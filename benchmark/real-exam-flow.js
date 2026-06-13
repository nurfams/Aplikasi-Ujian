import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:4100").replace(/\/$/, "");
const STUDENTS_CSV = __ENV.STUDENTS_CSV || "benchmark/students.csv";
const EXAM_TOKEN = __ENV.EXAM_TOKEN || "";
const TARGET_VUS = Number(__ENV.TARGET_VUS || 50);
const HTTP_TIMEOUT = __ENV.HTTP_TIMEOUT || "20s";
const EXAM_DURATION_SECONDS = parseDuration(__ENV.EXAM_DURATION || "30m");
const HEARTBEAT_INTERVAL_SECONDS = Number(__ENV.HEARTBEAT_INTERVAL_SECONDS || 20);
const ANSWER_INTERVAL_SECONDS = Number(__ENV.ANSWER_INTERVAL_SECONDS || 15);
const QUESTION_PREFETCH = Number(__ENV.QUESTION_PREFETCH || 2);
const SUBMIT = String(__ENV.SUBMIT || "false").toLowerCase() === "true";
const RELOGIN_PERCENT = Math.max(0, Math.min(100, Number(__ENV.RELOGIN_PERCENT || 5)));
const RELOGIN_AT_PERCENT = Math.max(5, Math.min(95, Number(__ENV.RELOGIN_AT_PERCENT || 50)));

let studentsCsvText = "";
try {
  studentsCsvText = open(STUDENTS_CSV);
} catch {
  studentsCsvText = open("students.csv");
}
const studentRows = parseCsv(studentsCsvText);

export const options = {
  scenarios: {
    ujian_nyata: {
      executor: "shared-iterations",
      vus: TARGET_VUS,
      iterations: TARGET_VUS,
      maxDuration: __ENV.MAX_DURATION || secondsToK6Duration(EXAM_DURATION_SECONDS + 10 * 60)
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.03"],
    login_failed: ["rate<0.02"],
    portal_failed: ["rate<0.02"],
    exam_start_failed: ["rate<0.05"],
    question_fetch_failed: ["rate<0.03"],
    autosave_failed: ["rate<0.03"],
    heartbeat_failed: ["rate<0.03"]
  }
};

const loginFailed = new Rate("login_failed");
const portalFailed = new Rate("portal_failed");
const examStartFailed = new Rate("exam_start_failed");
const questionFetchFailed = new Rate("question_fetch_failed");
const autosaveFailed = new Rate("autosave_failed");
const heartbeatFailed = new Rate("heartbeat_failed");
const startedAttempts = new Counter("started_attempts");
const reloginAttempts = new Counter("relogin_attempts");
const fetchedQuestions = new Counter("fetched_questions");
const answeredQuestions = new Counter("answered_questions");
const submittedAttempts = new Counter("submitted_attempts");
const loginDuration = new Trend("login_duration");
const startDuration = new Trend("start_duration");
const autosaveDuration = new Trend("autosave_duration");
const heartbeatDuration = new Trend("heartbeat_duration");
const questionFetchDuration = new Trend("question_fetch_duration");

function parseDuration(value) {
  const text = String(value || "30m").trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!match) return 30 * 60;
  const amount = Number(match[1]);
  const unit = match[2] || "s";
  if (unit === "ms") return Math.max(1, Math.ceil(amount / 1000));
  if (unit === "m") return Math.ceil(amount * 60);
  if (unit === "h") return Math.ceil(amount * 60 * 60);
  return Math.ceil(amount);
}

function secondsToK6Duration(seconds) {
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.ceil(seconds)}s`;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines.shift().split(",").map((item) => item.trim());
  return lines.map((line) => {
    const values = line.split(",").map((item) => item.trim());
    return headers.reduce((row, header, index) => {
      row[header] = values[index] || "";
      return row;
    }, {});
  }).filter((row) => row.username && row.password);
}

function jsonHeaders(token) {
  return {
    timeout: HTTP_TIMEOUT,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  };
}

function safeJson(response, selector) {
  if (!response || !response.body) return null;
  try {
    return selector ? response.json(selector) : response.json();
  } catch {
    return null;
  }
}

function pickStudent() {
  const index = (__VU - 1) % studentRows.length;
  return studentRows[index];
}

function chooseReadyExam(exams) {
  return exams.find((item) => item.canStart && item.status !== "submitted")
    || exams.find((item) => item.status === "in_progress")
    || null;
}

function firstAnswerFor(question) {
  if (question.type === "multiple_response") {
    return [(question.options || [])[0]?.key || "A"];
  }
  if (question.type === "true_false") {
    return (question.statements || []).reduce((answers, statement) => {
      answers[statement.id] = "true";
      return answers;
    }, {});
  }
  if (question.type === "matching") {
    const choices = question.matchingOptions || [];
    return (question.pairs || []).reduce((answers, pair, index) => {
      answers[pair.id] = choices[index % Math.max(choices.length, 1)]?.value || "";
      return answers;
    }, {});
  }
  if (question.type === "short_answer") return "jawaban";
  if (question.type === "essay") return "Jawaban simulasi benchmark.";
  return (question.options || [])[0]?.key || "A";
}

function login(student) {
  let token = "";
  let user = null;
  group("login-sekali", () => {
    const response = http.post(
      `${BASE_URL}/api/login`,
      JSON.stringify({ username: student.username, password: student.password }),
      jsonHeaders()
    );
    loginDuration.add(response.timings.duration);
    const loginJson = safeJson(response);
    const ok = check(response, {
      "login peserta 200": (res) => res.status === 200
    }) && check(loginJson, {
      "role siswa": (body) => body?.user?.role === "siswa",
      "token peserta ada": (body) => Boolean(body?.token)
    });
    loginFailed.add(!ok);
    if (ok) {
      token = loginJson.token;
      user = loginJson.user;
    }
  });
  return { token, user };
}

function openPortal(user, auth) {
  let selected = null;
  group("portal-peserta", () => {
    const response = http.get(`${BASE_URL}/api/student/${user.id}/exams`, auth);
    const exams = safeJson(response);
    const ok = check(response, {
      "jadwal peserta 200": (res) => res.status === 200
    }) && check(exams, {
      "jadwal array": (body) => Array.isArray(body)
    });
    portalFailed.add(!ok);
    if (ok) selected = chooseReadyExam(exams);
  });
  return selected;
}

function startExam(user, selected, auth) {
  let session = null;
  group("mulai-ujian-sekali", () => {
    const response = http.post(
      `${BASE_URL}/api/attempts/start`,
      JSON.stringify({ studentId: user.id, examId: selected.exam.id, token: EXAM_TOKEN }),
      auth
    );
    startDuration.add(response.timings.duration);
    const startJson = safeJson(response);
    const ok = check(response, {
      "mulai ujian 200": (res) => res.status === 200
    }) && check(startJson, {
      "attempt ada": (body) => Boolean(body?.attempt?.id),
      "questions array": (body) => Array.isArray(body?.questions)
    });
    examStartFailed.add(!ok);
    if (ok) {
      session = startJson;
      startedAttempts.add(1);
    }
  });
  return session;
}

function makeQuestionSlots(session) {
  const manifest = session.questionManifest?.length
    ? session.questionManifest
    : (session.questions || []).map((question, index) => ({ id: question.id, index, type: question.type }));
  const slots = Array.from({ length: manifest.length }, () => null);
  const indexById = new Map(manifest.map((item, index) => [item.id, index]));
  for (const question of session.questions || []) {
    const index = indexById.get(question.id);
    if (index !== undefined) slots[index] = question;
  }
  return { manifest, slots };
}

function fetchQuestion(attemptId, index, auth, slots) {
  if (slots[index]) return slots[index];
  const response = http.get(`${BASE_URL}/api/attempts/${attemptId}/question/${index}`, auth);
  questionFetchDuration.add(response.timings.duration);
  const json = safeJson(response);
  const ok = check(response, {
    "fetch soal 200": (res) => res.status === 200
  }) && check(json, {
    "soal ada": (body) => Boolean(body?.question?.id)
  });
  questionFetchFailed.add(!ok);
  if (!ok) return null;
  slots[index] = json.question;
  fetchedQuestions.add(1);
  return json.question;
}

function autosave(attemptId, answers, auth) {
  const response = http.put(
    `${BASE_URL}/api/attempts/${attemptId}/answers`,
    JSON.stringify({ answers }),
    auth
  );
  autosaveDuration.add(response.timings.duration);
  const ok = check(response, {
    "autosave 200/409": (res) => [200, 409].includes(res.status)
  });
  autosaveFailed.add(!ok);
  return ok;
}

function heartbeat(attemptId, auth) {
  const response = http.post(
    `${BASE_URL}/api/attempts/${attemptId}/heartbeat`,
    JSON.stringify({ event: "heartbeat" }),
    auth
  );
  heartbeatDuration.add(response.timings.duration);
  const ok = check(response, {
    "heartbeat 200/409": (res) => [200, 409].includes(res.status)
  });
  heartbeatFailed.add(!ok);
  return ok;
}

export default function () {
  const student = pickStudent();
  let { token, user } = login(student);
  if (!token || !user) return;

  let auth = jsonHeaders(token);
  const selected = openPortal(user, auth);
  if (!selected) return;

  const session = startExam(user, selected, auth);
  if (!session?.attempt?.id) return;

  const attemptId = session.attempt.id;
  const { manifest, slots } = makeQuestionSlots(session);
  const answers = { ...(session.attempt.answers || {}) };
  let answerIndex = 0;
  let nextHeartbeatAt = HEARTBEAT_INTERVAL_SECONDS;
  let nextAnswerAt = Math.max(1, ANSWER_INTERVAL_SECONDS);
  let reloginDone = false;
  const shouldRelogin = RELOGIN_PERCENT > 0 && ((__VU - 1) % 100) < RELOGIN_PERCENT;
  const reloginAt = Math.floor(EXAM_DURATION_SECONDS * (RELOGIN_AT_PERCENT / 100));

  const startedAt = Date.now();
  while ((Date.now() - startedAt) / 1000 < EXAM_DURATION_SECONDS) {
    const elapsed = (Date.now() - startedAt) / 1000;

    if (shouldRelogin && !reloginDone && elapsed >= reloginAt) {
      reloginDone = true;
      reloginAttempts.add(1);
      const relogin = login(student);
      if (relogin.token && relogin.user) {
        token = relogin.token;
        user = relogin.user;
        auth = jsonHeaders(token);
        const resumedExam = openPortal(user, auth);
        if (resumedExam) startExam(user, resumedExam, auth);
      }
    }

    if (elapsed >= nextAnswerAt && answerIndex < manifest.length) {
      const question = fetchQuestion(attemptId, answerIndex, auth, slots);
      for (let offset = 1; offset <= QUESTION_PREFETCH; offset += 1) {
        fetchQuestion(attemptId, answerIndex + offset, auth, slots);
      }
      if (question) {
        answers[question.id] = firstAnswerFor(question);
        if (autosave(attemptId, answers, auth)) answeredQuestions.add(1);
        answerIndex += 1;
      }
      nextAnswerAt += Math.max(1, ANSWER_INTERVAL_SECONDS);
    }

    if (elapsed >= nextHeartbeatAt) {
      heartbeat(attemptId, auth);
      nextHeartbeatAt += Math.max(5, HEARTBEAT_INTERVAL_SECONDS);
    }

    sleep(1);
  }

  if (SUBMIT) {
    group("submit-ujian", () => {
      const response = http.post(
        `${BASE_URL}/api/attempts/${attemptId}/submit`,
        JSON.stringify({ answers }),
        auth
      );
      const ok = check(response, { "submit 200/409": (res) => [200, 409].includes(res.status) });
      if (ok) submittedAttempts.add(1);
    });
  }
}
