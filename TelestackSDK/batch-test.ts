import { TelestackClient } from './src/index';

declare const process: any;

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
};

const db = new TelestackClient({
    endpoint: 'http://localhost:8787',
    centrifugoUrl: 'ws://localhost:8000/connection/websocket',
    userId: 'batch-tester-' + Date.now(),
    workspaceId: 'test-workspace'
});

async function runBatchTest() {
    console.log(`${colors.cyan}Starting Batch Operations Test...${colors.reset}\n`);

    const col = db.collection('batch-test');
    const doc1 = col.doc('doc1');
    const doc2 = col.doc('doc2');

    // 1. Setup real-time listeners
    let updatesReceived = 0;
    doc1.onSnapshot((data) => {
        if (data) {
            console.log(`📡 Real-time update for doc1:`, data);
            updatesReceived++;
        }
    });

    // 2. Commit a batch
    console.log(`ℹ Committing batch (SET doc1, SET doc2)...`);
    const batch = db.batch();
    batch.set(doc1, { name: 'Document 1', status: 'fresh' });
    batch.set(doc2, { name: 'Document 2', status: 'fresh' });

    await batch.commit();
    console.log(`${colors.green}✓ Batch committed successfully${colors.reset}`);

    // 3. Verify data
    const d1 = await doc1.get();
    const d2 = await doc2.get();

    if (d1?.name === 'Document 1' && d2?.name === 'Document 2') {
        console.log(`${colors.green}✓ Data verification passed${colors.reset}`);
    } else {
        console.log(`${colors.red}✗ Data verification failed${colors.reset}`);
        process.exit(1);
    }

    // 4. Update via batch
    console.log(`\nℹ Committing second batch (UPDATE doc1, DELETE doc2)...`);
    const batch2 = db.batch();
    batch2.update(doc1, { status: 'updated' });
    batch2.delete(doc2);
    await batch2.commit();

    const d1_updated = await doc1.get();
    const d2_deleted = await doc2.get();

    if (d1_updated?.status === 'updated' && d2_deleted === null) {
        console.log(`${colors.green}✓ Second batch verification passed${colors.reset}`);
    } else {
        console.log(`${colors.red}✗ Second batch verification failed${colors.reset}`);
        process.exit(1);
    }

    console.log(`\n${colors.green}🎉 ALL BATCH TESTS PASSED!${colors.reset}`);
    process.exit(0);
}

runBatchTest().catch(err => {
    console.error(`${colors.red}Batch Test Failed:`, err);
    process.exit(1);
});
