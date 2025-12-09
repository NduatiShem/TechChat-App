import * as SQLite from 'expo-sqlite';

export const DB_VERSION = 3;

export async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  const result = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  );
  const currentVersion = result?.user_version || 0;

  if (currentVersion < 1) {
    await migrateToVersion1(db);
  }
  
  if (currentVersion < 2) {
    await migrateToVersion2(db);
  }
  
  if (currentVersion < 3) {
    await migrateToVersion3(db);
  }
}

async function migrateToVersion1(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER UNIQUE,
      conversation_id INTEGER NOT NULL,
      conversation_type TEXT NOT NULL CHECK(conversation_type IN ('individual', 'group')),
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER,
      group_id INTEGER,
      message TEXT,
      created_at TEXT NOT NULL,
      read_at TEXT,
      edited_at TEXT,
      reply_to_id INTEGER,
      sync_status TEXT NOT NULL DEFAULT 'synced' CHECK(sync_status IN ('synced', 'pending', 'failed')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL
    );
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      conversation_type TEXT NOT NULL CHECK(conversation_type IN ('individual', 'group')),
      user_id INTEGER,
      group_id INTEGER,
      name TEXT NOT NULL,
      email TEXT,
      avatar_url TEXT,
      last_message TEXT,
      last_message_date TEXT,
      last_message_sender_id INTEGER,
      last_message_read_at TEXT,
      unread_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      sync_status TEXT NOT NULL DEFAULT 'synced' CHECK(sync_status IN ('synced', 'pending', 'failed')),
      UNIQUE(conversation_id, conversation_type)
    );
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER,
      message_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      url TEXT NOT NULL,
      local_path TEXT,
      size INTEGER,
      type TEXT,
      sync_status TEXT NOT NULL DEFAULT 'synced' CHECK(sync_status IN ('synced', 'pending', 'failed')),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS sync_state (
      conversation_id INTEGER NOT NULL,
      conversation_type TEXT NOT NULL CHECK(conversation_type IN ('individual', 'group')),
      last_sync_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      sync_status TEXT NOT NULL DEFAULT 'synced' CHECK(sync_status IN ('synced', 'syncing', 'failed')),
      last_error TEXT,
      PRIMARY KEY (conversation_id, conversation_type)
    );
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, conversation_type);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_sync_status ON messages(sync_status);
    CREATE INDEX IF NOT EXISTS idx_messages_server_id ON messages(server_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(conversation_type);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);
    CREATE INDEX IF NOT EXISTS idx_sync_state_conversation ON sync_state(conversation_id, conversation_type);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  await db.execAsync(`PRAGMA user_version = 1`);
}

async function migrateToVersion2(db: SQLite.SQLiteDatabase): Promise<void> {
  // Add users table for caching user list
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  await db.execAsync(`PRAGMA user_version = 2`);
}

async function migrateToVersion3(db: SQLite.SQLiteDatabase): Promise<void> {
  // Add dedicated groups table for caching group list with all fields
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      owner_id INTEGER,
      avatar_url TEXT,
      member_count INTEGER DEFAULT 0,
      last_message TEXT,
      last_message_date TEXT,
      unread_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_groups_updated_at ON groups(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_groups_owner_id ON groups(owner_id);
  `);

  await db.execAsync(`PRAGMA user_version = ${DB_VERSION}`);
}



