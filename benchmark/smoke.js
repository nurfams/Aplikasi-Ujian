import http from "k6/http";
import { check, group, sleep } from "k6";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:4100").replace(/\/$/, "");
const ADMIN_USERNAME = __ENV.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || "admin123";

export const options = {
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800", "p(99)<1500"]
  }
};

function jsonHeaders(token) {
  return {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  };
}

export function setup() {
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, {
    "health 200": (response) => response.status === 200,
    "health ok": (response) => response.json("ok") === true
  });

  const login = http.post(
    `${BASE_URL}/api/login`,
    JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
    jsonHeaders()
  );

  check(login, {
    "admin login 200": (response) => response.status === 200,
    "admin token ada": (response) => Boolean(response.json("token"))
  });

  return { token: login.json("token") };
}

export default function (data) {
  const auth = jsonHeaders(data.token);

  group("dashboard-admin", () => {
    check(http.get(`${BASE_URL}/api/summary`, auth), { "summary 200": (response) => response.status === 200 });
    check(http.get(`${BASE_URL}/api/students`, auth), { "students 200": (response) => response.status === 200 });
    check(http.get(`${BASE_URL}/api/exams`, auth), { "exams 200": (response) => response.status === 200 });
    check(http.get(`${BASE_URL}/api/attempts`, auth), { "attempts 200": (response) => response.status === 200 });
    check(http.get(`${BASE_URL}/api/results`, auth), { "results 200": (response) => response.status === 200 });
  });

  sleep(1);
}
