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
