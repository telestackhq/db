
import { TelestackClient } from './src/index';
import WebSocket from 'ws';

// Polyfill WebSocket for Node.js
global.WebSocket = WebSocket as any;

const config = {
    endpoint: 'http://127.0.0.1:8787',
    centrifugoUrl: 'ws://127.0.0.1:8000/connection/websocket',
    userId: 'test-user-presence',
    enablePersistence: false
};

const client = new TelestackClient(config);

async function getPresenceStatsWithRetry(channel: string, maxRetries = 5): Promise<any> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const stats = await client.getPresenceStats(channel);
            return stats;
        } catch (e) {
            if (i === maxRetries - 1) throw e;
            console.log(`⏳ Presence stats not ready, retrying in ${(i + 1) * 100}ms...`);
            await new Promise(r => setTimeout(r, (i + 1) * 100));
        }
    }
    throw new Error('Failed to get presence stats after all retries');
}

async function runPresenceTest() {
    console.log("🚀 Starting Telestack Presence Test...");

    try {
        // 1. Connect
        console.log("WAIT: Connecting to Realtime...");
        await new Promise<void>((resolve) => {
            client.getCentrifuge()!.on('connected', () => resolve());
            client.getCentrifuge()!.connect();
        });
        console.log("✓ Connected");

        // 2. Subscribe
        const collection = client.collection('presence-test');
        const channel = 'collection:presence-test';
        console.log(`WAIT: Subscribing to ${channel}...`);
        const unsubscribe = collection.onPresence((event) => {
            console.log(`📡 Presence Event: ${event.action} - ${event.user} (${event.clientId})`);
        });

        // Small delay to ensure subscription is active
        await new Promise(r => setTimeout(r, 1000));

        // 3. Test getPresenceStats
        console.log(`TEST: Fetching stats for ${channel}...`);
        const stats = await getPresenceStatsWithRetry(channel);
        console.log("STATS:", stats);

        if (stats.numClients >= 1) {
            console.log("✓ Presence Stats Verification PASSED");
        } else {
            console.error("✗ Presence Stats Verification FAILED: Expected >= 1 client");
            process.exit(1);
        }

        // 4. Test getPresence
        console.log(`TEST: Fetching presence list for ${channel}...`);
        const presence: any = await client.getPresence(channel);
        const clients = presence.clients ? Object.values(presence.clients) : Object.values(presence);
        console.log(`PRESENCE LIST: ${clients.length} clients found`);
        const me = clients.find((c: any) => c.user === config.userId);
        if (me) {
            console.log("✓ Found myself in presence list");
        } else {
            console.error("✗ Could not find myself in presence list");
            process.exit(1);
        }

        console.log("✅ PRESENCE TEST PASSED");
        process.exit(0);

    } catch (e: any) {
        console.error("\n❌ PRESENCE TEST FAILED:", e);
        process.exit(1);
    }
}

runPresenceTest();
