import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";

const db = new Database("app.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    passwordHash TEXT
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT,
    status TEXT,
    token TEXT,
    selected TEXT
  );
`);

export function seedPhotographer() {
  const c = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (!c) {
    const hash = bcrypt.hashSync("photo123", 10);
    db.prepare("INSERT INTO users(id,email,passwordHash) VALUES(?,?,?)")
      .run(uuidv4(), "photo@example.com", hash);
  }
}
export function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email=?").get(email);
}
export function createUser(email, password) {
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare("INSERT INTO users(id,email,passwordHash) VALUES(?,?,?)")
      .run(uuidv4(), email, hash);
    return true;
  } catch (e) {
    return false;
  }
}
export default db;
