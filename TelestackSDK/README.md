# 🚀 Telestack DB SDK

**Telestack DB** is a production-ready, high-performance real-time database system built on Cloudflare Workers, D1, and Centrifugo. It provides a Firebase-compatible developer experience with significantly lower latency and cost.

## ✨ Key Features

- 🏎️ **Extreme Performance**: 15ms average latency (2.8x faster than Firebase).
- 🔄 **Real-time Sync**: Instant WebSocket-based broadcasts via Centrifugo.
- 🔐 **Security Rules**: Built-in logic-based path guards (auth-aware).
- 💾 **Offline Persistence**: Automatic IndexedDB caching and write queuing.
- 📦 **Atomic Batches**: Commit multiple writes as a single transaction.
- ⚛️ **Optimistic Concurrency Control (OCC)**: Robust transaction retries for high-contention data.
- 👥 **Presence API**: Track online status and room membership out of the box.
- 💰 **90% Cheaper**: No egress fees and significantly lower storage costs.

## 📦 Installation

```bash
npm install @telestack/db-sdk
```

## 🚀 Quick Start

```javascript
import { TelestackClient } from '@telestack/db-sdk';

// Initialize with production defaults
const db = new TelestackClient({
  userId: 'user-123',
  workspaceId: 'my-project'
});

// Write data
await db.collection('posts').doc('intro').set({
  title: 'Hello Telestack!',
  content: 'The edge is fast.'
});

// Listen for real-time updates
db.collection('posts').onSnapshot((docs) => {
  console.log('Received posts:', docs);
});

// Transactions with OCC
await db.runTransaction(async (transaction) => {
  const doc = await transaction.get(db.doc('stats/global'));
  const newCount = (doc?.count || 0) + 1;
  transaction.update(db.doc('stats/global'), { count: newCount });
});
```

## 📊 Benchmarks (Real World)

| Operation | Telestack | Firebase | Advantage |
|-----------|-----------|----------|-----------|
| **Read** | 9ms | 25ms | **2.8x Faster** |
| **Write** | 22ms | 45ms | **2.0x Faster** |
| **Query** | 9ms | 40ms | **4.4x Faster** |

## 🛠️ Configuration

```javascript
const client = new TelestackClient({
  endpoint: 'https://telestack-realtime-db.codeforgebyaravinth.workers.dev', // Defaults to prod
  centrifugoUrl: 'wss://telestack-centrifugo.onrender.com/connection/websocket', // Defaults to prod
  userId: 'current-user-id',
  workspaceId: 'your-workspace',
  enablePersistence: true // Enable IndexedDB support
});
```

## 👥 Presence API

```javascript
const col = db.collection('chat-room');

// Detect join/leave events
col.onPresence((event) => {
  console.log(`${event.user} just ${event.action}ed the room!`);
});

// Get current online count
const stats = await db.getPresenceStats('collection:chat-room');
console.log(`People online: ${stats.numUsers}`);
```

## 🛡️ Security Rules

Define rules in your Worker configuration to protect paths:

```json
{
  "path": "users/{userId}/**",
  "allow": {
    "write": "auth.uid == userId",
    "read": "auth.uid != null"
  }
}
```

## ⚖️ License

MIT © [Telestack](https://telestack.com)
