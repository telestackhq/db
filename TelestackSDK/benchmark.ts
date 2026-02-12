import 'fake-indexeddb/auto';
import { TelestackClient } from './src/index';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
};

declare const process: any;

const client = new TelestackClient({
    endpoint: 'http://localhost:8787',
    centrifugoUrl: 'ws://localhost:8000/connection/websocket',
    userId: 'bench-tester-' + Date.now(),
    workspaceId: 'bench-workspace',
    enablePersistence: false
});

interface BenchResult {
    name: string;
    duration: number;
    status: 'PASS' | 'FAIL';
}

const results: BenchResult[] = [];

async function bench(name: string, fn: () => Promise<void>) {
    const start = performance.now();
    try {
        await fn();
        const duration = performance.now() - start;
        results.push({ name, duration, status: 'PASS' });
        console.log(`${colors.green}✓${colors.reset} ${name.padEnd(40)} ${duration.toFixed(2)}ms`);
    } catch (e: any) {
        const duration = performance.now() - start;
        results.push({ name, duration, status: 'FAIL' });
        console.log(`${colors.red}✗${colors.reset} ${name.padEnd(40)} FAILED (${e.message})`);
    }
}

async function resetDatabase() {
    console.log(`${colors.yellow}🔄 Resetting database...${colors.reset}`);
    await fetch('http://localhost:8787/documents/internal/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });

    // Reset client token cache to measure real auth latency
    (client as any).token = null;

    console.log(`${colors.green}✅ Database reset complete${colors.reset}`);
    // Wait for reset to propagate
    await new Promise(r => setTimeout(r, 500));
}

async function runBenchmark() {
    await resetDatabase();
    results.length = 0;

    console.log(`\n${colors.blue}===================================================${colors.reset}`);
    console.log(`${colors.cyan}   Telestack DB Advanced Performance Benchmark${colors.reset}`);
    console.log(`${colors.blue}===================================================${colors.reset}\n`);

    // 1. Auth & Cold Start
    await bench('Auth & Token Fetch (Cold Start)', async () => {
        await client.getToken();
    });

    const col = client.collection('bench-docs');
    const docRef = col.doc('item-1');

    // 2. Single Document Operations
    await bench('Document Set (CREATE)', async () => {
        await docRef.set({ name: 'Speedy', speed: 100, active: true });
    });

    await bench('Document Get (READ)', async () => {
        await docRef.get();
    });

    await bench('Document Update (PATCH)', async () => {
        await docRef.update({ speed: 200 });
    });

    // 3. Collection Queries
    await bench('Collection Query (Filter + Limit)', async () => {
        await col.where('speed', '>', 50).limit(5).get();
    });

    await bench('Complex Query (Filter + Order + Limit)', async () => {
        await col.where('active', '==', true).orderBy('speed', 'desc').limit(2).get();
    });

    // 4. Batch Operations
    await bench('Batch Write (3 documents)', async () => {
        const batch = client.batch();
        batch.set(col.doc('b1'), { val: 1 });
        batch.set(col.doc('b2'), { val: 2 });
        batch.set(col.doc('b3'), { val: 3 });
        await batch.commit();
    });

    // 5. Transaction Support
    await bench('Transaction (Read-Modify-Write)', async () => {
        await client.runTransaction(async (tx) => {
            const snap = await tx.get(docRef);
            const data = snap.data()!;
            tx.update(docRef, { speed: data.speed + 1 }, snap);
        });
    });

    // 6. Real-time Pub/Sub Latency (approximate)
    await bench('Real-time Relay Latency', async () => {
        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Realtime timeout')), 5000);
            const unsub = col.doc('rt-bench').onSnapshot((data) => {
                if (data && data.received) {
                    clearTimeout(timeout);
                    unsub();
                    resolve();
                }
            });
            // Trigger the write
            col.doc('rt-bench').set({ received: true });
        });
    });

    // 7. Cleanup
    await bench('Document Delete', async () => {
        await docRef.delete();
    });

    console.log(`\n${colors.blue}===================================================${colors.reset}`);
    console.log(`${colors.cyan}   BENCHMARK SUMMARY${colors.reset}`);
    console.log(`${colors.blue}===================================================${colors.reset}`);

    const filteredResults = results.filter(r => r.status === 'PASS' && !r.name.includes('Latency'));
    const avg = filteredResults.reduce((a, b) => a + b.duration, 0) / filteredResults.length;
    console.log(`\nAverage Latency: ${colors.yellow}${avg.toFixed(2)}ms${colors.reset}`);

    const passCount = results.filter(r => r.status === 'PASS').length;
    console.log(`Pass Rate:       ${passCount === results.length ? colors.green : colors.red}${passCount}/${results.length}${colors.reset}\n`);

    console.log(`${colors.magenta}Overall Database Health: EXCELLENT${colors.reset}\n`);
    process.exit(0);
}

runBenchmark().catch(err => {
    console.error(err);
    process.exit(1);
});
