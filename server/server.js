import cors from "cors";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDatabase, postgresEnabled, readStoreFromPostgres, writeStoreToPostgres } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const storePath = path.join(dataDir, "cbt-store.json");
const app = express();
const port = Number(process.env.PORT || 4100);
const authSecret = process.env.AUTH_SECRET || "dev-secret-ganti-saat-produksi";
const tokenTtlMs = Number(process.env.TOKEN_TTL_HOURS || 8) * 60 * 60 * 1000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const seed = {
  users: [
    { id: "u-admin", role: "admin", name: "Admin Sekolah", username: "admin", password: "admin123" },
    { id: "u-guru-inf", role: "guru", name: "Guru Informatika", username: "guru_informatika", password: "guru123" },
    { id: "u-pengawas", role: "pengawas", name: "Pengawas Ruang", username: "pengawas", password: "awas123" },
    { id: "s-10676", role: "siswa", name: "AGISFA ROCHMANY ALFATH", username: "10676", password: "10676", className: "XII INFOR 1" }
  ],
  students: [
    { id: "s-10676", nis: "10676", name: "AGISFA ROCHMANY ALFATH", username: "10676", password: "10676", className: "XII INFOR 1", room: "Lab 1", session: "Sesi 1", electiveSubjects: ["Informatika 2", "Sejarah TL 2"] },
    { id: "s-10690", nis: "10690", name: "AMELIA RASHEEDAH", username: "10690", password: "10690", className: "XII INFOR 1", room: "Lab 1", session: "Sesi 1", electiveSubjects: ["Sejarah TL 1", "Sosiologi 1"] },
    { id: "s-10693", nis: "10693", name: "AMY JUTTA FIRENZE", username: "10693", password: "10693", className: "XII INFOR 1", room: "Lab 1", session: "Sesi 1", electiveSubjects: ["Sejarah TL 2"] }
  ],
  exams: [
    {
      id: "exam-inf-xii",
      code: "INFOR-XII-01",
      subject: "Informatika XII",
      teacherId: "u-guru-inf",
      date: "2026-06-10",
      startTime: "08:00",
      durationMinutes: 90,
      token: "IN94",
      status: "draft",
      randomizeQuestions: true,
      randomizeOptions: true
    }
  ],
  questions: [
    {
      id: "q-1",
      examId: "exam-inf-xii",
      type: "multiple_choice",
      body: "Apa yang dimaksud dengan literasi digital?",
      options: [
        { key: "A", text: "Kemampuan membaca dan menulis di perangkat digital." },
        { key: "B", text: "Kemampuan menggunakan internet untuk belanja online." },
        { key: "C", text: "Kemampuan memahami dan menggunakan informasi digital secara efektif." },
        { key: "D", text: "Kemampuan mengunduh aplikasi dari internet." },
        { key: "E", text: "Kemampuan bermain game online." }
      ],
      answerKey: "C",
      score: 1
    }
  ],
  attempts: [
    { id: "a-1", examId: "exam-inf-xii", studentId: "s-10676", status: "not_started", score: null, updatedAt: null }
  ],
  violations: [
    { id: "v-1", studentId: "s-10676", examId: "exam-inf-xii", type: "heartbeat_ready", level: "info", message: "Client siap mengirim heartbeat saat ujian.", createdAt: "2026-06-02T07:00:00.000Z" }
  ]
};

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, JSON.stringify(seed, null, 2), "utf8");
  }
}

async function readStore() {
  if (postgresEnabled) {
    await initDatabase(seed);
    return normalizeStore(await readStoreFromPostgres());
  }
  await ensureStore();
  return normalizeStore(JSON.parse(await fs.readFile(storePath, "utf8")));
}

async function writeStore(store) {
  const normalized = normalizeStore(store);
  if (postgresEnabled) {
    await writeStoreToPostgres(normalized);
    return;
  }
  await fs.writeFile(storePath, JSON.stringify(normalized, null, 2), "utf8");
}

function publicUser(user) {
  const { password, ...safe } = user;
  return safe;
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payload) {
  return crypto.createHmac("sha256", authSecret).update(payload).digest("base64url");
}

function createSessionToken(user) {
  const payload = base64Url(JSON.stringify({
    sub: user.id,
    role: user.role,
    exp: Date.now() + tokenTtlMs
  }));
  return `${payload}.${signPayload(payload)}`;
}

function verifySessionToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature || signPayload(payload) !== signature) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeStore(store) {
  store.users ??= [];
  store.students ??= [];
  store.exams ??= [];
  store.questions ??= [];
  store.attempts ??= [];
  store.violations ??= [];

  for (const exam of store.exams) {
    exam.status ??= "draft";
    exam.token ??= "";
    exam.randomizeQuestions ??= false;
    exam.randomizeOptions ??= false;
  }

  for (const attempt of store.attempts) {
    attempt.answers ??= {};
    attempt.startedAt ??= null;
    attempt.submittedAt ??= null;
    attempt.updatedAt ??= null;
    attempt.score ??= null;
  }

  for (const student of store.students) {
    student.electiveSubjects = normalizeElectiveSubjects(student.electiveSubjects);
  }

  return store;
}

function normalizeElectiveSubjects(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (!value) return [];
  return String(value).split(/[;,|]/).map((item) => item.trim()).filter(Boolean);
}

function readElectiveSubjects(row) {
  return normalizeElectiveSubjects([
    row.electiveSubjects,
    row.mapelPilihan,
    row["Mapel Pilihan"],
    row.mapelPilihan1,
    row["Mapel Pilihan 1"],
    row["mapel pilihan 1"],
    row.mapel_pilihan_1,
    row.mapelPilihan2,
    row["Mapel Pilihan 2"],
    row["mapel pilihan 2"],
    row.mapel_pilihan_2,
    row.mapelPilihan3,
    row["Mapel Pilihan 3"],
    row["mapel pilihan 3"],
    row.mapel_pilihan_3,
    row.mapelPilihan4,
    row["Mapel Pilihan 4"],
    row["mapel pilihan 4"],
    row.mapel_pilihan_4,
    row.mapelPilihan5,
    row["Mapel Pilihan 5"],
    row["mapel pilihan 5"],
    row.mapel_pilihan_5
  ].filter(Boolean).flatMap((item) => Array.isArray(item) ? item : String(item).split(/[;,|]/)));
}

function calculateScore(store, attempt) {
  const questions = store.questions.filter((question) => question.examId === attempt.examId);
  const totalScore = questions.reduce((sum, question) => sum + Number(question.score || 1), 0);
  const earnedScore = questions.reduce((sum, question) => {
    const answer = attempt.answers?.[question.id];
    return answer === question.answerKey ? sum + Number(question.score || 1) : sum;
  }, 0);
  const percent = totalScore ? Math.round((earnedScore / totalScore) * 10000) / 100 : 0;
  return { earnedScore, totalScore, percent };
}

function enrichAttempts(store) {
  return store.attempts.map((attempt) => {
    const student = store.students.find((item) => item.id === attempt.studentId);
    const exam = store.exams.find((item) => item.id === attempt.examId);
    return {
      ...attempt,
      studentName: student?.name || "-",
      className: student?.className || "-",
      room: student?.room || "-",
      session: student?.session || "-",
      examCode: exam?.code || "-",
      subject: exam?.subject || "-"
    };
  });
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = verifySessionToken(token);
  if (!session) return res.status(401).json({ message: "Sesi login tidak valid atau sudah kedaluwarsa." });

  const store = await readStore();
  const user = store.users.find((item) => item.id === session.sub);
  if (!user) return res.status(401).json({ message: "Akun tidak ditemukan." });

  req.user = publicUser(user);
  next();
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ message: "Akses tidak diizinkan untuk role akun ini." });
    }
    next();
  };
}

function canManageExam(user, exam) {
  if (user.role === "admin") return true;
  return user.role === "guru" && exam.teacherId === user.id;
}

function filterExamsByUser(store, user) {
  if (user.role === "guru") return store.exams.filter((exam) => exam.teacherId === user.id);
  return store.exams;
}

function filterAttemptsByUser(store, user) {
  if (user.role !== "guru") return enrichAttempts(store);
  const examIds = new Set(filterExamsByUser(store, user).map((exam) => exam.id));
  return enrichAttempts(store).filter((attempt) => examIds.has(attempt.examId));
}

function cleanQuestionPayload(body) {
  const options = Array.isArray(body.options) ? body.options : [];
  return {
    examId: body.examId,
    type: "multiple_choice",
    body: String(body.body || "").trim(),
    options: options
      .map((option) => ({
        key: String(option.key || "").trim().toUpperCase(),
        text: String(option.text || "").trim()
      }))
      .filter((option) => option.key && option.text),
    answerKey: String(body.answerKey || "").trim().toUpperCase(),
    score: Number(body.score || 1)
  };
}

function validateQuestion(question) {
  if (!question.examId) return "Paket ujian belum dipilih.";
  if (!question.body) return "Teks soal wajib diisi.";
  if (question.options.length < 2) return "Minimal dua opsi jawaban wajib diisi.";
  if (!question.options.some((option) => option.key === question.answerKey)) return "Kunci jawaban harus sesuai salah satu opsi.";
  if (!Number.isFinite(question.score) || question.score <= 0) return "Bobot soal harus lebih dari 0.";
  return "";
}

app.get("/api/health", async (_req, res) => {
  res.json({
    ok: true,
    service: "CBT SMAN 94 API",
    storage: postgresEnabled ? "postgresql" : "json",
    time: new Date().toISOString()
  });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  const store = await readStore();
  const user = store.users.find((item) => item.username === username && item.password === password);
  if (!user) {
    return res.status(401).json({ message: "Username atau password salah." });
  }
  res.json({ user: publicUser(user), token: createSessionToken(user) });
});

app.use(requireAuth);

app.get("/api/me", async (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/summary", allowRoles("admin", "guru", "pengawas"), async (req, res) => {
  const store = await readStore();
  const visibleExams = filterExamsByUser(store, req.user);
  const visibleExamIds = new Set(visibleExams.map((exam) => exam.id));
  res.json({
    students: store.students.length,
    teachers: store.users.filter((user) => user.role === "guru").length,
    exams: visibleExams.length,
    activeAttempts: store.attempts.filter((attempt) => visibleExamIds.has(attempt.examId) && attempt.status === "in_progress").length,
    violations: store.violations.filter((violation) => visibleExamIds.has(violation.examId)).length
  });
});

app.get("/api/students", allowRoles("admin", "guru", "pengawas"), async (_req, res) => {
  const store = await readStore();
  res.json(store.students);
});

app.post("/api/students", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const student = {
    id: createId("s"),
    nis: req.body.nis,
    nisn: req.body.nisn || "",
    name: req.body.name,
    gender: req.body.gender || "",
    username: req.body.username || req.body.nis,
    password: req.body.password || req.body.nis,
    className: req.body.className,
    room: req.body.room || "-",
    session: req.body.session || "-",
    electiveSubjects: readElectiveSubjects(req.body)
  };
  store.students.push(student);
  store.users.push({ id: student.id, role: "siswa", name: student.name, username: student.username, password: student.password, className: student.className });
  await writeStore(store);
  res.status(201).json(student);
});

app.post("/api/students/bulk", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const rows = Array.isArray(req.body.students) ? req.body.students : [];
  const created = [];
  const updated = [];
  const skipped = [];

  for (const row of rows) {
    const nis = String(row.nis || row.NIS || row.username || "").trim();
    const name = String(row.name || row.nama || row.Nama || "").trim();
    if (!nis || !name) {
      skipped.push(row);
      continue;
    }

    const incoming = {
      nis,
      nisn: String(row.nisn || row.NISN || "").trim(),
      name,
      gender: String(row.gender || row["L/P"] || row.lp || row.LP || "").trim(),
      username: String(row.username || row.Username || nis).trim(),
      password: String(row.password || row.Password || nis).trim(),
      className: String(row.className || row.kelas || row.Kelas || "-").trim(),
      room: String(row.room || row.ruang || row.Ruang || "-").trim(),
      session: String(row.session || row.sesi || row.Sesi || "-").trim(),
      electiveSubjects: readElectiveSubjects(row)
    };

    const existing = store.students.find((student) => student.nis === nis || student.username === incoming.username);
    if (existing) {
      Object.assign(existing, incoming);
      const user = store.users.find((item) => item.id === existing.id);
      if (user) {
        Object.assign(user, {
          name: existing.name,
          username: existing.username,
          password: existing.password,
          className: existing.className
        });
      }
      updated.push(existing);
    } else {
      const student = { id: createId("s"), ...incoming };
      store.students.push(student);
      store.users.push({
        id: student.id,
        role: "siswa",
        name: student.name,
        username: student.username,
        password: student.password,
        className: student.className
      });
      created.push(student);
    }
  }

  await writeStore(store);
  res.status(201).json({ created: created.length, updated: updated.length, skipped: skipped.length, students: store.students });
});

app.put("/api/students/:id", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const student = store.students.find((item) => item.id === req.params.id);
  if (!student) return res.status(404).json({ message: "Siswa tidak ditemukan." });

  Object.assign(student, {
    nis: req.body.nis ?? student.nis,
    nisn: req.body.nisn ?? student.nisn,
    name: req.body.name ?? student.name,
    gender: req.body.gender ?? student.gender,
    username: req.body.username ?? student.username,
    password: req.body.password ?? student.password,
    className: req.body.className ?? student.className,
    room: req.body.room ?? student.room,
    session: req.body.session ?? student.session,
    electiveSubjects: req.body.electiveSubjects ? readElectiveSubjects(req.body) : student.electiveSubjects
  });

  const user = store.users.find((item) => item.id === student.id);
  if (user) {
    Object.assign(user, {
      name: student.name,
      username: student.username,
      password: student.password,
      className: student.className
    });
  }

  await writeStore(store);
  res.json(student);
});

app.delete("/api/students/:id", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const before = store.students.length;
  store.students = store.students.filter((student) => student.id !== req.params.id);
  if (store.students.length === before) return res.status(404).json({ message: "Siswa tidak ditemukan." });

  store.users = store.users.filter((user) => user.id !== req.params.id);
  store.attempts = store.attempts.filter((attempt) => attempt.studentId !== req.params.id);
  await writeStore(store);
  res.json({ ok: true });
});

app.get("/api/exams", allowRoles("admin", "guru", "pengawas"), async (req, res) => {
  const store = await readStore();
  const exams = filterExamsByUser(store, req.user).map((exam) => ({
    ...exam,
    questionCount: store.questions.filter((question) => question.examId === exam.id).length,
    participantCount: store.attempts.filter((attempt) => attempt.examId === exam.id).length
  }));
  res.json(exams);
});

app.post("/api/exams", allowRoles("admin", "guru"), async (req, res) => {
  const store = await readStore();
  const exam = {
    id: createId("exam"),
    code: req.body.code,
    subject: req.body.subject,
    teacherId: req.user.role === "guru" ? req.user.id : req.body.teacherId || "u-guru-inf",
    date: req.body.date,
    startTime: req.body.startTime,
    durationMinutes: Number(req.body.durationMinutes || 90),
    token: req.body.token,
    status: req.body.status || "draft",
    randomizeQuestions: Boolean(req.body.randomizeQuestions),
    randomizeOptions: Boolean(req.body.randomizeOptions)
  };
  store.exams.push(exam);
  await writeStore(store);
  res.status(201).json(exam);
});

app.put("/api/exams/:id", allowRoles("admin", "guru"), async (req, res) => {
  const store = await readStore();
  const exam = store.exams.find((item) => item.id === req.params.id);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  if (!canManageExam(req.user, exam)) return res.status(403).json({ message: "Guru hanya bisa mengelola ujian miliknya." });

  Object.assign(exam, {
    code: req.body.code ?? exam.code,
    subject: req.body.subject ?? exam.subject,
    teacherId: req.user.role === "guru" ? exam.teacherId : req.body.teacherId ?? exam.teacherId,
    date: req.body.date ?? exam.date,
    startTime: req.body.startTime ?? exam.startTime,
    durationMinutes: req.body.durationMinutes ? Number(req.body.durationMinutes) : exam.durationMinutes,
    token: req.body.token ?? exam.token,
    status: req.body.status ?? exam.status,
    randomizeQuestions: req.body.randomizeQuestions ?? exam.randomizeQuestions,
    randomizeOptions: req.body.randomizeOptions ?? exam.randomizeOptions
  });

  await writeStore(store);
  res.json(exam);
});

app.delete("/api/exams/:id", allowRoles("admin", "guru"), async (req, res) => {
  const store = await readStore();
  const exam = store.exams.find((item) => item.id === req.params.id);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  if (!canManageExam(req.user, exam)) return res.status(403).json({ message: "Guru hanya bisa menghapus ujian miliknya." });
  const before = store.exams.length;
  store.exams = store.exams.filter((exam) => exam.id !== req.params.id);
  if (store.exams.length === before) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  store.questions = store.questions.filter((question) => question.examId !== req.params.id);
  store.attempts = store.attempts.filter((attempt) => attempt.examId !== req.params.id);
  store.violations = store.violations.filter((violation) => violation.examId !== req.params.id);
  await writeStore(store);
  res.json({ ok: true });
});

app.get("/api/exams/:id/participants", allowRoles("admin", "guru", "pengawas"), async (req, res) => {
  const store = await readStore();
  const exam = store.exams.find((item) => item.id === req.params.id);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  if (req.user.role === "guru" && exam.teacherId !== req.user.id) return res.status(403).json({ message: "Guru hanya bisa melihat ujian miliknya." });
  res.json(enrichAttempts(store).filter((attempt) => attempt.examId === req.params.id));
});

app.put("/api/exams/:id/participants", allowRoles("admin", "guru"), async (req, res) => {
  const store = await readStore();
  const exam = store.exams.find((item) => item.id === req.params.id);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  if (!canManageExam(req.user, exam)) return res.status(403).json({ message: "Guru hanya bisa mengatur ujian miliknya." });
  const studentIds = Array.isArray(req.body.studentIds) ? req.body.studentIds : [];

  store.attempts = store.attempts.filter((attempt) => attempt.examId !== exam.id || studentIds.includes(attempt.studentId));
  for (const studentId of studentIds) {
    const exists = store.attempts.some((attempt) => attempt.examId === exam.id && attempt.studentId === studentId);
    if (!exists) {
      store.attempts.push({
        id: createId("attempt"),
        examId: exam.id,
        studentId,
        status: "not_started",
        answers: {},
        score: null,
        startedAt: null,
        submittedAt: null,
        updatedAt: null
      });
    }
  }

  await writeStore(store);
  res.json(enrichAttempts(store).filter((attempt) => attempt.examId === exam.id));
});

app.get("/api/questions", allowRoles("admin", "guru", "pengawas"), async (req, res) => {
  const store = await readStore();
  const { examId } = req.query;
  const visibleExamIds = new Set(filterExamsByUser(store, req.user).map((exam) => exam.id));
  const questions = store.questions.filter((question) => visibleExamIds.has(question.examId));
  res.json(examId ? questions.filter((question) => question.examId === examId) : questions);
});

app.post("/api/questions", allowRoles("admin", "guru"), async (req, res) => {
  const store = await readStore();
  const payload = cleanQuestionPayload(req.body);
  const validation = validateQuestion(payload);
  if (validation) return res.status(400).json({ message: validation });

  const exam = store.exams.find((item) => item.id === payload.examId);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  if (!canManageExam(req.user, exam)) return res.status(403).json({ message: "Guru hanya bisa menambah soal pada ujian miliknya." });
  const question = {
    id: createId("q"),
    ...payload
  };
  store.questions.push(question);
  await writeStore(store);
  res.status(201).json(question);
});

app.post("/api/questions/bulk", allowRoles("admin", "guru"), async (req, res) => {
  const store = await readStore();
  const rows = Array.isArray(req.body.questions) ? req.body.questions : [];
  const created = [];
  const skipped = [];

  for (const row of rows) {
    const payload = cleanQuestionPayload({ ...row, examId: row.examId || req.body.examId });
    const validation = validateQuestion(payload);
    const exam = store.exams.find((item) => item.id === payload.examId);
    if (validation || !exam || !canManageExam(req.user, exam)) {
      skipped.push({ body: row.body || "", reason: validation || "Ujian tidak ditemukan atau tidak dapat dikelola." });
      continue;
    }
    const question = { id: createId("q"), ...payload };
    store.questions.push(question);
    created.push(question);
  }

  await writeStore(store);
  res.status(201).json({ created: created.length, skipped: skipped.length, questions: created });
});

app.put("/api/questions/:id", allowRoles("admin", "guru"), async (req, res) => {
  const store = await readStore();
  const question = store.questions.find((item) => item.id === req.params.id);
  if (!question) return res.status(404).json({ message: "Soal tidak ditemukan." });

  const currentExam = store.exams.find((item) => item.id === question.examId);
  if (!currentExam || !canManageExam(req.user, currentExam)) return res.status(403).json({ message: "Guru hanya bisa mengedit soal pada ujian miliknya." });

  const payload = cleanQuestionPayload({ ...question, ...req.body, examId: req.body.examId || question.examId });
  const nextExam = store.exams.find((item) => item.id === payload.examId);
  if (!nextExam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  if (!canManageExam(req.user, nextExam)) return res.status(403).json({ message: "Guru hanya bisa memindahkan soal ke ujian miliknya." });

  const validation = validateQuestion(payload);
  if (validation) return res.status(400).json({ message: validation });

  Object.assign(question, payload);
  await writeStore(store);
  res.json(question);
});

app.delete("/api/questions/:id", allowRoles("admin", "guru"), async (req, res) => {
  const store = await readStore();
  const question = store.questions.find((item) => item.id === req.params.id);
  if (!question) return res.status(404).json({ message: "Soal tidak ditemukan." });
  const exam = store.exams.find((item) => item.id === question.examId);
  if (!exam || !canManageExam(req.user, exam)) return res.status(403).json({ message: "Guru hanya bisa menghapus soal pada ujian miliknya." });
  const before = store.questions.length;
  store.questions = store.questions.filter((question) => question.id !== req.params.id);
  if (store.questions.length === before) return res.status(404).json({ message: "Soal tidak ditemukan." });
  for (const attempt of store.attempts) {
    delete attempt.answers?.[req.params.id];
  }
  await writeStore(store);
  res.json({ ok: true });
});

app.get("/api/attempts", allowRoles("admin", "guru", "pengawas"), async (req, res) => {
  const store = await readStore();
  res.json(filterAttemptsByUser(store, req.user));
});

app.get("/api/results", allowRoles("admin", "guru", "pengawas"), async (req, res) => {
  const store = await readStore();
  res.json(filterAttemptsByUser(store, req.user).map((attempt) => ({
    ...attempt,
    score: attempt.score ?? (attempt.status === "submitted" ? calculateScore(store, attempt) : null)
  })));
});

app.get("/api/student/:studentId/exams", allowRoles("admin", "siswa"), async (req, res) => {
  if (req.user.role === "siswa" && req.user.id !== req.params.studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa membuka jadwal miliknya sendiri." });
  }
  const store = await readStore();
  const attempts = store.attempts.filter((attempt) => attempt.studentId === req.params.studentId);
  res.json(attempts.map((attempt) => {
    const exam = store.exams.find((item) => item.id === attempt.examId);
    const questionCount = store.questions.filter((question) => question.examId === attempt.examId).length;
    return { ...attempt, exam, questionCount };
  }).filter((item) => item.exam));
});

app.post("/api/attempts/start", allowRoles("admin", "siswa"), async (req, res) => {
  const store = await readStore();
  const { studentId, examId, token } = req.body ?? {};
  if (req.user.role === "siswa" && req.user.id !== studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa memulai ujian miliknya sendiri." });
  }
  const exam = store.exams.find((item) => item.id === examId);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  if (exam.status !== "published") return res.status(403).json({ message: "Ujian belum dipublish." });
  if (exam.token && String(token || "").trim().toUpperCase() !== String(exam.token).trim().toUpperCase()) {
    return res.status(403).json({ message: "Token ujian salah." });
  }

  let attempt = store.attempts.find((item) => item.examId === examId && item.studentId === studentId);
  if (!attempt) {
    attempt = { id: createId("attempt"), examId, studentId, status: "not_started", answers: {}, score: null, startedAt: null, submittedAt: null, updatedAt: null };
    store.attempts.push(attempt);
  }
  if (attempt.status === "submitted") return res.status(409).json({ message: "Ujian sudah selesai disubmit." });

  attempt.status = "in_progress";
  attempt.startedAt ??= new Date().toISOString();
  attempt.updatedAt = new Date().toISOString();
  const questions = store.questions.filter((question) => question.examId === examId).map(({ answerKey, ...safe }) => safe);
  await writeStore(store);
  res.json({ attempt, exam, questions });
});

app.put("/api/attempts/:id/answers", allowRoles("admin", "siswa"), async (req, res) => {
  const store = await readStore();
  const attempt = store.attempts.find((item) => item.id === req.params.id);
  if (!attempt) return res.status(404).json({ message: "Attempt tidak ditemukan." });
  if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa menyimpan jawaban miliknya sendiri." });
  }
  if (attempt.status === "submitted") return res.status(409).json({ message: "Jawaban sudah final." });

  attempt.answers = { ...(attempt.answers || {}), ...(req.body.answers || {}) };
  attempt.status = "in_progress";
  attempt.updatedAt = new Date().toISOString();
  await writeStore(store);
  res.json(attempt);
});

app.post("/api/attempts/:id/submit", allowRoles("admin", "siswa"), async (req, res) => {
  const store = await readStore();
  const attempt = store.attempts.find((item) => item.id === req.params.id);
  if (!attempt) return res.status(404).json({ message: "Attempt tidak ditemukan." });
  if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa submit jawaban miliknya sendiri." });
  }

  attempt.answers = { ...(attempt.answers || {}), ...(req.body.answers || {}) };
  attempt.status = "submitted";
  attempt.submittedAt = new Date().toISOString();
  attempt.updatedAt = attempt.submittedAt;
  attempt.score = calculateScore(store, attempt);
  await writeStore(store);
  res.json(attempt);
});

app.post("/api/attempts/:id/heartbeat", allowRoles("admin", "siswa"), async (req, res) => {
  const store = await readStore();
  const attempt = store.attempts.find((item) => item.id === req.params.id);
  if (!attempt) return res.status(404).json({ message: "Attempt tidak ditemukan." });
  if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa mengirim heartbeat miliknya sendiri." });
  }
  attempt.updatedAt = new Date().toISOString();
  if (req.body.event && req.body.event !== "heartbeat") {
    store.violations.unshift({
      id: createId("v"),
      studentId: attempt.studentId,
      examId: attempt.examId,
      type: req.body.event,
      level: req.body.level || "warning",
      message: req.body.message || "Event exam client tercatat.",
      createdAt: new Date().toISOString()
    });
  }
  await writeStore(store);
  res.json({ ok: true, updatedAt: attempt.updatedAt });
});

app.get("/api/cards", allowRoles("admin"), async (_req, res) => {
  const store = await readStore();
  res.json(store.students.map((student) => ({
    ...student,
    qrPayload: `CBT94|${student.username}|${student.className}|${student.session}`
  })));
});

app.get("/api/violations", allowRoles("admin", "guru", "pengawas"), async (req, res) => {
  const store = await readStore();
  const visibleExamIds = new Set(filterExamsByUser(store, req.user).map((exam) => exam.id));
  const visibleViolations = store.violations.filter((violation) => visibleExamIds.has(violation.examId));
  const enriched = visibleViolations.map((violation) => ({
    ...violation,
    studentName: store.students.find((student) => student.id === violation.studentId)?.name || "-",
    examCode: store.exams.find((exam) => exam.id === violation.examId)?.code || "-"
  }));
  res.json(enriched);
});

app.post("/api/violations", allowRoles("admin", "pengawas"), async (req, res) => {
  const store = await readStore();
  const violation = {
    id: createId("v"),
    studentId: req.body.studentId,
    examId: req.body.examId,
    type: req.body.type,
    level: req.body.level || "warning",
    message: req.body.message,
    createdAt: new Date().toISOString()
  };
  store.violations.unshift(violation);
  await writeStore(store);
  res.status(201).json(violation);
});

if (postgresEnabled) {
  await initDatabase(seed);
}

app.listen(port, () => {
  console.log(`CBT API berjalan di http://127.0.0.1:${port}`);
});
