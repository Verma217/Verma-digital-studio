import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";

// Database File
const db = new Database("app.db");

// Create Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    passwordHash TEXT,
    role TEXT DEFAULT 'photographer'
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT,
    status TEXT,
    token TEXT,
    selected TEXT,
    userId TEXT
  );
`);

// Seed default photographer if DB is empty
export function seedPhotographer() {
  const c = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (!c) {
    const hash = bcrypt.hashSync("photo123", 10);
    const id = uuidv4();
    db.prepare("INSERT INTO users(id,email,passwordHash,role) VALUES(?,?,?,?)")
      .run(id, "photo@example.com", hash, "photographer");
  }
}

// Get user by email
export function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email=?").get(email);
}

// Create new user and return full user object
export function createUser(email, password, role = "photographer") {
  const hash = bcrypt.hashSync(password, 10);
  const userId = uuidv4();
  try {
    db.prepare("INSERT INTO users(id,email,passwordHash,role) VALUES(?,?,?,?)")
      .run(userId, email, hash, role);
    return { id: userId, email, role }; // ✅ return full object
  } catch (e) {
    console.error("Signup error:", e.message);
    return null;
  }
}

export default db;
