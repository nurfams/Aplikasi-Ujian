import "dotenv/config";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL || "";
export const postgresEnabled = Boolean(databaseUrl);

export const pool = postgresEnabled
  ? new Pool({
      connectionString: databaseUrl
    })
  : null;

let initPromise = null;

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  class_name TEXT
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  nis TEXT NOT NULL UNIQUE,
  nisn TEXT,
  name TEXT NOT NULL,
  gender TEXT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  class_name TEXT NOT NULL,
  elective_subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
  room TEXT,
  session TEXT
);

ALTER TABLE students ADD COLUMN IF NOT EXISTS elective_subjects JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE students ADD COLUMN IF NOT EXISTS nisn TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS gender TEXT;

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  teacher_id TEXT,
  exam_date TEXT,
  start_time TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 90,
  token TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  randomize_questions BOOLEAN NOT NULL DEFAULT FALSE,
  randomize_options BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'multiple_choice',
  body TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer_key TEXT,
  score NUMERIC NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started',
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  score JSONB,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE (exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS violations (
  id TEXT PRIMARY KEY,
  student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
  exam_id TEXT REFERENCES exams(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'warning',
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_class_name ON students(class_name);
CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status);
CREATE INDEX IF NOT EXISTS idx_questions_exam_id ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_exam_id ON attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_student_id ON attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);
CREATE INDEX IF NOT EXISTS idx_violations_exam_id ON violations(exam_id);
CREATE INDEX IF NOT EXISTS idx_violations_student_id ON violations(student_id);
`;

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export async function initDatabase(seed) {
  if (!pool) return;
  initPromise ??= setupDatabase(seed);
  await initPromise;
}

async function setupDatabase(seed) {
  const client = await pool.connect();
  try {
    await client.query(schema);
    const result = await client.query("SELECT COUNT(*)::int AS count FROM users");
    if (result.rows[0].count === 0) {
      await writeStoreToPostgres(seed);
    }
  } finally {
    client.release();
  }
}

export async function readStoreFromPostgres() {
  const [users, students, exams, questions, attempts, violations] = await Promise.all([
    pool.query("SELECT * FROM users ORDER BY role, name"),
    pool.query("SELECT * FROM students ORDER BY class_name, name"),
    pool.query("SELECT * FROM exams ORDER BY exam_date NULLS LAST, start_time NULLS LAST, code"),
    pool.query("SELECT * FROM questions ORDER BY exam_id, id"),
    pool.query("SELECT * FROM attempts ORDER BY updated_at DESC NULLS LAST, id"),
    pool.query("SELECT * FROM violations ORDER BY created_at DESC")
  ]);

  return {
    users: users.rows.map((row) => ({
      id: row.id,
      role: row.role,
      name: row.name,
      username: row.username,
      password: row.password,
      className: row.class_name || undefined
    })),
    students: students.rows.map((row) => ({
      id: row.id,
      nis: row.nis,
      nisn: row.nisn || "",
      name: row.name,
      gender: row.gender || "",
      username: row.username,
      password: row.password,
      className: row.class_name,
      electiveSubjects: row.elective_subjects || [],
      room: row.room || "-",
      session: row.session || "-"
    })),
    exams: exams.rows.map((row) => ({
      id: row.id,
      code: row.code,
      subject: row.subject,
      teacherId: row.teacher_id,
      date: row.exam_date,
      startTime: row.start_time,
      durationMinutes: row.duration_minutes,
      token: row.token,
      status: row.status,
      randomizeQuestions: row.randomize_questions,
      randomizeOptions: row.randomize_options
    })),
    questions: questions.rows.map((row) => ({
      id: row.id,
      examId: row.exam_id,
      type: row.type,
      body: row.body,
      options: row.options || [],
      answerKey: row.answer_key,
      score: Number(row.score)
    })),
    attempts: attempts.rows.map((row) => ({
      id: row.id,
      examId: row.exam_id,
      studentId: row.student_id,
      status: row.status,
      answers: row.answers || {},
      score: row.score,
      startedAt: toIso(row.started_at),
      submittedAt: toIso(row.submitted_at),
      updatedAt: toIso(row.updated_at)
    })),
    violations: violations.rows.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      examId: row.exam_id,
      type: row.type,
      level: row.level,
      message: row.message,
      createdAt: toIso(row.created_at)
    }))
  };
}

export async function writeStoreToPostgres(store) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await deleteMissingRows(client, "violations", store.violations);
    await deleteMissingRows(client, "attempts", store.attempts);
    await deleteMissingRows(client, "questions", store.questions);
    await deleteMissingRows(client, "exams", store.exams);
    await deleteMissingRows(client, "students", store.students);
    await deleteMissingRows(client, "users", store.users);

    await upsertRows(client, store.users, upsertUser);
    await upsertRows(client, store.students, upsertStudent);
    await upsertRows(client, store.exams, upsertExam);
    await upsertRows(client, store.questions, upsertQuestion);
    await upsertRows(client, store.attempts, upsertAttempt);
    await upsertRows(client, store.violations, upsertViolation);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteMissingRows(client, table, rows) {
  const ids = rows.map((row) => row.id);
  if (ids.length) {
    await client.query(`DELETE FROM ${table} WHERE id <> ALL($1::text[])`, [ids]);
  } else {
    await client.query(`DELETE FROM ${table}`);
  }
}

async function upsertRows(client, rows, upsert) {
  for (const row of rows) {
    await upsert(client, row);
  }
}

function upsertUser(client, row) {
  return client.query(
    `INSERT INTO users (id, role, name, username, password, class_name)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       role = EXCLUDED.role,
       name = EXCLUDED.name,
       username = EXCLUDED.username,
       password = EXCLUDED.password,
       class_name = EXCLUDED.class_name`,
    [row.id, row.role, row.name, row.username, row.password, row.className || null]
  );
}

function upsertStudent(client, row) {
  return client.query(
    `INSERT INTO students (id, nis, nisn, name, gender, username, password, class_name, elective_subjects, room, session)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
     ON CONFLICT (id) DO UPDATE SET
       nis = EXCLUDED.nis,
       nisn = EXCLUDED.nisn,
       name = EXCLUDED.name,
       gender = EXCLUDED.gender,
       username = EXCLUDED.username,
       password = EXCLUDED.password,
       class_name = EXCLUDED.class_name,
       elective_subjects = EXCLUDED.elective_subjects,
       room = EXCLUDED.room,
       session = EXCLUDED.session`,
    [row.id, row.nis, row.nisn || "", row.name, row.gender || "", row.username, row.password, row.className, JSON.stringify(row.electiveSubjects || []), row.room || "-", row.session || "-"]
  );
}

function upsertExam(client, row) {
  return client.query(
    `INSERT INTO exams (id, code, subject, teacher_id, exam_date, start_time, duration_minutes, token, status, randomize_questions, randomize_options)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO UPDATE SET
       code = EXCLUDED.code,
       subject = EXCLUDED.subject,
       teacher_id = EXCLUDED.teacher_id,
       exam_date = EXCLUDED.exam_date,
       start_time = EXCLUDED.start_time,
       duration_minutes = EXCLUDED.duration_minutes,
       token = EXCLUDED.token,
       status = EXCLUDED.status,
       randomize_questions = EXCLUDED.randomize_questions,
       randomize_options = EXCLUDED.randomize_options`,
    [row.id, row.code, row.subject, row.teacherId || null, row.date || null, row.startTime || null, row.durationMinutes, row.token || "", row.status || "draft", !!row.randomizeQuestions, !!row.randomizeOptions]
  );
}

function upsertQuestion(client, row) {
  return client.query(
    `INSERT INTO questions (id, exam_id, type, body, options, answer_key, score)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       exam_id = EXCLUDED.exam_id,
       type = EXCLUDED.type,
       body = EXCLUDED.body,
       options = EXCLUDED.options,
       answer_key = EXCLUDED.answer_key,
       score = EXCLUDED.score`,
    [row.id, row.examId, row.type || "multiple_choice", row.body, JSON.stringify(row.options || []), row.answerKey || null, row.score || 1]
  );
}

function upsertAttempt(client, row) {
  return client.query(
    `INSERT INTO attempts (id, exam_id, student_id, status, answers, score, started_at, submitted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       exam_id = EXCLUDED.exam_id,
       student_id = EXCLUDED.student_id,
       status = EXCLUDED.status,
       answers = EXCLUDED.answers,
       score = EXCLUDED.score,
       started_at = EXCLUDED.started_at,
       submitted_at = EXCLUDED.submitted_at,
       updated_at = EXCLUDED.updated_at`,
    [row.id, row.examId, row.studentId, row.status || "not_started", JSON.stringify(row.answers || {}), row.score ? JSON.stringify(row.score) : null, row.startedAt || null, row.submittedAt || null, row.updatedAt || null]
  );
}

function upsertViolation(client, row) {
  return client.query(
    `INSERT INTO violations (id, student_id, exam_id, type, level, message, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       student_id = EXCLUDED.student_id,
       exam_id = EXCLUDED.exam_id,
       type = EXCLUDED.type,
       level = EXCLUDED.level,
       message = EXCLUDED.message,
       created_at = EXCLUDED.created_at`,
    [row.id, row.studentId || null, row.examId || null, row.type, row.level || "warning", row.message || "", row.createdAt || new Date().toISOString()]
  );
}
