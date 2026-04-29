const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dataDir = path.resolve(__dirname, '..', 'data');
const dbPath = path.resolve(dataDir, 'gym.sqlite');
let db = null;
let initialized = false;

function ensureDataDir() {
  const existed = fs.existsSync(dataDir);
  if (!existed) fs.mkdirSync(dataDir, { recursive: true });
  console.log(`[db] data directory: ${dataDir}`);
  console.log(`[db] data directory created: ${!existed}`);
  return !existed;
}

function removeDbFiles() {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function openDatabaseWithRecovery() {
  const dbFileExists = fs.existsSync(dbPath);
  console.log(`[db] database file: ${dbPath}`);
  console.log(`[db] database file existed: ${dbFileExists}`);
  try {
    const conn = new Database(dbPath);
    conn.pragma('journal_mode = WAL');
    conn.pragma('foreign_keys = ON');
    return conn;
  } catch (err) {
    console.error(`[db] failed to open database at ${dbPath}:`, err.stack || err);
    if (String(err.message || '').includes('SQLITE_IOERR')) {
      console.error('[db] SQLite I/O error detected, recreating database file');
      removeDbFiles();
      const conn = new Database(dbPath);
      conn.pragma('journal_mode = WAL');
      conn.pragma('foreign_keys = ON');
      return conn;
    }
    throw err;
  }
}

function getDb() {
  if (db) return db;
  ensureDataDir();
  db = openDatabaseWithRecovery();
  return db;
}

function closeDb() {
  if (!db) return;
  db.close();
  db = null;
  initialized = false;
}

function initDb() {
  if (initialized) return getDb();
  const conn = getDb();
  try {
    conn.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS branches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS training_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        duration_minutes INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trainers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        phone TEXT,
        supported_training_type_ids TEXT NOT NULL DEFAULT '[]',
        branch_ids TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        training_type_id INTEGER NOT NULL,
        sessions_count INTEGER NOT NULL,
        price REAL NOT NULL,
        description TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(training_type_id) REFERENCES training_types(id)
      );

      CREATE TABLE IF NOT EXISTS client_package_purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        package_id INTEGER NOT NULL,
        package_snapshot TEXT NOT NULL,
        training_type_id INTEGER NOT NULL,
        sessions_purchased INTEGER NOT NULL,
        sessions_used INTEGER NOT NULL DEFAULT 0,
        sessions_remaining INTEGER NOT NULL,
        purchase_date TEXT NOT NULL,
        expiry_date TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_by INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(client_id) REFERENCES clients(id),
        FOREIGN KEY(package_id) REFERENCES packages(id),
        FOREIGN KEY(training_type_id) REFERENCES training_types(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER,
        package_purchase_id INTEGER,
        amount_paid REAL NOT NULL,
        payment_date TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        notes TEXT,
        branch_id INTEGER,
        created_by INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(client_id) REFERENCES clients(id),
        FOREIGN KEY(package_purchase_id) REFERENCES client_package_purchases(id),
        FOREIGN KEY(branch_id) REFERENCES branches(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        branch_id INTEGER,
        notes TEXT,
        created_by INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(branch_id) REFERENCES branches(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        trainer_id INTEGER NOT NULL,
        branch_id INTEGER NOT NULL,
        training_type_id INTEGER NOT NULL,
        package_purchase_id INTEGER NOT NULL,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'booked',
        notes TEXT,
        created_by INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_session_deducted INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(client_id) REFERENCES clients(id),
        FOREIGN KEY(trainer_id) REFERENCES trainers(id),
        FOREIGN KEY(branch_id) REFERENCES branches(id),
        FOREIGN KEY(training_type_id) REFERENCES training_types(id),
        FOREIGN KEY(package_purchase_id) REFERENCES client_package_purchases(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
      );
    `);

    migrateUsersTable(conn);
    migratePurchasesTable(conn);
    initialized = true;
    return conn;
  } catch (err) {
    console.error(`[db] failed during schema init/migration for ${dbPath}:`, err.stack || err);
    throw err;
  }
}

function migrateUsersTable(conn) {
  const usersTable = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!usersTable) return;

  const cols = conn.prepare('PRAGMA table_info(users)').all();
  const colNames = new Set(cols.map((c) => c.name));

  if (!colNames.has('password_hash')) {
    conn.prepare('ALTER TABLE users ADD COLUMN password_hash TEXT').run();
  }

  const hasLegacyPassword = colNames.has('password');
  const users = hasLegacyPassword
    ? conn.prepare('SELECT id, password, password_hash FROM users').all()
    : conn.prepare('SELECT id, password_hash FROM users').all();
  const updateHash = conn.prepare('UPDATE users SET password_hash=@password_hash WHERE id=@id');
  const fallbackHash = bcrypt.hashSync(`legacy-password-${Date.now()}`, 10);

  for (const user of users) {
    if (user.password_hash) continue;
    if (hasLegacyPassword && user.password) {
      updateHash.run({ id: user.id, password_hash: bcrypt.hashSync(user.password, 10) });
    } else {
      updateHash.run({ id: user.id, password_hash: fallbackHash });
    }
  }
}

function migratePurchasesTable(conn) {
  const purchasesTable = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='client_package_purchases'").get();
  if (!purchasesTable) return;

  const cols = conn.prepare('PRAGMA table_info(client_package_purchases)').all();
  const colNames = new Set(cols.map((c) => c.name));

  if (!colNames.has('expiry_date')) {
    conn.prepare('ALTER TABLE client_package_purchases ADD COLUMN expiry_date TEXT').run();
  }
}

module.exports = { initDb, getDb, closeDb, dbPath, dataDir };
