import { SignJWT, jwtVerify } from 'jose';

export interface Env {
    DB: D1Database;
    CENTRIFUGO_API_KEY: string;
    CENTRIFUGO_API_URL: string;
    TOKEN_SECRET: string;
}

interface DocumentRequest {
    data: any;
    userId: string;
    path?: string;
    workspaceId?: string;
}

// Helper to publish to Centrifugo via fetch
async function publishToCentrifugo(env: Env, channel: string, data: any) {
    if (!env.CENTRIFUGO_API_URL || !env.CENTRIFUGO_API_KEY) {
        console.error("Centrifugo API URL or KEY missing in env");
        return;
    }

    console.log(`📡 Worker: Publishing to Centrifugo on[${channel}]`, JSON.stringify(data).substring(0, 100) + "...");

    try {
        const response = await fetch(env.CENTRIFUGO_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `apikey ${env.CENTRIFUGO_API_KEY} `
            },
            body: JSON.stringify({
                method: 'publish',
                params: { channel, data }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Centrifugo publish failed(${response.status}): ${errorText} `);
        } else {
            const result = await response.json() as any;
            if (result.error) {
                console.error(`❌ Centrifugo API error: `, result.error);
            } else {
                console.log(`✅ Centrifugo publish success!`);
            }
        }
    } catch (e: any) {
        console.error("❌ Failed to publish to Centrifugo:", e.message);
    }
}

// Security Rules Engine
class SecurityRules {
    private rules: any[];

    constructor(rulesConfig: any) {
        this.rules = rulesConfig.rules;
    }

    async evaluate(path: string, operation: 'read' | 'write' | 'delete', auth: any): Promise<boolean> {
        for (const rule of this.rules) {
            const match = this.matchPath(rule.path, path);
            if (match) {
                const expression = rule.allow[operation] || rule.allow['write'] || 'false';
                return this.evaluateExpression(expression, { ...match.params, auth });
            }
        }
        return false; // Default deny
    }

    private matchPath(pattern: string, path: string): { params: any } | null {
        const patternParts = pattern.split('/');
        const pathParts = path.split('/');

        if (pattern.endsWith('/**')) {
            const basePattern = pattern.slice(0, -3);
            if (path.startsWith(basePattern)) {
                return { params: {} }; // Basic wildcard match
            }
        }

        if (pattern.includes('{path=**}')) {
            const basePattern = pattern.split('{path=**}')[0];
            if (path.startsWith(basePattern)) {
                const remainingPath = path.substring(basePattern.length);
                return { params: { path: remainingPath } };
            }
        }

        if (patternParts.length !== pathParts.length) return null;

        const params: any = {};
        for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i].startsWith('{') && patternParts[i].endsWith('}')) {
                const paramName = patternParts[i].slice(1, -1);
                params[paramName] = pathParts[i];
            } else if (patternParts[i] !== pathParts[i]) {
                return null;
            }
        }
        return { params };
    }

    private evaluateExpression(expression: string, context: any): boolean {
        if (expression === 'true') return true;
        if (expression === 'false') return false;
        if (expression === 'auth !== null') return context.auth !== null;

        // Simple but dangerous: string comparison for auth.userId
        // In a real system, we'd use a safe expression evaluator
        try {
            // Replace variables from context
            let evalStr = expression;
            for (const [key, value] of Object.entries(context)) {
                if (typeof value === 'string') {
                    evalStr = evalStr.replace(new RegExp(key, 'g'), `'${value}'`);
                }
            }
            // For nested auth.userId
            if (context.auth) {
                evalStr = evalStr.replace(/auth\.userId/g, `'${context.auth.userId}'`);
                evalStr = evalStr.replace(/auth\.sub/g, `'${context.auth.userId}'`); // Use userId for sub
                evalStr = evalStr.replace(/auth\.role/g, `'${context.auth.role || ''}'`); // Add role if available
            }

            // Note: This is an extremely simplified evaluator for the demo
            return eval(evalStr);
        } catch (e) {
            console.error("Rule Evaluation Error:", e);
            return false;
        }
    }
}

const rulesConfig = {
    "rules": [
        {
            "path": "sync",
            "allow": {
                "read": "auth !== null"
            }
        },
        {
            "path": "storage/users/{userId}/**",
            "allow": {
                "read": "auth !== null && auth.sub === userId",
                "write": "auth !== null && auth.sub === userId",
                "delete": "auth !== null && auth.sub === userId"
            }
        },
        {
            "path": "documents/{path=**}",
            "allow": {
                "read": "auth.userId === userId",
                "write": "auth.userId === userId"
            }
        },
        {
            "path": "{collection}",
            "allow": {
                "read": "true",
                "write": "auth !== null"
            }
        },
        {
            "path": "{collection}/{id}",
            "allow": {
                "read": "true",
                "write": "auth !== null"
            }
        },
        {
            "path": "{collection}/{id}/**",
            "allow": {
                "read": "true",
                "write": "auth !== null"
            }
        }
    ]
};

const security = new SecurityRules(rulesConfig);

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, workspaceId',
    'Access-Control-Max-Age': '0',
};

async function initDatabase(env: Env) {
    await env.DB.batch([
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS documents(
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    collection_name TEXT NOT NULL,
    path TEXT NOT NULL,
    user_id TEXT NOT NULL,
    data TEXT NOT NULL,
    version INTEGER DEFAULT 0,
    deleted_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
    `),
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS events(
        version INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
        `),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_events_doc ON events(doc_id)`),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_events_workspace ON events(workspace_id)`),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_path_prefix ON documents(path) WHERE deleted_at IS NULL`)
    ]);
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        // Handle CORS Preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // Self-initialization
            await initDatabase(env);

            const url = new URL(request.url);
            const method = request.method;
            const pathParts = url.pathname.split('/').filter(Boolean);

            // Extract Auth Context from JWT
            let auth: any = null;
            const authHeader = request.headers.get('Authorization');
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                try {
                    const secret = env.TOKEN_SECRET || 'my_32_char_secret_key_testing_123';
                    const secretKey = new TextEncoder().encode(secret);
                    const { payload } = await jwtVerify(token, secretKey);
                    auth = { userId: payload.sub };
                    console.log(`✓ Auth context verified for ${auth.userId}`);
                } catch (e) {
                    console.warn("JWT Verification failed, proceeding as anonymous");
                }
            }


            // Routing: /documents
            if (pathParts[0] === 'documents') {
                const collection = pathParts[1];
                const docId = pathParts[2];
                const docPath = pathParts.slice(1).join('/');

                // Security Check for CRUD
                if (collection !== 'internal' && collection !== 'auth') {
                    const operation = method === 'GET' ? 'read' : 'write';
                    const isAllowed = await security.evaluate(docPath, operation, auth);
                    if (!isAllowed) {
                        return new Response("Permission Denied", { status: 403, headers: corsHeaders });
                    }
                }

                // Internal Reset Endpoint
                if (collection === 'internal' && docId === 'reset' && method === 'POST') {
                    await env.DB.batch([
                        env.DB.prepare("DROP TABLE IF EXISTS documents"),
                        env.DB.prepare("DROP TABLE IF EXISTS events")
                    ]);
                    await initDatabase(env);
                    return Response.json({ message: "Database reset successful" }, { headers: corsHeaders });
                }

                // 0. BATCH
                if (method === 'POST' && collection === 'batch') {
                    const { operations } = await request.json() as any;
                    if (!Array.isArray(operations)) return new Response("operations array required", { status: 400, headers: corsHeaders });

                    const d1Ops: D1PreparedStatement[] = [];
                    const publishPayloads: { channel: string, data: any }[] = [];
                    const workspaceId = request.headers.get('workspaceId') || 'default';

                    for (const op of operations) {
                        const { type, path, data, expectedVersion } = op;
                        const parts = path.split('/');
                        const col = parts[parts.length - 2];
                        const id = parts[parts.length - 1];
                        const userId = auth?.userId || 'anonymous';

                        // 1. Fetch current version for OCC
                        const currentDoc = await env.DB.prepare("SELECT version FROM documents WHERE id = ?").bind(id).first() as any;
                        if (expectedVersion !== undefined) {
                            if (!currentDoc || currentDoc.version !== expectedVersion) {
                                return new Response(`Version Conflict for ${path}`, { status: 409, headers: corsHeaders });
                            }
                        }

                        // Security Check
                        const authOp = (type === 'DELETE') ? 'delete' : 'write';
                        if (!(await security.evaluate(path, authOp, auth))) {
                            return new Response(`Permission Denied for ${path}`, { status: 403, headers: corsHeaders });
                        }

                        const eventId = crypto.randomUUID();
                        const eventType = type === 'SET' ? 'INSERT' : type === 'UPDATE' ? 'UPDATE' : 'DELETE';

                        // 1. Prepare Event Insert
                        d1Ops.push(env.DB.prepare(
                            `INSERT INTO events(id, doc_id, workspace_id, event_type, payload) VALUES(?, ?, ?, ?, ?)`
                        ).bind(eventId, id, workspaceId, eventType, JSON.stringify(data || {})));

                        // 2. Prepare Doc Op
                        if (type === 'SET') {
                            d1Ops.push(env.DB.prepare(
                                `INSERT INTO documents(id, workspace_id, collection_name, path, user_id, data, version)
VALUES(?, ?, ?, ?, ?, ?, (SELECT last_insert_rowid()))
                                 ON CONFLICT(id) DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = CURRENT_TIMESTAMP, deleted_at = NULL`
                            ).bind(id, workspaceId, col, path, userId, JSON.stringify(data)));
                        } else if (type === 'UPDATE') {
                            d1Ops.push(env.DB.prepare(
                                `UPDATE documents SET data = ?, version = (SELECT last_insert_rowid()), updated_at = CURRENT_TIMESTAMP WHERE id = ? `
                            ).bind(JSON.stringify(data), id));
                        } else if (type === 'DELETE') {
                            d1Ops.push(env.DB.prepare(
                                `UPDATE documents SET deleted_at = CURRENT_TIMESTAMP, version = (SELECT last_insert_rowid()) WHERE id = ? `
                            ).bind(id));
                        }

                        // 3. Prepare Publication
                        const collectionPath = path.split('/').slice(0, -1).join('/');
                        const pubType = type === 'DELETE' ? 'DELETED' : (type === 'SET' ? 'CREATED' : 'UPDATED');

                        publishPayloads.push({
                            channel: `collection:${collectionPath.replace(/\//g, '_')}`,
                            data: { type: pubType, id, path, doc: { id, path, data, userId } }
                        });
                        publishPayloads.push({
                            channel: `path:${path.replace(/\//g, '_')}`,
                            data: { type: pubType, id, path, data, userId }
                        });
                    }

                    try {
                        const batchRes = await env.DB.batch(d1Ops);
                        const lastVersion = batchRes[batchRes.length - 1].meta.last_row_id;

                        // Broadcast publications
                        for (const pub of publishPayloads) {
                            pub.data.version = lastVersion;
                            await publishToCentrifugo(env, pub.channel, pub.data);
                        }

                        return Response.json({ success: true, version: lastVersion }, { headers: corsHeaders });
                    } catch (error: any) {
                        return new Response(error.message, { status: 500, headers: corsHeaders });
                    }
                }

                // Centrifugo JWT Token Provider
                if (collection === 'auth' && docId === 'token' && method === 'POST') {
                    const { userId } = await request.json() as any;
                    if (!userId) return new Response("userId required", { status: 400, headers: corsHeaders });

                    const secret = env.TOKEN_SECRET || 'my_32_char_secret_key_testing_123';
                    const secretKey = new TextEncoder().encode(secret);

                    const token = await new SignJWT({
                        sub: userId,
                        user: userId
                    })
                        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
                        .setIssuedAt()
                        .setExpirationTime('24h')
                        .sign(secretKey);

                    console.log(`✓ JWT generated with jose for ${userId}`);
                    return Response.json({ token, debug_payload: { sub: userId } }, { headers: corsHeaders });
                }

                // 1. CREATE
                if (method === 'POST') {
                    if (!collection) return new Response("Collection required", { status: 400, headers: corsHeaders });

                    const { data, userId, parentPath, workspaceId } = await request.json() as any;
                    if (!data || !userId) return new Response("data and userId required", { status: 400, headers: corsHeaders });

                    const id = crypto.randomUUID();
                    const eventId = crypto.randomUUID();
                    const workspace = workspaceId || 'default';
                    const docPath = parentPath ? `${parentPath}/${collection}/${id}` : `${collection}/${id}`;
                    const collectionPath = parentPath ? `${parentPath}/${collection}` : `${collection}`;

                    try {
                        // 1. Insert Event to get the version
                        const eventRes = await env.DB.prepare(
                            `INSERT INTO events (id, doc_id, workspace_id, event_type, payload) VALUES (?, ?, ?, 'INSERT', ?)`
                        ).bind(eventId, id, workspace, JSON.stringify(data)).run();

                        const version = eventRes.meta.last_row_id;

                        // 2. Insert Document with that version
                        await env.DB.prepare(
                            `INSERT INTO documents (id, workspace_id, collection_name, path, user_id, data, version) VALUES (?, ?, ?, ?, ?, ?, ?)`
                        ).bind(id, workspace, collection, docPath, userId, JSON.stringify(data), version).run();

                        const payload = {
                            type: 'CREATED',
                            doc: { id, collection, path: docPath, userId, data, version, workspaceId: workspace }
                        };

                        await publishToCentrifugo(env, `collection:${collectionPath.replace(/\//g, '_')}`, payload);
                        await publishToCentrifugo(env, `path:${docPath.replace(/\//g, '_')}`, payload);

                        return Response.json({ id, path: docPath, version, collection, workspaceId: workspace }, { status: 201, headers: corsHeaders });
                    } catch (error: any) {
                        return new Response(error.message, { status: 500, headers: corsHeaders });
                    }
                }
                // 1.5 SYNC
                else if (method === 'GET' && collection === 'sync') {
                    const workspaceId = url.searchParams.get('workspaceId') || 'default';
                    const sinceVersion = parseInt(url.searchParams.get('since') || '0');

                    const { results } = await env.DB.prepare(
                        `SELECT * FROM events WHERE workspace_id = ? AND version > ? ORDER BY version ASC LIMIT 1000`
                    ).bind(workspaceId, sinceVersion).all();

                    return Response.json({
                        changes: results.map((r: any) => ({ ...r, payload: JSON.parse(r.payload) })),
                        serverTime: new Date().toISOString()
                    }, { headers: corsHeaders });
                }
                // 1.7 SECURE QUERY
                else if (method === 'GET' && collection === 'query') {
                    const workspaceId = url.searchParams.get('workspaceId') || 'default';
                    const filtersJson = url.searchParams.get('filters') || '[]';
                    console.log(`DEBUG filtersJson: ${filtersJson}`);
                    const orderByField = url.searchParams.get('orderByField');
                    const orderDirection = (url.searchParams.get('orderDirection') || 'ASC').toUpperCase();
                    const limit = parseInt(url.searchParams.get('limit') || '100');

                    let query = `SELECT * FROM documents WHERE workspace_id = ? AND deleted_at IS NULL`;
                    const params: any[] = [workspaceId];

                    try {
                        const filters = JSON.parse(filtersJson);
                        if (Array.isArray(filters)) {
                            for (const f of filters) {
                                const { field, op, value } = f;
                                // Basic injection protection for field names (alphanumeric + dots)
                                if (!/^[a-zA-Z0-9.]+$/.test(field)) continue;

                                const fieldExpr = `json_extract(data, '$.${field}')`;

                                if (op === '==') {
                                    query += ` AND ${fieldExpr} = ?`;
                                    params.push(value);
                                } else if (op === '!=') {
                                    query += ` AND ${fieldExpr} != ?`;
                                    params.push(value);
                                } else if (['<', '<=', '>', '>='].includes(op)) {
                                    query += ` AND ${fieldExpr} ${op} ?`;
                                    params.push(value);
                                } else if (op === 'in' && Array.isArray(value)) {
                                    const placeholders = value.map(() => '?').join(', ');
                                    query += ` AND ${fieldExpr} IN (${placeholders})`;
                                    params.push(...value);
                                } else if (op === 'array-contains') {
                                    query += ` AND EXISTS (SELECT 1 FROM json_each(json_extract(data, '$.${field}')) WHERE json_each.value = ?)`;
                                    params.push(value);
                                } else if (op === 'LIKE') {
                                    query += ` AND ${fieldExpr} LIKE ?`;
                                    params.push(value);
                                }
                            }
                        }
                    } catch (e) {
                        return new Response("Invalid filters JSON", { status: 400, headers: corsHeaders });
                    }

                    if (orderByField && /^[a-zA-Z0-9.]+$/.test(orderByField)) {
                        query += ` ORDER BY json_extract(data, '$.${orderByField}') ${orderDirection === 'DESC' ? 'DESC' : 'ASC'}`;
                    }

                    query += ` LIMIT ?`;
                    params.push(limit);

                    console.log(`DEBUG SQL: ${query}`, params);

                    const { results } = await env.DB.prepare(query).bind(...params).all();
                    const response = Response.json(results.map((r: any) => ({ ...r, data: JSON.parse(r.data) })), { headers: corsHeaders });
                    response.headers.set('X-Debug-SQL', query);
                    response.headers.set('X-Debug-Params', JSON.stringify(params));
                    return response;
                }
                // 2. LIST
                else if (method === 'GET' && collection && !docId) {
                    const workspaceId = url.searchParams.get('workspaceId') || 'default';
                    const parentPath = url.searchParams.get('parentPath');

                    let query = `SELECT * FROM documents WHERE collection_name = ? AND workspace_id = ? AND deleted_at IS NULL`;
                    const params: any[] = [collection, workspaceId];

                    if (parentPath) {
                        query += ` AND path LIKE ? || '/${collection}/%'`;
                        params.push(parentPath);
                    } else {
                        query += ` AND (path NOT LIKE '%/%/%')`;
                    }

                    const { results } = await env.DB.prepare(query).bind(...params).all();
                    return Response.json(results.map((r: any) => ({ ...r, data: JSON.parse(r.data) })), { headers: corsHeaders });
                }
                // 3. GET SINGLE
                else if (method === 'GET' && docId) {
                    const doc = await env.DB.prepare("SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL").bind(docId).first();
                    if (!doc) return new Response("Not Found", { status: 404, headers: corsHeaders });
                    return Response.json({ ...(doc as any), data: JSON.parse((doc as any).data) }, { headers: corsHeaders });
                }
                // 4. SET (PUT)
                else if (method === 'PUT' && docId) {
                    const { data, userId, workspaceId, parentPath, expectedVersion } = await request.json() as any;
                    const workspace = workspaceId || 'default';
                    const eventId = crypto.randomUUID();

                    const doc = await env.DB.prepare("SELECT path, version FROM documents WHERE id = ?").bind(docId).first() as any;

                    if (doc) {
                        // Check Precondition for OCC
                        if (expectedVersion !== undefined && doc.version !== expectedVersion) {
                            return new Response("Version Conflict", { status: 409, headers: corsHeaders });
                        }

                        // UPDATE via SET
                        const eventRes = await env.DB.prepare(
                            `INSERT INTO events (id, doc_id, workspace_id, event_type, payload) VALUES (?, ?, ?, 'SET', ?)`
                        ).bind(eventId, docId, workspace, JSON.stringify(data)).run();

                        const version = eventRes.meta.last_row_id;
                        const collectionPath = doc.path.split('/').slice(0, -1).join('/');

                        await env.DB.prepare(
                            `UPDATE documents SET data = ?, version = ?, updated_at = CURRENT_TIMESTAMP, deleted_at = NULL WHERE id = ?`
                        ).bind(JSON.stringify(data), version, docId).run();

                        const payload = {
                            type: 'UPDATED',
                            id: docId,
                            doc: { id: docId, collection, path: doc.path, data, version, userId, workspaceId: workspace },
                            version
                        };
                        await publishToCentrifugo(env, `collection:${collectionPath.replace(/\//g, '_')}`, payload);
                        await publishToCentrifugo(env, `path:${doc.path.replace(/\//g, '_')}`, payload);

                        return Response.json({ success: true, version }, { headers: corsHeaders });
                    } else {
                        // UPSERT
                        const docPath = parentPath ? `${parentPath}/${collection}/${docId}` : `${collection}/${docId}`;
                        const collectionPath = parentPath ? `${parentPath}/${collection}` : `${collection}`;

                        const eventRes = await env.DB.prepare(
                            `INSERT INTO events (id, doc_id, workspace_id, event_type, payload) VALUES (?, ?, ?, 'INSERT', ?)`
                        ).bind(eventId, docId, workspace, JSON.stringify(data)).run();

                        const version = eventRes.meta.last_row_id;

                        await env.DB.prepare(
                            `INSERT INTO documents (id, workspace_id, collection_name, path, user_id, data, version) VALUES (?, ?, ?, ?, ?, ?, ?)`
                        ).bind(docId, workspace, collection, docPath, userId, JSON.stringify(data), version).run();

                        const payload = { type: 'CREATED', doc: { id: docId, collection, path: docPath, data, version, workspaceId: workspace } };
                        await publishToCentrifugo(env, `collection:${collectionPath.replace(/\//g, '_')}`, payload);
                        await publishToCentrifugo(env, `path:${docPath.replace(/\//g, '_')}`, payload);

                        return Response.json({ id: docId, path: docPath, version }, { status: 201, headers: corsHeaders });
                    }
                }
                // 5. UPDATE (PATCH)
                else if (method === 'PATCH' && docId) {
                    const { data, userId, workspaceId, expectedVersion } = await request.json() as any;
                    const workspace = workspaceId || 'default';
                    const eventId = crypto.randomUUID();

                    const doc = await env.DB.prepare("SELECT path, version FROM documents WHERE id = ?").bind(docId).first() as any;
                    if (!doc) return new Response("Not Found", { status: 404, headers: corsHeaders });

                    // Check Precondition for OCC
                    if (expectedVersion !== undefined && doc.version !== expectedVersion) {
                        return new Response("Version Conflict", { status: 409, headers: corsHeaders });
                    }

                    const eventRes = await env.DB.prepare(
                        `INSERT INTO events (id, doc_id, workspace_id, event_type, payload) VALUES (?, ?, ?, 'UPDATE', ?)`
                    ).bind(eventId, docId, workspace, JSON.stringify(data)).run();

                    const version = eventRes.meta.last_row_id;
                    const collectionPath = doc.path.split('/').slice(0, -1).join('/');

                    await env.DB.prepare(
                        `UPDATE documents SET data = json_patch(data, ?), version = ?, updated_at = CURRENT_TIMESTAMP, deleted_at = NULL WHERE id = ?`
                    ).bind(JSON.stringify(data), version, docId).run();

                    // Fetch final state for real-time delivery
                    const updatedDoc = await env.DB.prepare("SELECT * FROM documents WHERE id = ?").bind(docId).first() as any;
                    const finalData = JSON.parse(updatedDoc.data);

                    const payload = {
                        type: 'UPDATED',
                        id: docId,
                        doc: {
                            id: docId,
                            collection,
                            path: updatedDoc.path,
                            data: finalData,
                            version,
                            userId,
                            workspaceId: workspace
                        },
                        version
                    };
                    await publishToCentrifugo(env, `collection:${collectionPath.replace(/\//g, '_')}`, payload);
                    await publishToCentrifugo(env, `path:${updatedDoc.path.replace(/\//g, '_')}`, payload);

                    return Response.json({ success: true, version }, { headers: corsHeaders });
                }
                // 6. DELETE
                else if (method === 'DELETE' && docId) {
                    const { expectedVersion } = await request.json().catch(() => ({})) as any;
                    const doc = await env.DB.prepare("SELECT path, workspace_id, version FROM documents WHERE id = ?").bind(docId).first() as any;
                    if (doc) {
                        // Check Precondition for OCC
                        if (expectedVersion !== undefined && doc.version !== expectedVersion) {
                            return new Response("Version Conflict", { status: 409, headers: corsHeaders });
                        }

                        const eventRes = await env.DB.prepare(
                            `INSERT INTO events (id, doc_id, workspace_id, event_type, payload) VALUES (?, ?, ?, 'DELETE', '{}')`
                        ).bind(crypto.randomUUID(), docId, doc.workspace_id).run();

                        const version = eventRes.meta.last_row_id;
                        const collectionPath = doc.path.split('/').slice(0, -1).join('/');

                        await env.DB.prepare(
                            "UPDATE documents SET deleted_at = CURRENT_TIMESTAMP, version = ? WHERE id = ?"
                        ).bind(version, docId).run();

                        const payload = { type: 'DELETED', id: docId, version };
                        await publishToCentrifugo(env, `collection:${collectionPath.replace(/\//g, '_')}`, payload);
                        await publishToCentrifugo(env, `path:${doc.path.replace(/\//g, '_')}`, payload);
                    }
                    return new Response(null, { status: 204, headers: corsHeaders });
                }
            }

            return new Response("Telestack Real-time DB Engine Active", { status: 200, headers: corsHeaders });
        } catch (e: any) {
            console.error("Worker Error:", e.message, e.stack);
            return new Response(e.message, { status: 500, headers: corsHeaders });
        }
    }
};
