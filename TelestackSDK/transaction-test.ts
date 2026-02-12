import { TelestackClient } from './src/index';

declare const process: any;

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
};

const db = new TelestackClient({
    endpoint: 'http://localhost:8787',
    centrifugoUrl: 'ws://localhost:8000/connection/websocket',
    userId: 'tx-tester-' + Date.now(),
    workspaceId: 'test-workspace'
});

async function runTransactionTest() {
    console.log(`${colors.cyan}Starting Transactions & OCC Test...${colors.reset}\n`);

    const col = db.collection('tx-test');
    const docRef = col.doc('counter');

    // 1. Initialize counter
    console.log(`ℹ Initializing counter to 0...`);
    await docRef.set({ count: 0 });

    // 2. Run a simple transaction
    console.log(`ℹ Running simple increment transaction...`);
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        const newCount = (snapshot.data()?.count || 0) + 1;
        transaction.update(docRef, { count: newCount }, snapshot);
    });

    const val1 = await docRef.get();
    if (val1?.count === 1) {
        console.log(`${colors.green}✓ Simple transaction passed (count: 1)${colors.reset}`);
    } else {
        console.log(`${colors.red}✗ Simple transaction failed (count: ${val1?.count})${colors.reset}`);
        process.exit(1);
    }

    // 3. Test Conflict and Retry
    console.log(`\nℹ Testing conflict and retry...`);
    console.log(`   (We will simulate a concurrent update during the transaction)`);

    let attempt = 0;
    await db.runTransaction(async (transaction) => {
        attempt++;
        console.log(`   Transaction attempt ${attempt}...`);

        const snapshot = await transaction.get(docRef);

        // Simulating concurrent update ONLY on first attempt
        if (attempt === 1) {
            console.log(`${colors.yellow}   ! Simulating concurrent update...${colors.reset}`);
            // Use a separate client or direct fetch to break the version
            await docRef.update({ count: 100 });
        }

        const newCount = (snapshot.data()?.count || 0) + 1;
        transaction.update(docRef, { count: newCount }, snapshot);
    });

    const finalVal = await docRef.get();
    if (finalVal?.count === 101) {
        console.log(`${colors.green}✓ Conflict & Retry test passed!${colors.reset}`);
        console.log(`   (Final count: 101, properly incremented from 100 which was the concurrent update)`);
    } else {
        console.log(`${colors.red}✗ Conflict & Retry test failed (final count: ${finalVal?.count})${colors.reset}`);
        process.exit(1);
    }

    console.log(`\n${colors.green}🎉 ALL TRANSACTION TESTS PASSED!${colors.reset}`);
    process.exit(0);
}

runTransactionTest().catch(err => {
    console.error(`${colors.red}Transaction Test Failed:`, err);
    process.exit(1);
});
