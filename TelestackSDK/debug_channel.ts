
import { TelestackClient } from './src/index';
import WebSocket from 'ws';

// Polyfill WebSocket
global.WebSocket = WebSocket as any;

const client = new TelestackClient({
    endpoint: 'http://127.0.0.1:8787',
    centrifugoUrl: 'ws://127.0.0.1:8000/connection/websocket',
    userId: 'debug-user',
    enablePersistence: false
});

async function run() {
    console.log("Starting DEBUG CHANNEL test...");

    try {
        // Option B: Subscribe first
        console.log("Subscribing to channels...");
        const sub1 = client.getCentrifuge()?.newSubscription('collection:bench-docs');
        sub1?.subscribe();

        const sub2 = client.getCentrifuge()?.newSubscription('collection:test');
        sub2?.subscribe();

        const sub3 = client.getCentrifuge()?.newSubscription('collection:valid');
        sub3?.subscribe();

        // Wait for subscriptions
        await new Promise(r => setTimeout(r, 1000));

        // Test 1: Write to 'bench-docs'
        console.log("Writing to 'bench-docs'...");
        await client.collection('bench-docs').doc('debug-1').set({ foo: 'bar' });
        console.log("✓ Write to 'bench-docs' successful");

        // Test 2: Write to 'test'
        console.log("Writing to 'test'...");
        await client.collection('test').doc('debug-2').set({ foo: 'bar' });
        console.log("✓ Write to 'test' successful");

        // Test 3: Write to 'valid'
        console.log("Writing to 'valid'...");
        await client.collection('valid').doc('debug-3').set({ foo: 'bar' });
        console.log("✓ Write to 'valid' successful");

    } catch (e: any) {
        console.error("DEBUG TEST FAILED:", e);
        process.exit(1);
    }
}

run();
