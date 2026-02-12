import { TelestackClient } from './src/index';

const db = new TelestackClient({
    endpoint: 'http://localhost:8787',
    centrifugoUrl: 'ws://localhost:8000/connection/websocket', // Adjust if needed
    userId: 'test-user',
    workspaceId: 'dev-workspace'
});

async function runDemo() {
    console.log("--- Telestack Fluent SDK Demo ---");

    // 1. Recursive Hierarchy: Sub-collections with Generics
    console.log("\n1. Deep Nesting:");
    interface Task {
        title: string;
        status: string;
        priority: number;
    }
    const taskRef = db
        .collection('projects').doc('telestack-pro')
        .collection<Task>('tasks').doc('implement-sdk');

    console.log("Reference Path:", taskRef.path);

    await taskRef.set({
        title: "Finish SDK implementation",
        status: "in-progress",
        priority: 1
    });
    console.log("Deep document set successfully.");

    // 2. Chainable Queries
    console.log("\n2. Fluent Queries:");
    interface Order {
        id: string;
        status: string;
        total: number;
        created_at: string;
    }
    const query = db.collection<Order>('orders')
        .where('status', '==', 'pending')
        .where('total', '>', 100)
        .orderBy('created_at', 'desc')
        .limit(5);

    console.log("Querying orders...");
    // Note: This requires the backend /query endpoint to be running
    try {
        const results = await query.get();
        console.log(`Found ${results.length} orders matching criteria.`);
    } catch (e: any) {
        console.warn("Query failed (backend might not be up or data missing):", e.message);
    }

    // 3. Advanced Operators (IN, LIKE)
    console.log("\n3. Advanced Operators:");
    const tagQuery = db.collection('posts')
        .where('tags', 'array-contains', 'typescript')
        .where('category', 'in', ['tech', 'coding']);

    console.log("Advanced query configured.");

    // 4. Real-time Snapshots
    console.log("\n4. Real-time Listeners:");
    const unsub = taskRef.onSnapshot((doc) => {
        if (doc) {
            console.log(">>> [Real-time Update] Task Title:", doc.title);
        } else {
            console.log(">>> [Real-time Update] Task Deleted.");
        }
    });

    console.log("Listening for changes to 'implement-sdk'...");

    // Wait a bit to simulate real-time activity
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log("\nUpdating task status...");
    await taskRef.update({ status: 'completed' });

    // Cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    unsub();
    console.log("\nDemo finished.");
}

runDemo().catch(console.error);
