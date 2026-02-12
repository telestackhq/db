/**
 * Simple test to verify Centrifugo subscription and publishing works
 */

import { Centrifuge } from 'centrifuge';

const centrifuge = new Centrifuge('ws://localhost:8000/connection/websocket');

centrifuge.on('connected', () => {
    console.log('✓ Connected to Centrifugo');

    // Subscribe to a namespaced test channel using the new delimiter
    const sub = centrifuge.newSubscription('collection__test-channel');

    sub.on('publication', (ctx) => {
        console.log('✓ Received publication:', ctx.data);
    });

    sub.subscribe();
    console.log('✓ Subscribed to test-channel');
    console.log('Now run this command in another terminal to test:');
    console.log('Invoke-WebRequest -Uri "http://localhost:8000/api" -Method POST -Headers @{"Content-Type"="application/json"; "Authorization"="apikey my_api_key"} -Body \'{"method":"publish","params":{"channel":"test-channel","data":{"message":"hello from manual test"}}}\'');
});

centrifuge.connect();

// Keep the script running
setTimeout(() => {
    console.log('\\nTest complete. Disconnecting...');
    centrifuge.disconnect();
    process.exit(0);
}, 30000);
