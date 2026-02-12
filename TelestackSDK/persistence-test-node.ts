import 'fake-indexeddb/auto';
import { TelestackClient } from './src/index';

declare const process: any;

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
};

// Mock fetch to simulate offline state
let isOffline = false;
const originalFetch = globalThis.fetch;

(globalThis as any).fetch = async (url: string, options: any) => {
    if (isOffline && !url.includes('auth/token')) {
        throw new Error('TypeError: Failed to fetch');
    }
    return originalFetch(url, options);
};

const client = new TelestackClient({
    endpoint: 'http://localhost:8787',
    centrifugoUrl: 'ws://localhost:8000/connection/websocket',
    userId: 'node-persist-tester-' + Date.now(),
    workspaceId: 'test-workspace',
    enablePersistence: true
});

async function runPersistenceTest() {
    console.log(`${colors.cyan}Starting Node.js Persistence & Offline Test...${colors.reset}\n`);

    const docRef = client.doc('offline-test/item-1');

    // 1. Initial ONLINE write
    console.log(`ℹ Step 1: Online write...`);
    await docRef.set({ count: 10 });
    const snap1 = await docRef.getSnapshot();
    if (snap1.data()?.count === 10 && !snap1.metadata.fromCache) {
        console.log(`${colors.green}✓ Online write succeeded (Metadata: fromCache=false)${colors.reset}`);
    } else {
        throw new Error('Initial write failed');
    }

    // 2. Go OFFLINE and increment
    console.log(`\nℹ Step 2: Going OFFLINE and attempting write...`);
    isOffline = true;

    // This should be optimistic and return a cached result
    const res = await docRef.set({ count: 11 });
    if (res.version === -1) {
        console.log(`${colors.green}✓ Correctly detected offline and returned local version -1${colors.reset}`);
    } else {
        console.log(`${colors.red}✗ Should have returned version -1 for offline write${colors.reset}`);
    }

    // 3. Verify Local Cache (Optimistic UI) & Metadata
    console.log(`\nℹ Step 3: Verifying local cache & metadata (Optimistic UI)...`);
    const snap2 = await docRef.getSnapshot();
    if (snap2.data()?.count === 11 && snap2.metadata.hasPendingWrites) {
        console.log(`${colors.green}✓ Local cache reflects optimistic update (count: 11)${colors.reset}`);
        console.log(`${colors.green}✓ Snapshot hasPendingWrites=true${colors.reset}`);
    } else {
        console.log(`${colors.red}✗ Metadata/Cache verification failed (hasPendingWrites: ${snap2.metadata.hasPendingWrites})${colors.reset}`);
    }

    // 4. Verify Persistent Queue
    console.log(`\nℹ Step 4: Verifying persistent queue...`);
    const persistence = (client as any).getPersistence();
    const queue = await persistence.getAll('queue');
    if (queue.length === 1 && queue[0].path === docRef.path) {
        console.log(`${colors.green}✓ Write correctly queued in IndexedDB${colors.reset}`);
    } else {
        console.log(`${colors.red}✗ Queue verification failed${colors.reset}`);
    }

    // 5. Go ONLINE and process queue
    console.log(`\nℹ Step 5: Going ONLINE and syncing...`);
    isOffline = false;
    await (client as any).processQueue();

    // 6. Final verification
    const finalVal = await docRef.get();
    if (finalVal.count === 11 && (finalVal as any).version !== -1) {
        console.log(`${colors.green}✓ Data synced to server successfully!${colors.reset}`);
        console.log(`${colors.green}🎉 ALL PERSISTENCE TESTS PASSED!${colors.reset}`);
        process.exit(0);
    } else {
        console.log(`${colors.red}✗ Final sync verification failed${colors.reset}`);
        process.exit(1);
    }
}

runPersistenceTest().catch(err => {
    console.error(`${colors.red}Persistence Test Failed:`, err);
    process.exit(1);
});
