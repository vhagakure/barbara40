CREATE TABLE rsvps (
  guest_id TEXT PRIMARY KEY NOT NULL,
  guest_name TEXT NOT NULL,
  attendance TEXT NOT NULL CHECK (attendance IN ('yes', 'no')),
  companions INTEGER NOT NULL CHECK (companions >= 0),
  companion_names TEXT NOT NULL,
  song TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
