import { Centrifuge, PublicationContext } from 'centrifuge';

declare global {
    interface Window {
        Centrifuge: typeof Centrifuge;
    }
}

/**
 * Configuration for TelestackClient
 */
export interface Config {
    /** HTTP endpoint of the Telestack backend */
    endpoint?: string;
    /** Optional Centrifugo WebSocket endpoint for real-time updates */
    centrifugoUrl?: string;
    /** Workspace ID for multi-tenant apps */
    workspaceId?: string;
    /** Current user ID */
    userId: string;
    /** Enable offline persistence via IndexedDB */
    enablePersistence?: boolean;
}

/**
 * PersistenceEngine defines the contract for local storage
 */
export interface PersistenceEngine {
    get(table: string, id: string): Promise<any>;
    put(table: string, id: string, data: any): Promise<void>;
    delete(table: string, id: string): Promise<void>;
    getAll(table: string): Promise<any[]>;
    clear(table: string): Promise<void>;
}

/**
 * IndexedDB implementation of PersistenceEngine
 */
export class IndexedDBPersistence implements PersistenceEngine {
    private db: IDBDatabase | null = null;
    private dbName = 'TelestackDB_Cache';

    async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'path' });
                if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
            };
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    async get(table: string, path: string): Promise<any> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(table, 'readonly');
            const store = tx.objectStore(table);
            const req = store.get(path);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async put(table: string, id: string, data: any): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(table, 'readwrite');
            const store = tx.objectStore(table);
            const req = store.put({ ...data, path: id });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async delete(table: string, id: string): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(table, 'readwrite');
            const store = tx.objectStore(table);
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async getAll(table: string): Promise<any[]> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(table, 'readonly');
            const store = tx.objectStore(table);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async clear(table: string): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(table, 'readwrite');
            tx.objectStore(table).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

/** Supported query operators */
export type WhereFilterOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'array-contains' | 'in' | 'LIKE';

/** Custom Error class for Telestack operations */
export class TelestackError extends Error {
    constructor(public message: string, public code?: string) {
        super(message);
        this.name = 'TelestackError';
    }
}

/**
 * Main Telestack Client
 */
export class TelestackClient {
    private centrifuge: Centrifuge | null = null;
    private isProcessingQueue = false;
    public workspaceId: string;
    private lastVersion: number = 0;
    private token: string | null = null;
    private persistence: PersistenceEngine | null = null;

    constructor(public config: Config) {
        this.config.endpoint = config.endpoint || 'https://telestack-realtime-db.codeforgebyaravinth.workers.dev';
        this.config.centrifugoUrl = config.centrifugoUrl || 'wss://telestack-centrifugo.onrender.com/connection/websocket';
        this.workspaceId = config.workspaceId || 'default';

        if (config.enablePersistence) {
            this.persistence = new IndexedDBPersistence();
        }

        if (config.centrifugoUrl) {
            this.centrifuge = new Centrifuge(config.centrifugoUrl, {
                getToken: () => this.getToken()
            });

            this.centrifuge.on('connected', () => {
                console.log("Telestack: Connected to real-time via JWT. Syncing...");
                this.sync();
                this.processQueue(); // Process queue immediately on reconnect
            });
            this.centrifuge.on('error', (ctx) => {
                console.error("Telestack: Centrifuge error:", ctx);
            });
            this.centrifuge.on('disconnected', (ctx) => {
                console.warn("Telestack: Centrifuge disconnected:", ctx);
            });
            this.centrifuge.connect();
        }

        this.startBackgroundWorkers();
    }

    /** Ensure we have a valid JWT token */
    async getToken(): Promise<string> {
        if (this.token) return this.token;

        const res = await fetch(`${this.config.endpoint}/documents/auth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: this.config.userId })
        });
        if (!res.ok) throw new TelestackError("Auth failed: " + await res.text());

        const { token } = await res.json();
        this.token = token;
        return token;
    }

    /** Helper for authenticated fetch */
    async authFetch(url: string | URL, options: RequestInit = {}): Promise<Response> {
        const token = await this.getToken();
        const headers = {
            ...options.headers,
            'Authorization': `Bearer ${token}`,
            'workspaceId': this.workspaceId
        };
        return fetch(url.toString(), { ...options, headers });
    }

    /** Incremental sync to fetch changes since last version */
    async sync() {
        try {
            const url = new URL(`${this.config.endpoint}/documents/sync`);
            url.searchParams.set('workspaceId', this.workspaceId);
            url.searchParams.set('since', this.lastVersion.toString());

            const res = await this.authFetch(url);
            if (!res.ok) throw new TelestackError(await res.text());

            const { changes } = await res.json();
            if (changes && changes.length > 0) {
                this.lastVersion = Math.max(this.lastVersion, ...changes.map((c: any) => c.version));
                return changes;
            }
            return [];
        } catch (e: any) {
            console.error("Telestack: Sync failed", e);
            return [];
        }
    }

    /** Get a reference to a collection */
    collection<T = any>(path: string): CollectionReference<T> {
        return new CollectionReference<T>(this, path);
    }

    /** Get a reference to a document */
    doc<T = any>(path: string): DocumentReference<T> {
        const parts = path.split('/');
        if (parts.length % 2 !== 0) {
            throw new TelestackError("Invalid document path. Must have an even number of segments.");
        }
        const collectionPath = parts.slice(0, -1).join('/');
        const id = parts[parts.length - 1];
        return new DocumentReference<T>(this, collectionPath, id);
    }

    /** Get a new write batch */
    batch(): WriteBatch {
        return new WriteBatch(this);
    }

    /** Get presence information for a channel */
    async getPresence(channel: string) {
        if (!this.centrifuge) throw new TelestackError("Realtime not connected");
        return this.centrifuge.presence(channel);
    }

    /** Get presence stats for a channel */
    async getPresenceStats(channel: string) {
        if (!this.centrifuge) throw new TelestackError("Realtime not connected");
        return this.centrifuge.presenceStats(channel);
    }

    /** Run an atomic transaction with automatic retries (OCC) */
    async runTransaction<T>(updateFunction: (transaction: Transaction) => Promise<T>, maxRetries = 10): Promise<T> {
        let retries = 0;
        while (retries < maxRetries) {
            const transaction = new Transaction(this);
            try {
                const result = await updateFunction(transaction);
                await transaction.commit();
                return result;
            } catch (e: any) {
                if (e.message.includes("Conflict") || (e.status === 409)) {
                    retries++;
                    if (retries >= maxRetries) break;

                    // Full Jitter Backoff
                    const baseDelay = Math.min(100 * Math.pow(1.5, retries), 2000);
                    const delay = Math.random() * baseDelay;

                    console.warn(`Telestack: Transaction conflict, retrying (${retries}/${maxRetries}) in ${Math.round(delay)}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                throw e;
            }
        }
        throw new TelestackError(`Transaction failed after ${maxRetries} retries due to persistent conflicts.`);
    }

    getCentrifuge() { return this.centrifuge; }
    getPersistence() { return this.persistence; }
    getLastVersion() { return this.lastVersion; }
    updateLastVersion(v: number) { this.lastVersion = Math.max(this.lastVersion, v); }

    /** Background process to sync offline writes */
    async processQueue() {
        if (!this.persistence || this.isProcessingQueue) return;

        const queue = await this.persistence.getAll('queue');
        if (queue.length === 0) return;

        this.isProcessingQueue = true;
        console.log(`Telestack: Processing ${queue.length} queued offline writes...`);

        try {
            for (const item of queue) {
                try {
                    const docRef = this.doc(item.path);
                    if (item.type === 'SET') {
                        await docRef.set(item.data);
                    } else if (item.type === 'UPDATE') {
                        await docRef.update(item.data);
                    } else if (item.type === 'DELETE') {
                        await docRef.delete();
                    }

                    // If success, remove from queue and update doc version (to clear pending write flag)
                    await this.persistence.delete('queue', item.path);

                    if (item.type !== 'DELETE') {
                        const snap = await docRef.getSnapshot();
                        await this.persistence.put('documents', item.path, { data: snap.data(), version: snap.version });
                    }

                    console.log(`✓ Synced ${item.path}`);
                } catch (e: any) {
                    console.warn(`✗ Failed to sync ${item.path}, will retry later.`, e.message);
                    break; // Stop processing queue if one fails (likely network still down)
                }
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }

    /** Start periodic sync and queue processing */
    private startBackgroundWorkers() {
        setInterval(() => this.sync(), 30000); // Incremental sync every 30s
        setInterval(() => this.processQueue(), 5000); // Process queue every 5s
    }
}

/**
 * Query class for collection-level queries
 */
export class Query<T = any> {
    protected filters: { field: string, op: WhereFilterOp, value: any }[] = [];
    protected limitCount?: number;
    protected orderByField?: string;
    protected orderDirection: 'asc' | 'desc' = 'asc';
    private docsCache: T[] = [];
    private debounceTimer: any = null;

    constructor(protected client: TelestackClient, public path: string) { }

    /** Add a filter to the query */
    where(field: string, op: WhereFilterOp, value: any): Query<T> {
        this.filters.push({ field, op, value });
        return this;
    }

    /** Limit the number of documents */
    limit(n: number): Query<T> {
        this.limitCount = n;
        return this;
    }

    /** Order the documents */
    orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): Query<T> {
        this.orderByField = field;
        this.orderDirection = direction;
        return this;
    }

    /** Convert filters to SQL-like where clause for backend query */
    private buildWhereClause(): string {
        if (this.filters.length === 0) return '1=1';
        return this.filters.map(f => {
            let val = f.value;
            let sqlOp = f.op === '==' ? '=' : f.op;

            if (f.op === 'array-contains') {
                return `EXISTS (SELECT 1 FROM json_each(json_extract(data, '$.${f.field}')) WHERE json_each.value = ${typeof val === 'string' ? `'${val}'` : val})`;
            }

            const fieldExpr = `json_extract(data, '$.${f.field}')`;

            if (f.op === 'in') {
                const list = (val as any[]).map(v => typeof v === 'string' ? `'${v}'` : v).join(', ');
                return `${fieldExpr} IN (${list})`;
            }

            const formattedVal = typeof val === 'string' ? `'${val}'` : val;
            return `${fieldExpr} ${sqlOp} ${formattedVal}`;
        }).join(' AND ');
    }

    /** Fetch documents matching the query */
    async get(): Promise<T[]> {
        const persistence = this.client.getPersistence();
        const url = new URL(`${this.client.config.endpoint}/documents/query`);
        url.searchParams.set('workspaceId', this.client.workspaceId);
        url.searchParams.set('filters', JSON.stringify(this.filters));

        if (this.orderByField) {
            url.searchParams.set('orderByField', this.orderByField);
            url.searchParams.set('orderDirection', this.orderDirection);
        }
        if (this.limitCount) url.searchParams.set('limit', this.limitCount.toString());

        try {
            const res = await this.client.authFetch(url.toString());
            if (!res.ok) throw new TelestackError(await res.text());
            const data = await res.json();

            const docs = data.map((d: any) => ({ id: d.id, ...d.data }));

            // Cache results locally if persistence enabled
            if (persistence) {
                for (const d of data) {
                    await persistence.put('documents', `${this.path}/${d.id}`, { data: d.data, version: d.version });
                }
            }

            return docs;
        } catch (e) {
            if (persistence) {
                console.warn(`Telestack: Offline query for ${this.path}, serving from cache.`);
                const allDocs = await persistence.getAll('documents');
                // Filter docs that belong to this collection and match filters
                const filtered = allDocs
                    .filter(d => d.path.startsWith(this.path) && this.matches(d.data))
                    .map(d => ({ id: d.path.split('/').pop()!, ...d.data, metadata: { fromCache: true, hasPendingWrites: true } }));

                // Sort locally if needed
                if (this.orderByField) {
                    filtered.sort((a, b) => {
                        const valA = a[this.orderByField!];
                        const valB = b[this.orderByField!];
                        if (this.orderDirection === 'asc') return valA > valB ? 1 : -1;
                        return valA < valB ? 1 : -1;
                    });
                }
                if (this.limitCount) return filtered.slice(0, this.limitCount);
                return filtered;
            }
            throw e;
        }
    }

    /** Check if a document matches the local filters */
    private matches(doc: any): boolean {
        for (const filter of this.filters) {
            const docValue = doc[filter.field];
            switch (filter.op) {
                case '==': if (docValue !== filter.value) return false; break;
                case '!=': if (docValue === filter.value) return false; break;
                case '>': if (!(docValue > filter.value)) return false; break;
                case '<': if (!(docValue < filter.value)) return false; break;
                case '>=': if (!(docValue >= filter.value)) return false; break;
                case '<=': if (!(docValue <= filter.value)) return false; break;
                case 'in':
                    if (!Array.isArray(filter.value) || !filter.value.includes(docValue)) return false;
                    break;
                case 'array-contains':
                    if (!Array.isArray(docValue) || !docValue.includes(filter.value)) return false;
                    break;
            }
        }
        return true;
    }

    /** Subscribe to realtime updates for this query */
    onSnapshot(callback: (docs: T[]) => void) {
        const centrifuge = this.client.getCentrifuge();
        if (!centrifuge) return () => { };

        const channel = `collection:${this.path.replace(/\//g, '_')}`;
        const sub = centrifuge.newSubscription(channel);

        const debouncedCallback = () => {
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => callback([...this.docsCache]), 50);
        };

        sub.on('publication', async (ctx: PublicationContext) => {
            const event = ctx.data;
            console.log(`📡 Received publication on ${channel}:`, event.type, event.id || (event.doc && event.doc.id));

            if (event.version) this.client.updateLastVersion(event.version);

            let changed = false;
            const docId = event.id || (event.doc && event.doc.id);

            if (event.type === 'CREATED' || event.type === 'SET') {
                if (this.matches(event.doc.data)) {
                    if (this.limitCount || this.orderByField) {
                        const docs = await this.get();
                        this.docsCache = docs;
                        callback(docs);
                    } else {
                        this.docsCache = [...this.docsCache.filter(d => (d as any).id !== docId), { id: docId, ...event.doc.data }];
                        changed = true;
                    }
                }
            } else if (event.type === 'UPDATED') {
                const docData = event.doc ? event.doc.data : (event.patch ? event.patch : {});
                const matches = this.matches(docData);

                if (this.limitCount || this.orderByField) {
                    const docs = await this.get();
                    this.docsCache = docs;
                    callback(docs);
                } else if (matches) {
                    this.docsCache = this.docsCache.map(d => (d as any).id === docId ? { ...d, ...docData } : d);
                    changed = true;
                } else {
                    this.docsCache = this.docsCache.filter(d => (d as any).id !== docId);
                    changed = true;
                }
            } else if (event.type === 'DELETED') {
                this.docsCache = this.docsCache.filter(d => (d as any).id !== docId);
                changed = true;
            }

            if (changed && !(this.limitCount || this.orderByField)) {
                debouncedCallback();
            }
        });

        sub.subscribe();

        // Initial fetch
        this.get().then(docs => {
            this.docsCache = docs;
            callback(docs);
        });

        return () => {
            sub.unsubscribe();
            sub.removeAllListeners();
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
        };
    }

    /** Subscribe to presence events (Join/Leave) for this collection */
    onPresence(callback: (event: { action: 'join' | 'leave', user: string, clientId: string }) => void) {
        const centrifuge = this.client.getCentrifuge();
        if (!centrifuge) return () => { };

        const channel = `collection:${this.path.replace(/\//g, '_')}`;
        const sub = centrifuge.newSubscription(channel);

        sub.on('join', (ctx: any) => {
            callback({ action: 'join', user: ctx.info.user, clientId: ctx.info.client });
        });

        sub.on('leave', (ctx: any) => {
            callback({ action: 'leave', user: ctx.info.user, clientId: ctx.info.client });
        });

        sub.subscribe();
        return () => {
            sub.unsubscribe();
            sub.removeAllListeners();
        };
    }
}

/**
 * CollectionReference extends Query with add() and doc() methods
 */
export class CollectionReference<T = any> extends Query<T> {
    doc<U = T>(id: string): DocumentReference<U> {
        return new DocumentReference<U>(this.client, this.path, id);
    }

    /** Add a new document to this collection */
    async add(data: T): Promise<{ id: string, version: number }> {
        const collectionName = this.path.split('/').pop()!;
        const parentPath = this.path.includes('/') ? this.path.split('/').slice(0, -1).join('/') : undefined;

        const res = await this.client.authFetch(`${this.client.config.endpoint}/documents/${collectionName}`, {
            method: 'POST',
            body: JSON.stringify({
                data,
                userId: this.client.config.userId,
                workspaceId: this.client.workspaceId,
                parentPath
            })
        });
        if (!res.ok) throw new TelestackError(await res.text());

        const result = await res.json();
        if (result.version) this.client.updateLastVersion(result.version);
        return result;
    }
}

/**
 * DocumentReference allows CRUD operations and realtime subscription on a single document
 */
export class DocumentReference<T = any> {
    constructor(
        private client: TelestackClient,
        private collectionPath: string,
        private id: string
    ) { }

    get path() { return `${this.collectionPath}/${this.id}`; }

    /** Access a nested collection */
    collection<U = any>(name: string): CollectionReference<U> {
        return new CollectionReference<U>(this.client, `${this.path}/${name}`);
    }

    /** Fetch this document */
    async get(): Promise<T | null> {
        const snap = await this.getSnapshot();
        return snap.exists() ? snap.data() : null;
    }

    /** Fetch document snapshot (includes version for transactions) */
    async asyncGetSnapshot(): Promise<DocumentSnapshot<T>> {
        const persistence = this.client.getPersistence();
        const collectionName = this.collectionPath.split('/').pop()!;

        try {
            const res = await this.client.authFetch(`${this.client.config.endpoint}/documents/${collectionName}/${this.id}`);
            if (res.status === 404) return new DocumentSnapshot<T>(this.id, this.path, null, 0);
            if (!res.ok) throw new TelestackError(await res.text());

            const data = await res.json();
            if (data.version) {
                this.client.updateLastVersion(data.version);
                if (persistence) await persistence.put('documents', this.path, { data: data.data, version: data.version });
            }
            return new DocumentSnapshot<T>(this.id, this.path, data.data, data.version);
        } catch (e) {
            if (persistence) {
                const cached = await persistence.get('documents', this.path);
                if (cached) return new DocumentSnapshot<T>(this.id, this.path, cached.data, cached.version, { fromCache: true, hasPendingWrites: true });
            }
            throw e;
        }
    }

    /** Compatibility alias for existing codebase */
    async getSnapshot(): Promise<DocumentSnapshot<T>> {
        return this.asyncGetSnapshot();
    }

    /** Replace or create this document */
    async set(data: T): Promise<{ version: number }> {
        const persistence = this.client.getPersistence();
        const collectionName = this.collectionPath.split('/').pop()!;
        const parentPath = this.collectionPath.includes('/') ? this.collectionPath.split('/').slice(0, -1).join('/') : undefined;

        // Optimistic UI: Update local cache immediately
        if (persistence) await persistence.put('documents', this.path, { data, version: -1 }); // -1 indicates local-only for now

        try {
            const res = await this.client.authFetch(`${this.client.config.endpoint}/documents/${collectionName}/${this.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    data,
                    userId: this.client.config.userId,
                    workspaceId: this.client.workspaceId,
                    parentPath
                })
            });
            if (!res.ok) throw new TelestackError(await res.text());

            const result = await res.json();
            if (result.version) {
                this.client.updateLastVersion(result.version);
                if (persistence) await persistence.put('documents', this.path, { data, version: result.version });
            }
            return result;
        } catch (e) {
            if (persistence) {
                console.warn(`Telestack: Offline, queueing SET for ${this.path}`);
                await persistence.put('queue', this.path, { type: 'SET', path: this.path, data, collectionName, parentPath });
                return { version: -1 };
            }
            throw e;
        }
    }

    /** Update part of this document */
    async update(data: Partial<T>): Promise<{ version: number }> {
        const persistence = this.client.getPersistence();
        const collectionName = this.collectionPath.split('/').pop()!;
        const parentPath = this.collectionPath.includes('/') ? this.collectionPath.split('/').slice(0, -1).join('/') : undefined;

        // Optimistic UI: Apply patch to local cache
        if (persistence) {
            const cached = await persistence.get('documents', this.path);
            const newData = cached ? { ...cached.data, ...data } : data;
            await persistence.put('documents', this.path, { data: newData, version: cached ? cached.version : -1 });
        }

        try {
            const res = await this.client.authFetch(`${this.client.config.endpoint}/documents/${collectionName}/${this.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    data,
                    userId: this.client.config.userId,
                    workspaceId: this.client.workspaceId,
                    parentPath
                })
            });
            if (!res.ok) throw new TelestackError(await res.text());

            const result = await res.json();
            if (result.version) {
                this.client.updateLastVersion(result.version);
                if (persistence) {
                    const snap = await this.getSnapshot();
                    await persistence.put('documents', this.path, { data: snap.data(), version: result.version });
                }
            }
            return result;
        } catch (e) {
            if (persistence) {
                console.warn(`Telestack: Offline, queueing UPDATE for ${this.path}`);
                await persistence.put('queue', this.path, { type: 'UPDATE', path: this.path, data, collectionName, parentPath });
                return { version: -1 };
            }
            throw e;
        }
    }

    /** Delete this document */
    async delete(): Promise<void> {
        const persistence = this.client.getPersistence();
        const collectionName = this.collectionPath.split('/').pop()!;

        // Optimistic UI: Remove from local cache
        if (persistence) await persistence.delete('documents', this.path);

        try {
            const res = await this.client.authFetch(`${this.client.config.endpoint}/documents/${collectionName}/${this.id}`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new TelestackError(await res.text());
        } catch (e) {
            if (persistence) {
                console.warn(`Telestack: Offline, queueing DELETE for ${this.path}`);
                await persistence.put('queue', this.path, { type: 'DELETE', path: this.path, collectionName });
                return;
            }
            throw e;
        }
    }

    /** Subscribe to realtime changes on this document */
    onSnapshot(callback: (data: T | null) => void) {
        const centrifuge = this.client.getCentrifuge();
        if (!centrifuge) return () => { };

        // Production refinement: Subscribe to path namespace
        const channel = `path:${this.path.replace(/\//g, '_')}`;
        const sub = centrifuge.newSubscription(channel);

        sub.on('publication', (ctx: PublicationContext) => {
            const event = ctx.data;
            if (event.version) this.client.updateLastVersion(event.version);

            if (event.type === 'DELETED') callback(null);
            else {
                this.get().then(callback);
            }
        });

        sub.on('subscribed', (ctx) => console.log(`Telestack: Subscribed to document channel ${channel}`, ctx));
        sub.on('error', (ctx) => console.error(`Telestack: Document subscription error on ${channel}`, ctx));

        sub.subscribe();
        this.get().then(callback);

        return () => {
            sub.unsubscribe();
            sub.removeAllListeners();
        };
    }
}


/**
 * WriteBatch allows multiple write operations to be committed atomically
 */
export class WriteBatch {
    private operations: { type: 'SET' | 'UPDATE' | 'DELETE', path: string, data?: any }[] = [];

    constructor(private client: TelestackClient) { }

    set<T>(docRef: DocumentReference<T>, data: T): WriteBatch {
        this.operations.push({ type: 'SET', path: docRef.path, data });
        return this;
    }

    update<T>(docRef: DocumentReference<T>, data: Partial<T>): WriteBatch {
        this.operations.push({ type: 'UPDATE', path: docRef.path, data });
        return this;
    }

    delete(docRef: DocumentReference): WriteBatch {
        this.operations.push({ type: 'DELETE', path: docRef.path });
        return this;
    }

    async commit(): Promise<void> {
        if (this.operations.length === 0) return;

        const res = await this.client.authFetch(`${this.client.config.endpoint}/documents/batch`, {
            method: 'POST',
            body: JSON.stringify({ operations: this.operations })
        });
        if (!res.ok) throw new TelestackError(await res.text());

        const result = await res.json();
        if (result.version) this.client.updateLastVersion(result.version);
    }
}
/**
 * DocumentSnapshot contains document data and its database version
 */
export class DocumentSnapshot<T = any> {
    constructor(
        public readonly id: string,
        public readonly path: string,
        private _data: T | null,
        public readonly version: number,
        public readonly metadata: { fromCache: boolean, hasPendingWrites: boolean } = { fromCache: false, hasPendingWrites: false }
    ) { }

    exists(): boolean { return this._data !== null; }
    data(): T | null { return this._data; }
}

/**
 * Transaction allows read-modify-write operations with OCC
 */
export class Transaction {
    private operations: { type: 'SET' | 'UPDATE' | 'DELETE', path: string, data?: any, expectedVersion?: number }[] = [];

    constructor(private client: TelestackClient) { }

    async get<T>(docRef: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
        return docRef.getSnapshot();
    }

    set<T>(docRef: DocumentReference<T>, data: T, snapshot?: DocumentSnapshot<T>): Transaction {
        this.operations.push({
            type: 'SET',
            path: docRef.path,
            data,
            expectedVersion: snapshot?.version
        });
        return this;
    }

    update<T>(docRef: DocumentReference<T>, data: Partial<T>, snapshot?: DocumentSnapshot<T>): Transaction {
        this.operations.push({
            type: 'UPDATE',
            path: docRef.path,
            data,
            expectedVersion: snapshot?.version
        });
        return this;
    }

    delete(docRef: DocumentReference, snapshot?: DocumentSnapshot): Transaction {
        this.operations.push({
            type: 'DELETE',
            path: docRef.path,
            expectedVersion: snapshot?.version
        });
        return this;
    }

    async commit(): Promise<void> {
        if (this.operations.length === 0) return;

        const res = await this.client.authFetch(`${this.client.config.endpoint}/documents/batch`, {
            method: 'POST',
            body: JSON.stringify({ operations: this.operations })
        });

        if (res.status === 409) {
            const err = new TelestackError("Conflict");
            (err as any).status = 409;
            throw err;
        }

        if (!res.ok) throw new TelestackError(await res.text());

        const result = await res.json();
        if (result.version) this.client.updateLastVersion(result.version);
    }
}
