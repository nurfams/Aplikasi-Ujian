import cors from "cors";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deleteSessionFromPostgres,
  getAppSettingFromPostgres,
  getAttemptContextFromPostgres,
  getAttemptLightContextFromPostgres,
  getAttemptStartContextFromPostgres,
  getAuthContextFromPostgres,
  getStudentExamContextFromPostgres,
  getUserByUsernameFromPostgres,
  initDatabase,
  postgresEnabled,
  readStoreFromPostgres,
  saveAuditLogToPostgres,
  saveAttemptHotToPostgres,
  saveAttemptToPostgres,
  saveLoginSessionToPostgres,
  saveViolationToPostgres,
  touchSessionInPostgres,
  writeStoreToPostgres
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const storePath = path.join(dataDir, "cbt-store.json");
const app = express();
const port = Number(process.env.PORT || 4100);
const authSecret = process.env.AUTH_SECRET || "dev-secret-ganti-saat-produksi";
const tokenTtlMs = Number(process.env.TOKEN_TTL_HOURS || 8) * 60 * 60 * 1000;
const schoolTimezoneOffset = process.env.SCHOOL_TIMEZONE_OFFSET || "+07:00";
const examClientKey = process.env.EXAM_CLIENT_KEY || "dev-exam-client-key";
const accessTokenChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const examClientHeartbeatTimeoutMs = Number(process.env.EXAM_CLIENT_HEARTBEAT_TIMEOUT_SECONDS || 25) * 1000;
const examClientHeartbeatRepeatMs = Number(process.env.EXAM_CLIENT_HEARTBEAT_REPEAT_SECONDS || 120) * 1000;
const postgresStoreCacheMs = Number(process.env.POSTGRES_STORE_CACHE_MS || 2000);

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
    { id: "s-10676", nis: "10676", name: "AGISFA ROCHMANY ALFATH", username: "10676", password: "10676", className: "XII INFOR 1", religion: "Islam", room: "Lab 1", session: "Sesi 1", electiveSubjects: ["Informatika 2", "Sejarah TL 2"] },
    { id: "s-10690", nis: "10690", name: "AMELIA RASHEEDAH", username: "10690", password: "10690", className: "XII INFOR 1", religion: "Islam", room: "Lab 1", session: "Sesi 1", electiveSubjects: ["Sejarah TL 1", "Sosiologi 1"] },
    { id: "s-10693", nis: "10693", name: "AMY JUTTA FIRENZE", username: "10693", password: "10693", className: "XII INFOR 1", religion: "Islam", room: "Lab 1", session: "Sesi 1", electiveSubjects: ["Sejarah TL 2"] }
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
  ],
  accessControl: {
    studentMode: "browser_token",
    browserTokens: []
  },
  examSettings: {
    examWithoutToken: false,
    tokenIntervalMinutes: 15,
    tokenSalt: "seed-token-sman94",
    submitUnlockMinutes: 30,
    autoSubmitOnEnd: true,
    requireReviewBeforePublish: false,
    requireWeight100BeforePublish: false,
    showStudentScores: true,
    defaultRandomizeQuestions: true,
    defaultRandomizeOptions: true,
    answerSyncMode: "extra_high",
    heartbeatEnabled: false,
    heartbeatIntervalSeconds: 30,
    heartbeatJitterSeconds: 10,
    autosaveBatchSize: 10,
    autosaveIntervalSeconds: 60,
    monitoringRefreshSeconds: 10,
    progressiveSoftLimitBytes: 1024 * 1024,
    progressiveHardLimitBytes: 2 * 1024 * 1024,
    progressiveParticipantLimit: 100,
    questionPrefetchCount: 2
  }
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

let seedStorePromise = null;
let databaseReadyPromise = null;

function getSeedStore() {
  seedStorePromise ??= readSeedStore();
  return seedStorePromise;
}

async function ensureDatabaseReady() {
  if (!postgresEnabled) return;
  databaseReadyPromise ??= getSeedStore().then((seedStore) => initDatabase(seedStore));
  await databaseReadyPromise;
}

let postgresStoreCache = null;
let postgresStoreCacheAt = 0;
let postgresStoreReadPromise = null;

function invalidatePostgresStoreCache() {
  postgresStoreCache = null;
  postgresStoreCacheAt = 0;
}

async function readStore() {
  if (postgresEnabled) {
    await ensureDatabaseReady();
    const now = Date.now();
    if (postgresStoreCache && now - postgresStoreCacheAt < postgresStoreCacheMs) {
      return normalizeStore(structuredClone(postgresStoreCache));
    }
    postgresStoreReadPromise ??= readStoreFromPostgres()
      .then((store) => {
        const normalized = normalizeStore(store);
        postgresStoreCache = structuredClone(normalized);
        postgresStoreCacheAt = Date.now();
        return normalized;
      })
      .finally(() => {
        postgresStoreReadPromise = null;
      });
    return normalizeStore(structuredClone(await postgresStoreReadPromise));
  }
  await ensureStore();
  return normalizeStore(JSON.parse(await fs.readFile(storePath, "utf8")));
}

async function writeStore(store) {
  const normalized = normalizeStore(store);
  if (postgresEnabled) {
    await writeStoreToPostgres(normalized);
    invalidatePostgresStoreCache();
    return;
  }
  await fs.writeFile(storePath, JSON.stringify(normalized, null, 2), "utf8");
}

async function persistAttemptChange(store, attempt, { invalidateCache = true } = {}) {
  if (postgresEnabled) {
    await saveAttemptToPostgres(attempt);
    if (invalidateCache) invalidatePostgresStoreCache();
    return;
  }
  await writeStore(store);
}

async function persistHotAttemptChange(store, attempt, { invalidateCache = false } = {}) {
  if (postgresEnabled) {
    await saveAttemptHotToPostgres(attempt);
    if (invalidateCache) invalidatePostgresStoreCache();
    return;
  }
  await writeStore(store);
}

async function persistViolationChange(store, violation) {
  if (!violation) return;
  if (postgresEnabled) {
    await saveViolationToPostgres(violation);
    invalidatePostgresStoreCache();
    return;
  }
  await writeStore(store);
}

async function persistAttemptAndViolationChanges(store, attempts = [], violations = [], { invalidateCache = true } = {}) {
  if (!attempts.length && !violations.length) return;
  if (!postgresEnabled) {
    await writeStore(store);
    return;
  }
  const uniqueAttempts = [...new Map(attempts.filter(Boolean).map((attempt) => [attempt.id, attempt])).values()];
  const uniqueViolations = [...new Map(violations.filter(Boolean).map((violation) => [violation.id, violation])).values()];
  for (const attempt of uniqueAttempts) {
    await saveAttemptToPostgres(attempt);
  }
  for (const violation of uniqueViolations) {
    await saveViolationToPostgres(violation);
  }
  if (invalidateCache) invalidatePostgresStoreCache();
}

async function persistSessionTouch(store, session) {
  if (postgresEnabled) {
    await touchSessionInPostgres(session.id, session.lastSeenAt);
    return;
  }
  await writeStore(store);
}

async function persistSessionDelete(store, sessionId) {
  if (postgresEnabled) {
    await deleteSessionFromPostgres(sessionId);
    invalidatePostgresStoreCache();
    return;
  }
  await writeStore(store);
}

async function persistLoginChange(store, session, auditLog, { replaceUserSessions = false } = {}) {
  if (!postgresEnabled) {
    await writeStore(store);
    return;
  }
  await saveLoginSessionToPostgres(session, { replaceUserSessions });
  if (auditLog) await saveAuditLogToPostgres(auditLog);
  invalidatePostgresStoreCache();
}

async function persistAuditLogChange(store, auditLog) {
  if (!auditLog) return;
  if (!postgresEnabled) {
    await writeStore(store);
    return;
  }
  await saveAuditLogToPostgres(auditLog);
  invalidatePostgresStoreCache();
}

function publicUser(user) {
  const { password, ...safe } = user;
  return safe;
}

function hotStoreFromContext(context = {}) {
  return normalizeStore({
    users: [],
    students: context.student ? [context.student] : [],
    exams: context.exam ? [context.exam] : (context.exams || []),
    questions: context.questions || [],
    attempts: context.attempt ? [context.attempt] : (context.attempts || []),
    violations: [],
    sessions: [],
    auditLogs: [],
    accessControl: {},
    examSettings: context.examSettings || {}
  });
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

function normalizeAccessControl(accessControl = {}) {
  const validModes = new Set(["strict", "browser_token", "open"]);
  return {
    studentMode: validModes.has(accessControl.studentMode) ? accessControl.studentMode : "browser_token",
    browserTokens: Array.isArray(accessControl.browserTokens) ? accessControl.browserTokens.map((token) => ({
      id: token.id || createId("browser-token"),
      token: String(token.token || "").trim().toUpperCase(),
      label: token.label || "Token Browser",
      active: token.active !== false,
      createdAt: token.createdAt || new Date().toISOString(),
      expiresAt: token.expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      createdBy: token.createdBy || ""
    })).filter((token) => token.token) : []
  };
}

function normalizeExamSettings(settings = {}) {
  const validIntervals = new Set([15, 30, 45, 60]);
  const validAnswerSyncModes = new Set(["extra_high", "balanced"]);
  const answerSyncMode = validAnswerSyncModes.has(settings.answerSyncMode) ? settings.answerSyncMode : "extra_high";
  const interval = Number(settings.tokenIntervalMinutes || 15);
  const submitUnlockMinutes = Math.max(0, Math.min(120, Number(settings.submitUnlockMinutes ?? 30)));
  const heartbeatIntervalSeconds = Math.max(15, Math.min(120, Number(settings.heartbeatIntervalSeconds ?? 30)));
  const heartbeatJitterSeconds = Math.max(0, Math.min(30, Number(settings.heartbeatJitterSeconds ?? 10)));
  const heartbeatEnabled = settings.heartbeatEnabled === undefined ? answerSyncMode !== "extra_high" : settings.heartbeatEnabled !== false;
  const autosaveBatchSize = Math.max(1, Math.min(20, Number(settings.autosaveBatchSize ?? (answerSyncMode === "extra_high" ? 10 : 3))));
  const autosaveIntervalSeconds = Math.max(5, Math.min(120, Number(settings.autosaveIntervalSeconds ?? (answerSyncMode === "extra_high" ? 60 : 20))));
  const monitoringRefreshSeconds = Math.max(5, Math.min(60, Number(settings.monitoringRefreshSeconds ?? 10)));
  const progressiveSoftLimitBytes = Math.max(128 * 1024, Math.min(5 * 1024 * 1024, Number(settings.progressiveSoftLimitBytes ?? 1024 * 1024)));
  const progressiveHardLimitBytes = Math.max(progressiveSoftLimitBytes, Math.min(10 * 1024 * 1024, Number(settings.progressiveHardLimitBytes ?? 2 * 1024 * 1024)));
  const progressiveParticipantLimit = Math.max(25, Math.min(1000, Number(settings.progressiveParticipantLimit ?? 100)));
  const questionPrefetchCount = Math.max(0, Math.min(5, Number(settings.questionPrefetchCount ?? 2)));
  return {
    examWithoutToken: !!settings.examWithoutToken,
    tokenIntervalMinutes: validIntervals.has(interval) ? interval : 15,
    tokenSalt: String(settings.tokenSalt || crypto.randomBytes(16).toString("hex")),
    submitUnlockMinutes,
    autoSubmitOnEnd: settings.autoSubmitOnEnd !== false,
    requireReviewBeforePublish: !!settings.requireReviewBeforePublish,
    requireWeight100BeforePublish: !!settings.requireWeight100BeforePublish,
    showStudentScores: settings.showStudentScores !== false,
    defaultRandomizeQuestions: settings.defaultRandomizeQuestions !== false,
    defaultRandomizeOptions: settings.defaultRandomizeOptions !== false,
    answerSyncMode,
    heartbeatEnabled,
    heartbeatIntervalSeconds,
    heartbeatJitterSeconds,
    autosaveBatchSize,
    autosaveIntervalSeconds,
    monitoringRefreshSeconds,
    progressiveSoftLimitBytes,
    progressiveHardLimitBytes,
    progressiveParticipantLimit,
    questionPrefetchCount
  };
}

function createTokenFromDigest(digest, length = 6) {
  let token = "";
  for (let index = 0; index < length; index += 1) {
    token += accessTokenChars[digest[index] % accessTokenChars.length];
  }
  return token;
}

function getGlobalExamToken(settings = {}, nowMs = Date.now()) {
  const normalized = normalizeExamSettings(settings);
  const intervalMs = normalized.tokenIntervalMinutes * 60 * 1000;
  const slot = Math.floor(nowMs / intervalMs);
  const slotStartMs = slot * intervalMs;
  const digest = crypto
    .createHmac("sha256", authSecret)
    .update(`${normalized.tokenSalt}:${slot}`)
    .digest();
  return {
    token: createTokenFromDigest(digest),
    intervalMinutes: normalized.tokenIntervalMinutes,
    generatedAt: new Date(slotStartMs).toISOString(),
    nextChangeAt: new Date(slotStartMs + intervalMs).toISOString(),
    serverTime: new Date(nowMs).toISOString()
  };
}

function validateGlobalExamToken(store, tokenValue) {
  const settings = normalizeExamSettings(store.examSettings);
  if (settings.examWithoutToken) return true;
  const expected = getGlobalExamToken(settings).token;
  return String(tokenValue || "").trim().toUpperCase() === expected;
}

function createBrowserAccessToken(length = 6) {
  let token = "BRW-";
  for (let index = 0; index < length; index += 1) {
    token += accessTokenChars[Math.floor(Math.random() * accessTokenChars.length)];
  }
  return token;
}

function isExamClientRequest(req) {
  const clientId = String(req.headers["x-cbt-exam-client"] || "").trim();
  const clientKey = String(req.headers["x-cbt-exam-client-key"] || "").trim();
  return clientId === "sman94-exam-browser" && clientKey && clientKey === examClientKey;
}

function getActiveBrowserToken(accessControl, tokenValue) {
  const value = String(tokenValue || "").trim().toUpperCase();
  const now = Date.now();
  return normalizeAccessControl(accessControl).browserTokens.find((token) => (
    token.active && token.token === value && (!token.expiresAt || new Date(token.expiresAt).getTime() > now)
  ));
}

function getStudentAccessState(store, session) {
  const accessControl = normalizeAccessControl(store.accessControl);
  if (!session || session.role !== "siswa") {
    return { required: false, granted: true, mode: accessControl.studentMode, method: "staff" };
  }
  if (accessControl.studentMode === "open") {
    return { required: false, granted: true, mode: "open", method: session.accessMethod || "open" };
  }
  if (session.examClientVerified) {
    return { required: false, granted: true, mode: accessControl.studentMode, method: "exam_browser" };
  }
  if (accessControl.studentMode === "browser_token" && session.browserAccessGrantedAt) {
    const browserToken = accessControl.browserTokens.find((token) => (
      token.id === session.browserTokenId && token.active && (!token.expiresAt || new Date(token.expiresAt).getTime() > Date.now())
    ));
    if (browserToken) return { required: false, granted: true, mode: "browser_token", method: "browser_token" };
  }
  return {
    required: true,
    granted: false,
    mode: accessControl.studentMode,
    method: "ordinary_browser",
    message: accessControl.studentMode === "strict"
      ? "Akun siswa hanya bisa digunakan melalui Exam Browser resmi sekolah."
      : "Masukkan Token Akses Browser dari admin/pengawas untuk memakai browser biasa."
  };
}

function createLoginSession(req, store, user) {
  const now = Date.now();
  const examClientVerified = user.role === "siswa" && isExamClientRequest(req);
  const session = {
    id: createId("sess"),
    userId: user.id,
    role: user.role,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    ipAddress: String(req.ip || req.socket?.remoteAddress || "").slice(0, 80),
    accessMethod: examClientVerified ? "exam_browser" : user.role === "siswa" ? "ordinary_browser" : "staff",
    examClientVerified,
    browserTokenId: "",
    browserAccessGrantedAt: null,
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

async function verifyPasswordAsync(storedPassword, plainPassword) {
  const stored = String(storedPassword || "");
  const plain = String(plainPassword || "");
  if (!isPasswordHash(stored)) return stored === plain;

  const [, iterationsText, salt, expected] = stored.split("$");
  const digest = await new Promise((resolve, reject) => {
    crypto.pbkdf2(plain, salt, Number(iterationsText), 32, "sha256", (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey.toString("hex"));
    });
  });
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
  store.accessControl = normalizeAccessControl(store.accessControl);
  store.examSettings = normalizeExamSettings(store.examSettings);

  for (const exam of store.exams) {
    exam.status ??= "draft";
    exam.token ??= "";
    exam.endTime ??= "";
    exam.reviewStatus ??= "unreviewed";
    exam.teacherIds = normalizeTeacherIds(exam);
    exam.teacherId = exam.teacherIds[0] || exam.teacherId || "";
    exam.submitUnlockMinutes = Number.isFinite(Number(exam.submitUnlockMinutes)) ? Number(exam.submitUnlockMinutes) : store.examSettings.submitUnlockMinutes;
    exam.randomizeQuestions ??= store.examSettings.defaultRandomizeQuestions;
    exam.randomizeOptions ??= store.examSettings.defaultRandomizeOptions;
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

  for (const violation of store.violations) {
    violation.metadata = violation.metadata && typeof violation.metadata === "object" ? violation.metadata : {};
    violation.dedupKey ||= violationDedupKey({
      studentId: violation.studentId,
      examId: violation.examId,
      type: violation.type,
      metadata: violation.metadata,
      createdAt: violation.createdAt
    });
    violation.updatedAt ??= null;
  }

  for (const session of store.sessions) {
    session.accessMethod ||= session.role === "siswa" ? "ordinary_browser" : "staff";
    session.examClientVerified = Boolean(session.examClientVerified);
    session.browserTokenId ||= "";
    session.browserAccessGrantedAt ??= null;
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
    student.religion = readReligion(student);
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

function readReligion(row, fallback = "") {
  const value = row.religion ?? row.agama ?? row.Agama ?? row["Agama"] ?? fallback ?? "";
  return String(value).trim();
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

function roundDecimal(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(Number(value || 0) * factor) / factor;
}

const FULL_PAYLOAD_SOFT_LIMIT_BYTES = Number(process.env.EXAM_PAYLOAD_SOFT_LIMIT_BYTES || 500 * 1024);
const FULL_PAYLOAD_HARD_LIMIT_BYTES = Number(process.env.EXAM_PAYLOAD_HARD_LIMIT_BYTES || 2 * 1024 * 1024);
const PROGRESSIVE_PARTICIPANT_LIMIT = Number(process.env.EXAM_PROGRESSIVE_PARTICIPANT_LIMIT || 100);
const MASS_PARTICIPANT_LIMIT = Number(process.env.EXAM_MASS_PARTICIPANT_LIMIT || 300);
const examQuestionCache = new Map();

function clonePayload(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${roundDecimal(value / 1024 / 1024, 2)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function questionPayloadSignature(question) {
  return [
    question.id,
    question.type,
    question.body?.length || 0,
    question.image?.length || 0,
    JSON.stringify(question.options || []).length,
    JSON.stringify(question.statements || []).length,
    JSON.stringify(question.pairs || []).length,
    Number(question.score || 0)
  ].join(":");
}

function getCachedSafeQuestionMap(store, examId) {
  const examQuestions = store.questions.filter((question) => question.examId === examId);
  const signature = examQuestions.map(questionPayloadSignature).join("|");
  const cached = examQuestionCache.get(examId);
  if (cached?.signature === signature) return cached;

  const byId = new Map(examQuestions.map((question) => [question.id, safeQuestionForStudent(question)]));
  const next = { signature, byId, questions: examQuestions };
  examQuestionCache.set(examId, next);
  return next;
}

function invalidateExamQuestionCache(examId) {
  if (examId) examQuestionCache.delete(examId);
  else examQuestionCache.clear();
}

function estimateJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function imagePayloadBytesFromQuestion(question) {
  const values = [
    question.image,
    ...(question.options || []).map((option) => option.image),
    ...(question.statements || []).map((statement) => statement.image),
    ...(question.pairs || []).flatMap((pair) => [pair.leftImage, pair.rightImage])
  ].filter(Boolean);
  return values.reduce((sum, value) => sum + Buffer.byteLength(String(value), "utf8"), 0);
}

function analyzeExamPayload(store, exam) {
  const settings = normalizeExamSettings(store.examSettings);
  const softLimitBytes = Number(settings.progressiveSoftLimitBytes || FULL_PAYLOAD_SOFT_LIMIT_BYTES);
  const hardLimitBytes = Number(settings.progressiveHardLimitBytes || FULL_PAYLOAD_HARD_LIMIT_BYTES);
  const progressiveParticipantLimit = Number(settings.progressiveParticipantLimit || PROGRESSIVE_PARTICIPANT_LIMIT);
  const cached = getCachedSafeQuestionMap(store, exam.id);
  const questions = cached.questions.map((question) => cached.byId.get(question.id)).filter(Boolean);
  const bytes = estimateJsonBytes({ questions });
  const participantCount = store.attempts.filter((attempt) => attempt.examId === exam.id).length;
  const imageCount = cached.questions.reduce((sum, question) => {
    return sum
      + (question.image ? 1 : 0)
      + (question.options || []).filter((option) => option.image).length
      + (question.statements || []).filter((statement) => statement.image).length
      + (question.pairs || []).filter((pair) => pair.leftImage).length
      + (question.pairs || []).filter((pair) => pair.rightImage).length;
  }, 0);
  const imageBytes = cached.questions.reduce((sum, question) => sum + imagePayloadBytesFromQuestion(question), 0);
  let level = "small";
  let recommendedDeliveryMode = "full";
  let message = "Paket soal kecil, aman dikirim sekaligus.";
  if (bytes > hardLimitBytes) {
    level = "large";
    recommendedDeliveryMode = "progressive";
    message = "Paket soal besar, disarankan dikirim bertahap agar mulai ujian lebih ringan.";
  } else if (participantCount >= MASS_PARTICIPANT_LIMIT) {
    level = "large";
    recommendedDeliveryMode = "progressive";
    message = "Peserta sangat banyak, mode bertahap dipakai untuk mengurangi beban awal server.";
  } else if (participantCount >= progressiveParticipantLimit && (bytes > 128 * 1024 || imageCount > 0)) {
    level = "medium";
    recommendedDeliveryMode = "progressive";
    message = "Peserta cukup banyak, mode bertahap dipakai agar koneksi awal lebih ringan.";
  } else if (bytes > softLimitBytes) {
    level = "medium";
    message = "Paket soal sedang, masih bisa dikirim sekaligus tetapi perlu dipantau saat ujian massal.";
  }
  return {
    bytes,
    label: formatBytes(bytes),
    imageBytes,
    imageLabel: imageBytes ? formatBytes(imageBytes) : "0 KB",
    imageCount,
    questionCount: questions.length,
    participantCount,
    level,
    recommendedDeliveryMode,
    softLimitBytes,
    hardLimitBytes,
    progressiveParticipantLimit,
    massParticipantLimit: MASS_PARTICIPANT_LIMIT,
    message
  };
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
  const cached = getCachedSafeQuestionMap(store, exam.id);
  return (attempt.questionOrder || [])
    .map((questionId) => cached.byId.get(questionId))
    .filter(Boolean)
    .map((question) => {
      const safe = clonePayload(question);
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

function questionManifestForAttempt(store, exam, attempt) {
  prepareAttemptQuestionOrder(store, exam, attempt);
  const cached = getCachedSafeQuestionMap(store, exam.id);
  return (attempt.questionOrder || [])
    .map((questionId, index) => {
      const question = cached.byId.get(questionId);
      if (!question) return null;
      return { id: question.id, index, type: question.type };
    })
    .filter(Boolean);
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

const forceFinishSyncGraceMs = Math.max(10, Number(process.env.FORCE_FINISH_SYNC_GRACE_SECONDS || 45)) * 1000;

function requestForceFinish(store, attempt, req, reason, type = "admin_force_finish") {
  const now = new Date().toISOString();
  attempt.status = "force_finishing";
  attempt.updatedAt = now;
  const { violation } = addViolationLog(store, {
    studentId: attempt.studentId,
    examId: attempt.examId,
    type,
    level: "critical",
    message: `Admin meminta ujian dihentikan paksa oleh ${req.user.name}. Menunggu sinkronisasi jawaban terakhir dari perangkat peserta. Alasan: ${reason}`,
    metadata: { attemptId: attempt.id, reason, forcedBy: req.user.id, requestedAt: now }
  });
  return violation;
}

function finishForceFinishingIfTimedOut(store, attempt) {
  if (attempt.status !== "force_finishing") return false;
  const requestedAt = Date.parse(attempt.updatedAt || attempt.startedAt || "");
  if (!requestedAt || Number.isNaN(requestedAt)) return false;
  if (Date.now() - requestedAt < forceFinishSyncGraceMs) return false;
  finishAttempt(store, attempt);
  addViolationLog(store, {
    studentId: attempt.studentId,
    examId: attempt.examId,
    type: "admin_force_finish_timeout",
    level: "warning",
    message: "Ujian dikunci otomatis karena perangkat peserta tidak mengirim sinkronisasi jawaban final setelah force selesai.",
    metadata: { attemptId: attempt.id, graceSeconds: Math.round(forceFinishSyncGraceMs / 1000) }
  });
  return true;
}

function finishForceFinishingAttempts(store, attempts = store.attempts) {
  const changedAttempts = [];
  const violations = [];
  for (const attempt of attempts) {
    const violationCountBefore = store.violations.length;
    if (finishForceFinishingIfTimedOut(store, attempt)) {
      changedAttempts.push(attempt);
      const createdViolations = store.violations.slice(0, Math.max(0, store.violations.length - violationCountBefore));
      violations.push(...createdViolations);
    }
  }
  return { changed: changedAttempts.length > 0, attempts: changedAttempts, violations };
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
  const expiredAttempts = [];
  for (const attempt of attempts) {
    if (finishAttemptIfExpired(store, attempt)) {
      changed = true;
      expiredAttempts.push(attempt);
    }
  }
  return { changed, attempts: expiredAttempts };
}

async function persistExpiredAttempts(store, result) {
  if (!result?.changed) return;
  if (!postgresEnabled) {
    await writeStore(store);
    return;
  }
  for (const attempt of result.attempts || []) {
    await saveAttemptToPostgres(attempt);
  }
}

async function persistAttemptMaintenance(store, results = []) {
  const attempts = [];
  const violations = [];
  let changed = false;
  for (const result of results) {
    if (!result) continue;
    if (result.changed) changed = true;
    attempts.push(...(result.attempts || []));
    violations.push(...(result.violations || []));
  }
  if (!changed && !attempts.length && !violations.length) return;
  await persistAttemptAndViolationChanges(store, attempts, violations);
}

function violationDedupKey({ studentId, examId, type, metadata = {}, createdAt }) {
  const eventTime = Date.parse(createdAt || metadata.clientTime || "") || Date.now();
  const windowMs = Number(metadata.dedupWindowMs || 2 * 60 * 1000);
  const windowSlot = Math.floor(eventTime / Math.max(30 * 1000, windowMs));
  const incidentKey = metadata.incidentKey || `window-${windowSlot}`;
  return [
    studentId || "",
    examId || "",
    type || "",
    incidentKey
  ].join("|");
}

function addViolationLog(store, payload) {
  store.violations ??= [];
  const metadata = payload.metadata || {};
  const dedupKey = payload.dedupKey || violationDedupKey({ ...payload, metadata });
  if (dedupKey) {
    const existing = store.violations.find((violation) => violation.dedupKey === dedupKey);
    if (existing) {
      existing.level = payload.level || existing.level;
      existing.message = payload.message || existing.message;
      existing.updatedAt = new Date().toISOString();
      const previousOccurrences = Number(existing.metadata?.occurrences || 1);
      existing.metadata = { ...(existing.metadata || {}), ...metadata, occurrences: previousOccurrences + 1 };
      return { violation: existing, created: false };
    }
  }

  const violation = {
    id: createId("v"),
    studentId: payload.studentId,
    examId: payload.examId,
    type: payload.type,
    level: payload.level || "warning",
    message: payload.message || "Event exam client tercatat.",
    createdAt: payload.createdAt || new Date().toISOString(),
    updatedAt: payload.updatedAt || null,
    metadata: { ...metadata, occurrences: 1 },
    dedupKey
  };
  store.violations.unshift(violation);
  return { violation, created: true };
}

function safeIsoDate(value, fallback = new Date().toISOString()) {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  const time = Date.parse(value || "");
  return Number.isNaN(time) ? fallback : new Date(time).toISOString();
}

function ensureExamClientHeartbeatViolations(store) {
  const now = Date.now();
  const settings = normalizeExamSettings(store.examSettings);
  if (!settings.heartbeatEnabled) return { changed: false, violations: [] };
  const heartbeatTimeoutMs = Math.max(examClientHeartbeatTimeoutMs, Number(settings.heartbeatIntervalSeconds || 30) * 3 * 1000);
  const heartbeatRepeatMs = Math.max(examClientHeartbeatRepeatMs, Number(settings.heartbeatIntervalSeconds || 30) * 4 * 1000);
  let changed = false;
  const violations = [];
  for (const attempt of store.attempts) {
    if (attempt.status !== "in_progress") continue;
    const exam = store.exams.find((item) => item.id === attempt.examId);
    if (!exam || getExamAvailability(exam, now).scheduleStatus !== "active") continue;
    const lastHeartbeatAt = Date.parse(attempt.updatedAt || attempt.startedAt || "");
    if (!lastHeartbeatAt || Number.isNaN(lastHeartbeatAt)) continue;
    const silentMs = now - lastHeartbeatAt;
    if (silentMs < heartbeatTimeoutMs) continue;

    const incidentSlot = Math.floor(lastHeartbeatAt / heartbeatRepeatMs);
    const { violation, created } = addViolationLog(store, {
      studentId: attempt.studentId,
      examId: attempt.examId,
      type: "exam_client_heartbeat_lost",
      level: "warning",
      message: `Koneksi atau aplikasi tidak terdeteksi selama ${Math.floor(silentMs / 1000)} detik saat ujian masih berjalan. Perlu dicek: bisa karena koneksi putus, HP terkunci, aplikasi keluar, izin overlay dimatikan, atau peserta membuka aplikasi lain.`,
      metadata: {
        incidentKey: `heartbeat-lost-${attempt.id}-${incidentSlot}`,
        attemptId: attempt.id,
        silentMs,
        lastHeartbeatAt: new Date(lastHeartbeatAt).toISOString(),
        status: "open",
        category: "connectivity_or_visibility"
      }
    });
    if (created) {
      changed = true;
      violations.push(violation);
    }
  }
  return { changed, violations };
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

  if (postgresEnabled) {
    await ensureDatabaseReady();
    const context = await getAuthContextFromPostgres(session.sub, session.sid);
    const user = context.user;
    if (!user) return res.status(401).json({ message: "Akun tidak ditemukan." });

    if (session.sid) {
      const activeSession = context.session;
      if (!activeSession || activeSession.userId !== user.id) {
        return res.status(401).json({ message: "Akun ini sudah login di perangkat lain. Silakan login ulang." });
      }
      if (activeSession.expiresAt && new Date(activeSession.expiresAt).getTime() <= Date.now()) {
        await persistSessionDelete({ sessions: [] }, session.sid);
        return res.status(401).json({ message: "Sesi login sudah kedaluwarsa." });
      }

      const lastSeen = activeSession.lastSeenAt ? new Date(activeSession.lastSeenAt).getTime() : 0;
      if (Date.now() - lastSeen > 60 * 1000) {
        activeSession.lastSeenAt = new Date().toISOString();
        await persistSessionTouch({ sessions: [activeSession] }, activeSession);
      }
      req.activeSession = activeSession;
    } else if (user.role === "siswa") {
      return res.status(401).json({ message: "Sesi siswa perlu login ulang agar satu akun hanya aktif di satu perangkat." });
    }

    req.user = publicUser(user);
    if (user.role === "siswa") {
      const accessStore = { accessControl: context.accessControl };
      const accessState = getStudentAccessState(accessStore, req.activeSession);
      const allowedPaths = new Set(["/api/me", "/api/browser-access/authorize"]);
      if (accessState.required && !allowedPaths.has(req.path)) {
        return res.status(403).json({
          code: "BROWSER_ACCESS_REQUIRED",
          message: accessState.message,
          accessState
        });
      }
      req.user.accessState = accessState;
    }
    return next();
  }

  const store = await readStore();
  const user = store.users.find((item) => item.id === session.sub);
  if (!user) return res.status(401).json({ message: "Akun tidak ditemukan." });

  if (session.sid) {
    const activeSession = store.sessions.find((item) => item.id === session.sid && item.userId === user.id);
    if (!activeSession) return res.status(401).json({ message: "Akun ini sudah login di perangkat lain. Silakan login ulang." });
    if (activeSession.expiresAt && new Date(activeSession.expiresAt).getTime() <= Date.now()) {
      store.sessions = store.sessions.filter((item) => item.id !== session.sid);
      await persistSessionDelete(store, session.sid);
      return res.status(401).json({ message: "Sesi login sudah kedaluwarsa." });
    }

    const lastSeen = activeSession.lastSeenAt ? new Date(activeSession.lastSeenAt).getTime() : 0;
    if (Date.now() - lastSeen > 60 * 1000) {
      activeSession.lastSeenAt = new Date().toISOString();
      await persistSessionTouch(store, activeSession);
    }
    req.activeSession = activeSession;
  } else if (user.role === "siswa") {
    return res.status(401).json({ message: "Sesi siswa perlu login ulang agar satu akun hanya aktif di satu perangkat." });
  }

  req.user = publicUser(user);
  if (user.role === "siswa") {
    const accessState = getStudentAccessState(store, req.activeSession);
    const allowedPaths = new Set(["/api/me", "/api/browser-access/authorize"]);
    if (accessState.required && !allowedPaths.has(req.path)) {
      return res.status(403).json({
        code: "BROWSER_ACCESS_REQUIRED",
        message: accessState.message,
        accessState
      });
    }
    req.user.accessState = accessState;
  }
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

async function requireAdminPassword(store, req, password) {
  const admin = store.users.find((user) => user.id === req.user?.id && user.role === "admin");
  return Boolean(admin && await verifyPasswordAsync(admin.password, password));
}

async function requireCurrentUserPassword(store, req, password) {
  const user = store.users.find((item) => item.id === req.user?.id);
  return Boolean(user && await verifyPasswordAsync(user.password, password));
}

function addAuditLog(store, req, action, entityType, entityId, message, metadata = {}) {
  store.auditLogs ??= [];
  const auditLog = {
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
  };
  store.auditLogs.unshift(auditLog);
  store.auditLogs = store.auditLogs.slice(0, 500);
  return auditLog;
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

async function loadAttemptHotContext(attemptId, { includeQuestions = true } = {}) {
  if (!postgresEnabled) return null;
  const context = includeQuestions
    ? await getAttemptContextFromPostgres(attemptId)
    : await getAttemptLightContextFromPostgres(attemptId);
  if (!context?.attempt) return null;
  return {
    ...context,
    store: hotStoreFromContext(context)
  };
}

function buildStartedExamPayload(store, exam, attempt, requestedDeliveryMode = "") {
  const payloadAnalysis = analyzeExamPayload(store, exam);
  const examSettings = normalizeExamSettings(store.examSettings);
  const deliveryMode = requestedDeliveryMode === "progressive"
    ? "progressive"
    : requestedDeliveryMode === "full" || examSettings.answerSyncMode === "extra_high"
      ? "full"
      : payloadAnalysis.recommendedDeliveryMode;
  const questions = questionsForAttempt(store, exam, attempt);
  return {
    attempt,
    exam,
    questions: deliveryMode === "progressive" ? questions.slice(0, 1) : questions,
    questionManifest: questionManifestForAttempt(store, exam, attempt),
    deliveryMode,
    payloadAnalysis,
    examSettings,
    availability: getExamAvailability(exam)
  };
}

function attemptActivityTime(attempt) {
  const value = attempt.updatedAt || attempt.startedAt || attempt.submittedAt || attempt.createdAt || "";
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function findClientEventAttempt(store, user, { attemptId = "", examId = "" } = {}) {
  if (user.role !== "siswa") return null;
  const ownAttempts = store.attempts.filter((attempt) => attempt.studentId === user.id);
  if (attemptId) {
    const direct = ownAttempts.find((attempt) => attempt.id === attemptId);
    if (direct) return direct;
  }

  const scopedAttempts = examId
    ? ownAttempts.filter((attempt) => attempt.examId === examId)
    : ownAttempts;
  const sorted = [...scopedAttempts].sort((a, b) => attemptActivityTime(b) - attemptActivityTime(a));
  return sorted.find((attempt) => attempt.status === "in_progress")
    || sorted.find((attempt) => attempt.status !== "not_started")
    || sorted[0]
    || null;
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
  const settings = normalizeExamSettings(store.examSettings);
  if (!exam.date || !exam.startTime || !exam.endTime) return "Tanggal, jam mulai, dan jam selesai wajib lengkap sebelum publish.";
  const { startAt, endAt } = getExamWindow(exam);
  if (!startAt || !endAt || endAt <= startAt) return "Jadwal ujian tidak valid.";
  if (!store.questions.some((question) => question.examId === exam.id)) return "Ujian belum memiliki soal.";
  if (!store.attempts.some((attempt) => attempt.examId === exam.id)) return "Ujian belum memiliki peserta.";
  if (settings.requireReviewBeforePublish && exam.reviewStatus !== "reviewed") return "Soal harus ditandai sudah dicek admin sebelum publish.";
  if (settings.requireWeight100BeforePublish) {
    const totalWeight = roundScore(store.questions
      .filter((question) => question.examId === exam.id)
      .reduce((sum, question) => sum + Number(question.score || 0), 0));
    if (Math.abs(totalWeight - 100) >= 0.01) return `Total bobot soal harus 100 sebelum publish. Saat ini ${totalWeight}.`;
  }
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
  if (postgresEnabled) {
    await ensureDatabaseReady();
    const user = await getUserByUsernameFromPostgres(username);
    if (!user || !(await verifyPasswordAsync(user.password, password))) {
      return res.status(401).json({ message: "Username atau password salah." });
    }
    const store = {
      users: [user],
      sessions: [],
      auditLogs: [],
      accessControl: await getAppSettingFromPostgres("access_control")
    };
    if (isExamClientRequest(req) && user.role !== "siswa") {
      const auditLog = addAuditLog(store, { ...req, user: publicUser(user) }, "blocked_exam_client_login", "session", "", `${user.name} ditolak login dari Exam Browser karena bukan akun siswa.`, {
        role: user.role
      });
      await saveAuditLogToPostgres(auditLog);
      return res.status(403).json({
        message: "Aplikasi Exam Browser hanya untuk peserta didik. Admin, guru, dan pengawas silakan login melalui browser biasa."
      });
    }
    const loginSession = createLoginSession(req, store, user);
    const accessState = getStudentAccessState(store, loginSession);
    const auditLog = addAuditLog(store, { ...req, user: publicUser(user) }, "login", "session", loginSession.id, `${user.name} login.`, {
      accessMethod: loginSession.accessMethod,
      accessState
    });
    await persistLoginChange(store, loginSession, auditLog, { replaceUserSessions: user.role === "siswa" });
    return res.json({ user: { ...publicUser(user), accessState }, token: createSessionToken(user, loginSession.id) });
  }

  const store = await readStore();
  const user = store.users.find((item) => item.username === username);
  if (!user || !(await verifyPasswordAsync(user.password, password))) {
    return res.status(401).json({ message: "Username atau password salah." });
  }
  if (isExamClientRequest(req) && user.role !== "siswa") {
    const auditLog = addAuditLog(store, { ...req, user: publicUser(user) }, "blocked_exam_client_login", "session", "", `${user.name} ditolak login dari Exam Browser karena bukan akun siswa.`, {
      role: user.role
    });
    if (postgresEnabled) {
      await saveAuditLogToPostgres(auditLog);
      invalidatePostgresStoreCache();
    } else await writeStore(store);
    return res.status(403).json({
      message: "Aplikasi Exam Browser hanya untuk peserta didik. Admin, guru, dan pengawas silakan login melalui browser biasa."
    });
  }
  ensureHashedPassword(user);
  const loginSession = createLoginSession(req, store, user);
  const accessState = getStudentAccessState(store, loginSession);
  const auditLog = addAuditLog(store, { ...req, user: publicUser(user) }, "login", "session", loginSession.id, `${user.name} login.`, {
    accessMethod: loginSession.accessMethod,
    accessState
  });
  await persistLoginChange(store, loginSession, auditLog, { replaceUserSessions: user.role === "siswa" });
  res.json({ user: { ...publicUser(user), accessState }, token: createSessionToken(user, loginSession.id) });
});

app.use(requireAuth);

app.get("/api/me", async (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/admin-users", allowRoles("admin"), async (_req, res) => {
  const store = await readStore();
  res.json(store.users
    .filter((user) => user.role === "admin")
    .map(publicUser)
    .sort((a, b) => a.name.localeCompare(b.name, "id")));
});

app.post("/api/admin-users", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const name = String(req.body.name || "").trim();
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const currentPassword = String(req.body.currentPassword || "");
  if (!name || !username || !password) {
    return res.status(400).json({ message: "Nama, username, dan password admin wajib diisi." });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: "Password admin minimal 8 karakter." });
  }
  if (!await requireAdminPassword(store, req, currentPassword)) {
    return res.status(403).json({ message: "Password admin saat ini salah." });
  }
  if (store.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ message: "Username sudah digunakan akun lain." });
  }
  const admin = {
    id: createId("u-admin"),
    role: "admin",
    name,
    username,
    password: hashPassword(password)
  };
  store.users.push(admin);
  addAuditLog(store, req, "create_admin_user", "user", admin.id, `Admin baru ${name} dibuat.`, {
    username
  });
  await writeStore(store);
  res.status(201).json(publicUser(admin));
});

app.put("/api/admin-users/:id/password", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const admin = store.users.find((user) => user.id === req.params.id && user.role === "admin");
  if (!admin) return res.status(404).json({ message: "Admin tidak ditemukan." });
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  if (newPassword.length < 8) {
    return res.status(400).json({ message: "Password baru minimal 8 karakter." });
  }
  if (!await requireAdminPassword(store, req, currentPassword)) {
    return res.status(403).json({ message: "Password admin saat ini salah." });
  }
  admin.password = hashPassword(newPassword);
  store.sessions = (store.sessions || []).filter((session) => session.userId !== admin.id || session.id === req.activeSession?.id);
  addAuditLog(store, req, "change_admin_password", "user", admin.id, `Password admin ${admin.name} diubah.`, {
    username: admin.username,
    selfChange: admin.id === req.user.id
  });
  await writeStore(store);
  res.json(publicUser(admin));
});

app.post("/api/browser-access/authorize", allowRoles("siswa"), async (req, res) => {
  const store = await readStore();
  const activeSession = store.sessions.find((item) => item.id === req.activeSession?.id && item.userId === req.user.id);
  if (!activeSession) return res.status(401).json({ message: "Sesi login tidak ditemukan." });
  const accessControl = normalizeAccessControl(store.accessControl);
  if (accessControl.studentMode === "strict") {
    return res.status(403).json({ message: "Mode saat ini wajib Exam Browser. Browser biasa tidak diizinkan." });
  }
  if (accessControl.studentMode === "open") {
    activeSession.accessMethod = "open";
    activeSession.browserAccessGrantedAt = new Date().toISOString();
  } else {
    const browserToken = getActiveBrowserToken(accessControl, req.body.token);
    if (!browserToken) return res.status(403).json({ message: "Token Akses Browser salah, tidak aktif, atau sudah kedaluwarsa." });
    activeSession.accessMethod = "browser_token";
    activeSession.browserTokenId = browserToken.id;
    activeSession.browserAccessGrantedAt = new Date().toISOString();
    addAuditLog(store, req, "authorize_browser_access", "session", activeSession.id, `${req.user.name} memakai Token Akses Browser.`, {
      tokenId: browserToken.id,
      tokenLabel: browserToken.label,
      ipAddress: activeSession.ipAddress,
      userAgent: activeSession.userAgent
    });
  }
  await writeStore(store);
  res.json({ user: { ...req.user, accessState: getStudentAccessState(store, activeSession) } });
});

app.get("/api/access-control", allowRoles("admin", "guru", "pengawas"), async (_req, res) => {
  const store = await readStore();
  res.json(normalizeAccessControl(store.accessControl));
});

app.put("/api/access-control", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const current = normalizeAccessControl(store.accessControl);
  store.accessControl = normalizeAccessControl({
    ...current,
    studentMode: req.body.studentMode || current.studentMode
  });
  addAuditLog(store, req, "update_access_control", "access_control", "student", "Mode akses peserta diperbarui.", {
    studentMode: store.accessControl.studentMode
  });
  await writeStore(store);
  res.json(store.accessControl);
});

app.post("/api/access-control/browser-tokens", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const accessControl = normalizeAccessControl(store.accessControl);
  const minutes = Math.max(5, Math.min(24 * 60, Number(req.body.expiresMinutes || 60)));
  const token = {
    id: createId("browser-token"),
    token: createBrowserAccessToken(),
    label: String(req.body.label || "Token Browser").trim() || "Token Browser",
    active: true,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
    createdBy: req.user.id
  };
  accessControl.browserTokens.unshift(token);
  store.accessControl = normalizeAccessControl(accessControl);
  addAuditLog(store, req, "create_browser_token", "access_control", token.id, `Token Akses Browser ${token.label} dibuat.`, {
    expiresAt: token.expiresAt
  });
  await writeStore(store);
  res.status(201).json(store.accessControl);
});

app.post("/api/access-control/browser-tokens/:id/revoke", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const accessControl = normalizeAccessControl(store.accessControl);
  const token = accessControl.browserTokens.find((item) => item.id === req.params.id);
  if (!token) return res.status(404).json({ message: "Token browser tidak ditemukan." });
  token.active = false;
  store.accessControl = normalizeAccessControl(accessControl);
  addAuditLog(store, req, "revoke_browser_token", "access_control", token.id, `Token Akses Browser ${token.label} dicabut.`);
  await writeStore(store);
  res.json(store.accessControl);
});

app.get("/api/exam-settings", allowRoles("admin", "guru", "pengawas"), async (_req, res) => {
  const store = await readStore();
  const settings = normalizeExamSettings(store.examSettings);
  res.json({ ...settings, activeToken: getGlobalExamToken(settings) });
});

app.put("/api/exam-settings", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const current = normalizeExamSettings(store.examSettings);
  const next = normalizeExamSettings({
    ...current,
    examWithoutToken: req.body.examWithoutToken ?? current.examWithoutToken,
    tokenIntervalMinutes: req.body.tokenIntervalMinutes ?? current.tokenIntervalMinutes,
    submitUnlockMinutes: req.body.submitUnlockMinutes ?? current.submitUnlockMinutes,
    autoSubmitOnEnd: req.body.autoSubmitOnEnd ?? current.autoSubmitOnEnd,
    requireReviewBeforePublish: req.body.requireReviewBeforePublish ?? current.requireReviewBeforePublish,
    requireWeight100BeforePublish: req.body.requireWeight100BeforePublish ?? current.requireWeight100BeforePublish,
    showStudentScores: req.body.showStudentScores ?? current.showStudentScores,
    defaultRandomizeQuestions: req.body.defaultRandomizeQuestions ?? current.defaultRandomizeQuestions,
    defaultRandomizeOptions: req.body.defaultRandomizeOptions ?? current.defaultRandomizeOptions,
    answerSyncMode: req.body.answerSyncMode ?? current.answerSyncMode,
    heartbeatEnabled: req.body.heartbeatEnabled ?? current.heartbeatEnabled,
    heartbeatIntervalSeconds: req.body.heartbeatIntervalSeconds ?? current.heartbeatIntervalSeconds,
    heartbeatJitterSeconds: req.body.heartbeatJitterSeconds ?? current.heartbeatJitterSeconds,
    autosaveBatchSize: req.body.autosaveBatchSize ?? current.autosaveBatchSize,
    autosaveIntervalSeconds: req.body.autosaveIntervalSeconds ?? current.autosaveIntervalSeconds,
    monitoringRefreshSeconds: req.body.monitoringRefreshSeconds ?? current.monitoringRefreshSeconds,
    progressiveSoftLimitBytes: req.body.progressiveSoftLimitBytes ?? current.progressiveSoftLimitBytes,
    progressiveHardLimitBytes: req.body.progressiveHardLimitBytes ?? current.progressiveHardLimitBytes,
    progressiveParticipantLimit: req.body.progressiveParticipantLimit ?? current.progressiveParticipantLimit,
    questionPrefetchCount: req.body.questionPrefetchCount ?? current.questionPrefetchCount
  });
  store.examSettings = next;
  addAuditLog(store, req, "update_exam_settings", "exam_settings", "global", "Pengaturan ujian diperbarui.", next);
  await writeStore(store);
  res.json({ ...next, activeToken: getGlobalExamToken(next) });
});

app.post("/api/exam-settings/token/regenerate", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const settings = normalizeExamSettings(store.examSettings);
  settings.tokenSalt = crypto.randomBytes(16).toString("hex");
  store.examSettings = settings;
  addAuditLog(store, req, "regenerate_exam_token", "exam_settings", "global_token", "Token ujian global digenerate ulang manual.", {
    nextChangeAt: getGlobalExamToken(settings).nextChangeAt
  });
  await writeStore(store);
  res.json({ ...settings, activeToken: getGlobalExamToken(settings) });
});

app.get("/api/summary", allowRoles("admin", "guru", "pengawas"), async (req, res) => {
  const store = await readStore();
  await persistAttemptMaintenance(store, [finishForceFinishingAttempts(store), expireEndedAttempts(store)]);
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

app.post("/api/teachers/delete-all", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const password = String(req.body.password || "");
  const confirmation = String(req.body.confirmation || "").trim().toUpperCase();
  if (confirmation !== "HAPUS GURU") return res.status(400).json({ message: "Ketik HAPUS GURU untuk konfirmasi." });
  if (!await requireAdminPassword(store, req, password)) return res.status(403).json({ message: "Password admin salah." });

  const teacherIds = new Set(store.users.filter((user) => user.role === "guru").map((user) => user.id));
  const deletedTeachers = teacherIds.size;
  for (const exam of store.exams) {
    exam.teacherIds = normalizeTeacherIds(exam).filter((id) => !teacherIds.has(id));
    exam.teacherId = exam.teacherIds[0] || "";
  }
  store.users = store.users.filter((user) => user.role !== "guru");
  store.sessions = (store.sessions || []).filter((session) => !teacherIds.has(session.userId));
  addAuditLog(store, req, "delete_all", "teacher", "all", `${deletedTeachers} guru dihapus massal oleh admin.`, {
    deletedTeachers
  });
  await writeStore(store);
  res.json({ ok: true, deletedTeachers });
});

app.post("/api/students", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const student = {
    id: createId("s"),
    nis: req.body.nis,
    nisn: req.body.nisn || "",
    name: req.body.name,
    gender: req.body.gender || "",
    religion: readReligion(req.body),
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
      religion: readReligion(row),
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
    religion: req.body.religion !== undefined || req.body.agama !== undefined ? readReligion(req.body, student.religion) : student.religion,
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

app.post("/api/students/delete-all", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const password = String(req.body.password || "");
  const confirmation = String(req.body.confirmation || "").trim().toUpperCase();
  if (confirmation !== "HAPUS SISWA") return res.status(400).json({ message: "Ketik HAPUS SISWA untuk konfirmasi." });
  if (!await requireAdminPassword(store, req, password)) return res.status(403).json({ message: "Password admin salah." });

  const studentIds = new Set(store.students.map((student) => student.id));
  const deletedStudents = store.students.length;
  const deletedAttempts = store.attempts.filter((attempt) => studentIds.has(attempt.studentId)).length;
  const deletedViolations = store.violations.filter((violation) => studentIds.has(violation.studentId)).length;
  store.students = [];
  store.users = store.users.filter((user) => user.role !== "siswa" && !studentIds.has(user.id));
  store.attempts = store.attempts.filter((attempt) => !studentIds.has(attempt.studentId));
  store.violations = store.violations.filter((violation) => !studentIds.has(violation.studentId));
  store.sessions = (store.sessions || []).filter((session) => !studentIds.has(session.userId));
  addAuditLog(store, req, "delete_all", "student", "all", `${deletedStudents} siswa dihapus massal oleh admin.`, {
    deletedStudents,
    deletedAttempts,
    deletedViolations
  });
  await writeStore(store);
  res.json({ ok: true, deletedStudents, deletedAttempts, deletedViolations });
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
    payloadAnalysis: analyzeExamPayload(store, exam),
    questionCount: store.questions.filter((question) => question.examId === exam.id).length,
    participantCount: store.attempts.filter((attempt) => attempt.examId === exam.id).length,
    attemptStatusCounts: store.attempts.filter((attempt) => attempt.examId === exam.id).reduce((counts, attempt) => {
      if (attempt.status === "submitted") counts.submitted += 1;
      else if (attempt.status === "in_progress") counts.inProgress += 1;
      else counts.notStarted += 1;
      return counts;
    }, { submitted: 0, inProgress: 0, notStarted: 0 })
  }));
  res.json(exams);
});

app.post("/api/exams", allowRoles("admin", "guru"), async (req, res) => {
  const store = await readStore();
  const settings = normalizeExamSettings(store.examSettings);
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
    submitUnlockMinutes: Number(req.body.submitUnlockMinutes ?? settings.submitUnlockMinutes),
    token: "",
    status: req.body.status || "draft",
    reviewStatus: req.body.reviewStatus || "unreviewed",
    randomizeQuestions: req.body.randomizeQuestions !== undefined ? Boolean(req.body.randomizeQuestions) : settings.defaultRandomizeQuestions,
    randomizeOptions: req.body.randomizeOptions !== undefined ? Boolean(req.body.randomizeOptions) : settings.defaultRandomizeOptions
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
    token: "",
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
  invalidateExamQuestionCache(req.params.id);
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

app.post("/api/exams/:id/attempts/reset", allowRoles("admin", "guru"), async (req, res) => {
  const store = await readStore();
  const exam = store.exams.find((item) => item.id === req.params.id);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  if (!canManageExam(req.user, exam)) return res.status(403).json({ message: "Guru hanya bisa reset ujian miliknya." });

  const studentIds = Array.isArray(req.body.studentIds) ? new Set(req.body.studentIds.map((id) => String(id))) : new Set();
  if (!studentIds.size) return res.status(400).json({ message: "Pilih minimal satu peserta yang akan direset." });

  let resetCount = 0;
  for (const attempt of store.attempts) {
    if (attempt.examId !== exam.id || !studentIds.has(attempt.studentId)) continue;
    attempt.status = "not_started";
    attempt.answers = {};
    attempt.questionOrder = [];
    attempt.optionOrders = {};
    attempt.score = null;
    attempt.startedAt = null;
    attempt.submittedAt = null;
    attempt.updatedAt = null;
    resetCount += 1;
  }

  addAuditLog(store, req, "reset_attempts", "exam", exam.id, `${resetCount} peserta ujian ${exam.code} direset.`, {
    studentIds: [...studentIds],
    count: resetCount
  });
  await writeStore(store);
  res.json({ reset: resetCount, participants: enrichAttempts(store).filter((attempt) => attempt.examId === exam.id) });
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
  invalidateExamQuestionCache(exam.id);
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
    invalidateExamQuestionCache(exam.id);
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

app.post("/api/questions/weights/generate", allowRoles("admin", "guru"), async (req, res) => {
  const store = await readStore();
  const exam = store.exams.find((item) => item.id === req.body.examId);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  if (!canManageExam(req.user, exam)) return res.status(403).json({ message: "Guru hanya bisa mengatur bobot pada ujian miliknya." });

  const examQuestions = store.questions.filter((question) => question.examId === exam.id);
  if (!examQuestions.length) return res.status(400).json({ message: "Belum ada soal untuk digenerate bobotnya." });

  const targetScore = Math.min(100, Math.max(1, Number(req.body.totalScore || 100)));
  const precision = 4;
  const factor = 10 ** precision;
  const baseScore = Math.floor((targetScore / examQuestions.length) * factor) / factor;
  let assignedScore = 0;

  examQuestions.forEach((question, index) => {
    const score = index === examQuestions.length - 1
      ? roundDecimal(targetScore - assignedScore, precision)
      : baseScore;
    question.score = score;
    assignedScore = roundDecimal(assignedScore + score, precision);
  });
  invalidateExamQuestionCache(exam.id);

  const totalScore = roundDecimal(examQuestions.reduce((sum, question) => sum + Number(question.score || 0), 0), precision);
  addAuditLog(store, req, "generate_question_weights", "exam", exam.id, `Bobot ${examQuestions.length} soal ${exam.code} digenerate menjadi total ${totalScore}.`, {
    examId: exam.id,
    questionCount: examQuestions.length,
    totalScore
  });
  await writeStore(store);
  res.json({
    updated: examQuestions.length,
    totalScore,
    perQuestionScore: baseScore,
    questions: examQuestions
  });
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
  invalidateExamQuestionCache(currentExam.id);
  invalidateExamQuestionCache(nextExam.id);
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
  invalidateExamQuestionCache(exam.id);
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
  const expired = expireEndedAttempts(store);
  const forceFinished = finishForceFinishingAttempts(store);
  const heartbeat = ensureExamClientHeartbeatViolations(store);
  await persistAttemptMaintenance(store, [forceFinished, expired, heartbeat]);
  res.json(filterAttemptsByUser(store, req.user));
});

app.get("/api/results", allowRoles("admin", "guru", "pengawas"), async (req, res) => {
  const store = await readStore();
  const expired = expireEndedAttempts(store);
  const forceFinished = finishForceFinishingAttempts(store);
  const heartbeat = ensureExamClientHeartbeatViolations(store);
  await persistAttemptMaintenance(store, [forceFinished, expired, heartbeat]);
  res.json(filterAttemptsByUser(store, req.user).map((attempt) => ({
    ...attempt,
    answers: attempt.answers || {},
    questionOrder: attempt.questionOrder || [],
    optionOrders: attempt.optionOrders || {},
    score: attempt.score ?? (attempt.status === "submitted" ? calculateScore(store, attempt) : null)
  })));
});

app.get("/api/student/:studentId/exams", allowRoles("admin", "siswa"), async (req, res) => {
  if (req.user.role === "siswa" && req.user.id !== req.params.studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa membuka jadwal miliknya sendiri." });
  }
  if (postgresEnabled) {
    const context = await getStudentExamContextFromPostgres(req.params.studentId);
    const store = hotStoreFromContext(context);
    const attempts = store.attempts;
    const examSettings = normalizeExamSettings(store.examSettings);
    await persistAttemptMaintenance(store, [finishForceFinishingAttempts(store, attempts), expireEndedAttempts(store, attempts)]);
    return res.json(attempts.map((attempt) => {
      const exam = store.exams.find((item) => item.id === attempt.examId);
      const questionCount = store.questions.filter((question) => question.examId === attempt.examId).length;
      if (!exam) return null;
      const availability = getExamAvailability(exam);
      if (req.user.role === "siswa" && availability.scheduleStatus === "draft") return null;
      return {
        ...attempt,
        score: examSettings.showStudentScores ? attempt.score : null,
        exam,
        questionCount,
        payloadAnalysis: analyzeExamPayload(store, exam),
        scheduleStatus: availability.scheduleStatus,
        scheduleMessage: availability.message,
        canStart: availability.canStart && attempt.status !== "submitted",
        tokenRequired: !examSettings.examWithoutToken && attempt.status !== "in_progress",
        startAt: availability.startAt,
        endAt: availability.endAt,
        serverTime: availability.serverTime,
        remainingMs: availability.remainingMs
      };
    }).filter(Boolean));
  }
  const store = await readStore();
  const attempts = store.attempts.filter((attempt) => attempt.studentId === req.params.studentId);
  const examSettings = normalizeExamSettings(store.examSettings);
  await persistAttemptMaintenance(store, [finishForceFinishingAttempts(store, attempts), expireEndedAttempts(store, attempts)]);
  res.json(attempts.map((attempt) => {
    const exam = store.exams.find((item) => item.id === attempt.examId);
    const questionCount = store.questions.filter((question) => question.examId === attempt.examId).length;
    if (!exam) return null;
    const availability = getExamAvailability(exam);
    if (req.user.role === "siswa" && availability.scheduleStatus === "draft") return null;
    return {
      ...attempt,
      score: examSettings.showStudentScores ? attempt.score : null,
      exam,
      questionCount,
      payloadAnalysis: analyzeExamPayload(store, exam),
      scheduleStatus: availability.scheduleStatus,
      scheduleMessage: availability.message,
      canStart: availability.canStart && attempt.status !== "submitted",
      tokenRequired: !examSettings.examWithoutToken && attempt.status !== "in_progress",
      startAt: availability.startAt,
      endAt: availability.endAt,
      serverTime: availability.serverTime,
      remainingMs: availability.remainingMs
    };
  }).filter(Boolean));
});

app.post("/api/attempts/start", allowRoles("admin", "siswa"), async (req, res) => {
  const { studentId, examId, token } = req.body ?? {};
  if (req.user.role === "siswa" && req.user.id !== studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa memulai ujian miliknya sendiri." });
  }
  if (postgresEnabled) {
    const context = await getAttemptStartContextFromPostgres(studentId, examId);
    const store = hotStoreFromContext(context);
    const exam = context.exam;
    if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
    const availability = getExamAvailability(exam);
    if (!availability.canStart) return res.status(403).json({ message: availability.message, availability });

    let attempt = context.attempt;
    const wasInProgress = attempt?.status === "in_progress";
    if (!attempt && req.user.role === "siswa") {
      return res.status(403).json({ message: "Akun ini belum terdaftar sebagai peserta ujian tersebut." });
    }
    if (attempt?.status === "submitted") return res.status(409).json({ message: "Ujian sudah selesai disubmit.", attempt });
    if (attempt?.status === "force_finishing") return res.status(409).json({ message: "Ujian sedang dihentikan admin. Mengirim sinkronisasi jawaban final.", forceFinishing: true, attempt });
    if (attempt?.status !== "in_progress" && !validateGlobalExamToken(store, token)) {
      return res.status(403).json({ message: "Token ujian salah." });
    }
    if (!attempt) {
      attempt = { id: createId("attempt"), examId, studentId, status: "not_started", answers: {}, questionOrder: [], optionOrders: {}, score: null, startedAt: null, submittedAt: null, updatedAt: null };
      store.attempts.push(attempt);
    }

    attempt.status = "in_progress";
    attempt.startedAt ??= new Date().toISOString();
    attempt.updatedAt = new Date().toISOString();
    let violationToSave = null;
    if (wasInProgress && req.user.role === "siswa") {
      const { violation } = addViolationLog(store, {
        studentId: attempt.studentId,
        examId: attempt.examId,
        type: "attempt_resumed",
        level: "info",
        message: "Peserta melanjutkan ujian yang sedang berjalan.",
        metadata: { attemptId: attempt.id }
      });
      violationToSave = violation;
    }
    const payload = buildStartedExamPayload(store, exam, attempt, String(req.body?.deliveryMode || "").toLowerCase());
    if (violationToSave) {
      await persistAttemptAndViolationChanges(store, [attempt], [violationToSave], { invalidateCache: false });
    } else {
      await persistHotAttemptChange(store, attempt);
    }
    return res.json({ ...payload, availability });
  }
  const store = await readStore();
  const exam = store.exams.find((item) => item.id === examId);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  const availability = getExamAvailability(exam);
  if (!availability.canStart) return res.status(403).json({ message: availability.message, availability });

  let attempt = store.attempts.find((item) => item.examId === examId && item.studentId === studentId);
  const wasInProgress = attempt?.status === "in_progress";
  if (!attempt && req.user.role === "siswa") {
    return res.status(403).json({ message: "Akun ini belum terdaftar sebagai peserta ujian tersebut." });
  }
  if (attempt?.status === "submitted") return res.status(409).json({ message: "Ujian sudah selesai disubmit.", attempt });
  if (attempt?.status === "force_finishing") return res.status(409).json({ message: "Ujian sedang dihentikan admin. Mengirim sinkronisasi jawaban final.", forceFinishing: true, attempt });
  if (attempt?.status !== "in_progress" && !validateGlobalExamToken(store, token)) {
    return res.status(403).json({ message: "Token ujian salah." });
  }
  if (!attempt) {
    attempt = { id: createId("attempt"), examId, studentId, status: "not_started", answers: {}, questionOrder: [], optionOrders: {}, score: null, startedAt: null, submittedAt: null, updatedAt: null };
    store.attempts.push(attempt);
  }

  attempt.status = "in_progress";
  attempt.startedAt ??= new Date().toISOString();
  attempt.updatedAt = new Date().toISOString();
  let violationToSave = null;
  if (wasInProgress && req.user.role === "siswa") {
    const { violation } = addViolationLog(store, {
      studentId: attempt.studentId,
      examId: attempt.examId,
      type: "attempt_resumed",
      level: "info",
      message: "Peserta melanjutkan ujian yang sedang berjalan.",
      metadata: { attemptId: attempt.id }
    });
    violationToSave = violation;
  }
  const payloadAnalysis = analyzeExamPayload(store, exam);
  const requestedDeliveryMode = String(req.body?.deliveryMode || "").toLowerCase();
  const examSettings = normalizeExamSettings(store.examSettings);
  const deliveryMode = requestedDeliveryMode === "progressive"
    ? "progressive"
    : requestedDeliveryMode === "full" || examSettings.answerSyncMode === "extra_high"
      ? "full"
      : payloadAnalysis.recommendedDeliveryMode;
  const questions = questionsForAttempt(store, exam, attempt);
  const questionManifest = questionManifestForAttempt(store, exam, attempt);
  await persistAttemptAndViolationChanges(store, [attempt], violationToSave ? [violationToSave] : []);
  res.json({
    attempt,
    exam,
    questions: deliveryMode === "progressive" ? questions.slice(0, 1) : questions,
    questionManifest,
    deliveryMode,
    payloadAnalysis,
    examSettings,
    availability
  });
});

app.get("/api/attempts/:id/reload", allowRoles("admin", "siswa"), async (req, res) => {
  if (postgresEnabled) {
    const context = await loadAttemptHotContext(req.params.id);
    if (!context) return res.status(404).json({ message: "Attempt tidak ditemukan." });
    const { store, attempt, exam } = context;
    if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
      return res.status(403).json({ message: "Peserta hanya bisa memuat ulang ujian miliknya sendiri." });
    }
    if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
    if (attempt.status === "submitted") return res.status(409).json({ message: "Ujian sudah selesai disubmit." });
    if (attempt.status === "force_finishing") return res.status(409).json({ message: "Ujian sedang dihentikan admin. Mengirim sinkronisasi jawaban final.", forceFinishing: true, attempt });
    if (finishAttemptIfExpired(store, attempt)) {
      await persistHotAttemptChange(store, attempt);
      return res.status(409).json({ message: "Waktu ujian sudah berakhir. Jawaban sudah disubmit otomatis.", attempt });
    }
    let violationToSave = null;
    if (req.user.role === "siswa") {
      const { violation } = addViolationLog(store, {
        studentId: attempt.studentId,
        examId: attempt.examId,
        type: "questions_reloaded",
        level: "info",
        message: "Peserta memuat ulang data soal tanpa keluar ujian.",
        metadata: { attemptId: attempt.id }
      });
      violationToSave = violation;
    }
    await persistViolationChange(store, violationToSave);
    return res.json(buildStartedExamPayload(store, exam, attempt, String(req.query.deliveryMode || "").toLowerCase()));
  }
  const store = await readStore();
  const attempt = store.attempts.find((item) => item.id === req.params.id);
  if (!attempt) return res.status(404).json({ message: "Attempt tidak ditemukan." });
  if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa memuat ulang ujian miliknya sendiri." });
  }
  const exam = store.exams.find((item) => item.id === attempt.examId);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  if (attempt.status === "submitted") return res.status(409).json({ message: "Ujian sudah selesai disubmit." });
  if (attempt.status === "force_finishing") return res.status(409).json({ message: "Ujian sedang dihentikan admin. Mengirim sinkronisasi jawaban final.", forceFinishing: true, attempt });

  const availability = getExamAvailability(exam);
  if (finishAttemptIfExpired(store, attempt)) {
    await persistAttemptChange(store, attempt);
    return res.status(409).json({ message: "Waktu ujian sudah berakhir. Jawaban sudah disubmit otomatis.", attempt });
  }

  const payloadAnalysis = analyzeExamPayload(store, exam);
  const requestedDeliveryMode = String(req.query.deliveryMode || "").toLowerCase();
  const examSettings = normalizeExamSettings(store.examSettings);
  const deliveryMode = requestedDeliveryMode === "progressive"
    ? "progressive"
    : requestedDeliveryMode === "full" || examSettings.answerSyncMode === "extra_high"
      ? "full"
      : payloadAnalysis.recommendedDeliveryMode;
  const questions = questionsForAttempt(store, exam, attempt);
  const questionManifest = questionManifestForAttempt(store, exam, attempt);
  let violationToSave = null;
  if (req.user.role === "siswa") {
    const { violation } = addViolationLog(store, {
      studentId: attempt.studentId,
      examId: attempt.examId,
      type: "questions_reloaded",
      level: "info",
      message: "Peserta memuat ulang data soal tanpa keluar ujian.",
      metadata: { attemptId: attempt.id }
    });
    violationToSave = violation;
  }
  await persistViolationChange(store, violationToSave);
  res.json({
    attempt,
    exam,
    questions: deliveryMode === "progressive" ? questions.slice(0, 1) : questions,
    questionManifest,
    deliveryMode,
    payloadAnalysis,
    examSettings,
    availability
  });
});

app.get("/api/attempts/:id/question/:index", allowRoles("admin", "siswa"), async (req, res) => {
  if (postgresEnabled) {
    const context = await loadAttemptHotContext(req.params.id);
    if (!context) return res.status(404).json({ message: "Attempt tidak ditemukan." });
    const { store, attempt, exam } = context;
    if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
      return res.status(403).json({ message: "Peserta hanya bisa membuka soal miliknya sendiri." });
    }
    if (attempt.status === "submitted") return res.status(409).json({ message: "Ujian sudah selesai disubmit.", attempt });
    if (attempt.status === "force_finishing") return res.status(409).json({ message: "Ujian sedang dihentikan admin. Mengirim sinkronisasi jawaban final.", forceFinishing: true, attempt });
    if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
    if (finishAttemptIfExpired(store, attempt)) {
      await persistHotAttemptChange(store, attempt);
      return res.status(409).json({ message: "Waktu ujian sudah berakhir. Jawaban sudah disubmit otomatis.", attempt });
    }
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ message: "Nomor soal tidak valid." });
    const questions = questionsForAttempt(store, exam, attempt);
    const question = questions[index];
    if (!question) return res.status(404).json({ message: "Soal tidak ditemukan." });
    return res.json({
      attempt,
      exam,
      question,
      index,
      questionManifest: questionManifestForAttempt(store, exam, attempt),
      payloadAnalysis: analyzeExamPayload(store, exam),
      examSettings: normalizeExamSettings(store.examSettings),
      availability: getExamAvailability(exam)
    });
  }
  const store = await readStore();
  const attempt = store.attempts.find((item) => item.id === req.params.id);
  if (!attempt) return res.status(404).json({ message: "Attempt tidak ditemukan." });
  if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa membuka soal miliknya sendiri." });
  }
  if (attempt.status === "submitted") return res.status(409).json({ message: "Ujian sudah selesai disubmit.", attempt });
  if (attempt.status === "force_finishing") return res.status(409).json({ message: "Ujian sedang dihentikan admin. Mengirim sinkronisasi jawaban final.", forceFinishing: true, attempt });

  const exam = store.exams.find((item) => item.id === attempt.examId);
  if (!exam) return res.status(404).json({ message: "Ujian tidak ditemukan." });
  if (finishAttemptIfExpired(store, attempt)) {
    await persistAttemptChange(store, attempt);
    return res.status(409).json({ message: "Waktu ujian sudah berakhir. Jawaban sudah disubmit otomatis.", attempt });
  }

  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) return res.status(400).json({ message: "Nomor soal tidak valid." });
  const questions = questionsForAttempt(store, exam, attempt);
  const question = questions[index];
  if (!question) return res.status(404).json({ message: "Soal tidak ditemukan." });

  res.json({
    attempt,
    exam,
    question,
    index,
    questionManifest: questionManifestForAttempt(store, exam, attempt),
    payloadAnalysis: analyzeExamPayload(store, exam),
    examSettings: normalizeExamSettings(store.examSettings),
    availability: getExamAvailability(exam)
  });
});

app.put("/api/attempts/:id/answers", allowRoles("admin", "siswa"), async (req, res) => {
  if (postgresEnabled) {
    let context = await loadAttemptHotContext(req.params.id, { includeQuestions: false });
    if (!context) return res.status(404).json({ message: "Attempt tidak ditemukan." });
    let { store, attempt } = context;
    if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
      return res.status(403).json({ message: "Peserta hanya bisa menyimpan jawaban miliknya sendiri." });
    }
    if (attempt.status === "submitted") return res.status(409).json({ message: "Jawaban sudah final.", attempt });
    const incomingAnswers = req.body.answersPatch && typeof req.body.answersPatch === "object"
      ? req.body.answersPatch
      : req.body.answers && typeof req.body.answers === "object"
        ? req.body.answers
        : {};
    if (attempt.status === "force_finishing") {
      return res.status(409).json({ message: "Ujian sedang dihentikan admin. Mengirim sinkronisasi jawaban final.", forceFinishing: true, attempt });
    }
    if (getExamAvailability(context.exam).scheduleStatus === "ended") {
      context = await loadAttemptHotContext(req.params.id, { includeQuestions: true });
      ({ store, attempt } = context);
    }
    if (finishAttemptIfExpired(context.store, context.attempt, { ...(context.attempt.answers || {}), ...incomingAnswers })) {
      await persistHotAttemptChange(store, attempt);
      return res.status(409).json({ message: "Waktu ujian sudah berakhir. Jawaban terakhir sudah disubmit otomatis.", attempt });
    }
    attempt.answers = { ...(attempt.answers || {}), ...incomingAnswers };
    attempt.status = "in_progress";
    attempt.updatedAt = new Date().toISOString();
    await persistHotAttemptChange(store, attempt);
    return res.json(attempt);
  }
  const store = await readStore();
  const attempt = store.attempts.find((item) => item.id === req.params.id);
  if (!attempt) return res.status(404).json({ message: "Attempt tidak ditemukan." });
  if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa menyimpan jawaban miliknya sendiri." });
  }
  if (attempt.status === "submitted") return res.status(409).json({ message: "Jawaban sudah final.", attempt });

  const incomingAnswers = req.body.answersPatch && typeof req.body.answersPatch === "object"
    ? req.body.answersPatch
    : req.body.answers && typeof req.body.answers === "object"
      ? req.body.answers
      : {};

  if (attempt.status === "force_finishing") {
    return res.status(409).json({ message: "Ujian sedang dihentikan admin. Mengirim sinkronisasi jawaban final.", forceFinishing: true, attempt });
  }

  if (finishAttemptIfExpired(store, attempt, { ...(attempt.answers || {}), ...incomingAnswers })) {
    await persistAttemptChange(store, attempt);
    return res.status(409).json({ message: "Waktu ujian sudah berakhir. Jawaban terakhir sudah disubmit otomatis.", attempt });
  }

  attempt.answers = { ...(attempt.answers || {}), ...incomingAnswers };
  attempt.status = "in_progress";
  attempt.updatedAt = new Date().toISOString();
  await persistAttemptChange(store, attempt, { invalidateCache: false });
  res.json(attempt);
});

app.post("/api/attempts/:id/submit", allowRoles("admin", "siswa"), async (req, res) => {
  if (postgresEnabled) {
    const context = await loadAttemptHotContext(req.params.id);
    if (!context) return res.status(404).json({ message: "Attempt tidak ditemukan." });
    const { store, attempt } = context;
    if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
      return res.status(403).json({ message: "Peserta hanya bisa submit jawaban miliknya sendiri." });
    }
    if (attempt.status === "submitted") {
      return res.status(409).json({ message: "Ujian sudah selesai. Jawaban final tidak bisa ditimpa.", attempt });
    }
    finishAttempt(store, attempt, req.body.answers || {});
    await persistHotAttemptChange(store, attempt, { invalidateCache: true });
    return res.json(attempt);
  }
  const store = await readStore();
  const attempt = store.attempts.find((item) => item.id === req.params.id);
  if (!attempt) return res.status(404).json({ message: "Attempt tidak ditemukan." });
  if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa submit jawaban miliknya sendiri." });
  }
  if (attempt.status === "submitted") {
    return res.status(409).json({ message: "Ujian sudah selesai. Jawaban final tidak bisa ditimpa.", attempt });
  }

  finishAttempt(store, attempt, req.body.answers || {});
  await persistAttemptChange(store, attempt);
  res.json(attempt);
});

app.post("/api/attempts/:id/final-sync", allowRoles("admin", "siswa"), async (req, res) => {
  if (postgresEnabled) {
    const context = await loadAttemptHotContext(req.params.id);
    if (!context) return res.status(404).json({ message: "Attempt tidak ditemukan." });
    const { store, attempt } = context;
    if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
      return res.status(403).json({ message: "Peserta hanya bisa sinkronisasi jawaban miliknya sendiri." });
    }
    if (attempt.status === "submitted") {
      return res.json({ ok: true, submitted: true, attempt });
    }
    const answers = req.body.answers && typeof req.body.answers === "object" ? req.body.answers : {};
    const wasForceFinishing = attempt.status === "force_finishing";
    finishAttempt(store, attempt, answers);
    const violationsToSave = [];
    if (wasForceFinishing) {
      const { violation } = addViolationLog(store, {
        studentId: attempt.studentId,
        examId: attempt.examId,
        type: "admin_force_finish_final_sync",
        level: "info",
        message: "Perangkat peserta berhasil mengirim jawaban terakhir setelah admin memaksa selesai.",
        metadata: { attemptId: attempt.id, syncedAt: attempt.submittedAt }
      });
      violationsToSave.push(violation);
    }
    await persistAttemptAndViolationChanges(store, [attempt], violationsToSave, { invalidateCache: true });
    return res.json({ ok: true, submitted: true, attempt });
  }
  const store = await readStore();
  const attempt = store.attempts.find((item) => item.id === req.params.id);
  if (!attempt) return res.status(404).json({ message: "Attempt tidak ditemukan." });
  if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa sinkronisasi jawaban miliknya sendiri." });
  }
  if (attempt.status === "submitted") {
    return res.json({ ok: true, submitted: true, attempt });
  }

  const answers = req.body.answers && typeof req.body.answers === "object" ? req.body.answers : {};
  const wasForceFinishing = attempt.status === "force_finishing";
  finishAttempt(store, attempt, answers);
  const violationsToSave = [];
  if (wasForceFinishing) {
    const { violation } = addViolationLog(store, {
      studentId: attempt.studentId,
      examId: attempt.examId,
      type: "admin_force_finish_final_sync",
      level: "info",
      message: "Perangkat peserta berhasil mengirim jawaban terakhir setelah admin memaksa selesai.",
      metadata: { attemptId: attempt.id, syncedAt: attempt.submittedAt }
    });
    violationsToSave.push(violation);
  }
  await persistAttemptAndViolationChanges(store, [attempt], violationsToSave);
  res.json({ ok: true, submitted: true, attempt });
});

app.post("/api/attempts/:id/admin-finish", allowRoles("admin", "pengawas"), async (req, res) => {
  const store = await readStore();
  const attempt = store.attempts.find((item) => item.id === req.params.id);
  if (!attempt) return res.status(404).json({ message: "Attempt tidak ditemukan." });
  if (attempt.status === "submitted") return res.status(409).json({ message: "Ujian peserta sudah selesai." });
  if (attempt.status !== "in_progress" && attempt.status !== "force_finishing") {
    return res.status(409).json({ message: "Force selesai hanya bisa untuk peserta yang sedang mengerjakan." });
  }
  const reason = String(req.body.reason || "Dipaksa selesai oleh admin/pengawas.").slice(0, 300);
  const violation = requestForceFinish(store, attempt, req, reason, "admin_force_finish");
  const auditLog = addAuditLog(store, req, "force_finish_attempt", "attempt", attempt.id, `Ujian peserta diminta selesai paksa. Alasan: ${reason}`, {
    studentId: attempt.studentId,
    examId: attempt.examId,
    reason
  });
  if (postgresEnabled) {
    await persistAttemptAndViolationChanges(store, [attempt], [violation]);
    await persistAuditLogChange(store, auditLog);
  } else {
    await writeStore(store);
  }
  res.json(attempt);
});

app.post("/api/attempts/admin-finish-bulk", allowRoles("admin", "pengawas"), async (req, res) => {
  const store = await readStore();
  const attemptIds = Array.isArray(req.body.attemptIds) ? [...new Set(req.body.attemptIds.map((id) => String(id)))] : [];
  const reason = String(req.body.reason || "").trim().slice(0, 300);
  const password = String(req.body.password || "");
  if (!attemptIds.length) return res.status(400).json({ message: "Tidak ada peserta yang dipilih." });
  if (!reason) return res.status(400).json({ message: "Alasan force selesai wajib diisi." });
  if (!await requireCurrentUserPassword(store, req, password)) return res.status(403).json({ message: "Password akun salah." });

  const attemptsToFinish = store.attempts.filter((attempt) => attemptIds.includes(attempt.id) && attempt.status === "in_progress");
  const violationsToSave = [];
  for (const attempt of attemptsToFinish) {
    const violation = requestForceFinish(store, attempt, req, reason, "admin_force_finish_bulk");
    violationsToSave.push(violation);
  }
  const auditLog = addAuditLog(store, req, "force_finish_attempt_bulk", "attempt", "bulk", `${attemptsToFinish.length} ujian peserta diminta selesai paksa massal. Alasan: ${reason}`, {
    requested: attemptIds.length,
    finished: attemptsToFinish.length,
    skipped: attemptIds.length - attemptsToFinish.length,
    reason,
    attemptIds
  });

  if (postgresEnabled) {
    await persistAttemptAndViolationChanges(store, attemptsToFinish, violationsToSave);
    await persistAuditLogChange(store, auditLog);
  } else {
    await writeStore(store);
  }
  res.json({ ok: true, requested: attemptIds.length, finished: attemptsToFinish.length, skipped: attemptIds.length - attemptsToFinish.length });
});

app.get("/api/attempts/:id/status", allowRoles("admin", "siswa"), async (req, res) => {
  if (postgresEnabled) {
    const context = await loadAttemptHotContext(req.params.id);
    if (!context) return res.status(404).json({ message: "Attempt tidak ditemukan." });
    const { store, attempt } = context;
    if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
      return res.status(403).json({ message: "Peserta hanya bisa mengecek status ujian miliknya sendiri." });
    }
    const violationsBefore = store.violations.length;
    if (finishForceFinishingIfTimedOut(store, attempt) || finishAttemptIfExpired(store, attempt)) {
      await persistAttemptAndViolationChanges(store, [attempt], store.violations.slice(0, Math.max(0, store.violations.length - violationsBefore)), { invalidateCache: true });
    }
    return res.json({ ok: true, submitted: attempt.status === "submitted", forceFinishing: attempt.status === "force_finishing", attempt });
  }
  const store = await readStore();
  const attempt = store.attempts.find((item) => item.id === req.params.id);
  if (!attempt) return res.status(404).json({ message: "Attempt tidak ditemukan." });
  if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa mengecek status ujian miliknya sendiri." });
  }
  const violationsBefore = store.violations.length;
  if (finishForceFinishingIfTimedOut(store, attempt) || finishAttemptIfExpired(store, attempt)) {
    await persistAttemptAndViolationChanges(store, [attempt], store.violations.slice(0, Math.max(0, store.violations.length - violationsBefore)));
  }
  res.json({ ok: true, submitted: attempt.status === "submitted", forceFinishing: attempt.status === "force_finishing", attempt });
});

app.post("/api/attempts/:id/heartbeat", allowRoles("admin", "siswa"), async (req, res) => {
  if (postgresEnabled) {
    const context = await loadAttemptHotContext(req.params.id);
    if (!context) return res.status(404).json({ message: "Attempt tidak ditemukan." });
    const { store, attempt } = context;
    if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
      return res.status(403).json({ message: "Peserta hanya bisa mengirim heartbeat miliknya sendiri." });
    }
    if (attempt.status === "submitted") {
      return res.json({ ok: true, updatedAt: attempt.updatedAt, submitted: true, attempt });
    }
    if (attempt.status === "force_finishing") {
      const violationsBefore = store.violations.length;
      if (finishForceFinishingIfTimedOut(store, attempt)) {
        await persistAttemptAndViolationChanges(store, [attempt], store.violations.slice(0, Math.max(0, store.violations.length - violationsBefore)), { invalidateCache: true });
        return res.json({ ok: true, updatedAt: attempt.updatedAt, submitted: true, attempt });
      }
      return res.json({ ok: true, updatedAt: attempt.updatedAt, submitted: false, forceFinishing: true, attempt });
    }
    attempt.updatedAt = new Date().toISOString();
    let violationToSave = null;
    if (req.body.event && req.body.event !== "heartbeat") {
      const { violation } = addViolationLog(store, {
        studentId: attempt.studentId,
        examId: attempt.examId,
        type: req.body.event,
        level: req.body.level || "warning",
        message: req.body.message || "Event exam client tercatat.",
        metadata: {
          ...(req.body.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}),
          attemptId: attempt.id,
          clientEventId: req.body.clientEventId || ""
        }
      });
      violationToSave = violation;
    }
    if (violationToSave) {
      await persistAttemptAndViolationChanges(store, [attempt], [violationToSave], { invalidateCache: false });
    } else {
      await persistHotAttemptChange(store, attempt);
    }
    return res.json({ ok: true, updatedAt: attempt.updatedAt, submitted: false, attempt });
  }
  const store = await readStore();
  const attempt = store.attempts.find((item) => item.id === req.params.id);
  if (!attempt) return res.status(404).json({ message: "Attempt tidak ditemukan." });
  if (req.user.role === "siswa" && req.user.id !== attempt.studentId) {
    return res.status(403).json({ message: "Peserta hanya bisa mengirim heartbeat miliknya sendiri." });
  }
  if (attempt.status === "submitted") {
    return res.json({ ok: true, updatedAt: attempt.updatedAt, submitted: true, attempt });
  }
  if (attempt.status === "force_finishing") {
    const violationsBefore = store.violations.length;
    if (finishForceFinishingIfTimedOut(store, attempt)) {
      await persistAttemptAndViolationChanges(store, [attempt], store.violations.slice(0, Math.max(0, store.violations.length - violationsBefore)), { invalidateCache: false });
      return res.json({ ok: true, updatedAt: attempt.updatedAt, submitted: true, attempt });
    }
    return res.json({ ok: true, updatedAt: attempt.updatedAt, submitted: false, forceFinishing: true, attempt });
  }
  attempt.updatedAt = new Date().toISOString();
  let violationToSave = null;
  if (req.body.event && req.body.event !== "heartbeat") {
    const { violation } = addViolationLog(store, {
      studentId: attempt.studentId,
      examId: attempt.examId,
      type: req.body.event,
      level: req.body.level || "warning",
      message: req.body.message || "Event exam client tercatat.",
      metadata: {
        ...(req.body.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}),
        attemptId: attempt.id,
        clientEventId: req.body.clientEventId || ""
      }
    });
    violationToSave = violation;
  }
  await persistAttemptAndViolationChanges(store, [attempt], violationToSave ? [violationToSave] : [], { invalidateCache: false });
  res.json({ ok: true, updatedAt: attempt.updatedAt, submitted: false, attempt });
});

app.post("/api/client-events", allowRoles("siswa"), async (req, res) => {
  const store = await readStore();
  const attempt = findClientEventAttempt(store, req.user, {
    attemptId: String(req.body.attemptId || ""),
    examId: String(req.body.examId || "")
  });
  if (!attempt) {
    return res.status(404).json({ message: "Attempt peserta belum ditemukan untuk mencatat event." });
  }

  const event = String(req.body.event || "client_event").slice(0, 80);
  const level = String(req.body.level || "warning").slice(0, 30);
  const message = String(req.body.message || "Event exam client tercatat.").slice(0, 500);
  const attemptsToSave = [];
  let violationToSave = null;
  if (attempt.status === "in_progress") {
    attempt.updatedAt = new Date().toISOString();
    attemptsToSave.push(attempt);
  }
  if (event && event !== "heartbeat") {
    const { violation } = addViolationLog(store, {
      studentId: attempt.studentId,
      examId: attempt.examId,
      type: event,
      level,
      message,
      createdAt: safeIsoDate(req.body.clientTime),
      metadata: {
        ...(req.body.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}),
        attemptId: attempt.id,
        clientEventId: req.body.clientEventId || "",
        clientTime: req.body.clientTime || "",
        receivedAt: new Date().toISOString()
      }
    });
    violationToSave = violation;
  }
  await persistAttemptAndViolationChanges(store, attemptsToSave, violationToSave ? [violationToSave] : [], { invalidateCache: false });
  res.json({ ok: true, attemptId: attempt.id, examId: attempt.examId });
});

app.post("/api/client-events/batch", allowRoles("siswa"), async (req, res) => {
  const store = await readStore();
  const events = Array.isArray(req.body.events) ? req.body.events.slice(0, 100) : [];
  const recorded = [];
  const attemptsToSave = [];
  const violationsToSave = [];

  for (const item of events) {
    const attempt = findClientEventAttempt(store, req.user, {
      attemptId: String(item.attemptId || ""),
      examId: String(item.examId || "")
    });
    if (!attempt) continue;
    const event = String(item.event || "client_event").slice(0, 80);
    if (!event || event === "heartbeat") continue;

    if (attempt.status === "in_progress") {
      attempt.updatedAt = new Date().toISOString();
      attemptsToSave.push(attempt);
    }
    const { violation } = addViolationLog(store, {
      studentId: attempt.studentId,
      examId: attempt.examId,
      type: event,
      level: String(item.level || "warning").slice(0, 30),
      message: String(item.message || "Event exam client tercatat.").slice(0, 500),
      createdAt: safeIsoDate(item.clientTime),
      metadata: {
        ...(item.metadata && typeof item.metadata === "object" ? item.metadata : {}),
        attemptId: attempt.id,
        clientEventId: item.clientEventId || "",
        clientTime: item.clientTime || "",
        receivedAt: new Date().toISOString(),
        source: "offline_queue"
      }
    });
    violationsToSave.push(violation);
    recorded.push({ id: violation.id, event, attemptId: attempt.id, examId: attempt.examId });
  }

  await persistAttemptAndViolationChanges(store, attemptsToSave, violationsToSave, { invalidateCache: false });
  res.json({ ok: true, recorded: recorded.length, events: recorded });
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

app.delete("/api/violations", allowRoles("admin"), async (req, res) => {
  const store = await readStore();
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map((id) => String(id || "")).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ message: "Pilih minimal satu log pelanggaran untuk dihapus." });

  const idSet = new Set(ids);
  const before = store.violations.length;
  store.violations = store.violations.filter((violation) => !idSet.has(violation.id));
  const deleted = before - store.violations.length;
  addAuditLog(store, req, "delete", "violation", "bulk", `${deleted} log pelanggaran dihapus dari monitoring.`, {
    deleted,
    requested: ids.length
  });
  await writeStore(store);
  res.json({ ok: true, deleted });
});

app.get("/api/audit-logs", allowRoles("admin"), async (_req, res) => {
  const store = await readStore();
  res.json((store.auditLogs || []).slice(0, 200));
});

app.post("/api/violations", allowRoles("admin", "pengawas"), async (req, res) => {
  const store = await readStore();
  const { violation } = addViolationLog(store, {
    studentId: req.body.studentId,
    examId: req.body.examId,
    type: req.body.type,
    level: req.body.level || "warning",
    message: req.body.message,
    metadata: req.body.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}
  });
  await writeStore(store);
  res.status(201).json(violation);
});

if (postgresEnabled) {
  await initDatabase(seed);
}

app.listen(port, () => {
  console.log(`CBT API berjalan di http://127.0.0.1:${port}`);
});
