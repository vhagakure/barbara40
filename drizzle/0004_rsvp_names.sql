ALTER TABLE rsvps ADD COLUMN guest_given_name TEXT NOT NULL DEFAULT '';
ALTER TABLE rsvps ADD COLUMN guest_family_name TEXT NOT NULL DEFAULT '';
ALTER TABLE rsvps ADD COLUMN companion_given_name TEXT NOT NULL DEFAULT '';
ALTER TABLE rsvps ADD COLUMN companion_family_name TEXT NOT NULL DEFAULT '';
