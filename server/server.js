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
const schoolTimezoneOffset = process.env.SCHOOL_TIMEZONE_OFFSET || "+07:00";

app.use(cors());
app.use(express.json({ limit: "8mb" }));

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
      teacherIds: ["u-guru-inf"],
      date: "2026-06-10",
      startTime: "08:00",
      endTime: "09:30",
      durationMinutes: 90,
      token: "IN94",
      status: "draft",
      reviewStatus: "unreviewed",
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

async function readSeedStore() {
  await ensureStore();
  try {
    return normalizeStore(JSON.parse(await fs.readFile(storePath, "utf8")));
  } catch {
    return normalizeStore(structuredClone(seed));
  }
}

async function readStore() {
  if (postgresEnabled) {
    await initDatabase(await readSeedStore());
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

function createSessionToken(user, sessionId) {
  const payload = base64Url(JSON.stringify({
    sub: user.id,
    sid: sessionId,
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

function createLoginSession(req, store, user) {
  const now = Date.now();
  const session = {
    id: createId("sess"),
    userId: user.id,
    role: user.role,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    ipAddress: String(req.ip || req.socket?.remoteAddress || "").slice(0, 80),
    createdAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    expiresAt: new Date(now + tokenTtlMs).toISOString()
  };

  store.sessions = (store.sessions || []).filter((item) => item.expiresAt && new Date(item.expiresAt).getTime() > now);
  if (user.role === "siswa") {
    store.sessions = store.sessions.filter((item) => item.userId !== user.id);
  }
  store.sessions.push(session);
  return session;
}

const studentPasswordChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createStudentPassword(length = 6) {
  let password = "";
  for (let index = 0; index < length; index += 1) {
    password += studentPasswordChars[Math.floor(Math.random() * studentPasswordChars.length)];
  }
  return password;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const iterations = 120000;
  const digest = crypto.pbkdf2Sync(String(password || ""), salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2$${iterations}$${salt}$${digest}`;
}

function isPasswordHash(value) {
  return /^pbkdf2\$\d+\$[a-f0-9]+\$[a-f0-9]+$/i.test(String(value || ""));
}

function verifyPassword(storedPassword, plainPassword) {
  const stored = String(storedPassword || "");
  const plain = String(plainPassword || "");
  if (!isPasswordHash(stored)) return stored === plain;

  const [, iterationsText, salt, expected] = stored.split("$");
  const digest = crypto.pbkdf2Sync(plain, salt, Number(iterationsText), 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(expected, "hex"));
}

function ensureHashedPassword(user) {
  if (!user?.password || isPasswordHash(user.password)) return false;
  user.password = hashPassword(user.password);
  return true;
}

function syncStudentUser(store, student) {
  const userPayload = {
    id: student.id,
    role: "siswa",
    name: student.name,
    username: student.username,
    password: hashPassword(student.password),
    className: student.className
  };
  const user = store.users.find((item) => item.id === student.id);
  if (user) Object.assign(user, userPayload);
  else store.users.push(userPayload);
}

function normalizeStore(store) {
  store.users ??= [];
  store.students ??= [];
  store.exams ??= [];
  store.questions ??= [];
  store.attempts ??= [];
  store.violations ??= [];
  store.sessions ??= [];
  store.auditLogs ??= [];

  for (const exam of store.exams) {
    exam.status ??= "draft";
    exam.token ??= "";
    exam.endTime ??= "";
    exam.reviewStatus ??= "unreviewed";
    exam.teacherIds = normalizeTeacherIds(exam);
    exam.teacherId = exam.teacherIds[0] || exam.teacherId || "";
    exam.submitUnlockMinutes = Number.isFinite(Number(exam.submitUnlockMinutes)) ? Number(exam.submitUnlockMinutes) : 30;
    exam.randomizeQuestions ??= false;
    exam.randomizeOptions ??= false;
  }

  for (const user of store.users) {
    if (user.role === "guru") user.subjects = normalizeTeacherSubjects(user.subjects);
  }

  for (const attempt of store.attempts) {
    attempt.answers ??= {};
    attempt.questionOrder = Array.isArray(attempt.questionOrder) ? attempt.questionOrder : [];
    attempt.optionOrders = attempt.optionOrders && typeof attempt.optionOrders === "object" ? attempt.optionOrders : {};
    attempt.startedAt ??= null;
    attempt.submittedAt ??= null;
    attempt.updatedAt ??= null;
    attempt.score ??= null;
  }

  for (const question of store.questions) {
    question.type ||= "multiple_choice";
    question.image ||= "";
    question.options = Array.isArray(question.options) ? question.options : [];
    question.correctAnswers = Array.isArray(question.correctAnswers) ? question.correctAnswers : [];
    question.statements = Array.isArray(question.statements) ? question.statements : [];
    question.pairs = Array.isArray(question.pairs) ? question.pairs : [];
    question.shortAnswers = Array.isArray(question.shortAnswers) ? question.shortAnswers : [];
    question.answerRules ||= { caseSensitive: false, ignorePunctuation: true, trimSpaces: true };
    question.score = Number(question.score || 1);
  }

  for (const student of store.students) {
    student.electiveSubjects = normalizeElectiveSubjects(student.electiveSubjects);
  }

  const now = Date.now();
  store.sessions = store.sessions.filter((session) => !session.expiresAt || new Date(session.expiresAt).getTime() > now);
  store.auditLogs = store.auditLogs.slice(0, 500);

  return store;
}

function normalizeTeacherIds(examOrValue) {
  const value = Array.isArray(examOrValue) ? examOrValue : examOrValue?.teacherIds;
  const legacyTeacherId = Array.isArray(examOrValue) ? "" : examOrValue?.teacherId;
  const ids = Array.isArray(value) ? value : [];
  return [...new Set([legacyTeacherId, ...ids].map((item) => String(item || "").trim()).filter(Boolean))];
}

function readTeacherIds(body, fallback = []) {
  if (Array.isArray(body.teacherIds)) return normalizeTeacherIds(body.teacherIds);
  if (body.teacherId) return normalizeTeacherIds([body.teacherId]);
  return normalizeTeacherIds(fallback);
}

function normalizeTeacherSubjects(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (!value) return [];
  return String(value).split(/[;,|]/).map((item) => item.trim()).filter(Boolean);
}

function readTeacherSubjects(row) {
  return normalizeTeacherSubjects([
    row.subjects,
    row.mapel,
    row.Mapel,
    row["Mata Pelajaran"],
    row["mata pelajaran"],
    row.mapel1,
    row["Mapel 1"],
    row["mapel 1"],
    row.mataPelajaran1,
    row["Mata Pelajaran 1"],
    row.mapel2,
    row["Mapel 2"],
    row["mapel 2"],
    row.mataPelajaran2,
    row["Mata Pelajaran 2"],
    row.mapel3,
    row["Mapel 3"],
    row["mapel 3"],
    row.mataPelajaran3,
    row["Mata Pelajaran 3"],
    row.mapel4,
    row["Mapel 4"],
    row["mapel 4"],
    row.mataPelajaran4,
    row["Mata Pelajaran 4"],
    row.mapel5,
    row["Mapel 5"],
    row["mapel 5"],
    row.mataPelajaran5,
    row["Mata Pelajaran 5"]
  ].filter(Boolean).flatMap((item) => Array.isArray(item) ? item : String(item).split(/[;,|]/)));
}

function normalizeSubjectText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function subjectMatchesExam(teacherSubject, exam) {
  const teacherText = normalizeSubjectText(teacherSubject);
  const examText = normalizeSubjectText(`${exam.subject} ${exam.code}`);
  return teacherText && (examText.includes(teacherText) || teacherText.includes(normalizeSubjectText(exam.subject)));
}

function applyTeacherSubjectAssignments(store, teachers) {
  for (const teacher of teachers) {
    const subjects = normalizeTeacherSubjects(teacher.subjects);
    if (!subjects.length) continue;
    for (const exam of store.exams) {
      if (!subjects.some((subject) => subjectMatchesExam(subject, exam))) continue;
      const teacherIds = new Set(normalizeTeacherIds(exam));
      teacherIds.add(teacher.id);
      exam.teacherIds = [...teacherIds];
      exam.teacherId = exam.teacherIds[0] || "";
    }
  }
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

function normalizeAnswerText(value, rules = {}) {
  let text = String(value || "");
  if (rules.trimSpaces !== false) text = text.trim().replace(/\s+/g, " ");
  if (rules.ignorePunctuation !== false) text = text.replace(/[^\p{L}\p{N}\s]/gu, "");
  else text = text.replace(/,/g, ".");
  if (!rules.caseSensitive) text = text.toLowerCase();
  return text;
}

function scoreQuestion(question, answer) {
  const score = Number(question.score || 1);
  if (question.type === "essay") return { earned: 0, total: score, manualPending: true };

  if (question.type === "short_answer") {
    const rules = question.answerRules || {};
    const expected = (question.shortAnswers || []).map((item) => normalizeAnswerText(item, rules)).filter(Boolean);
    const actual = normalizeAnswerText(answer, rules);
    return { earned: actual && expected.includes(actual) ? score : 0, total: score, manualPending: false };
  }

  if (question.type === "multiple_response") {
    const selected = new Set(Array.isArray(answer) ? answer : []);
    const correct = new Set(question.correctAnswers || []);
    if (!correct.size) return { earned: 0, total: score, manualPending: false };
    const correctSelected = [...selected].filter((key) => correct.has(key)).length;
    const wrongSelected = [...selected].filter((key) => !correct.has(key)).length;
    const ratio = Math.max(0, correctSelected - wrongSelected) / correct.size;
    return { earned: score * ratio, total: score, manualPending: false };
  }

  if (question.type === "true_false") {
    const statements = question.statements || [];
    if (!statements.length) return { earned: 0, total: score, manualPending: false };
    const correct = statements.filter((statement) => String(answer?.[statement.id] || "") === String(statement.answer || "")).length;
    return { earned: score * (correct / statements.length), total: score, manualPending: false };
  }

  if (question.type === "matching") {
    const pairs = question.pairs || [];
    if (!pairs.length) return { earned: 0, total: score, manualPending: false };
    const correct = pairs.filter((pair) => String(answer?.[pair.id] || "") === String(pair.right || "")).length;
    return { earned: score * (correct / pairs.length), total: score, manualPending: false };
  }

  return { earned: answer === question.answerKey ? score : 0, total: score, manualPending: false };
}

function roundScore(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function shuffledCopy(items) {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const randomIndex = crypto.randomInt(index + 1);
    [list[index], list[randomIndex]] = [list[randomIndex], list[index]];
  }
  return list;
}

function prepareAttemptQuestionOrder(store, exam, attempt) {
  const examQuestions = store.questions.filter((question) => question.examId === exam.id);
  const questionIds = examQuestions.map((question) => question.id);
  const knownIds = new Set(questionIds);
  const savedIds = (attempt.questionOrder || []).filter((id) => knownIds.has(id));
  const missingIds = questionIds.filter((id) => !savedIds.includes(id));

  if (!attempt.questionOrder?.length) {
    attempt.questionOrder = exam.randomizeQuestions ? shuffledCopy(questionIds) : questionIds;
  } else if (missingIds.length) {
    attempt.questionOrder = [...savedIds, ...(exam.randomizeQuestions ? shuffledCopy(missingIds) : missingIds)];
  } else {
    attempt.questionOrder = savedIds;
  }

  attempt.optionOrders ??= {};
  if (exam.randomizeOptions) {
    for (const question of examQuestions) {
      const optionKeys = question.type === "matching"
        ? (question.pairs || []).map((pair) => pair.right).filter(Boolean)
        : (question.options || []).map((option) => option.key).filter(Boolean);
      if (optionKeys.length < 2) continue;
      const knownOptionKeys = new Set(optionKeys);
      const savedOptionKeys = (attempt.optionOrders[question.id] || []).filter((key) => knownOptionKeys.has(key));
      const missingOptionKeys = optionKeys.filter((key) => !savedOptionKeys.includes(key));
      attempt.optionOrders[question.id] = savedOptionKeys.length
        ? [...savedOptionKeys, ...shuffledCopy(missingOptionKeys)]
        : shuffledCopy(optionKeys);
    }
  }
}

function questionsForAttempt(store, exam, attempt) {
  prepareAttemptQuestionOrder(store, exam, attempt);
  const byId = new Map(store.questions.filter((question) => question.examId === exam.id).map((question) => [question.id, question]));
  return (attempt.questionOrder || [])
    .map((questionId) => byId.get(questionId))
    .filter(Boolean)
    .map((question) => {
      const safe = safeQuestionForStudent(question);
      const optionOrder = attempt.optionOrders?.[question.id];
      if (Array.isArray(optionOrder) && optionOrder.length && Array.isArray(safe.options)) {
        const optionsByKey = new Map(safe.options.map((option) => [option.key, option]));
        safe.options = optionOrder.map((key) => optionsByKey.get(key)).filter(Boolean);
      }
      if (Array.isArray(optionOrder) && optionOrder.length && Array.isArray(safe.matchingOptions)) {
        const matchingByValue = new Map(safe.matchingOptions.map((option) => [option.value, option]));
        safe.matchingOptions = optionOrder.map((value) => matchingByValue.get(value)).filter(Boolean);
      }
      return safe;
    });
}

function normalizeClock(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length === 5 ? `${text}:00` : text;
}

function examDateTimeMs(date, time) {
  if (!date || !time) return null;
  const parsed = new Date(`${date}T${normalizeClock(time)}${schoolTimezoneOffset}`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function getExamWindow(exam) {
  const startAt = examDateTimeMs(exam.date, exam.startTime);
  if (!startAt) return { startAt: null, endAt: null };
  let endAt = exam.endTime ? examDateTimeMs(exam.date, exam.endTime) : null;
  if (!endAt) endAt = startAt + Number(exam.durationMinutes || 90) * 60 * 1000;
  if (endAt <= startAt) endAt += 24 * 60 * 60 * 1000;
  return { startAt, endAt };
}

function examScheduleMessage(exam, status) {
  if (status === "draft") return "Ujian belum dipublish.";
  if (status === "closed") return "Ujian sudah ditutup admin.";
  if (status === "upcoming") return `Ujian belum dibuka. Ujian dapat dimulai pada ${exam.date} pukul ${exam.startTime}.`;
  if (status === "ended") return "Waktu ujian sudah berakhir.";
  if (status === "invalid_schedule") return "Jadwal ujian belum lengkap.";
  return "Ujian sedang berlangsung.";
}

function getExamAvailability(exam, nowMs = Date.now()) {
  const { startAt, endAt } = getExamWindow(exam);
  let scheduleStatus = "active";
  if (exam.status === "draft") scheduleStatus = "draft";
  else if (exam.status === "closed") scheduleStatus = "closed";
  else if (exam.status !== "published") scheduleStatus = "draft";
  else if (!startAt || !endAt) scheduleStatus = "invalid_schedule";
  else if (nowMs < startAt) scheduleStatus = "upcoming";
  else if (nowMs >= endAt) scheduleStatus = "ended";

  return {
    scheduleStatus,
    canStart: scheduleStatus === "active",
    message: examScheduleMessage(exam, scheduleStatus),
    startAt: startAt ? new Date(startAt).toISOString() : null,
    endAt: endAt ? new Date(endAt).toISOString() : null,
    serverTime: new Date(nowMs).toISOString(),
    remainingMs: scheduleStatus === "active" ? Math.max(0, endAt - nowMs) : 0
  };
}

function finishAttempt(store, attempt, answers = {}) {
  attempt.answers = { ...(attempt.answers || {}), ...(answers || {}) };
  attempt.status = "submitted";
  attempt.submittedAt = new Date().toISOString();
  attempt.updatedAt = attempt.submittedAt;
  attempt.score = calculateScore(store, attempt);
  return attempt;
}

function finishAttemptIfExpired(store, attempt, answers = {}) {
  const exam = store.exams.find((item) => item.id === attempt.examId);
  if (!exam || attempt.status === "submitted") return false;
  const availability = getExamAvailability(exam);
  if (availability.scheduleStatus !== "ended") return false;
  finishAttempt(store, attempt, answers);
  return true;
}

function expireEndedAttempts(store, attempts = store.attempts) {
  let changed = false;
  for (const attempt of attempts) {
    if (finishAttemptIfExpired(store, attempt)) changed = true;
  }
  return changed;
}

function calculateScore(store, attempt) {
  const questions = store.questions.filter((question) => question.examId === attempt.examId);
  const parts = questions.map((question) => scoreQuestion(question, attempt.answers?.[question.id]));
  const totalScore = roundScore(parts.reduce((sum, part) => sum + part.total, 0));
  const earnedScore = roundScore(parts.reduce((sum, part) => sum + part.earned, 0));
  const manualPendingScore = roundScore(parts.filter((part) => part.manualPending).reduce((sum, part) => sum + part.total, 0));
  const percent = totalScore ? Math.round((earnedScore / totalScore) * 10000) / 100 : 0;
  return { earnedScore, totalScore, percent, manualPending: manualPendingScore > 0, manualPendingScore };
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

  if (session.sid) {
    const activeSession = store.sessions.find((item) => item.id === session.sid && item.userId === user.id);
    if (!activeSession) return res.status(401).json({ message: "Akun ini sudah login di perangkat lain. Silakan login ulang." });
    if (activeSession.expiresAt && new Date(activeSession.expiresAt).getTime() <= Date.now()) {
      store.sessions = store.sessions.filter((item) => item.id !== session.sid);
      await writeStore(store);
      return res.status(401).json({ message: "Sesi login sudah kedaluwarsa." });
    }

    const lastSeen = activeSession.lastSeenAt ? new Date(activeSession.lastSeenAt).getTime() : 0;
    if (Date.now() - lastSeen > 60 * 1000) {
      activeSession.lastSeenAt = new Date().toISOString();
      await writeStore(store);
    }
  } else if (user.role === "siswa") {
    return res.status(401).json({ message: "Sesi siswa perlu login ulang agar satu akun hanya aktif di satu perangkat." });
  }

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
  return user.role === "guru" && normalizeTeacherIds(exam).includes(user.id);
}

function addAuditLog(store, req, action, entityType, entityId, message, metadata = {}) {
  store.auditLogs ??= [];
  store.auditLogs.unshift({
    id: createId("audit"),
    userId: req.user?.id || "",
    username: req.user?.username || "",
    role: req.user?.role || "",
    action,
    entityType,
    entityId,
    message,
    metadata,
    createdAt: new Date().toISOString()
  });
  store.auditLogs = store.auditLogs.slice(0, 500);
}

function filterExamsByUser(store, user) {
  if (user.role === "guru") return store.exams.filter((exam) => normalizeTeacherIds(exam).includes(user.id));
  return store.exams;
}

function filterAttemptsByUser(store, user) {
  if (user.role !== "guru") return enrichAttempts(store);
  const examIds = new Set(filterExamsByUser(store, user).map((exam) => exam.id));
  return enrichAttempts(store).filter((attempt) => examIds.has(attempt.examId));
}

function cleanQuestionPayload(body) {
  const options = Array.isArray(body.options) ? body.options : [];
  const type = String(body.type || "multiple_choice");
  return {
    examId: body.examId,
    type,
    body: String(body.body || "").trim(),
    image: String(body.image || ""),
    options: options
      .map((option) => ({
        key: String(option.key || "").trim().toUpperCase(),
        text: String(option.text || "").trim(),
        image: String(option.image || "")
      }))
      .filter((option) => option.key && (option.text || option.image)),
    answerKey: String(body.answerKey || "").trim().toUpperCase(),
    correctAnswers: Array.isArray(body.correctAnswers) ? body.correctAnswers.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean) : [],
    statements: Array.isArray(body.statements) ? body.statements.map((statement, index) => ({
      id: String(statement.id || `st-${index + 1}`),
      text: String(statement.text || "").trim(),
      image: String(statement.image || ""),
      answer: String(statement.answer || "true")
    })).filter((statement) => statement.text || statement.image) : [],
    pairs: Array.isArray(body.pairs) ? body.pairs.map((pair, index) => ({
      id: String(pair.id || `pair-${index + 1}`),
      left: String(pair.left || "").trim(),
      right: String(pair.right || "").trim(),
      leftImage: String(pair.leftImage || ""),
      rightImage: String(pair.rightImage || "")
    })).filter((pair) => (pair.left || pair.leftImage) && (pair.right || pair.rightImage)) : [],
    shortAnswers: Array.isArray(body.shortAnswers) ? body.shortAnswers.map((item) => String(item || "").trim()).filter(Boolean) : [],
    answerRules: {
      caseSensitive: !!body.answerRules?.caseSensitive,
      ignorePunctuation: body.answerRules?.ignorePunctuation !== false,
      trimSpaces: body.answerRules?.trimSpaces !== false
    },
    score: Number(String(body.score || 1).replace(",", "."))
  };
}

function validateQuestion(question) {
  if (!question.examId) return "Paket ujian belum dipilih.";
  if (!question.body) return "Teks soal wajib diisi.";
  if (!Number.isFinite(question.score) || question.score <= 0) return "Bobot soal harus lebih dari 0.";
  if (["multiple_choice", "multiple_response"].includes(question.type) && question.options.length < 2) return "Minimal dua opsi jawaban wajib diisi.";
  if (question.type === "multiple_choice" && !question.options.some((option) => option.key === question.answerKey)) return "Kunci jawaban harus sesuai salah satu opsi.";
  if (question.type === "multiple_response" && !question.correctAnswers.length) return "Minimal satu jawaban benar harus dipilih.";
  if (question.type === "true_false" && !question.statements.length) return "Minimal satu pernyataan benar/salah wajib diisi.";
  if (question.type === "matching" && question.pairs.length < 2) return "Minimal dua pasangan jawaban wajib diisi.";
  if (question.type === "short_answer" && !question.shortAnswers.length) return "Jawaban benar isian singkat wajib diisi.";
  return "";
}

function validateExamPublish(store, exam) {
  if (exam.reviewStatus !== "reviewed") return "Ujian belum ditandai Sudah Dicek oleh admin.";
  if (!String(exam.token || "").trim()) return "Token ujian wajib diisi sebelum publish.";
  if (!exam.date || !exam.startTime || !exam.endTime) return "Tanggal, jam mulai, dan jam selesai wajib lengkap sebelum publish.";
  const { startAt, endAt } = getExamWindow(exam);
  if (!startAt || !endAt || endAt <= startAt) return "Jadwal ujian tidak valid.";
  if (!store.questions.some((question) => question.examId === exam.id)) return "Ujian belum memiliki soal.";
  if (!store.attempts.some((attempt) => attempt.examId === exam.id)) return "Ujian belum memiliki peserta.";
  return "";
}

function safeQuestionForStudent(question) {
  const {
    answerKey,
    correctAnswers,
    shortAnswers,
    answerRules,
    ...safe
  } = question;
  if (question.type === "true_false") {
    safe.statements = (question.statements || []).map(({ answer, ...statement }) => statement);
  }
  if (question.type === "matching") {
    safe.pairs = (question.pairs || []).map(({ right, rightImage, ...pair }) => pair);
    safe.matchingOptions = (question.pairs || []).map((pair) => ({ value: pair.right, image: pair.rightImage || "" }));
  }
  return safe;
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
  const user = store.users.find((item) => item.username === username);
  if (!user || !verifyPassword(user.password, password)) {
    return res.status(401).json({ message: "Username atau password salah." });
  }
  ensureHashedPassword(user);
  const loginSession = createLoginSession(req, store, user);
  await writeStore(store);
  res.json({ user: publicUser(user), token: createSessionToken(user, loginSession.id) });
});

app.use(requireAuth);

app.get("/api/me", async (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/summary", allowRoles("admin", "guru", "pengawas"), async (req, res) => {
  const store = await readStore();
  if (expireEndedAttempts(store)) await writeStore(store);
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

app.get("/api/teachers", allowRoles("admin", "guru", "pengawas"), async (_req, res) => {
  const store = await readStore();
  res.json(store.users.filter((user) => user.role === "guru").map(publicUser).sort((a, b) => a.name.localeCompare(b.name, "id")));
});

app.post("/api/teachers", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const name = String(req.body.name || "").trim();
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "").trim();
  const subjects = readTeacherSubjects(req.body);
  if (!name || !username || !password) return res.status(400).json({ message: "Nama, username, dan password guru wajib diisi." });
  if (store.users.some((user) => user.username === username)) return res.status(409).json({ message: "Username guru sudah digunakan." });
  const teacher = { id: createId("u-guru"), role: "guru", name, username, password: hashPassword(password), subjects };
  store.users.push(teacher);
  applyTeacherSubjectAssignments(store, [teacher]);
  addAuditLog(store, req, "create", "teacher", teacher.id, `Guru ${teacher.name} ditambahkan.`, { username });
  await writeStore(store);
  res.status(201).json(publicUser(teacher));
});

app.post("/api/teachers/bulk", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const rows = Array.isArray(req.body.teachers) ? req.body.teachers : [];
  const created = [];
  const updated = [];
  const skipped = [];

  for (const row of rows) {
    const name = String(row.name || row.nama || row.Nama || "").trim();
    const username = String(row.username || row.Username || "").trim();
    const password = String(row.password || row.Password || "").trim();
    if (!name || !username || !password) {
      skipped.push(row);
      continue;
    }

    const existing = store.users.find((user) => user.username === username);
    if (existing) {
      if (existing.role !== "guru") {
        skipped.push(row);
        continue;
      }
      Object.assign(existing, { name, username, password: hashPassword(password), subjects: readTeacherSubjects(row) });
      updated.push(existing);
    } else {
      const teacher = { id: createId("u-guru"), role: "guru", name, username, password: hashPassword(password), subjects: readTeacherSubjects(row) };
      store.users.push(teacher);
      created.push(teacher);
    }
  }

  applyTeacherSubjectAssignments(store, [...created, ...updated]);
  addAuditLog(store, req, "bulk_import", "teacher", "", `Import guru selesai: ${created.length} baru, ${updated.length} diperbarui, ${skipped.length} dilewati.`, {
    created: created.length,
    updated: updated.length,
    skipped: skipped.length
  });
  await writeStore(store);
  res.status(201).json({
    created: created.length,
    updated: updated.length,
    skipped: skipped.length,
    teachers: store.users.filter((user) => user.role === "guru").map(publicUser)
  });
});

app.put("/api/teachers/:id", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const teacher = store.users.find((user) => user.id === req.params.id && user.role === "guru");
  if (!teacher) return res.status(404).json({ message: "Guru tidak ditemukan." });
  const username = String(req.body.username ?? teacher.username).trim();
  if (!username) return res.status(400).json({ message: "Username guru wajib diisi." });
  const duplicate = store.users.find((user) => user.id !== teacher.id && user.username === username);
  if (duplicate) return res.status(409).json({ message: "Username guru sudah digunakan." });
  Object.assign(teacher, {
    name: String(req.body.name ?? teacher.name).trim() || teacher.name,
    username,
    password: String(req.body.password || "").trim() ? hashPassword(String(req.body.password).trim()) : teacher.password,
    subjects: req.body.subjects || req.body.mapel1 || req.body["Mapel 1"] ? readTeacherSubjects(req.body) : teacher.subjects
  });
  applyTeacherSubjectAssignments(store, [teacher]);
  addAuditLog(store, req, "update", "teacher", teacher.id, `Data guru ${teacher.name} diperbarui.`, { username });
  await writeStore(store);
  res.json(publicUser(teacher));
});

app.delete("/api/teachers/:id", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const teacher = store.users.find((user) => user.id === req.params.id && user.role === "guru");
  if (!teacher) return res.status(404).json({ message: "Guru tidak ditemukan." });
  const assignedExam = store.exams.find((exam) => normalizeTeacherIds(exam).includes(teacher.id));
  if (assignedExam) return res.status(409).json({ message: `Guru masih ditugaskan pada ujian ${assignedExam.code}. Hapus penugasan dari ujian terlebih dahulu.` });
  store.users = store.users.filter((user) => user.id !== teacher.id);
  addAuditLog(store, req, "delete", "teacher", teacher.id, `Guru ${teacher.name} dihapus.`, { username: teacher.username });
  await writeStore(store);
  res.json({ ok: true });
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
    password: req.body.password || createStudentPassword(),
    className: req.body.className,
    room: req.body.room || "-",
    session: req.body.session || "-",
    electiveSubjects: readElectiveSubjects(req.body)
  };
  store.students.push(student);
  syncStudentUser(store, student);
  addAuditLog(store, req, "create", "student", student.id, `Siswa ${student.name} ditambahkan.`, { nis: student.nis, className: student.className });
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
      password: String(row.password || row.Password || "").trim(),
      className: String(row.className || row.kelas || row.Kelas || "-").trim(),
      room: String(row.room || row.ruang || row.Ruang || "-").trim(),
      session: String(row.session || row.sesi || row.Sesi || "-").trim(),
      electiveSubjects: readElectiveSubjects(row)
    };

    const existing = store.students.find((student) => student.nis === nis || student.username === incoming.username);
    if (existing) {
      if (!incoming.password) incoming.password = existing.password || createStudentPassword();
      Object.assign(existing, incoming);
      const user = store.users.find((item) => item.id === existing.id);
      if (user) {
        Object.assign(user, {
          name: existing.name,
          username: existing.username,
          password: hashPassword(existing.password),
          className: existing.className
        });
      } else {
        syncStudentUser(store, existing);
      }
      updated.push(existing);
    } else {
      if (!incoming.password) incoming.password = createStudentPassword();
      const student = { id: createId("s"), ...incoming };
      store.students.push(student);
      syncStudentUser(store, student);
      created.push(student);
    }
  }

  addAuditLog(store, req, "bulk_import", "student", "", `Import siswa selesai: ${created.length} baru, ${updated.length} diperbarui, ${skipped.length} dilewati.`, {
    created: created.length,
    updated: updated.length,
    skipped: skipped.length
  });
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
      password: hashPassword(student.password),
      className: student.className
    });
  } else {
    syncStudentUser(store, student);
  }

  addAuditLog(store, req, "update", "student", student.id, `Data siswa ${student.name} diperbarui.`, { nis: student.nis, className: student.className });
  await writeStore(store);
  res.json(student);
});

app.post("/api/students/passwords", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const studentIds = Array.isArray(req.body.studentIds) ? new Set(req.body.studentIds.map((id) => String(id))) : null;
  const changed = [];

  for (const student of store.students) {
    if (studentIds && !studentIds.has(student.id)) continue;
    student.password = createStudentPassword();
    const user = store.users.find((item) => item.id === student.id);
    if (user) user.password = hashPassword(student.password);
    else syncStudentUser(store, student);
    changed.push({ id: student.id, password: student.password });
  }

  addAuditLog(store, req, "regenerate_passwords", "student", "", `${changed.length} password siswa dibuat ulang.`, { count: changed.length });
  await writeStore(store);
  res.json({ updated: changed.length });
});

app.delete("/api/students/:id", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const before = store.students.length;
  store.students = store.students.filter((student) => student.id !== req.params.id);
  if (store.students.length === before) return res.status(404).json({ message: "Siswa tidak ditemukan." });

  store.users = store.users.filter((user) => user.id !== req.params.id);
  store.attempts = store.attempts.filter((attempt) => attempt.studentId !== req.params.id);
  store.sessions = store.sessions.filter((session) => session.userId !== req.params.id);
  addAuditLog(store, req, "delete", "student", req.params.id, "Siswa dihapus beserta akun dan attempt terkait.");
  await writeStore(store);
  res.json({ ok: true });
});

app.get("/api/exams", allowRoles("admin", "guru", "pengawas"), async (req, res) => {
  const store = await readStore();
  const exams = filterExamsByUser(store, req.user).map((exam) => ({
    ...exam,
    teacherIds: normalizeTeacherIds(exam),
    teacherNames: normalizeTeacherIds(exam).map((teacherId) => store.users.find((user) => user.id === teacherId)?.name).filter(Boolean),
    questionCount: store.questions.filter((question) => question.examId === exam.id).length,
    participantCount: store.attempts.filter((attempt) => attempt.examId === exam.id).length
  }));
  res.json(exams);
});

app.post("/api/exams", allowRoles("admin", "guru"), async (req, res) => {
  const store = await readStore();
  const teacherIds = req.user.role === "guru" ? [req.user.id] : readTeacherIds(req.body);
  const exam = {
    id: createId("exam"),
    code: req.body.code,
    subject: req.body.subject,
    teacherId: teacherIds[0] || "",
    teacherIds,
    date: req.body.date,
    startTime: req.body.startTime,
    endTime: req.body.endTime || "",
    durationMinutes: Number(req.body.durationMinutes || 90),
    submitUnlockMinutes: Number(req.body.submitUnlockMinutes ?? 30),
    token: req.body.token,
    status: req.body.status || "draft",
    reviewStatus: req.body.reviewStatus || "unreviewed",
    randomizeQuestions: Boolean(req.body.randomizeQuestions),
    randomizeOptions: Boolean(req.body.randomizeOptions)
  };
  if (exam.status === "published") {
    const validation = validateExamPublish(store, exam);
    if (validation) return res.status(400).json({ message: validation });
  }
  store.exams.push(exam);
  addAuditLog(store, req, "create", "exam", exam.id, `Ujian ${exam.code} dibuat.`, { subject: exam.subject, status: exam.status });
  await writeStore(store);
  res.status(201).json(exam);
});

app.put("/api/exams/:id", allowRoles("admin", "guru"), async (req, res) => {
  const store = await readStore();
  const exam = store.exams.find((item) => item.id === req.params.id);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  if (!canManageExam(req.user, exam)) return res.status(403).json({ message: "Guru hanya bisa mengelola ujian miliknya." });

  const previousStatus = exam.status;
  Object.assign(exam, {
    code: req.body.code ?? exam.code,
    subject: req.body.subject ?? exam.subject,
    teacherIds: req.user.role === "guru" ? normalizeTeacherIds(exam) : readTeacherIds(req.body, exam),
    teacherId: req.user.role === "guru" ? exam.teacherId : readTeacherIds(req.body, exam)[0] || "",
    date: req.body.date ?? exam.date,
    startTime: req.body.startTime ?? exam.startTime,
    endTime: req.body.endTime ?? exam.endTime,
    durationMinutes: req.body.durationMinutes ? Number(req.body.durationMinutes) : exam.durationMinutes,
    submitUnlockMinutes: req.body.submitUnlockMinutes !== undefined ? Number(req.body.submitUnlockMinutes) : exam.submitUnlockMinutes,
    token: req.body.token ?? exam.token,
    status: req.body.status ?? exam.status,
    reviewStatus: req.body.reviewStatus ?? exam.reviewStatus,
    randomizeQuestions: req.body.randomizeQuestions ?? exam.randomizeQuestions,
    randomizeOptions: req.body.randomizeOptions ?? exam.randomizeOptions
  });

  if (exam.status === "published") {
    const validation = validateExamPublish(store, exam);
    if (validation) return res.status(400).json({ message: validation });
  }

  addAuditLog(store, req, "update", "exam", exam.id, `Ujian ${exam.code} diperbarui.`, {
    subject: exam.subject,
    previousStatus,
    status: exam.status,
    reviewStatus: exam.reviewStatus
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
  addAuditLog(store, req, "delete", "exam", exam.id, `Ujian ${exam.code} dihapus.`, { subject: exam.subject });
  await writeStore(store);
  res.json({ ok: true });
});

app.get("/api/exams/:id/participants", allowRoles("admin", "guru", "pengawas"), async (req, res) => {
  const store = await readStore();
  const exam = store.exams.find((item) => item.id === req.params.id);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  if (req.user.role === "guru" && !normalizeTeacherIds(exam).includes(req.user.id)) return res.status(403).json({ message: "Guru hanya bisa melihat ujian miliknya." });
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
        questionOrder: [],
        optionOrders: {},
        score: null,
        startedAt: null,
        submittedAt: null,
        updatedAt: null
      });
    }
  }

  addAuditLog(store, req, "update_participants", "exam", exam.id, `Peserta ujian ${exam.code} diperbarui.`, { count: studentIds.length });
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
  addAuditLog(store, req, "create", "question", question.id, `Soal baru ditambahkan ke ${exam.code}.`, { examId: exam.id, type: question.type });
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

  addAuditLog(store, req, "bulk_import", "question", "", `Import soal selesai: ${created.length} dibuat, ${skipped.length} dilewati.`, {
    examId: req.body.examId || "",
    created: created.length,
    skipped: skipped.length
  });
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
  addAuditLog(store, req, "update", "question", question.id, `Soal pada ${nextExam.code} diperbarui.`, { examId: nextExam.id, type: question.type });
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
    attempt.questionOrder = (attempt.questionOrder || []).filter((questionId) => questionId !== req.params.id);
    if (attempt.optionOrders) delete attempt.optionOrders[req.params.id];
  }
  addAuditLog(store, req, "delete", "question", req.params.id, `Soal pada ${exam.code} dihapus.`, { examId: exam.id });
  await writeStore(store);
  res.json({ ok: true });
});

app.get("/api/attempts", allowRoles("admin", "guru", "pengawas"), async (req, res) => {
  const store = await readStore();
  if (expireEndedAttempts(store)) await writeStore(store);
  res.json(filterAttemptsByUser(store, req.user));
});

app.get("/api/results", allowRoles("admin", "guru", "pengawas"), async (req, res) => {
  const store = await readStore();
  if (expireEndedAttempts(store)) await writeStore(store);
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
  if (expireEndedAttempts(store, attempts)) await writeStore(store);
  res.json(attempts.map((attempt) => {
    const exam = store.exams.find((item) => item.id === attempt.examId);
    const questionCount = store.questions.filter((question) => question.examId === attempt.examId).length;
    if (!exam) return null;
    const availability = getExamAvailability(exam);
    if (req.user.role === "siswa" && availability.scheduleStatus === "draft") return null;
    return {
      ...attempt,
      exam,
      questionCount,
      scheduleStatus: availability.scheduleStatus,
      scheduleMessage: availability.message,
      canStart: availability.canStart && attempt.status !== "submitted",
      startAt: availability.startAt,
      endAt: availability.endAt,
      serverTime: availability.serverTime,
      remainingMs: availability.remainingMs
    };
  }).filter(Boolean));
});

app.post("/api/attempts/start", allowRoles("admin", "siswa"), async (req, res) => {
  const store = await readStore();
  const { studentId, examId, token } = req.body ?? {};
  if (req.user.role === "siswa" && req.user.id !== studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa memulai ujian miliknya sendiri." });
  }
  const exam = store.exams.find((item) => item.id === examId);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  const availability = getExamAvailability(exam);
  if (!availability.canStart) return res.status(403).json({ message: availability.message, availability });

  let attempt = store.attempts.find((item) => item.examId === examId && item.studentId === studentId);
  const wasInProgress = attempt?.status === "in_progress";
  if (!attempt && req.user.role === "siswa") {
    return res.status(403).json({ message: "Akun ini belum terdaftar sebagai peserta ujian tersebut." });
  }
  if (exam.token && attempt?.status !== "in_progress" && String(token || "").trim().toUpperCase() !== String(exam.token).trim().toUpperCase()) {
    return res.status(403).json({ message: "Token ujian salah." });
  }
  if (!attempt) {
    attempt = { id: createId("attempt"), examId, studentId, status: "not_started", answers: {}, questionOrder: [], optionOrders: {}, score: null, startedAt: null, submittedAt: null, updatedAt: null };
    store.attempts.push(attempt);
  }
  if (attempt.status === "submitted") return res.status(409).json({ message: "Ujian sudah selesai disubmit." });

  attempt.status = "in_progress";
  attempt.startedAt ??= new Date().toISOString();
  attempt.updatedAt = new Date().toISOString();
  if (wasInProgress && req.user.role === "siswa") {
    store.violations.unshift({
      id: createId("v"),
      studentId: attempt.studentId,
      examId: attempt.examId,
      type: "attempt_resumed",
      level: "info",
      message: "Peserta melanjutkan ujian yang sedang berjalan.",
      createdAt: new Date().toISOString()
    });
  }
  const questions = questionsForAttempt(store, exam, attempt);
  await writeStore(store);
  res.json({ attempt, exam, questions, availability });
});

app.get("/api/attempts/:id/reload", allowRoles("admin", "siswa"), async (req, res) => {
  const store = await readStore();
  const attempt = store.attempts.find((item) => item.id === req.params.id);
  if (!attempt) return res.status(404).json({ message: "Attempt tidak ditemukan." });
  if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa memuat ulang ujian miliknya sendiri." });
  }
  const exam = store.exams.find((item) => item.id === attempt.examId);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  if (attempt.status === "submitted") return res.status(409).json({ message: "Ujian sudah selesai disubmit." });

  const availability = getExamAvailability(exam);
  if (finishAttemptIfExpired(store, attempt)) {
    await writeStore(store);
    return res.status(409).json({ message: "Waktu ujian sudah berakhir. Jawaban sudah disubmit otomatis.", attempt });
  }

  const questions = questionsForAttempt(store, exam, attempt);
  if (req.user.role === "siswa") {
    store.violations.unshift({
      id: createId("v"),
      studentId: attempt.studentId,
      examId: attempt.examId,
      type: "questions_reloaded",
      level: "info",
      message: "Peserta memuat ulang data soal tanpa keluar ujian.",
      createdAt: new Date().toISOString()
    });
  }
  await writeStore(store);
  res.json({ attempt, exam, questions, availability });
});

app.put("/api/attempts/:id/answers", allowRoles("admin", "siswa"), async (req, res) => {
  const store = await readStore();
  const attempt = store.attempts.find((item) => item.id === req.params.id);
  if (!attempt) return res.status(404).json({ message: "Attempt tidak ditemukan." });
  if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa menyimpan jawaban miliknya sendiri." });
  }
  if (attempt.status === "submitted") return res.status(409).json({ message: "Jawaban sudah final." });

  if (finishAttemptIfExpired(store, attempt, req.body.answers || {})) {
    await writeStore(store);
    return res.status(409).json({ message: "Waktu ujian sudah berakhir. Jawaban terakhir sudah disubmit otomatis.", attempt });
  }

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

  finishAttempt(store, attempt, req.body.answers || {});
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
    qrPayload: `CBT94|${student.username}|${student.className}`
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

app.get("/api/audit-logs", allowRoles("admin"), async (_req, res) => {
  const store = await readStore();
  res.json((store.auditLogs || []).slice(0, 200));
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
