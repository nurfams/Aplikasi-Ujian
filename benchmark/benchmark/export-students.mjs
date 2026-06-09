import fs from "node:fs/promises";

const baseUrl = (process.env.BASE_URL || "http://localhost:4100").replace(/\/$/, "");
const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
const limit = Number(process.env.LIMIT || 100);
const output = process.env.OUTPUT || "benchmark/students.csv";

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return response.json();
}

const login = await api("/api/login", {
  method: "POST",
  body: JSON.stringify({ username: adminUsername, password: adminPassword })
});

const students = await api("/api/students", {
  headers: { Authorization: `Bearer ${login.token}` }
});

const rows = students
  .filter((student) => student.username && student.password)
  .slice(0, limit)
  .map((student) => `${csv(student.username)},${csv(student.password)}`);

await fs.writeFile(output, `username,password\n${rows.join("\n")}\n`, "utf8");

console.log(`Berhasil membuat ${output} berisi ${rows.length} akun peserta.`);
console.log("Catatan: file ini berisi password peserta. Jangan dibagikan.");

function csv(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}
