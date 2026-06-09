import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:4100").replace(/\/$/, "");
const STUDENTS_CSV = __ENV.STUDENTS_CSV || "benchmark/students.csv";
const EXAM_TOKEN = __ENV.EXAM_TOKEN || "";
const THINK_TIME_SECONDS = Number(__ENV.THINK_TIME_SECONDS || 2);
const AUTOSAVE_ROUNDS = Number(__ENV.AUTOSAVE_ROUNDS || 3);
const SUBMIT = String(__ENV.SUBMIT || "false").toLowerCase() === "true";
const TARGET_VUS = Number(__ENV.TARGET_VUS || 50);
const ITERATIONS = Number(__ENV.ITERATIONS || TARGET_VUS);
const MODE = String(__ENV.MODE || "once").toLowerCase();
const HTTP_TIMEOUT = __ENV.HTTP_TIMEOUT || "20s";

let studentsCsvText = "";
try {
  studentsCsvText = open(STUDENTS_CSV);
} catch {
  studentsCsvText = open("students.csv");
}
const studentRows = parseCsv(studentsCsvText);

const onceScenario = {
  peserta_ujian: {
    executor: "shared-iterations",
    vus: TARGET_VUS,
    iterations: ITERATIONS,
    maxDuration: __ENV.MAX_DURATION || "20m"
  }
};

const soakScenario = {
  peserta_ujian: {
    executor: "ramping-vus",
    stages: [
      { duration: __ENV.RAMP_UP || "1m", target: TARGET_VUS },
      { duration: __ENV.HOLD || "3m", target: TARGET_VUS },
      { duration: __ENV.RAMP_DOWN || "30s", target: 0 }
    ]
  }
};

export const options = {
  scenarios: {
    ...(MODE === "soak" ? soakScenario : onceScenario)
  },
  thresholds: {
    http_req_failed: ["rate<0.03"],
    http_req_duration: ["p(95)<1200", "p(99)<2500"],
    student_login_failed: ["rate<0.02"],
    exam_start_failed: ["rate<0.15"],
    autosave_failed: ["rate<0.03"],
    heartbeat_failed: ["rate<0.03"]
  }
};

const studentLoginFailed = new Rate("student_login_failed");
const examStartFailed = new Rate("exam_start_failed");
const autosaveFailed = new Rate("autosave_failed");
const heartbeatFailed = new Rate("heartbeat_failed");
const startedAttempts = new Counter("started_attempts");
const submittedAttempts = new Counter("submitted_attempts");

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
  const index = ((__VU - 1) + (__ITER * TARGET_VUS)) % studentRows.length;
  return studentRows[index];
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

function chooseReadyExam(exams) {
  return exams.find((item) => item.canStart && item.status !== "submitted")
    || exams.find((item) => item.status === "in_progress")
    || null;
}

export default function () {
  const student = pickStudent();
  let token = "";
  let user = null;

  group("login-peserta", () => {
    const response = http.post(
      `${BASE_URL}/api/login`,
      JSON.stringify({ username: student.username, password: student.password }),
      jsonHeaders()
    );
    const loginJson = safeJson(response);
    const ok = check(response, {
      "login peserta 200": (res) => res.status === 200
    }) && check(loginJson, {
      "role siswa": (body) => body?.user?.role === "siswa",
      "token peserta ada": (body) => Boolean(body?.token)
    });
    studentLoginFailed.add(!ok);
    if (!ok) return;
    token = loginJson.token;
    user = loginJson.user;
  });

  if (!token || !user) return;

  const auth = jsonHeaders(token);
  let selected = null;

  group("portal-peserta", () => {
    const response = http.get(`${BASE_URL}/api/student/${user.id}/exams`, auth);
    const exams = safeJson(response);
    const ok = check(response, {
      "jadwal peserta 200": (res) => res.status === 200
    }) && check(exams, {
      "jadwal array": (body) => Array.isArray(body)
    });
    if (!ok) return;
    selected = chooseReadyExam(exams);
  });

  if (!selected) {
    sleep(THINK_TIME_SECONDS);
    return;
  }

  let attempt = null;
  let questions = [];

  group("mulai-ujian", () => {
    const response = http.post(
      `${BASE_URL}/api/attempts/start`,
      JSON.stringify({ studentId: user.id, examId: selected.exam.id, token: EXAM_TOKEN }),
      auth
    );
    const startJson = safeJson(response);
    const ok = check(response, {
      "mulai ujian 200": (res) => res.status === 200
    }) && check(startJson, {
      "attempt ada": (body) => Boolean(body?.attempt?.id),
      "questions array": (body) => Array.isArray(body?.questions)
    });
    examStartFailed.add(!ok);
    if (!ok) return;
    attempt = startJson.attempt;
    questions = startJson.questions;
    startedAttempts.add(1);
  });

  if (!attempt || !questions.length) return;

  const answers = {};
  const rounds = Math.min(AUTOSAVE_ROUNDS, questions.length);

  for (let index = 0; index < rounds; index += 1) {
    const question = questions[index];
    answers[question.id] = firstAnswerFor(question);

    group("autosave-jawaban", () => {
      const response = http.put(
        `${BASE_URL}/api/attempts/${attempt.id}/answers`,
        JSON.stringify({ answers }),
        auth
      );
      const ok = check(response, {
        "autosave 200/409": (res) => [200, 409].includes(res.status)
      });
      autosaveFailed.add(!ok);
    });

    group("heartbeat", () => {
      const response = http.post(
        `${BASE_URL}/api/attempts/${attempt.id}/heartbeat`,
        JSON.stringify({ event: "heartbeat" }),
        auth
      );
      const ok = check(response, { "heartbeat 200": (res) => res.status === 200 });
      heartbeatFailed.add(!ok);
    });

    sleep(THINK_TIME_SECONDS);
  }

  if (SUBMIT) {
    group("submit-ujian", () => {
      const response = http.post(
        `${BASE_URL}/api/attempts/${attempt.id}/submit`,
        JSON.stringify({ answers }),
        auth
      );
      const ok = check(response, { "submit 200": (res) => res.status === 200 });
      if (ok) submittedAttempts.add(1);
    });
  }
}
