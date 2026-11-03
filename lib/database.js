import { DatabaseSync } from 'node:sqlite';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','operator')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      csrf TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO settings VALUES ('tariffs','{"adult":0,"child":0,"senior":0,"version":0,"configured":false}');
    CREATE TABLE IF NOT EXISTS visits (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      request_hash TEXT NOT NULL, received_at TEXT NOT NULL, occurred_at TEXT NOT NULL,
      business_day TEXT NOT NULL, name TEXT NOT NULL, locality TEXT NOT NULL,
      adult INTEGER NOT NULL, child INTEGER NOT NULL, senior INTEGER NOT NULL,
      tariffs TEXT NOT NULL, total INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      registration_status TEXT NOT NULL DEFAULT 'registered',
      payment_status TEXT NOT NULL DEFAULT 'pending', payment_method TEXT,
      fiscal_status TEXT NOT NULL DEFAULT 'not_issued', paid_at TEXT
    );
    CREATE INDEX IF NOT EXISTS visits_day ON visits(business_day);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, at TEXT NOT NULL, user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL, entity TEXT NOT NULL, details TEXT NOT NULL
    );
  `);
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function audit(db, user, action, entity, details) {
  db.prepare('INSERT INTO audit(at,user_id,action,entity,details) VALUES (?,?,?,?,?)')
    .run(new Date().toISOString(), user, action, entity, JSON.stringify(details));
}
