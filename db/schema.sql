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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS active_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status);
CREATE INDEX IF NOT EXISTS idx_questions_exam_id ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_exam_id ON attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_student_id ON attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);
CREATE INDEX IF NOT EXISTS idx_violations_exam_id ON violations(exam_id);
CREATE INDEX IF NOT EXISTS idx_violations_student_id ON violations(student_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_user_id ON active_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_expires_at ON active_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
