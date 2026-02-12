/**
 * Comprehensive Real-time Database Functionality Test
 * Tests all aspects of the Telestack DB real-time features
 */

import { TelestackClient } from './src/index';

// Color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

function success(message: string) {
    log(`✓ ${message}`, colors.green);
}

function error(message: string) {
    log(`✗ ${message}`, colors.red);
}

function info(message: string) {
    log(`ℹ ${message}`, colors.cyan);
}

function section(message: string) {
    log(`\n${'='.repeat(60)}`, colors.blue);
    log(message, colors.blue);
    log('='.repeat(60), colors.blue);
}

// Test configuration
const db = new TelestackClient({
    endpoint: 'http://localhost:8787',
    centrifugoUrl: 'ws://localhost:8000/connection/websocket',
    userId: 'test-user-' + Date.now(),
    workspaceId: 'test-workspace'
});

// Test state
let testsPassed = 0;
let testsFailed = 0;
let realtimeUpdateReceived = false;

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function test1_BasicCRUD() {
    section('Test 1: Basic CRUD Operations');

    try {
        // CREATE
        info('Creating a new document...');
        const result = await db.collection('test-items').add({
            name: 'Test Item',
            value: 42,
            timestamp: new Date().toISOString()
        });
        success(`Document created with ID: ${result.id}`);

        // READ
        info('Reading the document...');
        const docRef = db.collection('test-items').doc(result.id);
        const data = await docRef.get();
        if (data && (data as any).name === 'Test Item') {
            success('Document read successfully');
        } else {
            throw new Error('Document data mismatch');
        }

        // UPDATE
        info('Updating the document...');
        await docRef.update({ value: 100 });
        const updatedData = await docRef.get();
        if ((updatedData as any).value === 100) {
            success('Document updated successfully');
        } else {
            throw new Error('Update failed');
        }

        // DELETE
        info('Deleting the document...');
        await docRef.delete();
        const deletedData = await docRef.get();
        if (deletedData === null) {
            success('Document deleted successfully');
        } else {
            throw new Error('Delete failed');
        }

        testsPassed++;
        success('Test 1 PASSED');
    } catch (e: any) {
        testsFailed++;
        error(`Test 1 FAILED: ${e.message}`);
    }
}

async function test2_RealtimeDocumentUpdates() {
    section('Test 2: Real-time Document Updates');

    try {
        info('Creating a document for real-time testing...');
        const result = await db.collection('realtime-test').add({
            status: 'initial',
            counter: 0
        });

        const docRef = db.collection('realtime-test').doc(result.id);

        info('Setting up real-time listener...');
        let updateCount = 0;
        const unsubscribe = docRef.onSnapshot((data) => {
            if (data) {
                info(`Real-time update received: status=${(data as any).status}, counter=${(data as any).counter}`);
                updateCount++;
                realtimeUpdateReceived = true;
            }
        });

        // Wait for initial snapshot
        await sleep(1000);

        info('Updating document to trigger real-time event...');
        await docRef.update({ status: 'updated', counter: 1 });

        // Wait for real-time update
        await sleep(2000);

        info('Updating document again...');
        await docRef.update({ counter: 2 });

        await sleep(2000);

        unsubscribe();

        if (updateCount >= 2) {
            success(`Received ${updateCount} real-time updates`);
            testsPassed++;
            success('Test 2 PASSED');
        } else {
            throw new Error(`Expected at least 2 updates, got ${updateCount}`);
        }

        // Cleanup
        await docRef.delete();
    } catch (e: any) {
        testsFailed++;
        error(`Test 2 FAILED: ${e.message}`);
    }
}

async function test3_RealtimeCollectionUpdates() {
    section('Test 3: Real-time Collection Updates');

    try {
        info('Setting up collection listener...');
        const collectionRef = db.collection('live-collection');
        let snapshotCount = 0;
        let lastDocCount = 0;

        const unsubscribe = collectionRef.onSnapshot((docs) => {
            snapshotCount++;
            lastDocCount = docs.length;
            info(`Collection snapshot ${snapshotCount}: ${docs.length} documents`);
        });

        // Wait for initial snapshot
        await sleep(1000);

        info('Adding first document...');
        const doc1 = await collectionRef.add({ name: 'Doc 1', order: 1 });
        await sleep(1500);

        info('Adding second document...');
        const doc2 = await collectionRef.add({ name: 'Doc 2', order: 2 });
        await sleep(1500);

        info('Adding third document...');
        const doc3 = await collectionRef.add({ name: 'Doc 3', order: 3 });
        await sleep(1500);

        unsubscribe();

        if (snapshotCount >= 3 && lastDocCount >= 3) {
            success(`Received ${snapshotCount} collection snapshots, final count: ${lastDocCount}`);
            testsPassed++;
            success('Test 3 PASSED');
        } else {
            throw new Error(`Expected multiple snapshots with 3+ docs, got ${snapshotCount} snapshots, ${lastDocCount} docs`);
        }

        // Cleanup
        await collectionRef.doc(doc1.id).delete();
        await collectionRef.doc(doc2.id).delete();
        await collectionRef.doc(doc3.id).delete();
    } catch (e: any) {
        testsFailed++;
        error(`Test 3 FAILED: ${e.message}`);
    }
}

async function test4_QueryWithFilters() {
    section('Test 4: Query with Filters');

    try {
        info('Creating test documents...');
        const col = db.collection('query-test');

        await col.add({ status: 'active', priority: 1, name: 'Task 1' });
        await col.add({ status: 'active', priority: 2, name: 'Task 2' });
        await col.add({ status: 'completed', priority: 1, name: 'Task 3' });
        await col.add({ status: 'active', priority: 3, name: 'Task 4' });

        await sleep(500);

        info('Querying active tasks with priority > 1...');
        const WORKER_URL = db.config.endpoint;
        const WORKSPACE_ID = db.workspaceId;
        const filters = [
            { field: 'status', op: '==', value: 'active' },
            { field: 'priority', op: '>', value: 1 }
        ];
        const res = await fetch(`${WORKER_URL}/documents/query?workspaceId=${WORKSPACE_ID}&collection=query-test&limit=100&filters=${encodeURIComponent(JSON.stringify(filters))}`);
        console.log(`DEBUG: X-Debug-SQL: ${res.headers.get('X-Debug-SQL')}`);
        console.log(`DEBUG: X-Debug-Params: ${res.headers.get('X-Debug-Params')}`);
        const results = await res.json();

        if (results.length === 2) {
            success(`Query returned ${results.length} documents (expected 2)`);
            testsPassed++;
            success('Test 4 PASSED');
        } else {
            throw new Error(`Expected 2 results, got ${results.length}`);
        }
    } catch (e: any) {
        testsFailed++;
        error(`Test 4 FAILED: ${e.message}`);
    }
}

async function test5_NestedCollections() {
    section('Test 5: Nested Collections (Hierarchical Paths)');

    try {
        info('Creating nested structure: users/u1/posts/p1');

        const userRef = db.collection('users').doc('user-test-1');
        await userRef.set({ name: 'Test User', email: 'test@example.com' });

        const postsCol = userRef.collection('posts');
        const postResult = await postsCol.add({
            title: 'My First Post',
            content: 'Hello World',
            likes: 0
        });

        success(`Created nested document at: ${postsCol.doc(postResult.id).path}`);

        info('Reading nested document...');
        const postData = await postsCol.doc(postResult.id).get();

        if (postData && (postData as any).title === 'My First Post') {
            success('Nested document read successfully');
            testsPassed++;
            success('Test 5 PASSED');
        } else {
            throw new Error('Failed to read nested document');
        }

        // Cleanup
        await postsCol.doc(postResult.id).delete();
        await userRef.delete();
    } catch (e: any) {
        testsFailed++;
        error(`Test 5 FAILED: ${e.message}`);
    }
}

async function test6_CentrifugoConnection() {
    section('Test 6: Centrifugo WebSocket Connection');

    try {
        const centrifuge = db.getCentrifuge();

        if (!centrifuge) {
            throw new Error('Centrifuge client not initialized');
        }

        info('Checking Centrifuge connection state...');

        // Wait a bit to ensure connection is established
        await sleep(2000);

        if (realtimeUpdateReceived) {
            success('Centrifuge connection is working (real-time updates received in previous tests)');
            testsPassed++;
            success('Test 6 PASSED');
        } else {
            throw new Error('No real-time updates received - connection may be broken');
        }
    } catch (e: any) {
        testsFailed++;
        error(`Test 6 FAILED: ${e.message}`);
    }
}

async function test7_VersionTracking() {
    section('Test 7: Version Tracking and Sync');

    try {
        const initialVersion = db.getLastVersion();
        info(`Initial version: ${initialVersion}`);

        info('Creating a document to increment version...');
        const result = await db.collection('version-test').add({
            data: 'test',
            timestamp: Date.now()
        });

        await sleep(500);

        const newVersion = db.getLastVersion();
        info(`New version: ${newVersion}`);

        if (newVersion > initialVersion) {
            success(`Version incremented from ${initialVersion} to ${newVersion}`);
            testsPassed++;
            success('Test 7 PASSED');
        } else {
            throw new Error('Version did not increment');
        }

        // Cleanup
        await db.collection('version-test').doc(result.id).delete();
    } catch (e: any) {
        testsFailed++;
        error(`Test 7 FAILED: ${e.message}`);
    }
}

async function runAllTests() {
    log('\n╔════════════════════════════════════════════════════════════╗', colors.blue);
    log('║  TELESTACK REAL-TIME DATABASE FUNCTIONALITY TEST SUITE    ║', colors.blue);
    log('╚════════════════════════════════════════════════════════════╝', colors.blue);

    info(`Worker Endpoint: ${db.config.endpoint}`);
    info(`Centrifugo URL: ${db.config.centrifugoUrl}`);
    info(`Workspace ID: ${db.workspaceId}`);
    info(`User ID: ${db.config.userId}`);

    // Wait for Centrifuge to connect
    info('\nWaiting for Centrifuge connection...');
    await sleep(2000);

    // Run all tests
    await test1_BasicCRUD();
    await test2_RealtimeDocumentUpdates();
    await test3_RealtimeCollectionUpdates();
    await test4_QueryWithFilters();
    await test5_NestedCollections();
    await test6_CentrifugoConnection();
    await test7_VersionTracking();

    // Summary
    section('Test Summary');
    log(`Total Tests: ${testsPassed + testsFailed}`, colors.blue);
    log(`Passed: ${testsPassed}`, colors.green);
    log(`Failed: ${testsFailed}`, testsFailed > 0 ? colors.red : colors.green);

    if (testsFailed === 0) {
        log('\n🎉 ALL TESTS PASSED! Real-time functionality is working as expected.', colors.green);
    } else {
        log('\n⚠️  SOME TESTS FAILED. Please review the errors above.', colors.red);
    }

    process.exit(testsFailed > 0 ? 1 : 0);
}

// Run the test suite
runAllTests().catch((e) => {
    error(`Fatal error: ${e.message}`);
    console.error(e);
    process.exit(1);
});
