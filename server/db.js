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

export const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  class_name TEXT,
  subjects JSONB NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS subjects JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  nis TEXT NOT NULL UNIQUE,
  nisn TEXT,
  name TEXT NOT NULL,
  gender TEXT,
  religion TEXT,
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
ALTER TABLE students ADD COLUMN IF NOT EXISTS religion TEXT;

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  teacher_id TEXT,
  teacher_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  exam_date TEXT,
  start_time TEXT,
  end_time TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 90,
  submit_unlock_minutes INTEGER NOT NULL DEFAULT 30,
  token TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  randomize_questions BOOLEAN NOT NULL DEFAULT FALSE,
  randomize_options BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE exams ADD COLUMN IF NOT EXISTS end_time TEXT;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'unreviewed';
ALTER TABLE exams ADD COLUMN IF NOT EXISTS teacher_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS submit_unlock_minutes INTEGER NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'multiple_choice',
  body TEXT NOT NULL,
  image TEXT NOT NULL DEFAULT '',
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer_key TEXT,
  correct_answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  statements JSONB NOT NULL DEFAULT '[]'::jsonb,
  pairs JSONB NOT NULL DEFAULT '[]'::jsonb,
  short_answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  score NUMERIC NOT NULL DEFAULT 1
);

ALTER TABLE questions ADD COLUMN IF NOT EXISTS image TEXT NOT NULL DEFAULT '';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS correct_answers JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS statements JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS pairs JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS short_answers JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS answer_rules JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started',
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  question_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  option_orders JSONB NOT NULL DEFAULT '{}'::jsonb,
  score JSONB,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE (exam_id, student_id)
);

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS question_order JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS option_orders JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS violations (
  id TEXT PRIMARY KEY,
  student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
  exam_id TEXT REFERENCES exams(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'warning',
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedup_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

ALTER TABLE violations ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE violations ADD COLUMN IF NOT EXISTS dedup_key TEXT;
ALTER TABLE violations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS active_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  access_method TEXT NOT NULL DEFAULT 'ordinary_browser',
  exam_client_verified BOOLEAN NOT NULL DEFAULT FALSE,
  browser_token_id TEXT,
  browser_access_granted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE active_sessions ADD COLUMN IF NOT EXISTS access_method TEXT NOT NULL DEFAULT 'ordinary_browser';
ALTER TABLE active_sessions ADD COLUMN IF NOT EXISTS exam_client_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE active_sessions ADD COLUMN IF NOT EXISTS browser_token_id TEXT;
ALTER TABLE active_sessions ADD COLUMN IF NOT EXISTS browser_access_granted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  username TEXT,
  role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_class_name ON students(class_name);
CREATE INDEX IF NOT EXISTS idx_students_religion ON students(religion);
CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status);
CREATE INDEX IF NOT EXISTS idx_questions_exam_id ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_exam_id ON attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_student_id ON attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);
CREATE INDEX IF NOT EXISTS idx_violations_exam_id ON violations(exam_id);
CREATE INDEX IF NOT EXISTS idx_violations_student_id ON violations(student_id);
CREATE INDEX IF NOT EXISTS idx_violations_dedup_key ON violations(dedup_key);
CREATE INDEX IF NOT EXISTS idx_active_sessions_user_id ON active_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_expires_at ON active_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
`;

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

let writeQueue = Promise.resolve();

function enqueueWrite(operation) {
  const run = writeQueue.then(operation, operation);
  writeQueue = run.catch(() => {});
  return run;
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
  const [users, students, exams, questions, attempts, violations, sessions, auditLogs, accessControl, examSettings] = await Promise.all([
    pool.query("SELECT * FROM users ORDER BY role, name"),
    pool.query("SELECT * FROM students ORDER BY class_name, name"),
    pool.query("SELECT * FROM exams ORDER BY exam_date NULLS LAST, start_time NULLS LAST, code"),
    pool.query("SELECT * FROM questions ORDER BY exam_id, id"),
    pool.query("SELECT * FROM attempts ORDER BY updated_at DESC NULLS LAST, id"),
    pool.query("SELECT * FROM violations ORDER BY created_at DESC"),
    pool.query("SELECT * FROM active_sessions ORDER BY last_seen_at DESC"),
    pool.query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500"),
    pool.query("SELECT value FROM app_settings WHERE id = 'access_control'"),
    pool.query("SELECT value FROM app_settings WHERE id = 'exam_settings'")
  ]);

  return {
    users: users.rows.map((row) => ({
      id: row.id,
      role: row.role,
      name: row.name,
      username: row.username,
      password: row.password,
      className: row.class_name || undefined,
      subjects: row.subjects || []
    })),
    students: students.rows.map((row) => ({
      id: row.id,
      nis: row.nis,
      nisn: row.nisn || "",
      name: row.name,
      gender: row.gender || "",
      religion: row.religion || "",
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
      teacherIds: row.teacher_ids || (row.teacher_id ? [row.teacher_id] : []),
      date: row.exam_date,
      startTime: row.start_time,
      endTime: row.end_time || "",
      durationMinutes: row.duration_minutes,
      submitUnlockMinutes: row.submit_unlock_minutes ?? 30,
      token: row.token,
      status: row.status,
      reviewStatus: row.review_status || "unreviewed",
      randomizeQuestions: row.randomize_questions,
      randomizeOptions: row.randomize_options
    })),
    questions: questions.rows.map((row) => ({
      id: row.id,
      examId: row.exam_id,
      type: row.type,
      body: row.body,
      image: row.image || "",
      options: row.options || [],
      answerKey: row.answer_key,
      correctAnswers: row.correct_answers || [],
      statements: row.statements || [],
      pairs: row.pairs || [],
      shortAnswers: row.short_answers || [],
      answerRules: row.answer_rules || {},
      score: Number(row.score)
    })),
    attempts: attempts.rows.map((row) => ({
      id: row.id,
      examId: row.exam_id,
      studentId: row.student_id,
      status: row.status,
      answers: row.answers || {},
      questionOrder: row.question_order || [],
      optionOrders: row.option_orders || {},
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
      metadata: row.metadata || {},
      dedupKey: row.dedup_key || "",
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at)
    })),
    sessions: sessions.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      role: row.role,
      userAgent: row.user_agent || "",
      ipAddress: row.ip_address || "",
      accessMethod: row.access_method || "ordinary_browser",
      examClientVerified: !!row.exam_client_verified,
      browserTokenId: row.browser_token_id || "",
      browserAccessGrantedAt: toIso(row.browser_access_granted_at),
      createdAt: toIso(row.created_at),
      lastSeenAt: toIso(row.last_seen_at),
      expiresAt: toIso(row.expires_at)
    })),
    auditLogs: auditLogs.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      role: row.role,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      message: row.message,
      metadata: row.metadata || {},
      createdAt: toIso(row.created_at)
    })),
    accessControl: accessControl.rows[0]?.value || undefined,
    examSettings: examSettings.rows[0]?.value || undefined
  };
}

export async function writeStoreToPostgres(store) {
  return enqueueWrite(() => writeStoreToPostgresNow(store));
}

async function writeStoreToPostgresNow(store) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await deleteMissingRows(client, "audit_logs", store.auditLogs || []);
    await deleteMissingRows(client, "active_sessions", store.sessions || []);
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
    await upsertRows(client, store.sessions || [], upsertSession);
    await upsertRows(client, store.auditLogs || [], upsertAuditLog);
    await upsertSetting(client, "access_control", store.accessControl || {});
    await upsertSetting(client, "exam_settings", store.examSettings || {});

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function touchSessionInPostgres(sessionId, lastSeenAt) {
  return enqueueWrite(() => pool.query(
    "UPDATE active_sessions SET last_seen_at = $2 WHERE id = $1",
    [sessionId, lastSeenAt || new Date().toISOString()]
  ));
}

export async function deleteSessionFromPostgres(sessionId) {
  return enqueueWrite(() => pool.query("DELETE FROM active_sessions WHERE id = $1", [sessionId]));
}

export async function saveLoginSessionToPostgres(session, { replaceUserSessions = false } = {}) {
  return enqueueWrite(async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM active_sessions WHERE expires_at <= NOW()");
      if (replaceUserSessions) {
        await client.query("DELETE FROM active_sessions WHERE user_id = $1", [session.userId]);
      }
      await upsertSession(client, session);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function saveAuditLogToPostgres(row) {
  return enqueueWrite(async () => {
    const client = await pool.connect();
    try {
      await upsertAuditLog(client, row);
    } finally {
      client.release();
    }
  });
}

export async function saveAttemptToPostgres(row) {
  return enqueueWrite(async () => {
    const client = await pool.connect();
    try {
      await upsertAttempt(client, row);
    } finally {
      client.release();
    }
  });
}

export async function saveViolationToPostgres(row) {
  return enqueueWrite(async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (row.dedupKey) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [row.dedupKey]);
        const existing = await client.query(
          `UPDATE violations
           SET student_id = $1,
               exam_id = $2,
               type = $3,
               level = $4,
               message = $5,
               metadata = violations.metadata || $6::jsonb,
               updated_at = $7
           WHERE dedup_key = $8
           RETURNING id`,
          [
            row.studentId || null,
            row.examId || null,
            row.type,
            row.level || "warning",
            row.message || "",
            JSON.stringify(row.metadata || {}),
            row.updatedAt || new Date().toISOString(),
            row.dedupKey
          ]
        );
        if (existing.rowCount) {
          await client.query("COMMIT");
          return;
        }
      }
      await upsertViolation(client, row);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
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
    `INSERT INTO users (id, role, name, username, password, class_name, subjects)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       role = EXCLUDED.role,
       name = EXCLUDED.name,
       username = EXCLUDED.username,
       password = EXCLUDED.password,
       class_name = EXCLUDED.class_name,
       subjects = EXCLUDED.subjects`,
    [row.id, row.role, row.name, row.username, row.password, row.className || null, JSON.stringify(row.subjects || [])]
  );
}

function upsertStudent(client, row) {
  return client.query(
    `INSERT INTO students (id, nis, nisn, name, gender, religion, username, password, class_name, elective_subjects, room, session)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
     ON CONFLICT (id) DO UPDATE SET
       nis = EXCLUDED.nis,
       nisn = EXCLUDED.nisn,
       name = EXCLUDED.name,
       gender = EXCLUDED.gender,
       religion = EXCLUDED.religion,
       username = EXCLUDED.username,
       password = EXCLUDED.password,
       class_name = EXCLUDED.class_name,
       elective_subjects = EXCLUDED.elective_subjects,
       room = EXCLUDED.room,
       session = EXCLUDED.session`,
    [row.id, row.nis, row.nisn || "", row.name, row.gender || "", row.religion || "", row.username, row.password, row.className, JSON.stringify(row.electiveSubjects || []), row.room || "-", row.session || "-"]
  );
}

function upsertExam(client, row) {
  return client.query(
    `INSERT INTO exams (id, code, subject, teacher_id, teacher_ids, exam_date, start_time, end_time, duration_minutes, submit_unlock_minutes, token, status, review_status, randomize_questions, randomize_options)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (id) DO UPDATE SET
       code = EXCLUDED.code,
       subject = EXCLUDED.subject,
       teacher_id = EXCLUDED.teacher_id,
       teacher_ids = EXCLUDED.teacher_ids,
       exam_date = EXCLUDED.exam_date,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       duration_minutes = EXCLUDED.duration_minutes,
       submit_unlock_minutes = EXCLUDED.submit_unlock_minutes,
       token = EXCLUDED.token,
       status = EXCLUDED.status,
       review_status = EXCLUDED.review_status,
       randomize_questions = EXCLUDED.randomize_questions,
       randomize_options = EXCLUDED.randomize_options`,
    [row.id, row.code, row.subject, row.teacherId || null, JSON.stringify(row.teacherIds || (row.teacherId ? [row.teacherId] : [])), row.date || null, row.startTime || null, row.endTime || null, row.durationMinutes, row.submitUnlockMinutes ?? 30, row.token || "", row.status || "draft", row.reviewStatus || "unreviewed", !!row.randomizeQuestions, !!row.randomizeOptions]
  );
}

function upsertQuestion(client, row) {
  return client.query(
    `INSERT INTO questions (id, exam_id, type, body, image, options, answer_key, correct_answers, statements, pairs, short_answers, answer_rules, score)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13)
     ON CONFLICT (id) DO UPDATE SET
       exam_id = EXCLUDED.exam_id,
       type = EXCLUDED.type,
       body = EXCLUDED.body,
       image = EXCLUDED.image,
       options = EXCLUDED.options,
       answer_key = EXCLUDED.answer_key,
       correct_answers = EXCLUDED.correct_answers,
       statements = EXCLUDED.statements,
       pairs = EXCLUDED.pairs,
       short_answers = EXCLUDED.short_answers,
       answer_rules = EXCLUDED.answer_rules,
       score = EXCLUDED.score`,
    [
      row.id,
      row.examId,
      row.type || "multiple_choice",
      row.body,
      row.image || "",
      JSON.stringify(row.options || []),
      row.answerKey || null,
      JSON.stringify(row.correctAnswers || []),
      JSON.stringify(row.statements || []),
      JSON.stringify(row.pairs || []),
      JSON.stringify(row.shortAnswers || []),
      JSON.stringify(row.answerRules || {}),
      row.score || 1
    ]
  );
}

function upsertAttempt(client, row) {
  return client.query(
    `INSERT INTO attempts (id, exam_id, student_id, status, answers, question_order, option_orders, score, started_at, submitted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11)
     ON CONFLICT (id) DO UPDATE SET
       exam_id = EXCLUDED.exam_id,
       student_id = EXCLUDED.student_id,
       status = EXCLUDED.status,
       answers = EXCLUDED.answers,
       question_order = EXCLUDED.question_order,
       option_orders = EXCLUDED.option_orders,
       score = EXCLUDED.score,
       started_at = EXCLUDED.started_at,
       submitted_at = EXCLUDED.submitted_at,
       updated_at = EXCLUDED.updated_at`,
    [
      row.id,
      row.examId,
      row.studentId,
      row.status || "not_started",
      JSON.stringify(row.answers || {}),
      JSON.stringify(row.questionOrder || []),
      JSON.stringify(row.optionOrders || {}),
      row.score ? JSON.stringify(row.score) : null,
      row.startedAt || null,
      row.submittedAt || null,
      row.updatedAt || null
    ]
  );
}

function upsertViolation(client, row) {
  return client.query(
    `INSERT INTO violations (id, student_id, exam_id, type, level, message, metadata, dedup_key, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       student_id = EXCLUDED.student_id,
       exam_id = EXCLUDED.exam_id,
       type = EXCLUDED.type,
       level = EXCLUDED.level,
       message = EXCLUDED.message,
       metadata = EXCLUDED.metadata,
       dedup_key = EXCLUDED.dedup_key,
       created_at = EXCLUDED.created_at,
       updated_at = EXCLUDED.updated_at`,
    [
      row.id,
      row.studentId || null,
      row.examId || null,
      row.type,
      row.level || "warning",
      row.message || "",
      JSON.stringify(row.metadata || {}),
      row.dedupKey || null,
      row.createdAt || new Date().toISOString(),
      row.updatedAt || null
    ]
  );
}

function upsertSession(client, row) {
  return client.query(
    `INSERT INTO active_sessions (id, user_id, role, user_agent, ip_address, access_method, exam_client_verified, browser_token_id, browser_access_granted_at, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       role = EXCLUDED.role,
       user_agent = EXCLUDED.user_agent,
       ip_address = EXCLUDED.ip_address,
       access_method = EXCLUDED.access_method,
       exam_client_verified = EXCLUDED.exam_client_verified,
       browser_token_id = EXCLUDED.browser_token_id,
       browser_access_granted_at = EXCLUDED.browser_access_granted_at,
       created_at = EXCLUDED.created_at,
       last_seen_at = EXCLUDED.last_seen_at,
       expires_at = EXCLUDED.expires_at`,
    [
      row.id,
      row.userId,
      row.role,
      row.userAgent || "",
      row.ipAddress || "",
      row.accessMethod || "ordinary_browser",
      !!row.examClientVerified,
      row.browserTokenId || null,
      row.browserAccessGrantedAt || null,
      row.createdAt || new Date().toISOString(),
      row.lastSeenAt || new Date().toISOString(),
      row.expiresAt
    ]
  );
}

function upsertSetting(client, id, value) {
  return client.query(
    `INSERT INTO app_settings (id, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = NOW()`,
    [id, JSON.stringify(value || {})]
  );
}

function upsertAuditLog(client, row) {
  return client.query(
    `INSERT INTO audit_logs (id, user_id, username, role, action, entity_type, entity_id, message, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     ON CONFLICT (id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       username = EXCLUDED.username,
       role = EXCLUDED.role,
       action = EXCLUDED.action,
       entity_type = EXCLUDED.entity_type,
       entity_id = EXCLUDED.entity_id,
       message = EXCLUDED.message,
       metadata = EXCLUDED.metadata,
       created_at = EXCLUDED.created_at`,
    [row.id, row.userId || null, row.username || "", row.role || "", row.action, row.entityType, row.entityId || null, row.message || "", JSON.stringify(row.metadata || {}), row.createdAt || new Date().toISOString()]
  );
}
