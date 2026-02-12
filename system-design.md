# System Design: TelestackDB (Firebase Open-Source Alternative)

TelestackDB is a high-performance, serverless-first platform that merges several best-in-class open-source projects to provide Authentication, Scalable NoSQL-like Database, Real-time Synchronization, and Object Storage.

---

## 🏗️ High-Level Architecture

The system is designed to be **decoupled** and **stateless**, leveraging Cloudflare's Edge network for compute and specialized open-source engines for state management.

```mermaid
graph TD
    subgraph Client Layer
        Web[Web SDK]
        Mobile[Mobile SDK]
    end

    subgraph Compute Layer (Cloudflare Workers)
        Gateway[Cloud Gateway / API]
        AuthEngine[Telestack Auth Engine]
    end

    subgraph State Layer (Open Source & Edge)
        D1[(Cloudflare D1 + JSON)]
        Centrifugo[Centrifugo WebSocket Hub]
        MinIO[MinIO / Backblaze B2]
        ST[SuperTokens Core]
    end

    Client Layer -->|HTTPS| Gateway
    Gateway -->|Auth Check| ST
    Gateway -->|JSON CRUD| D1
    Gateway -->|Publish Event| Centrifugo
    Centrifugo -->|WebSocket Push| Client Layer
    Gateway -->|Upload/Download| MinIO
```

---

## 🛠️ Component Breakdown

### 1. Identity & Access (SuperTokens)
*   **Role**: Handles Session Management, OAuth, and User Metadata.
*   **Implementation**: `Telestack-Auth-Engine` acts as the bridge between the client and SuperTokens Core.
*   **Security Model**: Every API request is verified using SuperTokens JWT/Sessions. The User ID from the session is used to scope database records.

### 2. The Document Store (Cloudflare D1 + JSON)
*   **Role**: Primary data persistence with NoSQL flexibility.
*   **Strategy**: Instead of a strict relational schema, we use a `documents` table with a `data` TEXT/JSON column.
*   **Query Engine**: SQLite JSON1 functions are used to parse, filter, and modify document contents at the engine level.
*   **Schema**:
    ```sql
    CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        collection TEXT,
        owner_id TEXT, -- Tied to SuperTokens UID
        data TEXT,     -- SQLite JSON string
        version INTEGER,
        updated_at DATETIME
    );
    ```

### 3. Real-time Synchronization (Centrifugo)
*   **Role**: Handles high-concurrency WebSocket connections (Pub/Sub).
*   **Innovation**: Unlike Firestore (which combines data and sync), TelestackDB separates them. Workers update D1 and then "emit" a change to Centrifugo via an HTTP POST.
*   **Scaling**: Centrifugo scales horizontally to millions of connections, while the Workers remain compute-only.

### 4. Object Storage (MinIO / Backblaze)
*   **Role**: Large file storage (Images, Videos, Logs).
*   **Implementation**: S3-compatible API. Workers generate **Presigned URLs** to allow direct client-to-storage uploads, reducing bandwidth costs on the Gateway.

---

## 🔄 Data Flow: A "Real-time Write"

1.  **Client Pulse**: Web SDK sends `updateDoc('posts/123', { title: 'Hello' })`.
2.  **Auth Gate**: Worker receives request, verifies SuperTokens session, gets `userId`.
3.  **Permission Check**: Worker checks if `userId` owns the document in D1.
4.  **Database Commit**: Worker executes D1 SQL to update the JSON field.
5.  **Signal Emission**: Worker calls `fetch('centrifugo/api', { method: 'publish', channel: 'posts:123', data: ... })`.
6.  **Broadcast**: Centrifugo pushes the update to all clients subscribed to `posts:123` via WebSockets.
7.  **Client Sync**: SDK receives the WebSocket message and updates the local UI state.

---

## 🔒 Security Model

TelestackDB implements a **Centralized Security Middleware**:

*   **Row-Level Security (RLS)**: Enforced in the Worker layer. Queries always append `AND owner_id = ?` automatically unless a "Admin Bypass" is used.
*   **Validation**: JSON Schema validation is performed in the Worker before data hits D1.
*   **Token Verification**: Centrifugo connections are secured via JWTs signed by your Auth Engine, ensuring users only listen to their permitted collections.

---

## 📈 Scalability & Performance
| Component | Scaling Strategy | Convergence Time |
| :--- | :--- | :--- |
| **Compute** | Cloudflare Workers (Edge) | < 10ms |
| **Database** | D1 (Read Replication) | Low Latency |
| **Real-time** | Centrifugo (Redis Engine) | Milliseconds |
| **Storage** | CDN Caching (S3) | Global Availability |

---

## 🚀 Vision
By merging these tools, you achieve a platform that is **Cloud-Agnostic** (can move to self-hosted Postgres/MinIO anytime) but runs with **Edge Performance**.
