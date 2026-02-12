import 'fake-indexeddb/auto';
import { TelestackClient } from './src/index';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
};

declare const process: any;

const NUM_USERS = 15;
const OPS_PER_USER = 40;
const COUNTER_DOC = 'stress-test/counter';
const SET_CONTENTION_DOC = 'stress-test/settler';

const clients = Array.from({ length: NUM_USERS }, (_, i) => new TelestackClient({
    endpoint: 'http://localhost:8787',
    centrifugoUrl: 'ws://localhost:8000/connection/websocket',
    userId: `stress-user-${i}`,
    workspaceId: 'stress-workspace',
    enablePersistence: true
}));

async function runUserTask(id: number, client: TelestackClient) {
    const col = client.collection(`stress-docs-${id}`);
    let success = 0;
    let fail = 0;

    for (let i = 0; i < OPS_PER_USER; i++) {
        try {
            const opType = Math.random();
            if (opType < 0.3) {
                // Independent Write
                await col.doc(`item-${i}`).set({ val: Math.random(), ts: Date.now() });
            } else if (opType < 0.6) {
                // SET Contention (Last one wins)
                await client.doc(SET_CONTENTION_DOC).set({ lastUser: id, ts: Date.now() });
            } else if (opType < 0.9) {
                // Transactional Increment (OCC Test)
                await client.runTransaction(async (tx) => {
                    const snap = await tx.get(client.doc(COUNTER_DOC));
                    const data = snap.data() || { count: 0 };
                    tx.update(client.doc(COUNTER_DOC), { count: (data.count || 0) + 1 }, snap);
                }, 10);
            } else {
                // Global Query
                await client.collection('bench-docs').limit(10).get();
            }
            success++;
        } catch (e: any) {
            fail++;
        }
    }
    return { success, fail };
}

async function runStressTest() {
    console.log(`\n${colors.magenta}=== Telestack DB Stress Test ===${colors.reset}`);
    console.log(`Users: ${NUM_USERS}, Ops/User: ${OPS_PER_USER}, Total Ops: ${NUM_USERS * OPS_PER_USER}`);
    console.log(`Contention Target (Counter):    ${COUNTER_DOC}`);
    console.log(`Contention Target (Settler):    ${SET_CONTENTION_DOC}\n`);

    // Reset contention docs
    await clients[0].doc(COUNTER_DOC).set({ count: 0 });
    await clients[0].doc(SET_CONTENTION_DOC).set({ lastUser: -1 });

    const start = performance.now();

    // Run all users concurrently
    const tasks = clients.map((c, i) => runUserTask(i, c));
    const stats = await Promise.all(tasks);

    const duration = performance.now() - start;
    const totalSuccess = stats.reduce((a, b) => a + b.success, 0);
    const totalFail = stats.reduce((a, b) => a + b.fail, 0);

    console.log(`\n${colors.cyan}--- Results ---${colors.reset}`);
    console.log(`Duration:       ${(duration / 1000).toFixed(2)}s`);
    console.log(`Throughput:     ${(totalSuccess / (duration / 1000)).toFixed(1)} ops/sec`);
    console.log(`Total Success:  ${colors.green}${totalSuccess}${colors.reset}`);
    console.log(`Total Failures: ${totalFail > 0 ? colors.red : colors.green}${totalFail}${colors.reset}`);

    // Verify contention doc count if transactions worked
    const finalSnap = await clients[0].doc(COUNTER_DOC).get();
    console.log(`\nFinal Transaction Count: ${colors.yellow}${finalSnap.count}${colors.reset}`);
    console.log(`${colors.magenta}================================${colors.reset}\n`);

    if (totalFail > totalSuccess * 0.1) { // Allowing 10% failure due to extreme local contention
        console.log(`${colors.red}STRESS TEST FAILED: Failure rate too high!${colors.reset}`);
        process.exit(1);
    } else {
        console.log(`${colors.green}STRESS TEST PASSED: Stability confirmed.${colors.reset}`);
        process.exit(0);
    }
}

runStressTest().catch(err => {
    console.error(err);
    process.exit(1);
});
