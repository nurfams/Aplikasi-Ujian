import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const storePath = path.join(rootDir, "data", "cbt-store.json");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const iterations = 120000;
  const digest = crypto.pbkdf2Sync(String(password || ""), salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2$${iterations}$${salt}$${digest}`;
}

function createEmptySeed() {
  return {
    users: [
      {
        id: "u-admin",
        role: "admin",
        name: "Admin Sekolah",
        username: "admin",
        password: hashPassword("admin123"),
        subjects: []
      }
    ],
    students: [],
    exams: [],
    questions: [],
    attempts: [],
    violations: [],
    sessions: [],
    auditLogs: [],
    accessControl: {},
    examSettings: {}
  };
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

function maintenanceUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  const targetDatabase = decodeURIComponent(url.pathname.replace(/^\//, ""));
  url.pathname = "/postgres";
  return { url: url.toString(), targetDatabase };
}

async function ensureDatabase(databaseUrl) {
  const { url, targetDatabase } = maintenanceUrl(databaseUrl);
  if (!targetDatabase) throw new Error("Nama database pada DATABASE_URL belum diisi.");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [targetDatabase]);
    if (!result.rowCount) {
      await client.query(`CREATE DATABASE ${quoteIdentifier(targetDatabase)}`);
      console.log(`Database ${targetDatabase} dibuat.`);
    } else {
      console.log(`Database ${targetDatabase} sudah ada.`);
    }
  } finally {
    await client.end();
  }
}

async function readJsonSeed() {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    console.warn("Seed data/cbt-store.json tidak ditemukan. Database dibuat kosong dengan akun admin awal admin/admin123.");
    return createEmptySeed();
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.includes("ISI_PASSWORD_POSTGRES")) {
    throw new Error("Isi DATABASE_URL di file .env terlebih dahulu, contoh: postgres://postgres:PASSWORD@localhost:5432/cbt_sman94");
  }

  await ensureDatabase(databaseUrl);

  const seed = await readJsonSeed();
  const { initDatabase, pool } = await import("./db.js");
  await initDatabase(seed);

  const counts = await pool.query(`
    SELECT 'users' AS table_name, COUNT(*)::int AS count FROM users
    UNION ALL SELECT 'students', COUNT(*)::int FROM students
    UNION ALL SELECT 'exams', COUNT(*)::int FROM exams
    UNION ALL SELECT 'questions', COUNT(*)::int FROM questions
    UNION ALL SELECT 'attempts', COUNT(*)::int FROM attempts
    UNION ALL SELECT 'violations', COUNT(*)::int FROM violations
    ORDER BY table_name
  `);
  console.table(counts.rows);
  await pool.end();
}

main().catch((error) => {
  console.error(`Setup PostgreSQL gagal: ${error.message}`);
  process.exit(1);
});
