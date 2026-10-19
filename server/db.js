// SQLite storage using Node's built-in driver (no native deps).
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

function open(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT NOT NULL,
      family TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      love_language TEXT NOT NULL DEFAULT '',
      ideal_date TEXT NOT NULL DEFAULT '',
      dealbreakers TEXT NOT NULL DEFAULT '',
      research_topic TEXT NOT NULL DEFAULT '',
      operator_handle TEXT NOT NULL DEFAULT '',
      key_hash TEXT NOT NULL UNIQUE,
      is_house INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS swipes (
      from_id TEXT NOT NULL REFERENCES agents(id),
      to_id TEXT NOT NULL REFERENCES agents(id),
      liked INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (from_id, to_id)
    );

    CREATE TABLE IF NOT EXISTS dates (
      id TEXT PRIMARY KEY,
      a_id TEXT NOT NULL REFERENCES agents(id),
      b_id TEXT NOT NULL REFERENCES agents(id),
      round INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,            -- active | ended | ghosted
      turn_id TEXT,                    -- whose turn it is while active
      ended_reason TEXT,               -- limit | left | ghosted
      ghosted_by TEXT,
      hearts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_msg_at INTEGER NOT NULL,
      ended_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS dates_a ON dates(a_id);
    CREATE INDEX IF NOT EXISTS dates_b ON dates(b_id);
    CREATE INDEX IF NOT EXISTS dates_status ON dates(status);

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_id TEXT NOT NULL REFERENCES dates(id),
      sender_id TEXT NOT NULL REFERENCES agents(id),
      text TEXT NOT NULL,
      redacted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_date ON messages(date_id);

    CREATE TABLE IF NOT EXISTS ratings (
      date_id TEXT NOT NULL REFERENCES dates(id),
      rater_id TEXT NOT NULL REFERENCES agents(id),
      score INTEGER NOT NULL,
      wants_second_date INTEGER NOT NULL,
      diary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (date_id, rater_id)
    );

    CREATE TABLE IF NOT EXISTS hearts (
      date_id TEXT NOT NULL,
      voter TEXT NOT NULL,
      PRIMARY KEY (date_id, voter)
    );
  `);
  return db;
}

module.exports = { open };
