-- Telestack Real-time DB Enhanced Schema

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    collection_name TEXT NOT NULL,
    path TEXT NOT NULL,
    user_id TEXT NOT NULL,
    data TEXT NOT NULL, -- JSON
    version INTEGER DEFAULT 1,
    deleted_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_workspace_collection ON documents(workspace_id, collection_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_path_prefix ON documents(path) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user ON documents(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_updated_at ON documents(updated_at);

-- Trigger to auto-update updated_at
CREATE TRIGGER IF NOT EXISTS update_doc_timestamp 
AFTER UPDATE ON documents
FOR EACH ROW
BEGIN
    UPDATE documents SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

-- Event Sourcing Table (Immutable transaction log)
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    event_type TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
    payload TEXT NOT NULL, -- JSON diff or snapshot
    version INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doc_id) REFERENCES documents(id)
);

-- Advanced Indexing for JSON lookups (Simulated JSONB path indexes)
CREATE INDEX IF NOT EXISTS idx_events_doc ON events(doc_id);
CREATE INDEX IF NOT EXISTS idx_events_workspace_version ON events(workspace_id, version);

-- Note: In D1, we can't do functional indexes like documents(data->>'type'), 
-- but we can optimize the path/collection lookups.
