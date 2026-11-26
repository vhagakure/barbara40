CREATE TABLE guest_messages (
  guest_id TEXT PRIMARY KEY NOT NULL,
  guest_name TEXT NOT NULL,
  message TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
