import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import readXlsxFile from "read-excel-file/browser";
import {
  AlertTriangle,
  ALargeSmall,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Download,
  KeyRound,
  ListChecks,
  LayoutDashboard,
  LogOut,
  MonitorSmartphone,
  PlayCircle,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  Users
} from "lucide-react";
import "./styles.css";

const API_HOST = window.location.hostname || "127.0.0.1";
const API = `http://${API_HOST}:4100/api`;
const SESSION_KEY = "cbt_sman94_session";
const EXAM_FONT_SIZE_KEY = "cbt_sman94_exam_font_size";

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

async function api(path, options = {}) {
  const session = readSession();
  const authHeader = session?.token ? { Authorization: `Bearer ${session.token}` } : {};
  const response = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...authHeader, ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) {
    if (response.status === 401) clearSession();
    const error = await response.json().catch(() => ({}));
    const requestError = new Error(error.message || "Request gagal.");
    requestError.code = error.code;
    requestError.accessState = error.accessState;
    requestError.data = error;
    throw requestError;
  }
  return response.json();
}

function rowsToObjects(rows) {
  const [headers = [], ...body] = rows;
  return body
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [String(header).trim(), row[index] ?? ""])));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rowsToObjects(rows);
}

function parseQuestionText(text, examId) {
  const lines = text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const officialQuestions = parseOfficialQuestionText(lines, examId);
  if (officialQuestions.length) return officialQuestions;

  return parseLegacyQuestionText(lines, examId);
}

function questionTypeFromText(value) {
  const type = String(value || "").trim().toLowerCase();
  if (["checklist", "pgk", "pg kompleks", "pilihan ganda kompleks", "multiple_response"].includes(type)) return "multiple_response";
  return "multiple_choice";
}

function splitAnswerKeys(value) {
  return String(value || "")
    .toUpperCase()
    .split(/[,;/\s]+/)
    .map((item) => item.trim())
    .filter((item) => OPTION_KEYS.includes(item));
}

function parseOfficialQuestionText(lines, examId) {
  const questions = [];
  let current = null;
  let section = "";
  let activeOptionKey = "";

  function finishCurrent() {
    if (!current) return;
    current.body = current.body.trim();
    current.options = current.options.map((option) => ({ ...option, text: option.text.trim() })).filter((option) => option.text);
    if (current.type === "multiple_response" && current.body && current.options.length >= 2 && current.correctAnswers.length) {
      questions.push(current);
    } else if (current.type === "multiple_choice" && current.body && current.options.length >= 2 && current.answerKey) {
      questions.push(current);
    }
  }

  for (const line of lines) {
    const typeMatch = line.match(/^\[?\s*tipe\s*:\s*([^\]]+?)\s*\]?$/i);
    const questionLabelMatch = line.match(/^soal\s*:\s*(.*)$/i);
    const optionMatch = line.match(/^([A-E])[\).]\s*(.*)$/i);
    const keyMatch = line.match(/^(kunci|jawaban|answer)\s*[:=]\s*(.+)$/i);
    const scoreMatch = line.match(/^(bobot|skor|score)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);

    if (typeMatch) {
      finishCurrent();
      current = {
        examId,
        type: questionTypeFromText(typeMatch[1]),
        body: "",
        options: [],
        answerKey: "",
        correctAnswers: [],
        score: 1
      };
      section = "body";
      activeOptionKey = "";
    } else if (current && questionLabelMatch) {
      section = "body";
      activeOptionKey = "";
      if (questionLabelMatch[1]) current.body = questionLabelMatch[1];
    } else if (current && optionMatch) {
      activeOptionKey = optionMatch[1].toUpperCase();
      section = "option";
      current.options.push({ key: activeOptionKey, text: optionMatch[2] || "" });
    } else if (current && keyMatch) {
      const keys = splitAnswerKeys(keyMatch[2]);
      current.correctAnswers = keys;
      current.answerKey = keys[0] || "";
      if (keys.length > 1) current.type = "multiple_response";
      section = "";
      activeOptionKey = "";
    } else if (current && scoreMatch) {
      current.score = Number(scoreMatch[2].replace(",", ".")) || 1;
      section = "";
      activeOptionKey = "";
    } else if (current) {
      if (section === "option" && activeOptionKey) {
        const option = current.options.find((item) => item.key === activeOptionKey);
        if (option) option.text = `${option.text}${option.text ? "\n" : ""}${line}`;
      } else {
        current.body = `${current.body}${current.body ? "\n" : ""}${line}`;
      }
    }
  }

  finishCurrent();
  return questions;
}

function parseLegacyQuestionText(lines, examId) {
  const questions = [];
  let current = null;
  let activeOptionKey = "";

  function finishCurrent() {
    if (!current) return;
    current.body = current.body.trim();
    current.options = current.options.map((option) => ({ ...option, text: option.text.trim() })).filter((option) => option.text);
    if (current.body && current.options.length >= 2 && current.answerKey) {
      questions.push(current);
    }
  }

  for (const line of lines) {
    const questionMatch = line.match(/^\d+[\).]\s*(.+)$/);
    const optionMatch = line.match(/^([A-E])[\).]\s*(.*)$/i);
    const keyMatch = line.match(/^(kunci|jawaban|answer)\s*[:=]?\s*([A-E])\b/i);
    const scoreMatch = line.match(/^(bobot|skor|score)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);

    if (questionMatch) {
      finishCurrent();
      current = {
        examId,
        type: "multiple_choice",
        body: questionMatch[1],
        options: [],
        answerKey: "",
        correctAnswers: [],
        score: 1
      };
      activeOptionKey = "";
    } else if (current && optionMatch) {
      activeOptionKey = optionMatch[1].toUpperCase();
      current.options.push({ key: activeOptionKey, text: optionMatch[2] || "" });
    } else if (current && keyMatch) {
      current.answerKey = keyMatch[2].toUpperCase();
      current.correctAnswers = [current.answerKey];
      activeOptionKey = "";
    } else if (current && scoreMatch) {
      current.score = Number(scoreMatch[2].replace(",", ".")) || 1;
      activeOptionKey = "";
    } else if (current && activeOptionKey) {
      const option = current.options.find((item) => item.key === activeOptionKey);
      if (option) option.text = `${option.text}${option.text ? "\n" : ""}${line}`;
    } else if (current) {
      current.body = `${current.body}\n${line}`;
    }
  }

  finishCurrent();
  return questions;
}

function readQuestionCell(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function parseQuestionRows(rows, examId) {
  return rows.map((row) => {
    const typeText = readQuestionCell(row, ["tipe", "Tipe", "type", "Type", "jenis", "Jenis"]);
    const answerRaw = readQuestionCell(row, ["kunci", "Kunci", "kunci_jawaban", "Kunci Jawaban", "answerKey", "answer_key", "jawaban"]);
    const correctAnswers = splitAnswerKeys(answerRaw);
    const type = questionTypeFromText(typeText || (correctAnswers.length > 1 ? "checklist" : "pg"));
    const body = readQuestionCell(row, ["soal", "Soal", "pertanyaan", "Pertanyaan", "question", "Question", "body"]);
    const scoreText = readQuestionCell(row, ["bobot", "Bobot", "skor", "Skor", "score", "Score"]);
    const options = OPTION_KEYS.map((key) => ({
      key,
      text: readQuestionCell(row, [
        `opsi_${key.toLowerCase()}`,
        `opsi${key}`,
        `Opsi ${key}`,
        `Opsi_${key}`,
        `option_${key.toLowerCase()}`,
        `option${key}`,
        key
      ])
    })).filter((option) => option.text);
    return {
      examId,
      type,
      body,
      options,
      answerKey: correctAnswers[0] || "",
      correctAnswers,
      score: Number(String(scoreText || "1").replace(",", ".")) || 1
    };
  }).filter((question) => question.body && question.options.length >= 2 && (question.type === "multiple_response" ? question.correctAnswers.length : question.answerKey));
}

function formatElectiveSubjects(student) {
  return Array.isArray(student.electiveSubjects) ? student.electiveSubjects : [];
}

function formatReligion(student) {
  return String(student?.religion || student?.agama || "").trim();
}

function formatResultStatus(status) {
  const labels = {
    not_started: "Belum Mengerjakan",
    in_progress: "Sedang Mengerjakan",
    force_finishing: "Mengakhiri",
    submitted: "Selesai"
  };
  return labels[status] || status || "-";
}

function formatScheduleStatus(status) {
  const labels = {
    draft: "Belum dipublish",
    closed: "Ditutup admin",
    upcoming: "Belum dibuka",
    active: "Sedang berlangsung",
    ended: "Waktu berakhir",
    invalid_schedule: "Jadwal belum lengkap"
  };
  return labels[status] || status || "-";
}

function scheduleStatusClass(status) {
  if (status === "active") return "status-pill selected";
  if (status === "upcoming") return "status-pill revision";
  return "status-pill";
}

function formatRemainingTime(totalMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(totalMs || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${Math.round((value / 1024 / 1024) * 100) / 100} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function resultStatusClass(status) {
  if (status === "submitted") return "status-pill selected";
  if (status === "force_finishing") return "status-pill danger";
  if (status === "in_progress") return "status-pill revision";
  return "status-pill";
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
}

const OPTION_KEYS = ["A", "B", "C", "D", "E"];
const RELIGION_OPTIONS = ["Islam", "Kristen", "Katolik", "Hindu", "Buddha", "Konghucu", "Lainnya"];
const QUESTION_TYPES = [
  { value: "multiple_choice", label: "Pilihan Ganda" },
  { value: "multiple_response", label: "Pilihan Ganda Kompleks / Checklist" },
  { value: "true_false", label: "Benar / Salah Pernyataan" },
  { value: "matching", label: "Menjodohkan" },
  { value: "short_answer", label: "Isian Singkat" },
  { value: "essay", label: "Uraian / Isian Panjang" }
];

const DEFAULT_ANSWER_RULES = { caseSensitive: false, ignorePunctuation: true, trimSpaces: true };

function createDefaultQuestion(examId = "") {
  return {
    examId,
    type: "multiple_choice",
    body: "",
    image: "",
    answerKey: "A",
    correctAnswers: [],
    score: 1,
    options: OPTION_KEYS.map((key) => ({ key, text: "", image: "" })),
    statements: [
      { id: "st-1", text: "", image: "", answer: "true" },
      { id: "st-2", text: "", image: "", answer: "false" }
    ],
    pairs: [
      { id: "pair-1", left: "", right: "", leftImage: "", rightImage: "" },
      { id: "pair-2", left: "", right: "", leftImage: "", rightImage: "" }
    ],
    shortAnswers: [""],
    answerRules: { ...DEFAULT_ANSWER_RULES }
  };
}

function normalizeQuestionForForm(question, fallbackExamId = "") {
  return {
    ...createDefaultQuestion(fallbackExamId),
    ...question,
    examId: question.examId || fallbackExamId,
    type: question.type || "multiple_choice",
    image: question.image || "",
    options: Array.isArray(question.options) && question.options.length
      ? question.options.map((option) => ({ key: option.key, text: option.text || "", image: option.image || "" }))
      : createDefaultQuestion(fallbackExamId).options,
    correctAnswers: Array.isArray(question.correctAnswers) ? question.correctAnswers : [],
    statements: Array.isArray(question.statements) && question.statements.length ? question.statements : createDefaultQuestion(fallbackExamId).statements,
    pairs: Array.isArray(question.pairs) && question.pairs.length ? question.pairs : createDefaultQuestion(fallbackExamId).pairs,
    shortAnswers: Array.isArray(question.shortAnswers) && question.shortAnswers.length ? question.shortAnswers : [""],
    answerRules: { ...DEFAULT_ANSWER_RULES, ...(question.answerRules || {}) }
  };
}

function cleanQuestionForSubmit(form) {
  const cleanOptions = (form.options || []).filter((option) => option.text.trim() || option.image);
  const payload = {
    ...form,
    score: Number(String(form.score || 1).replace(",", ".")),
    options: cleanOptions,
    correctAnswers: form.correctAnswers || [],
    statements: (form.statements || []).filter((statement) => statement.text.trim() || statement.image),
    pairs: (form.pairs || []).filter((pair) => (pair.left.trim() || pair.leftImage) && (pair.right.trim() || pair.rightImage)),
    shortAnswers: (form.shortAnswers || []).map((item) => item.trim()).filter(Boolean),
    answerRules: { ...DEFAULT_ANSWER_RULES, ...(form.answerRules || {}) }
  };
  if (!payload.options.some((option) => option.key === payload.answerKey)) {
    payload.answerKey = payload.options[0]?.key || "A";
  }
  payload.correctAnswers = payload.correctAnswers.filter((key) => payload.options.some((option) => option.key === key));
  return payload;
}

function questionTypeLabel(type) {
  return QUESTION_TYPES.find((item) => item.value === type)?.label || "Pilihan Ganda";
}

function displayOptionLabel(index) {
  return OPTION_KEYS[index] || String(index + 1);
}

function compareSortValues(leftValue, rightValue) {
  const left = leftValue ?? "";
  const right = rightValue ?? "";
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "id", { numeric: true, sensitivity: "base" });
}

function applyTableSort(items, sort, resolvers) {
  if (!sort?.key || !resolvers?.[sort.key]) return items;
  const direction = sort.direction === "desc" ? -1 : 1;
  return [...items].sort((left, right) => {
    const result = compareSortValues(resolvers[sort.key](left), resolvers[sort.key](right));
    return result * direction;
  });
}

function toggleTableSort(current, key) {
  if (current?.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

function SortHeader({ sort, sortKey, onSort, children }) {
  const active = sort?.key === sortKey;
  return (
    <button type="button" className={`table-sort-button${active ? " active" : ""}`} onClick={() => onSort(sortKey)}>
      {children}{active ? ` ${sort.direction === "asc" ? "ASC" : "DESC"}` : ""}
    </button>
  );
}

async function compressImageFile(file, maxBytes = 500 * 1024, maxWidth = 1200) {
  if (!file.type.startsWith("image/")) throw new Error("File harus berupa gambar.");
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gambar tidak dapat dibaca."));
    img.src = dataUrl;
  });

  let width = Math.min(image.width, maxWidth);
  let height = Math.round(image.height * (width / image.width));
  let quality = 0.86;
  let bestBlob = null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  for (let step = 0; step < 18; step += 1) {
    canvas.width = Math.max(320, Math.round(width));
    canvas.height = Math.max(180, Math.round(height));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (blob) bestBlob = blob;
    if (blob && blob.size <= maxBytes) break;
    if (quality > 0.48) quality -= 0.08;
    else {
      width *= 0.86;
      height *= 0.86;
      quality = 0.72;
    }
  }

  if (!bestBlob) throw new Error("Gambar gagal dikompres.");
  if (bestBlob.size > maxBytes) throw new Error("Gambar masih terlalu besar setelah dikompres. Coba gunakan gambar dengan resolusi lebih kecil.");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result, size: bestBlob.size, width: canvas.width, height: canvas.height });
    reader.onerror = reject;
    reader.readAsDataURL(bestBlob);
  });
}

function timeToMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  const minutesInDay = 24 * 60;
  const safeMinutes = ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay;
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function deriveEndTime(startTime, durationMinutes) {
  const start = timeToMinutes(startTime);
  const duration = Number(durationMinutes);
  if (start === null || !Number.isFinite(duration)) return "";
  return minutesToTime(start + duration);
}

function deriveDurationMinutes(startTime, endTime, fallback = 90) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null) return Number(fallback) || 90;
  const diff = end >= start ? end - start : end + 24 * 60 - start;
  return diff || Number(fallback) || 90;
}

function formatExamTimeRange(exam) {
  const endTime = exam.endTime || deriveEndTime(exam.startTime, exam.durationMinutes);
  return endTime ? `${exam.startTime} - ${endTime}` : exam.startTime;
}

function localDateKey(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function examDateTimeMs(date, time) {
  if (!date || !time) return null;
  const timestamp = new Date(`${date}T${time}:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getExamScheduleMeta(exam, now = new Date()) {
  const startMs = examDateTimeMs(exam.date, exam.startTime);
  const endTime = exam.endTime || deriveEndTime(exam.startTime, exam.durationMinutes);
  const endMs = examDateTimeMs(exam.date, endTime);
  let status = exam.status === "published" ? "active" : exam.status || "draft";
  if (exam.status === "draft") status = "draft";
  else if (exam.status === "closed") status = "closed";
  else if (!startMs || !endMs) status = "invalid_schedule";
  else if (now.getTime() < startMs) status = "upcoming";
  else if (now.getTime() >= endMs) status = "ended";
  return {
    status,
    startMs,
    endMs,
    endTime,
    remainingMs: status === "active" && endMs ? Math.max(0, endMs - now.getTime()) : 0
  };
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString("id-ID") : "-";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function excelCellValue(cell) {
  return cell && typeof cell === "object" && "value" in cell ? cell.value : cell;
}

function excelCellStyle(cell) {
  if (!cell || typeof cell !== "object") return "";
  const style = cell.style || {};
  const parts = Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}:${value}`);
  return parts.length ? ` style="${escapeHtml(parts.join(";"))}"` : "";
}

function renderExcelCell(tag, cell) {
  return `<${tag}${excelCellStyle(cell)}>${escapeHtml(excelCellValue(cell))}</${tag}>`;
}

function downloadHtmlExcel({ filename, sheetTitle, headers, rows }) {
  const tableRows = [
    `<tr>${headers.map((header) => renderExcelCell("th", header)).join("")}</tr>`,
    ...rows.map((row) => `<tr>${row.map((cell) => renderExcelCell("td", cell)).join("")}</tr>`)
  ].join("");
  const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body><h2>${escapeHtml(sheetTitle)}</h2><table border="1">${tableRows}</table></body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

const REVIEW_STATUS_LABELS = {
  unreviewed: "Belum Dicek",
  reviewed: "Sudah Dicek",
  needs_revision: "Perlu Revisi"
};

function formatReviewStatus(status) {
  return REVIEW_STATUS_LABELS[status] || REVIEW_STATUS_LABELS.unreviewed;
}

function reviewStatusClass(status) {
  if (status === "reviewed") return "status-pill selected";
  if (status === "needs_revision") return "status-pill revision";
  return "status-pill";
}

function ReviewStatusIcon({ status }) {
  const label = formatReviewStatus(status);
  const reviewed = status === "reviewed";
  const Icon = reviewed ? CheckCircle2 : AlertTriangle;
  return (
    <span className={`review-status-icon ${reviewed ? "reviewed" : "warning"}`} title={label} aria-label={label}>
      <Icon size={18} />
    </span>
  );
}

function formatExamStatus(status) {
  const labels = {
    published: "Published",
    closed: "Closed",
    draft: "Draft"
  };
  return labels[status] || status || "-";
}

function examStatusClass(status) {
  if (status === "published") return "status-pill selected";
  if (status === "closed") return "status-pill danger";
  return "status-pill";
}

function downloadStudentTemplate() {
  const headers = ["nis", "nisn", "name", "gender", "agama", "className", "username", "password", "Mapel Pilihan 1", "Mapel Pilihan 2", "Mapel Pilihan 3", "Mapel Pilihan 4", "Mapel Pilihan 5"];
  const rows = [
    ["10676", "0062721508", "AGISFA ROCHMANY ALFATH", "L", "Islam", "XII.2", "10676", "", "Informatika 2", "Sejarah TL 2", "", "", ""],
    ["10690", "0061606839", "AMELIA RASHEEDAH", "P", "Kristen", "XII.3", "10690", "", "Sejarah TL 1", "Sosiologi 1", "", "", ""]
  ];
  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll("\"", "\"\"")}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "contoh-import-siswa-cbt.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function downloadTeacherTemplate() {
  const headers = ["name", "username", "password", "Mapel 1", "Mapel 2", "Mapel 3", "Mapel 4", "Mapel 5"];
  const rows = [
    ["Ibu Zuyun", "zuyun", "zuyun123", "Informatika", "Matematika", "", "", ""],
    ["Bapak Rojak", "rojak", "rojak123", "Matematika TL", "Bahasa Indonesia", "", "", ""],
    ["Bapak Sidiq", "sidiq", "sidiq123", "Informatika", "Bahasa Inggris", "Agama", "", ""],
    ["Ibu Vidia", "vidia", "vidia123", "Biologi", "", "", "", ""]
  ];
  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll("\"", "\"\"")}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "contoh-import-guru-cbt.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function zipBytes(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = (value) => new Uint8Array([value & 255, (value >>> 8) & 255]);
  const u32 = (value) => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
  const push = (target, ...parts) => {
    for (const part of parts) target.push(part);
  };
  const lengthOf = (parts) => parts.reduce((sum, part) => sum + part.length, 0);

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const localOffset = offset;
    const localHeader = [
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data
    ];
    push(chunks, ...localHeader);
    offset += lengthOf(localHeader);
    push(central,
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(localOffset), name
    );
  }

  const centralSize = lengthOf(central);
  const end = [
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralSize), u32(offset), u16(0)
  ];
  return new Blob([...chunks, ...central, ...end], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

function downloadQuestionWordTemplate() {
  const paragraphs = [
    "TEMPLATE IMPORT SOAL CBT SMAN 94",
    "",
    "PETUNJUK",
    "1. Gunakan [TIPE: PG] untuk pilihan ganda biasa.",
    "2. Gunakan [TIPE: CHECKLIST] untuk pilihan ganda kompleks yang jawabannya lebih dari satu.",
    "3. Kunci checklist ditulis dengan koma, contoh: Kunci: A, C, E.",
    "4. Bobot boleh menggunakan koma/desimal, contoh: Bobot: 2.5.",
    "5. Untuk tahap ini gambar bisa ditambahkan setelah import lewat editor soal aplikasi.",
    "",
    "[TIPE: PG]",
    "Soal:",
    "Apa yang dimaksud dengan literasi digital?",
    "",
    "A. Kemampuan membaca dan menulis di perangkat digital.",
    "B. Kemampuan menggunakan internet untuk belanja online.",
    "C. Kemampuan memahami dan menggunakan informasi digital secara efektif.",
    "D. Kemampuan mengunduh aplikasi dari internet.",
    "E. Kemampuan bermain game online.",
    "",
    "Kunci: C",
    "Bobot: 2.5",
    "",
    "[TIPE: CHECKLIST]",
    "Soal:",
    "Manakah pernyataan yang benar tentang keamanan digital?",
    "",
    "A. Password sebaiknya dibuat berbeda untuk setiap akun.",
    "B. OTP boleh dibagikan kepada teman dekat.",
    "C. Verifikasi dua langkah dapat meningkatkan keamanan akun.",
    "D. Link mencurigakan sebaiknya langsung dibuka tanpa dicek.",
    "E. Data pribadi sebaiknya tidak disebarkan sembarangan.",
    "",
    "Kunci: A, C, E",
    "Bobot: 3"
  ];
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`).join("\n    ")}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
  const blob = zipBytes([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/document.xml", content: documentXml }
  ]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "template-import-soal-cbt.docx";
  link.click();
  URL.revokeObjectURL(url);
}

function downloadQuestionTemplate() {
  const headers = ["tipe", "soal", "opsi_a", "opsi_b", "opsi_c", "opsi_d", "opsi_e", "kunci", "bobot"];
  const rows = [
    ["PG", "Apa yang dimaksud dengan literasi digital?", "Kemampuan membaca dan menulis di perangkat digital.", "Kemampuan belanja online.", "Kemampuan memahami dan menggunakan informasi digital secara efektif.", "Kemampuan mengunduh aplikasi.", "Kemampuan bermain game online.", "C", "2.5"],
    ["CHECKLIST", "Manakah pernyataan yang benar tentang keamanan digital?", "Password berbeda untuk setiap akun.", "OTP boleh dibagikan.", "Verifikasi dua langkah meningkatkan keamanan.", "Link mencurigakan langsung dibuka.", "Data pribadi tidak disebar sembarangan.", "A,C,E", "3"]
  ];
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "contoh-import-soal-cbt.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function getPageItems(items, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    currentPage: safePage,
    totalPages,
    start,
    end: Math.min(start + pageSize, items.length),
    items: items.slice(start, start + pageSize)
  };
}

function Modal({ title, icon: Icon, children, onClose, wide = false }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className={`modal-panel${wide ? " modal-wide" : ""}`}>
        <div className="modal-head">
          <PanelTitle icon={Icon} title={title} />
          <button type="button" className="ghost-button" onClick={onClose}>Keluar</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function PaginationControls({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [25, 50, 75, 100], itemLabel = "data", compact = false }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total ? (Math.min(page, totalPages) - 1) * pageSize + 1 : 0;
  const end = Math.min(Math.min(page, totalPages) * pageSize, total);

  return (
    <div className={`pagination-bar${compact ? " pagination-compact" : ""}`}>
      <span>{start}-{end} dari {total} {itemLabel}</span>
      <div className="pagination-actions">
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {pageSizeOptions.map((size) => <option value={size} key={size}>{compact ? `${size} / Hal` : `${size}/halaman`}</option>)}
        </select>
        <button type="button" className="ghost-button page-symbol-button" title="Halaman sebelumnya" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          {compact ? "<<" : "Sebelumnya"}
        </button>
        <code>{Math.min(page, totalPages)} / {totalPages}</code>
        <button type="button" className="ghost-button page-symbol-button" title="Halaman berikutnya" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          {compact ? ">>" : "Berikutnya"}
        </button>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="stat-card" title={label}>
      <div className="stat-icon"><Icon size={20} /></div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function Login({ onLogin }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api("/login", { method: "POST", body: JSON.stringify(form) });
      saveSession(result);
      onLogin(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-row">
          <div className="brand-mark"><ShieldCheck size={28} /></div>
          <div>
            <h1>CBT SMAN 94</h1>
            <p>Masukkan username dan password akun ujian.</p>
          </div>
        </div>
        <form onSubmit={submit} className="login-form">
          <label>
            Username
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </label>
          <label>
            Password
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          {error ? <div className="error-box">{error}</div> : null}
          <button type="submit" disabled={loading}>
            <KeyRound size={18} />
            {loading ? "Memeriksa..." : "Masuk"}
          </button>
        </form>
      </section>
    </main>
  );
}

function BrowserAccessGate({ user, onAuthorized, onLogout }) {
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const accessState = user.accessState || {};
  const strictMode = accessState.mode === "strict";

  async function submit(event) {
    event.preventDefault();
    setNotice("");
    setLoading(true);
    try {
      const result = await api("/browser-access/authorize", {
        method: "POST",
        body: JSON.stringify({ token })
      });
      const currentSession = readSession();
      const nextSession = { ...currentSession, user: result.user };
      saveSession(nextSession);
      onAuthorized(result.user);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel access-gate-panel">
        <div className="brand-row">
          <div className="brand-mark"><ShieldCheck size={28} /></div>
          <div>
            <h1>Akses Peserta</h1>
            <p>{user.name}</p>
          </div>
        </div>
        {strictMode ? (
          <div className="error-box">
            Akun siswa hanya bisa membuka ujian melalui Exam Browser resmi sekolah. Silakan buka aplikasi CBT SMAN 94.
          </div>
        ) : (
          <form className="login-form" onSubmit={submit}>
            <div className="info-box">Browser biasa membutuhkan Token Akses Browser dari admin/pengawas. Jika memakai Exam Browser resmi, token ini tidak diperlukan.</div>
            <label>
              Token Akses Browser
              <input value={token} onChange={(event) => setToken(event.target.value.toUpperCase())} placeholder="Contoh: BRW-ABC123" required />
            </label>
            {notice ? <div className="error-box">{notice}</div> : null}
            <button type="submit" disabled={loading}>{loading ? "Memeriksa..." : "Masuk Portal"}</button>
          </form>
        )}
        <button type="button" className="ghost-button full-button" onClick={onLogout}>Keluar Akun</button>
      </section>
    </main>
  );
}

function AccessControlPanel({ accessControl, onChanged }) {
  const [mode, setMode] = useState(accessControl?.studentMode || "browser_token");
  const [expiresMinutes, setExpiresMinutes] = useState(60);
  const [label, setLabel] = useState("Token Ulangan");
  const [notice, setNotice] = useState("");
  const tokens = accessControl?.browserTokens || [];
  const activeTokens = tokens.filter((token) => token.active && (!token.expiresAt || new Date(token.expiresAt).getTime() > Date.now()));

  useEffect(() => {
    setMode(accessControl?.studentMode || "browser_token");
  }, [accessControl?.studentMode]);

  async function saveMode(nextMode = mode) {
    setNotice("");
    const result = await api("/access-control", {
      method: "PUT",
      body: JSON.stringify({ studentMode: nextMode })
    });
    setNotice("Mode akses peserta diperbarui.");
    await onChanged(result);
  }

  async function createToken() {
    setNotice("");
    const result = await api("/access-control/browser-tokens", {
      method: "POST",
      body: JSON.stringify({ label, expiresMinutes })
    });
    setNotice("Token Akses Browser baru dibuat.");
    await onChanged(result);
  }

  async function revokeToken(tokenId) {
    const result = await api(`/access-control/browser-tokens/${tokenId}/revoke`, { method: "POST" });
    setNotice("Token Akses Browser dicabut.");
    await onChanged(result);
  }

  return (
    <section className="panel">
      <PanelTitle icon={ShieldCheck} title="Akses Peserta" />
      <div className="access-control-panel">
        <label>
          Mode akses siswa
          <select value={mode} onChange={(event) => { setMode(event.target.value); saveMode(event.target.value); }}>
            <option value="strict">Wajib Exam Browser</option>
            <option value="browser_token">Exam Browser / Token Browser</option>
            <option value="open">Terbuka Sementara</option>
          </select>
        </label>
        <p className="muted">Exam Browser resmi tidak perlu token. Browser biasa hanya diizinkan jika mode memakai token atau terbuka sementara.</p>
        <div className="token-create-grid">
          <label>Nama token<input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
          <label>Berlaku menit<input type="number" min="5" max="1440" value={expiresMinutes} onChange={(event) => setExpiresMinutes(event.target.value)} /></label>
          <button type="button" onClick={createToken}>Buat Token</button>
        </div>
        {notice ? <div className="success-box">{notice}</div> : null}
        <div className="browser-token-list">
          {activeTokens.length ? activeTokens.map((token) => (
            <article className="browser-token-item" key={token.id}>
              <div>
                <strong>{token.token}</strong>
                <span>{token.label} | Berlaku sampai {formatDateTime(token.expiresAt)}</span>
              </div>
              <button type="button" className="ghost-button small-button" onClick={() => revokeToken(token.id)}>Cabut</button>
            </article>
          )) : <p className="muted">Belum ada token browser aktif.</p>}
        </div>
      </div>
    </section>
  );
}

function ExamSettingsPanel({ examSettings, onChanged }) {
  const settings = examSettings || {};
  const activeToken = settings.activeToken || {};
  const [form, setForm] = useState({
    examWithoutToken: !!settings.examWithoutToken,
    tokenIntervalMinutes: settings.tokenIntervalMinutes || 15,
    submitUnlockMinutes: settings.submitUnlockMinutes ?? 30,
    autoSubmitOnEnd: settings.autoSubmitOnEnd !== false,
    requireReviewBeforePublish: !!settings.requireReviewBeforePublish,
    requireWeight100BeforePublish: !!settings.requireWeight100BeforePublish,
    showStudentScores: settings.showStudentScores !== false,
    defaultRandomizeQuestions: settings.defaultRandomizeQuestions !== false,
    defaultRandomizeOptions: settings.defaultRandomizeOptions !== false,
    answerSyncMode: settings.answerSyncMode || "extra_high",
    heartbeatEnabled: settings.heartbeatEnabled !== false,
    heartbeatIntervalSeconds: settings.heartbeatIntervalSeconds ?? 30,
    heartbeatJitterSeconds: settings.heartbeatJitterSeconds ?? 10,
    autosaveBatchSize: settings.autosaveBatchSize ?? 3,
    autosaveIntervalSeconds: settings.autosaveIntervalSeconds ?? 20,
    monitoringRefreshSeconds: settings.monitoringRefreshSeconds ?? 10,
    progressiveSoftLimitBytes: settings.progressiveSoftLimitBytes ?? 1024 * 1024,
    progressiveHardLimitBytes: settings.progressiveHardLimitBytes ?? 2 * 1024 * 1024,
    progressiveParticipantLimit: settings.progressiveParticipantLimit ?? 100,
    questionPrefetchCount: settings.questionPrefetchCount ?? 2
  });
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setForm({
      examWithoutToken: !!settings.examWithoutToken,
      tokenIntervalMinutes: settings.tokenIntervalMinutes || 15,
      submitUnlockMinutes: settings.submitUnlockMinutes ?? 30,
      autoSubmitOnEnd: settings.autoSubmitOnEnd !== false,
      requireReviewBeforePublish: !!settings.requireReviewBeforePublish,
      requireWeight100BeforePublish: !!settings.requireWeight100BeforePublish,
      showStudentScores: settings.showStudentScores !== false,
      defaultRandomizeQuestions: settings.defaultRandomizeQuestions !== false,
      defaultRandomizeOptions: settings.defaultRandomizeOptions !== false,
      answerSyncMode: settings.answerSyncMode || "extra_high",
      heartbeatEnabled: settings.heartbeatEnabled !== false,
      heartbeatIntervalSeconds: settings.heartbeatIntervalSeconds ?? 30,
      heartbeatJitterSeconds: settings.heartbeatJitterSeconds ?? 10,
      autosaveBatchSize: settings.autosaveBatchSize ?? 3,
      autosaveIntervalSeconds: settings.autosaveIntervalSeconds ?? 20,
      monitoringRefreshSeconds: settings.monitoringRefreshSeconds ?? 10,
      progressiveSoftLimitBytes: settings.progressiveSoftLimitBytes ?? 1024 * 1024,
      progressiveHardLimitBytes: settings.progressiveHardLimitBytes ?? 2 * 1024 * 1024,
      progressiveParticipantLimit: settings.progressiveParticipantLimit ?? 100,
      questionPrefetchCount: settings.questionPrefetchCount ?? 2
    });
  }, [
    settings.examWithoutToken,
    settings.tokenIntervalMinutes,
    settings.submitUnlockMinutes,
    settings.autoSubmitOnEnd,
    settings.requireReviewBeforePublish,
    settings.requireWeight100BeforePublish,
    settings.showStudentScores,
    settings.defaultRandomizeQuestions,
    settings.defaultRandomizeOptions,
    settings.answerSyncMode,
    settings.heartbeatEnabled,
    settings.heartbeatIntervalSeconds,
    settings.heartbeatJitterSeconds,
    settings.autosaveBatchSize,
    settings.autosaveIntervalSeconds,
    settings.monitoringRefreshSeconds,
    settings.progressiveSoftLimitBytes,
    settings.progressiveHardLimitBytes,
    settings.progressiveParticipantLimit,
    settings.questionPrefetchCount
  ]);

  async function save(nextForm = form) {
    setNotice("");
    const result = await api("/exam-settings", {
      method: "PUT",
      body: JSON.stringify(nextForm)
    });
    setNotice("Pengaturan ujian berhasil disimpan.");
    await onChanged(result);
  }

  async function regenerateToken() {
    const result = await api("/exam-settings/token/regenerate", { method: "POST" });
    setNotice("Token ujian global berhasil digenerate ulang.");
    await onChanged(result);
  }

  function update(key, value) {
    const next = { ...form, [key]: value };
    setForm(next);
    save(next).catch((error) => setNotice(error.message));
  }

  return (
    <div className="settings-stack">
      <section className="panel">
        <PanelTitle icon={KeyRound} title="Token Ujian Global" />
        <div className="settings-grid">
          <label>
            Ujian tanpa token
            <select value={form.examWithoutToken ? "yes" : "no"} onChange={(event) => update("examWithoutToken", event.target.value === "yes")}>
              <option value="no">Tidak</option>
              <option value="yes">Ya</option>
            </select>
          </label>
          <label>
            Interval token
            <select value={form.tokenIntervalMinutes} onChange={(event) => update("tokenIntervalMinutes", Number(event.target.value))} disabled={form.examWithoutToken}>
              <option value={15}>15 menit</option>
              <option value={30}>30 menit</option>
              <option value={45}>45 menit</option>
              <option value={60}>60 menit</option>
            </select>
          </label>
        </div>
        <div className="token-display-panel">
          <div>
            <span>Token aktif</span>
            <strong>{form.examWithoutToken ? "Tanpa Token" : activeToken.token || "-"}</strong>
          </div>
          <div>
            <span>Berubah berikutnya</span>
            <strong>{form.examWithoutToken ? "-" : formatDateTime(activeToken.nextChangeAt)}</strong>
          </div>
          <button type="button" className="ghost-button" onClick={regenerateToken} disabled={form.examWithoutToken}>Generate Sekarang</button>
        </div>
        <p className="muted">Token ini berlaku untuk semua mata pelajaran yang sedang aktif pada jadwal yang sama.</p>
        {notice ? <div className={notice.includes("gagal") ? "error-box" : "success-box"}>{notice}</div> : null}
      </section>

      <section className="panel">
        <PanelTitle icon={ClipboardList} title="Aturan Ujian dan Publish" />
        <div className="settings-grid">
          <label>
            Submit tersedia
            <select value={form.submitUnlockMinutes} onChange={(event) => update("submitUnlockMinutes", Number(event.target.value))}>
              <option value={15}>15 menit terakhir</option>
              <option value={30}>30 menit terakhir</option>
              <option value={45}>45 menit terakhir</option>
              <option value={60}>60 menit terakhir</option>
            </select>
          </label>
          <label>
            Auto-submit saat waktu habis
            <select value={form.autoSubmitOnEnd ? "yes" : "no"} onChange={(event) => update("autoSubmitOnEnd", event.target.value === "yes")}>
              <option value="yes">Ya</option>
              <option value="no">Tidak</option>
            </select>
          </label>
          <label>
            Wajib review sebelum publish
            <select value={form.requireReviewBeforePublish ? "yes" : "no"} onChange={(event) => update("requireReviewBeforePublish", event.target.value === "yes")}>
              <option value="no">Tidak</option>
              <option value="yes">Ya</option>
            </select>
          </label>
          <label>
            Wajib bobot 100 sebelum publish
            <select value={form.requireWeight100BeforePublish ? "yes" : "no"} onChange={(event) => update("requireWeight100BeforePublish", event.target.value === "yes")}>
              <option value="no">Tidak</option>
              <option value="yes">Ya</option>
            </select>
          </label>
          <label>
            Tampilkan nilai ke siswa
            <select value={form.showStudentScores ? "yes" : "no"} onChange={(event) => update("showStudentScores", event.target.value === "yes")}>
              <option value="yes">Ya</option>
              <option value="no">Tidak</option>
            </select>
          </label>
          <label className="check-row"><input type="checkbox" checked={form.defaultRandomizeQuestions} onChange={(event) => update("defaultRandomizeQuestions", event.target.checked)} /> Default acak soal</label>
          <label className="check-row"><input type="checkbox" checked={form.defaultRandomizeOptions} onChange={(event) => update("defaultRandomizeOptions", event.target.checked)} /> Default acak opsi</label>
        </div>
        <p className="muted">Pengaturan default berlaku untuk ujian baru. Ujian lama tetap memakai pengaturan yang sudah tersimpan di paket ujian masing-masing.</p>
      </section>

      <section className="panel">
        <PanelTitle icon={MonitorSmartphone} title="Performa dan Pengiriman Data" />
        <div className="settings-grid">
          <label>
            Mode simpan jawaban
            <select value={form.answerSyncMode} onChange={(event) => update("answerSyncMode", event.target.value)}>
              <option value="extra_high">Extra High Stability</option>
              <option value="balanced">Seimbang</option>
            </select>
          </label>
          <label>
            Heartbeat peserta
            <select value={form.heartbeatEnabled ? "yes" : "no"} onChange={(event) => update("heartbeatEnabled", event.target.value === "yes")}>
              <option value="no">Nonaktif</option>
              <option value="yes">Aktif</option>
            </select>
          </label>
          <label>
            Interval heartbeat
            <select value={form.heartbeatIntervalSeconds} onChange={(event) => update("heartbeatIntervalSeconds", Number(event.target.value))}>
              <option value={15}>15 detik</option>
              <option value={20}>20 detik</option>
              <option value={30}>30 detik</option>
              <option value={45}>45 detik</option>
              <option value={60}>60 detik</option>
            </select>
          </label>
          <label>
            Jeda acak heartbeat
            <select value={form.heartbeatJitterSeconds} onChange={(event) => update("heartbeatJitterSeconds", Number(event.target.value))}>
              <option value={0}>Tanpa jitter</option>
              <option value={5}>0-5 detik</option>
              <option value={10}>0-10 detik</option>
              <option value={15}>0-15 detik</option>
            </select>
          </label>
          <label>
            Autosave setelah
            <select value={form.autosaveBatchSize} onChange={(event) => update("autosaveBatchSize", Number(event.target.value))} disabled={form.answerSyncMode === "extra_high"}>
              <option value={1}>1 jawaban berubah</option>
              <option value={3}>3 jawaban berubah</option>
              <option value={5}>5 jawaban berubah</option>
              <option value={10}>10 jawaban berubah</option>
            </select>
          </label>
          <label>
            Autosave berkala
            <select value={form.autosaveIntervalSeconds} onChange={(event) => update("autosaveIntervalSeconds", Number(event.target.value))} disabled={form.answerSyncMode === "extra_high"}>
              <option value={10}>10 detik</option>
              <option value={15}>15 detik</option>
              <option value={20}>20 detik</option>
              <option value={30}>30 detik</option>
              <option value={60}>60 detik</option>
            </select>
          </label>
          <label>
            Refresh monitoring
            <select value={form.monitoringRefreshSeconds} onChange={(event) => update("monitoringRefreshSeconds", Number(event.target.value))}>
              <option value={5}>5 detik</option>
              <option value={10}>10 detik</option>
              <option value={15}>15 detik</option>
              <option value={30}>30 detik</option>
              <option value={60}>60 detik</option>
            </select>
          </label>
          <label>
            Mode bertahap mulai
            <select value={form.progressiveSoftLimitBytes} onChange={(event) => update("progressiveSoftLimitBytes", Number(event.target.value))}>
              <option value={512000}>500 KB</option>
              <option value={1048576}>1 MB</option>
              <option value={2097152}>2 MB</option>
            </select>
          </label>
          <label>
            Wajib bertahap
            <select value={form.progressiveHardLimitBytes} onChange={(event) => update("progressiveHardLimitBytes", Number(event.target.value))}>
              <option value={1048576}>1 MB</option>
              <option value={2097152}>2 MB</option>
              <option value={5242880}>5 MB</option>
            </select>
          </label>
          <label>
            Peserta mulai bertahap
            <select value={form.progressiveParticipantLimit} onChange={(event) => update("progressiveParticipantLimit", Number(event.target.value))}>
              <option value={50}>50 peserta</option>
              <option value={100}>100 peserta</option>
              <option value={200}>200 peserta</option>
              <option value={300}>300 peserta</option>
            </select>
          </label>
          <label>
            Prefetch soal
            <select value={form.questionPrefetchCount} onChange={(event) => update("questionPrefetchCount", Number(event.target.value))}>
              <option value={0}>Tidak prefetch</option>
              <option value={1}>1 soal berikutnya</option>
              <option value={2}>2 soal berikutnya</option>
              <option value={3}>3 soal berikutnya</option>
            </select>
          </label>
        </div>
        <p className="muted">Mode Extra High menyimpan jawaban penuh di perangkat dan mengirim final saat submit. Mode Seimbang tetap melakukan autosave berkala ke server.</p>
      </section>
    </div>
  );
}

function AdminAccountsPanel() {
  const emptyAddForm = { name: "", username: "", password: "", confirmPassword: "", currentPassword: "" };
  const [admins, setAdmins] = useState([]);
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [passwordForm, setPasswordForm] = useState({ adminId: "", newPassword: "", confirmPassword: "", currentPassword: "" });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadAdmins() {
    const data = await api("/admin-users");
    setAdmins(data);
    setPasswordForm((current) => ({
      ...current,
      adminId: current.adminId || data[0]?.id || ""
    }));
  }

  useEffect(() => {
    loadAdmins().catch((err) => setError(err.message));
  }, []);

  async function createAdmin(event) {
    event.preventDefault();
    setNotice("");
    setError("");
    if (addForm.password !== addForm.confirmPassword) {
      setError("Konfirmasi password admin baru tidak sama.");
      return;
    }
    setLoading(true);
    try {
      await api("/admin-users", {
        method: "POST",
        body: JSON.stringify({
          name: addForm.name,
          username: addForm.username,
          password: addForm.password,
          currentPassword: addForm.currentPassword
        })
      });
      setAddForm(emptyAddForm);
      setNotice("Admin baru berhasil dibuat.");
      await loadAdmins();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setNotice("");
    setError("");
    if (!passwordForm.adminId) {
      setError("Pilih admin yang akan diubah passwordnya.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError("Konfirmasi password baru tidak sama.");
      return;
    }
    setLoading(true);
    try {
      await api(`/admin-users/${passwordForm.adminId}/password`, {
        method: "PUT",
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        })
      });
      setPasswordForm((current) => ({ ...current, newPassword: "", confirmPassword: "", currentPassword: "" }));
      setNotice("Password admin berhasil diubah.");
      await loadAdmins();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <PanelTitle icon={ShieldCheck} title="Akun Admin" />
      <p className="muted">Gunakan panel ini untuk menambah admin baru atau mengganti password admin. Setiap perubahan wajib memasukkan password admin yang sedang login.</p>
      {notice ? <div className="success-box">{notice}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}
      <div className="admin-account-grid">
        <form className="admin-account-card" onSubmit={createAdmin}>
          <h3>Tambah Admin</h3>
          <label>Nama admin
            <input value={addForm.name} onChange={(event) => setAddForm({ ...addForm, name: event.target.value })} required />
          </label>
          <label>Username
            <input value={addForm.username} onChange={(event) => setAddForm({ ...addForm, username: event.target.value })} required />
          </label>
          <label>Password admin baru
            <input type="password" value={addForm.password} onChange={(event) => setAddForm({ ...addForm, password: event.target.value })} required minLength={8} />
          </label>
          <label>Konfirmasi password baru
            <input type="password" value={addForm.confirmPassword} onChange={(event) => setAddForm({ ...addForm, confirmPassword: event.target.value })} required minLength={8} />
          </label>
          <label>Password admin saat ini
            <input type="password" value={addForm.currentPassword} onChange={(event) => setAddForm({ ...addForm, currentPassword: event.target.value })} required />
          </label>
          <button type="submit" disabled={loading}><Plus size={18} /> Tambah Admin</button>
        </form>

        <form className="admin-account-card" onSubmit={changePassword}>
          <h3>Ubah Password Admin</h3>
          <label>Pilih admin
            <select value={passwordForm.adminId} onChange={(event) => setPasswordForm({ ...passwordForm, adminId: event.target.value })} required>
              {admins.map((admin) => <option key={admin.id} value={admin.id}>{admin.name} ({admin.username})</option>)}
            </select>
          </label>
          <label>Password baru
            <input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} required minLength={8} />
          </label>
          <label>Konfirmasi password baru
            <input type="password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} required minLength={8} />
          </label>
          <label>Password admin saat ini
            <input type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} required />
          </label>
          <button type="submit" className="ghost-button" disabled={loading || !admins.length}><KeyRound size={18} /> Simpan Password</button>
        </form>

        <div className="admin-account-card admin-list-card">
          <h3>Daftar Admin</h3>
          <div className="admin-user-list">
            {admins.length ? admins.map((admin) => (
              <div className="admin-user-item" key={admin.id}>
                <div>
                  <strong>{admin.name}</strong>
                  <span>{admin.username}</span>
                </div>
                <span className="status-pill selected">Admin</span>
              </div>
            )) : <p className="muted">Belum ada data admin.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function SettingsDashboard({ accessControl, examSettings, onAccessControlChanged, onExamSettingsChanged }) {
  return (
    <div className="page-stack">
      <ExamSettingsPanel examSettings={examSettings} onChanged={onExamSettingsChanged} />
      <AccessControlPanel accessControl={accessControl} onChanged={onAccessControlChanged} />
      <AdminAccountsPanel />
    </div>
  );
}

function AdminDashboard({ summary, students, exams, questions, attempts, results, violations }) {
  const now = new Date();
  const today = localDateKey(now);
  const questionsByExam = new Map();
  const attemptsByExam = new Map();
  for (const question of questions) {
    questionsByExam.set(question.examId, (questionsByExam.get(question.examId) || 0) + 1);
  }
  for (const attempt of attempts) {
    attemptsByExam.set(attempt.examId, (attemptsByExam.get(attempt.examId) || 0) + 1);
  }
  const examRows = exams.map((exam) => ({
    ...exam,
    questionCount: questionsByExam.get(exam.id) || 0,
    participantCount: attemptsByExam.get(exam.id) || 0,
    schedule: getExamScheduleMeta(exam, now)
  }));
  const todayExams = examRows
    .filter((exam) => exam.date === today)
    .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
  const nextExams = examRows
    .filter((exam) => exam.schedule.startMs && exam.schedule.startMs >= now.getTime())
    .sort((a, b) => a.schedule.startMs - b.schedule.startMs)
    .slice(0, 6);
  const submittedResults = results.filter((item) => item.status === "submitted");
  const averageScore = submittedResults.length
    ? Math.round(submittedResults.reduce((total, item) => total + Number(item.score?.percent || 0), 0) / submittedResults.length)
    : "-";
  const inProgress = attempts.filter((attempt) => attempt.status === "in_progress").length;
  const staleActive = attempts.filter((attempt) => {
    if (attempt.status !== "in_progress" || !attempt.updatedAt) return false;
    return now.getTime() - new Date(attempt.updatedAt).getTime() > 5 * 60 * 1000;
  }).length;
  const alerts = [
    ...examRows.filter((exam) => exam.status === "published" && !exam.questionCount).map((exam) => ({
      level: "danger",
      title: `${exam.code} belum punya soal`,
      message: "Tambahkan soal atau tutup publish sebelum peserta masuk."
    })),
    ...examRows.filter((exam) => exam.status === "published" && !exam.participantCount).map((exam) => ({
      level: "warning",
      title: `${exam.code} belum punya peserta`,
      message: "Pilih peserta ujian agar kartu dan portal siswa sesuai."
    })),
    ...examRows.filter((exam) => exam.status === "published" && exam.reviewStatus !== "reviewed").map((exam) => ({
      level: "warning",
      title: `${exam.code} belum dicek admin`,
      message: "Review soal sebaiknya selesai sebelum jadwal ujian."
    })),
    ...(staleActive ? [{
      level: "warning",
      title: `${staleActive} peserta aktif tidak mengirim update`,
      message: "Cek koneksi atau perangkat peserta pada halaman Monitoring."
    }] : [])
  ].slice(0, 8);

  return (
    <div className="page-stack">
      <section className="span-full stat-grid">
        <StatCard icon={Users} label="Siswa" value={summary.students ?? 0} />
        <StatCard icon={UserRound} label="Guru" value={summary.teachers ?? 0} />
        <StatCard icon={PlayCircle} label="Sedang Ujian" value={inProgress} />
        <StatCard icon={CheckCircle2} label="Rata-rata Nilai" value={averageScore} />
      </section>
      <div className="content-grid dashboard-grid">
        <section className="panel span-wide">
          <PanelTitle icon={CalendarDays} title="Jadwal Hari Ini" />
          <div className="timeline-list">
            {todayExams.length ? todayExams.map((exam) => (
              <article className="timeline-item" key={exam.id}>
                <div>
                  <strong>{exam.code} - {exam.subject}</strong>
                  <span>{formatExamTimeRange(exam)} | {exam.durationMinutes} menit | {exam.participantCount} peserta</span>
                </div>
                <span className={scheduleStatusClass(exam.schedule.status)}>{formatScheduleStatus(exam.schedule.status)}</span>
              </article>
            )) : <div className="empty-state"><strong>Tidak ada jadwal hari ini.</strong><p>Jadwal berikutnya tetap bisa dilihat di daftar bawah.</p></div>}
          </div>
        </section>
        <section className="panel">
          <PanelTitle icon={AlertTriangle} title="Perlu Perhatian" />
          <div className="alert-list">
            {alerts.length ? alerts.map((alert, index) => (
              <article className={`alert-item ${alert.level}`} key={`${alert.title}-${index}`}>
                <strong>{alert.title}</strong>
                <span>{alert.message}</span>
              </article>
            )) : <div className="empty-state compact-empty"><strong>Semua terlihat aman.</strong><p>Tidak ada ujian publish yang kosong soal/peserta.</p></div>}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="dashboard-section-head">
          <PanelTitle icon={ClipboardList} title="Ringkasan Ujian" />
          <div className="dashboard-metrics">
            <code>{examRows.length} ujian</code>
            <code>{violations.length} log pelanggaran</code>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Mata Pelajaran</th>
                <th>Jadwal</th>
                <th>Soal</th>
                <th>Peserta</th>
                <th>Status Jadwal</th>
                <th>Review Soal</th>
              </tr>
            </thead>
            <tbody>
              {(nextExams.length ? nextExams : examRows.slice(0, 6)).map((exam) => (
                <tr key={exam.id}>
                  <td><strong>{exam.code}</strong></td>
                  <td>{exam.subject}</td>
                  <td>{exam.date} | {formatExamTimeRange(exam)}</td>
                  <td>{exam.questionCount}</td>
                  <td>{exam.participantCount}</td>
                  <td><span className={scheduleStatusClass(exam.schedule.status)}>{formatScheduleStatus(exam.schedule.status)}</span></td>
                  <td><span className={reviewStatusClass(exam.reviewStatus)}>{formatReviewStatus(exam.reviewStatus)}</span></td>
                </tr>
              ))}
              {examRows.length ? null : <tr><td colSpan="7">Belum ada ujian.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MonitoringDashboard({ attempts, students, exams, violations, activeTab = "active", onTabChange = () => {}, onChanged = () => {}, canDeleteViolations = false }) {
  const [examFilter, setExamFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedLogTarget, setSelectedLogTarget] = useState(null);
  const [selectedAttemptIds, setSelectedAttemptIds] = useState([]);
  const [bulkFinishOpen, setBulkFinishOpen] = useState(false);
  const [bulkFinishReason, setBulkFinishReason] = useState("Pelanggaran saat ujian");
  const [bulkFinishPassword, setBulkFinishPassword] = useState("");
  const [bulkFinishLoading, setBulkFinishLoading] = useState(false);
  const [bulkNotice, setBulkNotice] = useState("");
  const [monitoringSort, setMonitoringSort] = useState({ key: "", direction: "asc" });
  const now = new Date();

  const studentById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const examById = useMemo(() => new Map(exams.map((exam) => [exam.id, exam])), [exams]);
  const classOptions = [...new Set(students.map((student) => student.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));
  const violationCountByAttempt = useMemo(() => {
    const map = new Map();
    for (const violation of violations) {
      const key = `${violation.examId}-${violation.studentId}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [violations]);

  const violationsByAttempt = useMemo(() => {
    const map = new Map();
    for (const violation of violations) {
      const key = `${violation.examId}-${violation.studentId}`;
      const list = map.get(key) || [];
      list.push(violation);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
    return map;
  }, [violations]);

  const rows = attempts.map((attempt) => {
    const student = studentById.get(attempt.studentId) || {};
    const exam = examById.get(attempt.examId) || {};
    const schedule = getExamScheduleMeta(exam, now);
    const lastSeenMs = attempt.updatedAt ? new Date(attempt.updatedAt).getTime() : null;
    const isStale = attempt.status === "in_progress" && lastSeenMs && now.getTime() - lastSeenMs > 5 * 60 * 1000;
    return {
      ...attempt,
      nis: student.nis || "",
      studentName: attempt.studentName || student.name || "-",
      className: attempt.className || student.className || "-",
      electiveSubjects: formatElectiveSubjects(student),
      examCode: attempt.examCode || exam.code || "-",
      subject: attempt.subject || exam.subject || "-",
      examDate: exam.date || "-",
      examTime: exam.id ? formatExamTimeRange(exam) : "-",
      scheduleStartMs: schedule.startMs || 0,
      updatedAtMs: attempt.updatedAt ? new Date(attempt.updatedAt).getTime() : 0,
      schedule,
      violationCount: violationCountByAttempt.get(`${attempt.examId}-${attempt.studentId}`) || 0,
      violationLogs: violationsByAttempt.get(`${attempt.examId}-${attempt.studentId}`) || [],
      isStale
    };
  });

  const filteredRows = rows.filter((item) => {
    const matchesExam = examFilter ? item.examId === examFilter : true;
    const matchesClass = classFilter ? item.className === classFilter : true;
    const matchesStatus = statusFilter === "stale" ? item.isStale : statusFilter ? item.status === statusFilter : true;
    const haystack = [
      item.nis,
      item.studentName,
      item.className,
      item.examCode,
      item.subject,
      item.electiveSubjects.join(" ")
    ].join(" ").toLowerCase();
    return matchesExam && matchesClass && matchesStatus && haystack.includes(query.toLowerCase());
  });

  const sortedRows = applyTableSort(filteredRows, monitoringSort, {
    studentName: (item) => item.studentName,
    className: (item) => item.className,
    exam: (item) => `${item.examCode} ${item.subject} ${item.scheduleStartMs}`,
    status: (item) => item.isStale ? "Perlu Dicek" : formatResultStatus(item.status),
    activity: (item) => item.updatedAtMs,
    violations: (item) => item.violationCount
  });
  const paged = getPageItems(sortedRows, page, pageSize);
  const selectableRows = filteredRows.filter((item) => item.status === "in_progress");
  const selectablePagedRows = paged.items.filter((item) => item.status === "in_progress");
  const selectedSet = new Set(selectedAttemptIds);
  const selectedRows = rows.filter((item) => selectedSet.has(item.id));
  const allPagedSelected = selectablePagedRows.length > 0 && selectablePagedRows.every((item) => selectedSet.has(item.id));
  const allFilteredSelected = selectableRows.length > 0 && selectableRows.every((item) => selectedSet.has(item.id));
  const baseStats = [
    { icon: Users, label: "Peserta Tampil", value: filteredRows.length },
    { icon: PlayCircle, label: "Sedang Mengerjakan", value: filteredRows.filter((item) => item.status === "in_progress").length },
    { icon: CheckCircle2, label: "Selesai", value: filteredRows.filter((item) => item.status === "submitted").length },
    { icon: AlertTriangle, label: "Perlu Dicek", value: filteredRows.filter((item) => item.isStale || item.violationCount).length }
  ];
  const violationStats = [
    { icon: Users, label: "Peserta Tercatat", value: new Set(violations.map((item) => `${item.examId}-${item.studentId}`)).size },
    { icon: ClipboardList, label: "Log Info", value: violations.filter((item) => normalizeViolationLevel(item.level) === "info").length },
    { icon: AlertTriangle, label: "Peringatan", value: violations.filter((item) => normalizeViolationLevel(item.level) === "warning").length },
    { icon: ShieldCheck, label: "Pelanggaran Berat", value: violations.filter((item) => normalizeViolationLevel(item.level) === "critical").length }
  ];
  const visibleStats = activeTab === "violations" ? [...baseStats, ...violationStats] : baseStats;

  function changeFilter(setter, value) {
    setter(value);
    setPage(1);
  }

  function changeMonitoringSort(key) {
    setMonitoringSort((current) => toggleTableSort(current, key));
    setPage(1);
  }

  useEffect(() => {
    const validIds = new Set(rows.filter((item) => item.status === "in_progress").map((item) => item.id));
    setSelectedAttemptIds((current) => current.filter((id) => validIds.has(id)));
  }, [attempts]);

  function toggleAttemptSelection(id, checked) {
    setSelectedAttemptIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return [...next];
    });
  }

  function togglePageSelection(checked) {
    setSelectedAttemptIds((current) => {
      const next = new Set(current);
      for (const item of selectablePagedRows) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return [...next];
    });
  }

  function toggleFilteredSelection(checked) {
    setSelectedAttemptIds((current) => {
      const next = new Set(current);
      for (const item of selectableRows) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return [...next];
    });
  }

  async function forceFinishAttempt(item) {
    if (item.status !== "in_progress") return;
    const reason = window.prompt(`Alasan paksa selesai untuk ${item.studentName}:`, "Pelanggaran saat ujian");
    if (reason === null) return;
    const ok = window.confirm(`Paksa selesai ujian ${item.examCode} untuk ${item.studentName}? Perangkat peserta akan diminta mengirim jawaban terakhir lalu ujian dikunci.`);
    if (!ok) return;
    await api(`/attempts/${item.id}/admin-finish`, {
      method: "POST",
      body: JSON.stringify({ reason })
    });
    await onChanged();
  }

  async function forceFinishSelectedAttempts() {
    setBulkFinishLoading(true);
    try {
      const result = await api("/attempts/admin-finish-bulk", {
        method: "POST",
        body: JSON.stringify({ attemptIds: selectedAttemptIds, reason: bulkFinishReason, password: bulkFinishPassword })
      });
      setBulkNotice(`${result.finished} peserta sedang diminta mengirim jawaban terakhir dan selesai paksa. ${result.skipped ? `${result.skipped} peserta dilewati karena sudah tidak aktif.` : ""}`);
      setSelectedAttemptIds([]);
      setBulkFinishOpen(false);
      setBulkFinishPassword("");
      setBulkFinishReason("Pelanggaran saat ujian");
      await onChanged();
    } catch (error) {
      setBulkNotice(error.message);
    } finally {
      setBulkFinishLoading(false);
    }
  }

  return (
    <div className="page-stack">
      <section className={`stat-grid monitoring-stat-grid ${activeTab === "violations" ? "eight-stats" : ""}`}>
        {visibleStats.map((item) => (
          <StatCard icon={item.icon} label={item.label} value={item.value} key={item.label} />
        ))}
      </section>
      {activeTab === "violations" ? (
        <ViolationSummaryDashboard
          students={students}
          exams={exams}
          violations={violations}
          onOpenLogs={setSelectedLogTarget}
          onChanged={onChanged}
          canDeleteViolations={canDeleteViolations}
        />
      ) : (
        <>
      <section className="panel">
        <div className="result-header">
          <PanelTitle icon={MonitorSmartphone} title="Monitoring Peserta Ujian" />
          <span className="muted">Data diperbarui saat halaman direfresh atau admin membuka menu ini.</span>
        </div>
        <div className="result-controls monitoring-controls">
          <label className="field-control">
            <span>Ujian</span>
            <select value={examFilter} onChange={(event) => changeFilter(setExamFilter, event.target.value)}>
              <option value="">Semua Ujian</option>
              {exams.map((exam) => <option value={exam.id} key={exam.id}>{exam.code} - {exam.subject}</option>)}
            </select>
          </label>
          <label className="field-control">
            <span>Kelas</span>
            <select value={classFilter} onChange={(event) => changeFilter(setClassFilter, event.target.value)}>
              <option value="">Semua Kelas</option>
              {classOptions.map((className) => <option value={className} key={className}>{className}</option>)}
            </select>
          </label>
          <label className="field-control">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => changeFilter(setStatusFilter, event.target.value)}>
              <option value="">Semua Status</option>
              <option value="not_started">Belum Mengerjakan</option>
              <option value="in_progress">Sedang Mengerjakan</option>
              <option value="submitted">Selesai</option>
              <option value="stale">Perlu Dicek</option>
            </select>
          </label>
          <label className="field-control result-search-control">
            <span>Cari Peserta</span>
            <span className="search-box">
              <Search size={16} />
              <input value={query} placeholder="Cari nama, NIS, ujian..." onChange={(event) => changeFilter(setQuery, event.target.value)} />
            </span>
          </label>
        </div>
        {bulkNotice ? <div className="success-box">{bulkNotice}</div> : null}
        <div className="bulk-action-bar monitoring-bulk-action-bar">
          <label className="inline-check">
            <input type="checkbox" checked={allPagedSelected} disabled={!selectablePagedRows.length} onChange={(event) => togglePageSelection(event.target.checked)} />
            Pilih halaman ini ({selectablePagedRows.length})
          </label>
          <button type="button" className="ghost-button" onClick={() => toggleFilteredSelection(!allFilteredSelected)} disabled={!selectableRows.length}>
            {allFilteredSelected ? "Batalkan Semua Filter" : `Pilih Semua Sesuai Filter (${selectableRows.length})`}
          </button>
          <button type="button" className="danger-button" onClick={() => setBulkFinishOpen(true)} disabled={!selectedAttemptIds.length}>
            <AlertTriangle size={18} /> Force Selesai Terpilih ({selectedAttemptIds.length})
          </button>
          {selectedAttemptIds.length ? <button type="button" className="ghost-button" onClick={() => setSelectedAttemptIds([])}>Kosongkan Pilihan</button> : null}
        </div>
        <PaginationControls
          page={paged.currentPage}
          pageSize={pageSize}
          total={sortedRows.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          pageSizeOptions={[25, 50, 75, 100]}
          itemLabel="peserta"
        />
        <div className="table-wrap">
          <table className="monitoring-active-table">
            <thead>
              <tr>
                <th>Pilih</th>
                <th><SortHeader sort={monitoringSort} sortKey="studentName" onSort={changeMonitoringSort}>Peserta</SortHeader></th>
                <th><SortHeader sort={monitoringSort} sortKey="className" onSort={changeMonitoringSort}>Kelas</SortHeader></th>
                <th><SortHeader sort={monitoringSort} sortKey="exam" onSort={changeMonitoringSort}>Ujian / Jadwal</SortHeader></th>
                <th><SortHeader sort={monitoringSort} sortKey="status" onSort={changeMonitoringSort}>Status</SortHeader></th>
                <th><SortHeader sort={monitoringSort} sortKey="activity" onSort={changeMonitoringSort}>Aktivitas</SortHeader></th>
                <th><SortHeader sort={monitoringSort} sortKey="violations" onSort={changeMonitoringSort}>Pelanggaran</SortHeader></th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {paged.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      className="monitoring-row-checkbox"
                      type="checkbox"
                      checked={selectedSet.has(item.id)}
                      disabled={item.status !== "in_progress"}
                      onChange={(event) => toggleAttemptSelection(item.id, event.target.checked)}
                      aria-label={`Pilih ${item.studentName}`}
                    />
                  </td>
                  <td><strong>{item.studentName}</strong><br /><code>{item.nis || item.studentId}</code></td>
                  <td>{item.className}</td>
                  <td><strong>{item.examCode}</strong><br /><span>{item.subject}</span><br /><small>{item.examDate} | {item.examTime}</small></td>
                  <td>
                    <span className={item.isStale ? "status-pill revision" : resultStatusClass(item.status)}>
                      {item.isStale ? "Perlu Dicek" : formatResultStatus(item.status)}
                    </span>
                  </td>
                  <td>
                    <span>Mulai: {formatDateTime(item.startedAt)}</span><br />
                    <span>Aktif: {formatDateTime(item.updatedAt)}</span><br />
                    <span>Sisa: {item.status === "in_progress" && item.schedule.status === "active" ? formatRemainingTime(item.schedule.remainingMs) : "-"}</span>
                  </td>
                  <td>
                    {item.violationCount ? (
                      <button type="button" className="log-count-button" onClick={() => setSelectedLogTarget(item)}>
                        {item.violationCount} log
                      </button>
                    ) : "-"}
                  </td>
                  <td>
                    <button type="button" className="ghost-button small-button monitoring-action-button" title="Paksa selesai ujian peserta ini" onClick={() => forceFinishAttempt(item)} disabled={item.status !== "in_progress"}>
                      Selesai
                    </button>
                  </td>
                </tr>
              ))}
              {paged.items.length ? null : <tr><td colSpan="8">Belum ada peserta sesuai filter.</td></tr>}
            </tbody>
          </table>
        </div>
        <PaginationControls
          page={paged.currentPage}
          pageSize={pageSize}
          total={sortedRows.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          pageSizeOptions={[25, 50, 75, 100]}
          itemLabel="peserta"
        />
      </section>
        </>
      )}
      {selectedLogTarget ? (
        <MonitoringLogModal
          target={selectedLogTarget}
          logs={selectedLogTarget.violationLogs}
          onClose={() => setSelectedLogTarget(null)}
        />
      ) : null}
      {bulkFinishOpen ? (
        <PasswordConfirmModal
          title="Force Selesai Peserta Terpilih"
          icon={AlertTriangle}
          description={`Tindakan ini akan menyelesaikan paksa ${selectedRows.length} peserta yang sedang ujian. Jawaban terakhir akan menjadi final dan log pelanggaran berat akan dibuat.`}
          actionLabel="Force Selesai"
          reason={bulkFinishReason}
          setReason={setBulkFinishReason}
          password={bulkFinishPassword}
          setPassword={setBulkFinishPassword}
          confirmation=""
          setConfirmation={() => {}}
          loading={bulkFinishLoading}
          onCancel={() => { setBulkFinishOpen(false); setBulkFinishPassword(""); }}
          onConfirm={forceFinishSelectedAttempts}
        />
      ) : null}
    </div>
  );
}

function ViolationSummaryDashboard({ students, exams, violations, onOpenLogs, onChanged, canDeleteViolations }) {
  const [examFilter, setExamFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState("critical");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState(false);

  const studentById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const examById = useMemo(() => new Map(exams.map((exam) => [exam.id, exam])), [exams]);
  const classOptions = [...new Set(students.map((student) => student.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));

  const rows = useMemo(() => {
    const map = new Map();
    for (const log of violations) {
      const key = `${log.examId}-${log.studentId}`;
      const student = studentById.get(log.studentId) || {};
      const exam = examById.get(log.examId) || {};
      const row = map.get(key) || {
        id: key,
        studentId: log.studentId,
        examId: log.examId,
        nis: student.nis || "",
        studentName: log.studentName || student.name || "-",
        className: student.className || "-",
        examCode: log.examCode || exam.code || "-",
        subject: exam.subject || "-",
        examDate: exam.date || "-",
        examTime: exam.id ? formatExamTimeRange(exam) : "-",
        counts: { info: 0, warning: 0, critical: 0 },
        logs: [],
        latestAt: ""
      };
      const level = normalizeViolationLevel(log.level);
      row.counts[level] += 1;
      row.logs.push(log);
      if (!row.latestAt || new Date(log.createdAt || 0) > new Date(row.latestAt || 0)) {
        row.latestAt = log.createdAt || "";
      }
      map.set(key, row);
    }

    return [...map.values()].map((row) => {
      row.logs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      row.total = row.counts.info + row.counts.warning + row.counts.critical;
      row.reviewStatus = row.counts.critical ? "Butuh Tindak Lanjut" : row.counts.warning ? "Perlu Dicek" : "Info";
      return row;
    });
  }, [violations, studentById, examById]);

  const filteredRows = rows.filter((item) => {
    const matchesExam = examFilter ? item.examId === examFilter : true;
    const matchesClass = classFilter ? item.className === classFilter : true;
    const matchesLevel = levelFilter ? item.counts[levelFilter] > 0 : true;
    const haystack = [item.nis, item.studentName, item.className, item.examCode, item.subject].join(" ").toLowerCase();
    return matchesExam && matchesClass && matchesLevel && haystack.includes(query.toLowerCase());
  });

  const sortedRows = [...filteredRows].sort((a, b) => {
    if (sortMode === "warning") return (b.counts.warning - a.counts.warning) || (b.total - a.total);
    if (sortMode === "total") return b.total - a.total;
    if (sortMode === "latest") return new Date(b.latestAt || 0) - new Date(a.latestAt || 0);
    if (sortMode === "name") return a.studentName.localeCompare(b.studentName, "id");
    return (b.counts.critical - a.counts.critical) || (b.counts.warning - a.counts.warning) || (b.total - a.total);
  });

  const paged = getPageItems(sortedRows, page, pageSize);
  const totalInfo = filteredRows.reduce((sum, row) => sum + row.counts.info, 0);
  const totalWarning = filteredRows.reduce((sum, row) => sum + row.counts.warning, 0);
  const totalCritical = filteredRows.reduce((sum, row) => sum + row.counts.critical, 0);

  function changeFilter(setter, value) {
    setter(value);
    setPage(1);
  }

  function openLogs(row, level = "") {
    const filteredLogs = level ? row.logs.filter((log) => normalizeViolationLevel(log.level) === level) : row.logs;
    onOpenLogs({
      ...row,
      violationLogs: filteredLogs,
      logScope: level ? formatViolationLevel(level) : "Semua Log"
    });
  }

  function filteredLogIds() {
    return sortedRows.flatMap((row) => (
      levelFilter ? row.logs.filter((log) => normalizeViolationLevel(log.level) === levelFilter) : row.logs
    )).map((log) => log.id).filter(Boolean);
  }

  function downloadViolationSummary() {
    const rowsForExcel = sortedRows.map((item) => [
      item.studentName,
      item.nis,
      item.className,
      item.examCode,
      item.subject,
      item.examDate,
      item.examTime,
      item.counts.info,
      item.counts.warning,
      item.counts.critical,
      item.total,
      formatDateTime(item.latestAt),
      item.reviewStatus
    ]);
    downloadHtmlExcel({
      filename: `rekap-pelanggaran-cbt-${localDateKey(new Date())}.xls`,
      sheetTitle: "Rekap Pelanggaran CBT SMAN 94",
      headers: ["Peserta", "NIS", "Kelas", "Kode Ujian", "Mata Pelajaran", "Tanggal", "Jadwal", "Log Info", "Log Peringatan", "Log Berat", "Total Log", "Terakhir Log", "Review"],
      rows: rowsForExcel
    });
  }

  async function deleteFilteredLogs() {
    const ids = filteredLogIds();
    if (!ids.length) {
      setNotice("Tidak ada log yang bisa dihapus dari filter saat ini.");
      setDeleteOpen(false);
      return;
    }
    setDeleting(true);
    try {
      const result = await api("/violations", {
        method: "DELETE",
        body: JSON.stringify({ ids })
      });
      setNotice(`${result.deleted} log pelanggaran berhasil dihapus.`);
      setDeleteOpen(false);
      await onChanged();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="result-header">
          <PanelTitle icon={AlertTriangle} title="Rekap Pelanggaran Peserta" />
          <div className="toolbar-actions">
            <button type="button" className="ghost-button" onClick={downloadViolationSummary} disabled={!sortedRows.length}>
              <Download size={18} /> Download Excel
            </button>
            {canDeleteViolations ? (
              <button type="button" className="danger-button" onClick={() => setDeleteOpen(true)} disabled={!filteredLogIds().length}>
                <Trash2 size={18} /> Hapus Log Filter
              </button>
            ) : null}
          </div>
        </div>
        {notice ? <div className={notice.includes("berhasil") ? "success-box" : "error-box"}>{notice}</div> : null}
        <div className="result-controls monitoring-controls violation-controls">
          <label className="field-control">
            <span>Ujian</span>
            <select value={examFilter} onChange={(event) => changeFilter(setExamFilter, event.target.value)}>
              <option value="">Semua Ujian</option>
              {exams.map((exam) => <option value={exam.id} key={exam.id}>{exam.code} - {exam.subject}</option>)}
            </select>
          </label>
          <label className="field-control">
            <span>Kelas</span>
            <select value={classFilter} onChange={(event) => changeFilter(setClassFilter, event.target.value)}>
              <option value="">Semua Kelas</option>
              {classOptions.map((className) => <option value={className} key={className}>{className}</option>)}
            </select>
          </label>
          <label className="field-control">
            <span>Level</span>
            <select value={levelFilter} onChange={(event) => changeFilter(setLevelFilter, event.target.value)}>
              <option value="">Semua Level</option>
              <option value="info">Info</option>
              <option value="warning">Peringatan</option>
              <option value="critical">Berat</option>
            </select>
          </label>
          <label className="field-control">
            <span>Urutkan</span>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value)}>
              <option value="critical">Berat terbanyak</option>
              <option value="warning">Peringatan terbanyak</option>
              <option value="total">Total terbanyak</option>
              <option value="latest">Log terbaru</option>
              <option value="name">Nama A-Z</option>
            </select>
          </label>
          <label className="field-control result-search-control">
            <span>Cari Peserta</span>
            <span className="search-box">
              <Search size={16} />
              <input value={query} placeholder="Cari nama, NIS, ujian..." onChange={(event) => changeFilter(setQuery, event.target.value)} />
            </span>
          </label>
        </div>
        <PaginationControls
          page={paged.currentPage}
          pageSize={pageSize}
          total={sortedRows.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          pageSizeOptions={[25, 50, 75, 100]}
          itemLabel="peserta"
        />
        <div className="table-wrap">
          <table className="violation-summary-table">
            <thead>
              <tr>
                <th>Peserta</th>
                <th>Kelas</th>
                <th>Ujian</th>
                <th>Jadwal</th>
                <th>Log Info</th>
                <th>Log Peringatan</th>
                <th>Log Pelanggaran Berat</th>
                <th>Total Log</th>
                <th>Terakhir Log</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {paged.items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.studentName}</strong><br /><code>{item.nis || item.studentId}</code></td>
                  <td>{item.className}</td>
                  <td><strong>{item.examCode}</strong><br /><span>{item.subject}</span></td>
                  <td>{item.examDate}<br /><span>{item.examTime}</span></td>
                  <td>{renderViolationCountButton(item.counts.info, "info", () => openLogs(item, "info"))}</td>
                  <td>{renderViolationCountButton(item.counts.warning, "warning", () => openLogs(item, "warning"))}</td>
                  <td>{renderViolationCountButton(item.counts.critical, "critical", () => openLogs(item, "critical"))}</td>
                  <td>{renderViolationCountButton(item.total, "total", () => openLogs(item))}</td>
                  <td>{formatDateTime(item.latestAt)}</td>
                  <td>{renderViolationReview(item)}</td>
                </tr>
              ))}
              {paged.items.length ? null : <tr><td colSpan="10">Belum ada log sesuai filter.</td></tr>}
            </tbody>
          </table>
        </div>
        <PaginationControls
          page={paged.currentPage}
          pageSize={pageSize}
          total={sortedRows.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          pageSizeOptions={[25, 50, 75, 100]}
          itemLabel="peserta"
        />
      </section>
      {deleteOpen ? (
        <Modal title="Hapus Log Pelanggaran" icon={Trash2} onClose={() => setDeleteOpen(false)}>
          <div className="confirm-delete-modal">
            <p>
              Sistem akan menghapus <strong>{filteredLogIds().length}</strong> log pelanggaran sesuai filter yang sedang aktif.
              Data yang sudah dihapus tidak tampil lagi di Monitoring.
            </p>
            <p className="muted">Saran: download Excel terlebih dahulu jika log ini masih diperlukan sebagai bukti audit.</p>
            <div className="form-actions">
              <button type="button" className="danger-button" onClick={deleteFilteredLogs} disabled={deleting}>
                <Trash2 size={18} /> {deleting ? "Menghapus..." : "Ya, Hapus Log"}
              </button>
              <button type="button" className="ghost-button" onClick={() => setDeleteOpen(false)}>Batal</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function normalizeViolationLevel(level) {
  const normalized = String(level || "warning").toLowerCase();
  if (["critical", "danger", "berat", "heavy"].includes(normalized)) return "critical";
  if (normalized === "info") return "info";
  return "warning";
}

function renderViolationCountButton(count, level, onClick) {
  if (!count) return "-";
  return (
    <button type="button" className={`log-count-button ${level}`} onClick={onClick}>
      {count} kali
    </button>
  );
}

function renderViolationReview(item) {
  if (item.counts.critical) {
    return (
      <span className="review-icon danger" title="Butuh Tindak Lanjut">
        <AlertTriangle size={20} />
      </span>
    );
  }
  if (item.counts.warning) {
    return (
      <span className="review-icon warning" title="Perlu Dicek">
        <AlertTriangle size={20} />
      </span>
    );
  }
  return <span className="status-pill neutral">Info</span>;
}

function formatViolationLevel(level) {
  const normalized = normalizeViolationLevel(level);
  if (normalized === "critical") return "Berat";
  if (normalized === "info") return "Info";
  return "Peringatan";
}

function formatViolationType(type) {
  const labels = {
    android_app_hidden: "Aplikasi Android Keluar Fokus",
    android_app_resumed: "Aplikasi Android Aktif Lagi",
    android_back_blocked: "Tombol Back Ditekan",
    connection_lost: "Koneksi Terputus",
    connection_restored: "Koneksi Tersambung Lagi",
    visibility_hidden: "Halaman Tidak Terlihat",
    visibility_visible: "Halaman Terlihat Lagi",
    window_blur: "Jendela Kehilangan Fokus",
    possible_overlay_focus_lost: "Overlay Kehilangan Fokus",
    overlay_permission_revoked: "Izin Overlay Dimatikan",
    overlay_service_destroyed: "Service Overlay Berhenti",
    overlay_exam_started: "Overlay Ujian Aktif",
    exam_client_heartbeat_lost: "Heartbeat Exam Browser Hilang",
    exam_screen_opened: "Halaman Ujian Dibuka",
    exam_started: "Ujian Dimulai",
    attempt_started: "Ujian Dimulai",
    attempt_resumed: "Ujian Dilanjutkan",
    submit_attempt: "Submit Ujian",
    context_blocked: "Klik Kanan/Seleksi Diblokir",
    refresh_question: "Muat Ulang Soal",
    questions_reloaded: "Muat Ulang Soal"
  };
  return labels[type] || String(type || "Event").replaceAll("_", " ");
}

function violationLevelClass(level) {
  const normalized = normalizeViolationLevel(level);
  if (normalized === "critical") return "status-pill danger";
  if (normalized === "info") return "status-pill neutral";
  return "status-pill revision";
}

function MonitoringLogModal({ target, logs, onClose }) {
  const latestLog = logs[0];
  const infoCount = logs.filter((item) => normalizeViolationLevel(item.level) === "info").length;
  const warningCount = logs.filter((item) => normalizeViolationLevel(item.level) === "warning").length;
  const criticalCount = logs.filter((item) => normalizeViolationLevel(item.level) === "critical").length;

  return (
    <Modal title="Detail Log Pelanggaran" icon={AlertTriangle} onClose={onClose} wide>
      <div className="monitoring-log-summary">
        <div>
          <span>Peserta</span>
          <strong>{target.studentName}</strong>
          <code>{target.nis || target.studentId}</code>
        </div>
        <div>
          <span>Ujian</span>
          <strong>{target.examCode}</strong>
          <small>{target.subject}</small>
        </div>
        <div>
          <span>Total Log</span>
          <strong>{logs.length}</strong>
          <small>{criticalCount} berat, {warningCount} peringatan, {infoCount} info</small>
        </div>
        <div>
          <span>{target.logScope || "Terakhir"}</span>
          <strong>{formatDateTime(latestLog?.createdAt)}</strong>
          <small>{formatViolationType(latestLog?.type)}</small>
        </div>
      </div>
      <div className="table-wrap monitoring-log-table-wrap">
        <table className="monitoring-log-table">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Jenis</th>
              <th>Level</th>
              <th>Catatan</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{formatDateTime(log.createdAt)}</td>
                <td><strong>{formatViolationType(log.type)}</strong><br /><code>{log.type || "event"}</code></td>
                <td><span className={violationLevelClass(log.level)}>{formatViolationLevel(log.level)}</span></td>
                <td>{log.message || "-"}</td>
              </tr>
            ))}
            {logs.length ? null : <tr><td colSpan="4">Belum ada log untuk peserta ini.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted monitoring-log-note">
        Catatan: log adalah indikator untuk pengawas. Periksa pola kejadian sebelum menyimpulkan pelanggaran berat.
      </p>
    </Modal>
  );
}

function TeacherManager({ teachers, exams = [], onChanged }) {
  const emptyForm = { name: "", username: "", password: "", mapel1: "", mapel2: "", mapel3: "", mapel4: "", mapel5: "" };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [notice, setNotice] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [subjectToAdd, setSubjectToAdd] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllPassword, setDeleteAllPassword] = useState("");
  const [deleteAllConfirmation, setDeleteAllConfirmation] = useState("");
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);

  const subjectOptions = useMemo(() => {
    return [...new Set(exams.map((exam) => String(exam.subject || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "id"));
  }, [exams]);
  const selectedSubjects = [form.mapel1, form.mapel2, form.mapel3, form.mapel4, form.mapel5].map((item) => item.trim()).filter(Boolean);
  const availableSubjectOptions = subjectOptions.filter((subject) => !selectedSubjects.includes(subject));
  const pagedTeachers = getPageItems(teachers, page, pageSize);

  function reset() {
    setEditingId("");
    setForm(emptyForm);
    setSubjectToAdd("");
  }

  function edit(teacher) {
    setEditingId(teacher.id);
    const subjects = teacher.subjects || [];
    setForm({
      name: teacher.name,
      username: teacher.username,
      password: "",
      mapel1: subjects[0] || "",
      mapel2: subjects[1] || "",
      mapel3: subjects[2] || "",
      mapel4: subjects[3] || "",
      mapel5: subjects[4] || ""
    });
    setSubjectToAdd("");
    setNotice("");
    setModalOpen(true);
  }

  function setSelectedSubjects(subjects) {
    const nextSubjects = subjects.slice(0, 5);
    setForm((current) => ({
      ...current,
      mapel1: nextSubjects[0] || "",
      mapel2: nextSubjects[1] || "",
      mapel3: nextSubjects[2] || "",
      mapel4: nextSubjects[3] || "",
      mapel5: nextSubjects[4] || ""
    }));
  }

  function addSubjectToTeacher() {
    if (!subjectToAdd || selectedSubjects.includes(subjectToAdd) || selectedSubjects.length >= 5) return;
    setSelectedSubjects([...selectedSubjects, subjectToAdd]);
    setSubjectToAdd("");
  }

  function removeSubjectFromTeacher(subject) {
    setSelectedSubjects(selectedSubjects.filter((item) => item !== subject));
  }

  async function submit(event) {
    event.preventDefault();
    const payload = {
      name: form.name,
      username: form.username,
      password: form.password,
      subjects: selectedSubjects
    };
    if (editingId && !payload.password) delete payload.password;
    if (editingId) {
      await api(`/teachers/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      setNotice("Data guru berhasil diperbarui.");
    } else {
      await api("/teachers", { method: "POST", body: JSON.stringify(payload) });
      setNotice("Guru baru berhasil ditambahkan.");
    }
    reset();
    setModalOpen(false);
    onChanged();
  }

  async function remove(teacher) {
    const ok = window.confirm(`Hapus guru ${teacher.name}?`);
    if (!ok) return;
    await api(`/teachers/${teacher.id}`, { method: "DELETE" });
    setNotice("Data guru berhasil dihapus.");
    onChanged();
  }

  async function deleteAllTeachers() {
    setDeleteAllLoading(true);
    try {
      const result = await api("/teachers/delete-all", {
        method: "POST",
        body: JSON.stringify({ password: deleteAllPassword, confirmation: deleteAllConfirmation })
      });
      setNotice(`${result.deletedTeachers} guru berhasil dihapus massal.`);
      setDeleteAllOpen(false);
      setDeleteAllPassword("");
      setDeleteAllConfirmation("");
      setPage(1);
      onChanged();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setDeleteAllLoading(false);
    }
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = file.name.toLowerCase().endsWith(".csv")
      ? parseCsv(await file.text())
      : rowsToObjects(await readXlsxFile(file));
    const result = await api("/teachers/bulk", { method: "POST", body: JSON.stringify({ teachers: rows }) });
    setNotice(`Import guru selesai: ${result.created} baru, ${result.updated} diperbarui, ${result.skipped} dilewati.`);
    event.target.value = "";
    setBulkOpen(false);
    onChanged();
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-toolbar">
          <div className="toolbar-actions">
            <button type="button" onClick={() => setBulkOpen(true)}><Upload size={18} /> Upload Bulk</button>
            <button type="button" onClick={() => { reset(); setModalOpen(true); }}><Plus size={18} /> Tambah Guru</button>
            <button type="button" className="danger-button" onClick={() => setDeleteAllOpen(true)} disabled={!teachers.length}><Trash2 size={18} /> Hapus Semua Guru</button>
          </div>
        </div>
        <PanelTitle icon={UserRound} title="Data Guru" />
        {notice ? <div className="success-box">{notice}</div> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nama Guru</th>
                <th>Username</th>
                <th>Mapel Diampu</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {pagedTeachers.items.map((teacher) => (
                <tr key={teacher.id}>
                  <td><strong>{teacher.name}</strong></td>
                  <td><code>{teacher.username}</code></td>
                  <td>{teacher.subjects?.join(", ") || "-"}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="small-button" onClick={() => edit(teacher)}>Edit</button>
                      <button type="button" className="danger-button" onClick={() => remove(teacher)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {teachers.length ? null : <tr><td colSpan="4">Belum ada guru.</td></tr>}
            </tbody>
          </table>
        </div>
        <PaginationControls
          page={pagedTeachers.currentPage}
          pageSize={pageSize}
          total={teachers.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          pageSizeOptions={[10, 25, 50]}
          itemLabel="guru"
          compact
        />
      </section>

      {modalOpen ? (
        <Modal title={editingId ? "Edit Guru" : "Tambah Guru"} icon={UserRound} onClose={() => { reset(); setModalOpen(false); }}>
          <form className="student-form" onSubmit={submit}>
            <label>Nama Guru<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
            <label>Username<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></label>
            <label>Password<input value={form.password} placeholder={editingId ? "Kosongkan jika tidak diubah" : ""} onChange={(event) => setForm({ ...form, password: event.target.value })} required={!editingId} /></label>
            <div className="field-control">
              <span>Mapel Diampu</span>
              <div className="teacher-picker">
                <div className="teacher-picker-row">
                  <select value={subjectToAdd} onChange={(event) => setSubjectToAdd(event.target.value)} disabled={!availableSubjectOptions.length || selectedSubjects.length >= 5}>
                    <option value="">{availableSubjectOptions.length ? "Pilih mapel dari daftar ujian..." : "Semua mapel sudah dipilih"}</option>
                    {availableSubjectOptions.map((subject) => <option value={subject} key={subject}>{subject}</option>)}
                  </select>
                  <button type="button" className="ghost-button" onClick={addSubjectToTeacher} disabled={!subjectToAdd || selectedSubjects.length >= 5}>Tambah Mapel</button>
                </div>
                <div className="selected-teachers">
                  {selectedSubjects.map((subject) => (
                    <span className="teacher-chip" key={subject}>
                      {subject}
                      <button type="button" aria-label={`Hapus ${subject}`} onClick={() => removeSubjectFromTeacher(subject)}>x</button>
                    </span>
                  ))}
                  {selectedSubjects.length ? null : <p className="muted">Belum ada mapel dipilih.</p>}
                </div>
                {subjectOptions.length ? null : <p className="muted">Belum ada daftar mapel dari Dashboard Ujian. Buat ujian/mapel terlebih dahulu agar muncul di dropdown.</p>}
                {selectedSubjects.length >= 5 ? <p className="muted">Maksimal 5 mapel per guru.</p> : null}
              </div>
            </div>
            <div className="form-actions">
              <button type="submit"><Save size={18} /> {editingId ? "Simpan Guru" : "Tambah Guru"}</button>
              <button type="button" className="ghost-button" onClick={() => { reset(); setModalOpen(false); }}>Batal</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {bulkOpen ? (
        <Modal title="Upload Bulk Guru" icon={Upload} onClose={() => setBulkOpen(false)} wide>
          <div className="import-box">
            <strong>Import Excel/CSV Guru</strong>
            <p>Header yang didukung: `name`, `username`, `password`, `Mapel 1`, `Mapel 2`, sampai `Mapel 5`. Kolom `nama` juga didukung sebagai pengganti `name`.</p>
            <p>Jika username sudah ada, data guru akan diperbarui. Mapel yang cocok dengan daftar ujian akan otomatis menjadi penugasan guru.</p>
            <div className="sample-table teacher-sample-table">
              <div>name</div><div>username</div><div>password</div><div>Mapel 1</div><div>Mapel 2</div><div>Mapel 3</div>
              <div>Ibu Zuyun</div><div>zuyun</div><div>zuyun123</div><div>Informatika</div><div>Matematika</div><div></div>
              <div>Bapak Sidiq</div><div>sidiq</div><div>sidiq123</div><div>Informatika</div><div>Bahasa Inggris</div><div>Agama</div>
            </div>
            <button type="button" className="ghost-button" onClick={downloadTeacherTemplate}><Upload size={18} /> Download Contoh CSV</button>
            <label className="file-button">
              <Upload size={18} />
              Pilih File
              <input type="file" accept=".xlsx,.csv" onChange={importFile} />
            </label>
          </div>
        </Modal>
      ) : null}

      {deleteAllOpen ? (
        <PasswordConfirmModal
          title="Hapus Semua Guru"
          icon={Trash2}
          description={`Tindakan ini akan menghapus ${teachers.length} guru, akun guru, sesi login guru, dan mengosongkan penugasan guru pada ujian. Data tidak dapat dikembalikan karena arsip belum dibuat.`}
          confirmText="HAPUS GURU"
          actionLabel="Hapus Semua Guru"
          password={deleteAllPassword}
          setPassword={setDeleteAllPassword}
          confirmation={deleteAllConfirmation}
          setConfirmation={setDeleteAllConfirmation}
          loading={deleteAllLoading}
          onCancel={() => { setDeleteAllOpen(false); setDeleteAllPassword(""); setDeleteAllConfirmation(""); }}
          onConfirm={deleteAllTeachers}
        />
      ) : null}
    </div>
  );
}

function StudentManager({ students, onChanged }) {
  const emptyForm = { nis: "", nisn: "", name: "", gender: "", religion: "", username: "", password: "", className: "", mapelPilihan1: "", mapelPilihan2: "", mapelPilihan3: "", mapelPilihan4: "", mapelPilihan5: "" };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [deleteAllPassword, setDeleteAllPassword] = useState("");
  const [deleteAllConfirmation, setDeleteAllConfirmation] = useState("");
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);

  const filtered = students.filter((student) => {
    const haystack = `${student.nis} ${student.name} ${student.username} ${student.className} ${formatReligion(student)} ${formatElectiveSubjects(student).join(" ")}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  const paged = getPageItems(filtered, page, pageSize);

  function edit(student) {
    setEditingId(student.id);
    const electives = formatElectiveSubjects(student);
    setForm({
      nis: student.nis,
      nisn: student.nisn || "",
      name: student.name,
      gender: student.gender || "",
      religion: formatReligion(student),
      username: student.username,
      password: student.password,
      className: student.className,
      mapelPilihan1: electives[0] || "",
      mapelPilihan2: electives[1] || "",
      mapelPilihan3: electives[2] || "",
      mapelPilihan4: electives[3] || "",
      mapelPilihan5: electives[4] || ""
    });
    setNotice("");
    setModal("form");
  }

  function reset() {
    setEditingId("");
    setForm(emptyForm);
  }

  async function submit(event) {
    event.preventDefault();
    const payload = {
      nis: form.nis,
      nisn: form.nisn,
      name: form.name,
      gender: form.gender,
      religion: form.religion,
      className: form.className,
      username: form.username || form.nis,
      password: form.password || form.nis,
      electiveSubjects: [form.mapelPilihan1, form.mapelPilihan2, form.mapelPilihan3, form.mapelPilihan4, form.mapelPilihan5].map((item) => item.trim()).filter(Boolean)
    };
    if (editingId) {
      await api(`/students/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      setNotice("Data siswa berhasil diperbarui.");
    } else {
      await api("/students", { method: "POST", body: JSON.stringify(payload) });
      setNotice("Data siswa berhasil ditambahkan.");
    }
    reset();
    setModal("");
    onChanged();
  }

  async function remove(student) {
    const ok = window.confirm(`Hapus siswa ${student.name}?`);
    if (!ok) return;
    await api(`/students/${student.id}`, { method: "DELETE" });
    setNotice("Data siswa berhasil dihapus.");
    onChanged();
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = file.name.toLowerCase().endsWith(".csv")
      ? parseCsv(await file.text())
      : rowsToObjects(await readXlsxFile(file));
    const result = await api("/students/bulk", { method: "POST", body: JSON.stringify({ students: rows }) });
    setNotice(`Import selesai: ${result.created} baru, ${result.updated} diperbarui, ${result.skipped} dilewati.`);
    event.target.value = "";
    setModal("");
    onChanged();
  }

  async function generateFilteredPasswords() {
    if (!filtered.length) {
      setNotice("Tidak ada siswa sesuai filter untuk dibuatkan password.");
      return;
    }
    const ok = window.confirm(`Generate ulang password untuk ${filtered.length} siswa sesuai filter saat ini? Kartu peserta lama harus dicetak ulang.`);
    if (!ok) return;
    const result = await api("/students/passwords", {
      method: "POST",
      body: JSON.stringify({ studentIds: filtered.map((student) => student.id) })
    });
    setNotice(`${result.updated} password siswa berhasil dibuat ulang. Cetak ulang kartu peserta setelah perubahan ini.`);
    onChanged();
  }

  async function deleteAllStudents() {
    setDeleteAllLoading(true);
    try {
      const result = await api("/students/delete-all", {
        method: "POST",
        body: JSON.stringify({ password: deleteAllPassword, confirmation: deleteAllConfirmation })
      });
      setNotice(`${result.deletedStudents} siswa, ${result.deletedAttempts} attempt/hasil, dan ${result.deletedViolations} log pelanggaran berhasil dihapus.`);
      setModal("");
      setDeleteAllPassword("");
      setDeleteAllConfirmation("");
      setPage(1);
      onChanged();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setDeleteAllLoading(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-toolbar">
          <div className="toolbar-actions">
            <button type="button" onClick={() => setModal("bulk")}><Upload size={18} /> Upload Bulk</button>
            <button type="button" onClick={() => { reset(); setModal("form"); }}><Plus size={18} /> Tambah Siswa</button>
            <button type="button" className="ghost-button" onClick={generateFilteredPasswords}><KeyRound size={18} /> Generate Password Filter</button>
            <button type="button" className="danger-button" onClick={() => setModal("deleteAll")} disabled={!students.length}><Trash2 size={18} /> Hapus Semua Siswa</button>
          </div>
          <label className="search-box">
            <Search size={16} />
            <input value={query} placeholder="Cari siswa..." onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
          </label>
        </div>
        <PanelTitle icon={Users} title="Daftar Siswa" />
        {notice ? <div className="success-box">{notice}</div> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>NIS</th>
                <th>NISN</th>
                <th>Nama</th>
                <th>L/P</th>
                <th>Agama</th>
                <th>Kelas</th>
                <th>Mapel Pilihan 1</th>
                <th>Mapel Pilihan 2</th>
                <th>Mapel Pilihan 3</th>
                <th>Mapel Pilihan 4</th>
                <th>Mapel Pilihan 5</th>
                <th>Username</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {paged.items.map((student) => (
                <tr key={student.id}>
                  <td>{student.nis}</td>
                  <td>{student.nisn || "-"}</td>
                  <td>{student.name}</td>
                  <td>{student.gender || "-"}</td>
                  <td>{formatReligion(student) || "-"}</td>
                  <td>{student.className}</td>
                  <td>{formatElectiveSubjects(student)[0] || "-"}</td>
                  <td>{formatElectiveSubjects(student)[1] || "-"}</td>
                  <td>{formatElectiveSubjects(student)[2] || "-"}</td>
                  <td>{formatElectiveSubjects(student)[3] || "-"}</td>
                  <td>{formatElectiveSubjects(student)[4] || "-"}</td>
                  <td><code>{student.username}</code></td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="small-button" onClick={() => edit(student)}>Edit</button>
                      <button type="button" className="danger-button" onClick={() => remove(student)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationControls
          page={paged.currentPage}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        />
      </section>

      {modal === "form" ? (
        <Modal title={editingId ? "Edit Siswa" : "Tambah Siswa"} icon={editingId ? Save : Plus} onClose={() => { reset(); setModal(""); }} wide>
          <form className="student-form" onSubmit={submit}>
            <div className="inline-fields">
              <label>NIS<input value={form.nis} onChange={(event) => setForm({ ...form, nis: event.target.value })} required /></label>
              <label>NISN<input value={form.nisn} onChange={(event) => setForm({ ...form, nisn: event.target.value })} /></label>
            </div>
            <div className="inline-fields">
              <label>Kelas<input value={form.className} onChange={(event) => setForm({ ...form, className: event.target.value })} required /></label>
              <label>L/P<input value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value.toUpperCase() })} /></label>
              <label>Agama
                <select value={form.religion} onChange={(event) => setForm({ ...form, religion: event.target.value })}>
                  <option value="">Pilih agama...</option>
                  {RELIGION_OPTIONS.map((religion) => <option value={religion} key={religion}>{religion}</option>)}
                </select>
              </label>
            </div>
            <label>Nama Siswa<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
            <div className="inline-fields">
              <label>Mapel Pilihan 1<input value={form.mapelPilihan1} placeholder="Contoh: Informatika 2" onChange={(event) => setForm({ ...form, mapelPilihan1: event.target.value })} /></label>
              <label>Mapel Pilihan 2<input value={form.mapelPilihan2} placeholder="Contoh: Sejarah TL 2" onChange={(event) => setForm({ ...form, mapelPilihan2: event.target.value })} /></label>
            </div>
            <div className="inline-fields">
              <label>Mapel Pilihan 3<input value={form.mapelPilihan3} onChange={(event) => setForm({ ...form, mapelPilihan3: event.target.value })} /></label>
              <label>Mapel Pilihan 4<input value={form.mapelPilihan4} onChange={(event) => setForm({ ...form, mapelPilihan4: event.target.value })} /></label>
              <label>Mapel Pilihan 5<input value={form.mapelPilihan5} onChange={(event) => setForm({ ...form, mapelPilihan5: event.target.value })} /></label>
            </div>
            <div className="inline-fields">
              <label>Username<input value={form.username} placeholder="Default NIS" onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
              <label>Password<input value={form.password} placeholder="Kosongkan = random 6 karakter" onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
            </div>
            <div className="form-actions">
              <button type="submit"><Save size={18} /> {editingId ? "Simpan Perubahan" : "Tambah Siswa"}</button>
              <button type="button" className="ghost-button" onClick={() => { reset(); setModal(""); }}>Batal</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "bulk" ? (
        <Modal title="Upload Bulk Siswa" icon={Upload} onClose={() => setModal("")} wide>
          <div className="import-box">
            <strong>Import Excel/CSV</strong>
            <p>Header yang didukung: `nis`, `nisn`, `name`, `gender`, `agama`, `className`, `username`, `password`, `Mapel Pilihan 1`, sampai `Mapel Pilihan 5`.</p>
            <p>Kolom `password` boleh dikosongkan. Siswa baru akan otomatis mendapat password random 6 karakter huruf/angka.</p>
            <p>Gunakan file `.xlsx` atau `.csv`. Jika file masih `.xls` lama, buka di Excel lalu `Save As` menjadi `.xlsx` terlebih dahulu.</p>
            <div className="sample-table">
              <div>nis</div><div>nisn</div><div>name</div><div>agama</div><div>className</div><div>Mapel Pilihan 1</div><div>Mapel Pilihan 2</div>
              <div>10676</div><div>0062721508</div><div>AGISFA ROCHMANY ALFATH</div><div>Islam</div><div>XII.2</div><div>Informatika 2</div><div>Sejarah TL 2</div>
            </div>
            <button type="button" className="ghost-button" onClick={downloadStudentTemplate}><Upload size={18} /> Download Contoh CSV</button>
            <label className="file-button">
              <Upload size={18} />
              Pilih File
              <input type="file" accept=".xlsx,.csv" onChange={importFile} />
            </label>
          </div>
        </Modal>
      ) : null}

      {modal === "deleteAll" ? (
        <PasswordConfirmModal
          title="Hapus Semua Siswa"
          icon={Trash2}
          description={`Tindakan ini akan menghapus ${students.length} siswa, akun siswa, sesi login, attempt/hasil ujian, dan log pelanggaran terkait siswa. Data tidak dapat dikembalikan karena arsip belum dibuat.`}
          confirmText="HAPUS SISWA"
          actionLabel="Hapus Semua Siswa"
          password={deleteAllPassword}
          setPassword={setDeleteAllPassword}
          confirmation={deleteAllConfirmation}
          setConfirmation={setDeleteAllConfirmation}
          loading={deleteAllLoading}
          onCancel={() => { setModal(""); setDeleteAllPassword(""); setDeleteAllConfirmation(""); }}
          onConfirm={deleteAllStudents}
        />
      ) : null}
    </div>
  );
}

function ParticipantCards({ students }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [printSize, setPrintSize] = useState("compact");

  const filtered = students.filter((student) => {
    const text = `${student.nis} ${student.name} ${student.className} ${formatElectiveSubjects(student).join(" ")}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });
  const paged = getPageItems(filtered, page, pageSize);

  function Card({ student }) {
    return (
      <article className="print-card" key={student.id}>
        <div className="print-card-head">
          <div>
            <span>CBT SMAN 94 Jakarta</span>
            <strong>Kartu Peserta Ujian</strong>
          </div>
        </div>
        <div className="print-fields">
          <span>Nama</span><strong>{student.name}</strong>
          <span>NIS</span><strong>{student.nis}</strong>
          <span>Kelas</span><strong>{student.className}</strong>
          <span>User</span><strong className="credential-value">{student.username}</strong>
          <span>Pass</span><strong className="credential-value">{student.password}</strong>
        </div>
      </article>
    );
  }

  return (
    <div className={`cards-page print-size-${printSize}`}>
      <section className="panel no-print">
        <div className="panel-toolbar">
          <PanelTitle icon={CreditCard} title="Cetak Kartu Peserta" />
          <div className="print-actions">
            <label className="print-size-control">
              <span>Ukuran Cetak</span>
              <select value={printSize} onChange={(event) => setPrintSize(event.target.value)}>
                <option value="large">Besar</option>
                <option value="medium">Sedang</option>
                <option value="compact">Hemat</option>
              </select>
            </label>
            <label className="search-box">
              <Search size={16} />
              <input value={query} placeholder="Filter kartu..." onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
            </label>
            <button type="button" onClick={() => window.print()}><Printer size={18} /> Cetak</button>
          </div>
        </div>
        <p className="muted">QR code disembunyikan dulu sampai fitur scan pengawas/guru dipakai. Mode Hemat menjadi default agar lebih banyak kartu muat dalam A4. Saat klik cetak, semua kartu sesuai filter ikut tercetak.</p>
      </section>
      <div className="no-print">
        <PaginationControls
          page={paged.currentPage}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          pageSizeOptions={[30, 45, 60]}
          itemLabel="kartu"
          compact
        />
      </div>
      <section className="print-grid screen-card-grid">
        {paged.items.map((student) => <Card student={student} key={student.id} />)}
      </section>
      <div className="no-print">
        <PaginationControls
          page={paged.currentPage}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          pageSizeOptions={[30, 45, 60]}
          itemLabel="kartu"
          compact
        />
      </div>
      <section className="print-grid print-only">
        {filtered.map((student) => <Card student={student} key={student.id} />)}
      </section>
    </div>
  );
}

function ExamManager({ exams, questions = [], teachers = [], onChanged, onExit }) {
  const emptyForm = {
    code: "",
    subject: "",
    teacherIds: [],
    date: "",
    startTime: "",
    endTime: "",
    durationMinutes: 90,
    submitUnlockMinutes: 30,
    status: "draft",
    randomizeQuestions: true,
    randomizeOptions: true
  };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [notice, setNotice] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [reviewExamId, setReviewExamId] = useState("");
  const [questionEditMode, setQuestionEditMode] = useState(false);
  const [questionEditingId, setQuestionEditingId] = useState("");
  const [questionForm, setQuestionForm] = useState(createDefaultQuestion());
  const [teacherToAdd, setTeacherToAdd] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateSort, setDateSort] = useState("asc");
  const [resetExamId, setResetExamId] = useState("");
  const [resetParticipants, setResetParticipants] = useState([]);
  const [resetSelectedIds, setResetSelectedIds] = useState([]);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetStatusFilter, setResetStatusFilter] = useState("all");
  const [resetQuery, setResetQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const reviewExam = exams.find((exam) => exam.id === reviewExamId);
  const reviewQuestions = questions.filter((question) => question.examId === reviewExamId);
  const resetExam = exams.find((exam) => exam.id === resetExamId);
  const selectedTeachers = teachers.filter((teacher) => form.teacherIds.includes(teacher.id));
  const availableTeachers = teachers.filter((teacher) => !form.teacherIds.includes(teacher.id));
  const questionWeightByExam = useMemo(() => {
    const map = new Map();
    for (const question of questions) {
      const current = map.get(question.examId) || { count: 0, total: 0 };
      current.count += 1;
      current.total += Number(question.score || 0);
      map.set(question.examId, current);
    }
    return map;
  }, [questions]);
  const visibleExams = useMemo(() => {
    const sortValue = (exam) => {
      const timestamp = new Date(`${exam.date || "9999-12-31"}T${exam.startTime || "00:00"}:00`).getTime();
      return Number.isFinite(timestamp) ? timestamp : 0;
    };
    return exams
      .filter((exam) => statusFilter === "all" || exam.status === statusFilter)
      .slice()
      .sort((a, b) => (dateSort === "asc" ? sortValue(a) - sortValue(b) : sortValue(b) - sortValue(a)));
  }, [exams, statusFilter, dateSort]);
  const pagedExams = getPageItems(visibleExams, page, pageSize);
  const participantStats = useMemo(() => {
    const scores = resetParticipants
      .map((attempt) => Number(attempt.score?.percent))
      .filter((score) => Number.isFinite(score));
    return {
      total: resetParticipants.length,
      submitted: resetParticipants.filter((attempt) => attempt.status === "submitted").length,
      inProgress: resetParticipants.filter((attempt) => attempt.status === "in_progress").length,
      notStarted: resetParticipants.filter((attempt) => attempt.status !== "submitted" && attempt.status !== "in_progress").length,
      average: scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100 : "-",
      highest: scores.length ? Math.max(...scores) : "-",
      lowest: scores.length ? Math.min(...scores) : "-"
    };
  }, [resetParticipants]);
  const filteredResetParticipants = useMemo(() => {
    const query = resetQuery.toLowerCase();
    return resetParticipants.filter((attempt) => {
      const statusMatch = resetStatusFilter === "all" || attempt.status === resetStatusFilter || (resetStatusFilter === "not_started" && attempt.status !== "submitted" && attempt.status !== "in_progress");
      const text = `${attempt.studentName} ${attempt.className} ${attempt.examCode}`.toLowerCase();
      return statusMatch && text.includes(query);
    });
  }, [resetParticipants, resetQuery, resetStatusFilter]);

  function edit(exam) {
    setEditingId(exam.id);
    setForm({
      code: exam.code,
      subject: exam.subject,
      teacherIds: exam.teacherIds || (exam.teacherId ? [exam.teacherId] : []),
      date: exam.date,
      startTime: exam.startTime,
      endTime: exam.endTime || deriveEndTime(exam.startTime, exam.durationMinutes),
      durationMinutes: exam.durationMinutes,
      submitUnlockMinutes: exam.submitUnlockMinutes ?? 30,
      status: exam.status,
      randomizeQuestions: exam.randomizeQuestions,
      randomizeOptions: exam.randomizeOptions
    });
    setTeacherToAdd("");
    setNotice("");
    setModalOpen(true);
  }

  function reset() {
    setEditingId("");
    setForm(emptyForm);
    setTeacherToAdd("");
  }

  function addTeacherToExam() {
    if (!teacherToAdd || form.teacherIds.includes(teacherToAdd)) return;
    setForm({ ...form, teacherIds: [...form.teacherIds, teacherToAdd] });
    setTeacherToAdd("");
  }

  function removeTeacherFromExam(teacherId) {
    setForm({ ...form, teacherIds: form.teacherIds.filter((id) => id !== teacherId) });
  }

  function resetQuestionForm(examId = reviewExamId) {
    setQuestionEditingId("");
    setQuestionForm(createDefaultQuestion(examId));
  }

  function openQuestionReview(exam) {
    setReviewExamId(exam.id);
    setQuestionEditMode(false);
    resetQuestionForm(exam.id);
    setNotice("");
  }

  function closeQuestionReview() {
    setReviewExamId("");
    setQuestionEditMode(false);
    resetQuestionForm("");
  }

  function editQuestionFromReview(question) {
    setQuestionEditMode(true);
    setQuestionEditingId(question.id);
    setQuestionForm(normalizeQuestionForForm(question, reviewExamId));
  }

  async function submit(event) {
    event.preventDefault();
    const payload = {
      ...form,
      durationMinutes: deriveDurationMinutes(form.startTime, form.endTime, form.durationMinutes)
    };
    if (editingId) {
      await api(`/exams/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      setNotice("Ujian berhasil diperbarui.");
    } else {
      await api("/exams", { method: "POST", body: JSON.stringify(payload) });
      setNotice("Ujian baru berhasil dibuat.");
    }
    reset();
    setModalOpen(false);
    onChanged();
  }

  async function setStatus(exam, status) {
    if (status === "published" && exam.reviewStatus !== "reviewed") {
      const ok = window.confirm("Soal ujian ini belum ditandai Sudah Dicek. Tetap publish ujian?");
      if (!ok) return;
    }
    try {
      await api(`/exams/${exam.id}`, { method: "PUT", body: JSON.stringify({ ...exam, status }) });
      setNotice(status === "published" ? "Ujian dipublish dan bisa diakses peserta." : "Status ujian diperbarui.");
      onChanged();
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function openResetExam(exam) {
    setResetExamId(exam.id);
    setResetParticipants([]);
    setResetSelectedIds([]);
    setResetStatusFilter("all");
    setResetQuery("");
    setResetLoading(true);
    setNotice("");
    try {
      const participants = await api(`/exams/${exam.id}/participants`);
      setResetParticipants(participants);
    } catch (error) {
      setNotice(error.message);
      setResetExamId("");
    } finally {
      setResetLoading(false);
    }
  }

  function closeResetExam() {
    setResetExamId("");
    setResetParticipants([]);
    setResetSelectedIds([]);
    setResetStatusFilter("all");
    setResetQuery("");
  }

  function toggleResetStudent(studentId) {
    setResetSelectedIds((current) => current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId]);
  }

  async function resetSelectedAttempts() {
    if (!resetExam || !resetSelectedIds.length) return;
    const ok = window.confirm(`Reset ${resetSelectedIds.length} peserta pada ujian ${resetExam.subject}? Jawaban dan nilai peserta terpilih akan dikosongkan.`);
    if (!ok) return;
    setResetLoading(true);
    try {
      const result = await api(`/exams/${resetExam.id}/attempts/reset`, {
        method: "POST",
        body: JSON.stringify({ studentIds: resetSelectedIds })
      });
      setNotice(`${result.reset || resetSelectedIds.length} peserta berhasil direset.`);
      closeResetExam();
      await onChanged();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setResetLoading(false);
    }
  }

  function formatParticipantStatus(status) {
    if (status === "submitted") return "Selesai";
    if (status === "in_progress") return "Sedang Mengerjakan";
    return "Tidak Mengerjakan";
  }

  function downloadParticipantExcel() {
    if (!resetExam) return;
    const headers = ["nama", "kelas", "status", "nilai", "mulai", "submit", "update"];
    const rows = filteredResetParticipants.map((attempt) => [
      attempt.studentName,
      attempt.className,
      formatParticipantStatus(attempt.status),
      attempt.score?.percent ?? "",
      formatDateTime(attempt.startedAt),
      formatDateTime(attempt.submittedAt),
      formatDateTime(attempt.updatedAt)
    ]);
    downloadHtmlExcel({
      filename: `status-peserta-${resetExam.code || resetExam.subject}.xls`,
      sheetTitle: `Status Peserta ${resetExam.code || resetExam.subject}`,
      headers,
      rows
    });
  }

  function renderParticipantButton(exam) {
    return (
      <button type="button" className="participant-count-button" onClick={() => openResetExam(exam)} disabled={!exam.participantCount}>
        {exam.participantCount || 0} Peserta
      </button>
    );
  }

  function renderQuestionWeight(exam) {
    const weight = questionWeightByExam.get(exam.id) || { count: 0, total: 0 };
    const total = roundScore(weight.total);
    const complete = weight.count > 0 && Math.abs(total - 100) < 0.01;
    const empty = weight.count === 0;
    return (
      <div className="exam-weight-cell">
        <span className={`weight-status-pill ${complete ? "complete" : empty ? "empty" : "warning"}`}>
          {total} / 100
        </span>
        <small>{weight.count} soal</small>
      </div>
    );
  }

  function renderPayloadInfo(exam) {
    const analysis = exam.payloadAnalysis;
    if (!analysis) return <span className="muted">-</span>;
    return (
      <div className="exam-payload-cell" title={analysis.message}>
        <span className={`payload-status-pill ${analysis.level || "small"}`}>
          {analysis.label || formatBytes(analysis.bytes)}
        </span>
        <small>{analysis.recommendedDeliveryMode === "progressive" ? "Bertahap" : "Penuh"}</small>
      </div>
    );
  }

  async function setReviewStatus(exam, reviewStatus) {
    await api(`/exams/${exam.id}`, { method: "PUT", body: JSON.stringify({ ...exam, reviewStatus }) });
    setNotice(reviewStatus === "reviewed" ? "Soal ujian ditandai sudah dicek admin." : "Soal ujian ditandai perlu revisi.");
    await onChanged();
  }

  async function submitReviewQuestion(event) {
    event.preventDefault();
    if (!reviewExam) return;
    const payload = { ...cleanQuestionForSubmit(questionForm), examId: reviewExam.id };
    if (questionEditingId) {
      await api(`/questions/${questionEditingId}`, { method: "PUT", body: JSON.stringify(payload) });
      setNotice("Soal berhasil diperbarui admin.");
    } else {
      await api("/questions", { method: "POST", body: JSON.stringify(payload) });
      setNotice("Soal baru berhasil ditambahkan admin.");
    }
    resetQuestionForm(reviewExam.id);
    await onChanged();
  }

  async function removeReviewQuestion(question) {
    const ok = window.confirm("Hapus soal ini dari paket ujian?");
    if (!ok) return;
    await api(`/questions/${question.id}`, { method: "DELETE" });
    if (questionEditingId === question.id) resetQuestionForm(question.examId);
    setNotice("Soal berhasil dihapus.");
    await onChanged();
  }

  async function remove(exam) {
    const ok = window.confirm(`Hapus ujian ${exam.code}? Soal dan attempt terkait ikut terhapus.`);
    if (!ok) return;
    await api(`/exams/${exam.id}`, { method: "DELETE" });
    setNotice("Ujian berhasil dihapus.");
    onChanged();
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-toolbar">
          <div className="toolbar-actions">
            <button type="button" onClick={() => { reset(); setModalOpen(true); }}><Plus size={18} /> Tambah Ujian</button>
          </div>
        </div>
        <div className="exam-list-head">
          <PanelTitle icon={ClipboardList} title="Daftar Ujian" />
          <label className="compact-filter">
            Status
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
              <option value="all">Semua</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        </div>
        {notice ? <div className="success-box">{notice}</div> : null}
        <div className="table-wrap">
          <table className="exam-table">
            <thead>
              <tr>
                <th>Peserta</th>
                <th>Mapel / Kode</th>
                <th>Guru</th>
                <th>
                  <button type="button" className="table-sort-button" onClick={() => { setDateSort((value) => value === "asc" ? "desc" : "asc"); setPage(1); }}>
                    Tanggal {dateSort === "asc" ? "ASC" : "DESC"}
                  </button>
                </th>
                <th>Waktu</th>
                <th>Bobot Soal</th>
                <th>Ukuran</th>
                <th>Review Soal</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {pagedExams.items.map((exam) => (
                <tr key={exam.id}>
                  <td>{renderParticipantButton(exam)}</td>
                  <td>
                    <div className="exam-subject-cell">
                      <strong>{exam.subject}</strong>
                      <span>{exam.code}</span>
                    </div>
                  </td>
                  <td>{exam.teacherNames?.join(", ") || "-"}</td>
                  <td>{exam.date}</td>
                  <td>{formatExamTimeRange(exam)}</td>
                  <td>{renderQuestionWeight(exam)}</td>
                  <td>{renderPayloadInfo(exam)}</td>
                  <td><ReviewStatusIcon status={exam.reviewStatus} /></td>
                  <td><span className={examStatusClass(exam.status)}>{formatExamStatus(exam.status)}</span></td>
                  <td>
                    <div className="row-actions exam-row-actions">
                      <button type="button" className="small-button exam-action-button" onClick={() => openQuestionReview(exam)}>Lihat Soal</button>
                      <button type="button" className="small-button exam-action-button" onClick={() => edit(exam)}>Edit</button>
                      <button type="button" className="small-button exam-action-button" onClick={() => setStatus(exam, exam.status === "published" ? "closed" : "published")}>
                        {exam.status === "published" ? "Tutup" : "Publish"}
                      </button>
                      <button type="button" className="danger-button" onClick={() => remove(exam)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleExams.length ? null : (
                <tr><td colSpan="10">Belum ada ujian sesuai filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls
          page={pagedExams.currentPage}
          pageSize={pageSize}
          total={visibleExams.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          pageSizeOptions={[10, 25, 50]}
          itemLabel="ujian"
          compact
        />
      </section>

      {modalOpen ? (
        <Modal title={editingId ? "Edit Ujian" : "Tambah Ujian"} icon={CalendarDays} onClose={() => { reset(); setModalOpen(false); }} wide>
          <form className="student-form" onSubmit={submit}>
            <div className="inline-fields">
              <label>Kode Ujian<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required /></label>
            </div>
            <label>Mata Pelajaran<input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} required /></label>
            <div className="field-control">
              <span>Guru Penanggung Jawab</span>
              <div className="teacher-picker">
                <div className="teacher-picker-row">
                  <select value={teacherToAdd} onChange={(event) => setTeacherToAdd(event.target.value)} disabled={!availableTeachers.length}>
                    <option value="">{availableTeachers.length ? "Pilih guru..." : "Semua guru sudah dipilih"}</option>
                    {availableTeachers.map((teacher) => <option value={teacher.id} key={teacher.id}>{teacher.name}</option>)}
                  </select>
                  <button type="button" className="ghost-button" onClick={addTeacherToExam} disabled={!teacherToAdd}>Tambah Guru</button>
                </div>
                <div className="selected-teachers">
                  {selectedTeachers.map((teacher) => (
                    <span className="teacher-chip" key={teacher.id}>
                      {teacher.name}
                      <button type="button" aria-label={`Hapus ${teacher.name}`} onClick={() => removeTeacherFromExam(teacher.id)}>x</button>
                    </span>
                  ))}
                  {selectedTeachers.length ? null : <p className="muted">Belum ada guru penanggung jawab.</p>}
                </div>
                {teachers.length ? null : <p className="muted">Belum ada guru. Tambahkan guru di menu Data Guru terlebih dahulu.</p>}
              </div>
            </div>
            <div className="inline-fields">
              <label>Tanggal<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></label>
              <label>Jam Mulai<input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value, endTime: deriveEndTime(event.target.value, form.durationMinutes) })} required /></label>
              <label>Jam Selesai<input type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} required /></label>
            </div>
            <div className="inline-fields">
              <label>Durasi Menit<input type="number" min="1" value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value, endTime: form.startTime ? deriveEndTime(form.startTime, event.target.value) : form.endTime })} /></label>
              <label>Submit Tersedia<input type="number" min="0" value={form.submitUnlockMinutes} onChange={(event) => setForm({ ...form, submitUnlockMinutes: event.target.value })} /><span className="field-hint">Menit terakhir sebelum ujian selesai. Default 30.</span></label>
              <label>Status
                <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
            </div>
            <label className="check-row"><input type="checkbox" checked={form.randomizeQuestions} onChange={(event) => setForm({ ...form, randomizeQuestions: event.target.checked })} /> Acak soal</label>
            <label className="check-row"><input type="checkbox" checked={form.randomizeOptions} onChange={(event) => setForm({ ...form, randomizeOptions: event.target.checked })} /> Acak opsi jawaban</label>
            <div className="form-actions">
              <button type="submit"><Save size={18} /> {editingId ? "Simpan Ujian" : "Tambah Ujian"}</button>
              <button type="button" className="ghost-button" onClick={() => { reset(); setModalOpen(false); }}>Batal</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {reviewExam ? (
        <Modal title={`Review Soal - ${reviewExam.code}`} icon={BookOpen} onClose={closeQuestionReview} wide>
          <div className="review-head">
            <div>
              <strong>{reviewExam.subject}</strong>
              <span>{reviewExam.date} | {formatExamTimeRange(reviewExam)} | {reviewQuestions.length} soal</span>
            </div>
            <span className={reviewStatusClass(reviewExam.reviewStatus)}>{formatReviewStatus(reviewExam.reviewStatus)}</span>
          </div>
          <div className="form-actions">
            <button type="button" onClick={() => { setQuestionEditMode((value) => !value); resetQuestionForm(reviewExam.id); }}>
              <BookOpen size={18} /> {questionEditMode ? "Selesai Edit" : "Edit Soal"}
            </button>
            <button type="button" className="ghost-button" onClick={() => setReviewStatus(reviewExam, "reviewed")}>Tandai Sudah Dicek</button>
            <button type="button" className="ghost-button" onClick={() => setReviewStatus(reviewExam, "needs_revision")}>Perlu Revisi</button>
          </div>

          {questionEditMode ? (
            <div className="review-editor">
              <strong>{questionEditingId ? "Edit Soal Terpilih" : "Tambah Soal Baru"}</strong>
              <QuestionEditor
                form={questionForm}
                setForm={setQuestionForm}
                exams={[reviewExam]}
                onSubmit={submitReviewQuestion}
                editingId={questionEditingId}
                onCancel={() => resetQuestionForm(reviewExam.id)}
              />
            </div>
          ) : null}

          <div className="question-list review-question-list">
            {reviewQuestions.map((question, index) => (
              <div className="question-summary-card" key={question.id}>
                <QuestionSummary question={question} index={index} />
                {questionEditMode ? (
                  <div className="row-actions">
                    <button type="button" className="small-button" onClick={() => editQuestionFromReview(question)}>Edit</button>
                    <button type="button" className="danger-button" onClick={() => removeReviewQuestion(question)}><Trash2 size={15} /></button>
                  </div>
                ) : null}
              </div>
            ))}
            {reviewQuestions.length ? null : <p className="muted">Belum ada soal pada ujian ini.</p>}
          </div>
        </Modal>
      ) : null}

      {resetExam ? (
        <Modal title={`Peserta Ujian - ${resetExam.subject}`} icon={Users} onClose={closeResetExam} wide>
          <div className="reset-exam-modal participant-detail-modal">
            <div className="participant-stat-grid">
              <div><span>Total</span><strong>{participantStats.total}</strong></div>
              <div><span>Selesai</span><strong>{participantStats.submitted}</strong></div>
              <div><span>Sedang Mengerjakan</span><strong>{participantStats.inProgress}</strong></div>
              <div><span>Tidak Mengerjakan</span><strong>{participantStats.notStarted}</strong></div>
              <div><span>Rata-rata</span><strong>{participantStats.average}</strong></div>
              <div><span>Tertinggi</span><strong>{participantStats.highest}</strong></div>
              <div><span>Terendah</span><strong>{participantStats.lowest}</strong></div>
            </div>
            <div className="participant-modal-controls">
              <label className="compact-filter">
                Status
                <select value={resetStatusFilter} onChange={(event) => setResetStatusFilter(event.target.value)}>
                  <option value="all">Semua</option>
                  <option value="submitted">Selesai</option>
                  <option value="in_progress">Sedang Mengerjakan</option>
                  <option value="not_started">Tidak Mengerjakan</option>
                </select>
              </label>
              <label className="search-box">
                <Search size={17} />
                <input value={resetQuery} onChange={(event) => setResetQuery(event.target.value)} placeholder="Cari peserta..." />
              </label>
              <button type="button" className="ghost-button" onClick={downloadParticipantExcel} disabled={!filteredResetParticipants.length}><Download size={18} /> Download Excel</button>
            </div>
            <div className="reset-actions">
              <button type="button" className="ghost-button" onClick={() => setResetSelectedIds(filteredResetParticipants.map((attempt) => attempt.studentId))} disabled={!filteredResetParticipants.length || resetLoading}>Pilih Tampil</button>
              <button type="button" className="ghost-button" onClick={() => setResetSelectedIds([])} disabled={!resetParticipants.length || resetLoading}>Kosongkan</button>
              <span>{resetSelectedIds.length} dipilih untuk reset</span>
            </div>
            <p className="muted">Reset hanya untuk peserta yang dicentang. Jawaban, nilai, waktu mulai, dan urutan acak peserta terpilih akan dikosongkan.</p>
            <div className="table-wrap reset-table-wrap">
              <table className="reset-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Siswa</th>
                    <th>Kelas</th>
                    <th>Status</th>
                    <th>Nilai</th>
                    <th>Mulai</th>
                    <th>Submit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResetParticipants.map((attempt) => (
                    <tr key={attempt.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={resetSelectedIds.includes(attempt.studentId)}
                          onChange={() => toggleResetStudent(attempt.studentId)}
                        />
                      </td>
                      <td>{attempt.studentName}</td>
                      <td>{attempt.className}</td>
                      <td>{formatParticipantStatus(attempt.status)}</td>
                      <td>{attempt.score?.percent ?? "-"}</td>
                      <td>{formatDateTime(attempt.startedAt)}</td>
                      <td>{formatDateTime(attempt.submittedAt)}</td>
                    </tr>
                  ))}
                  {filteredResetParticipants.length ? null : (
                    <tr><td colSpan="7">{resetLoading ? "Memuat peserta..." : "Tidak ada peserta sesuai filter."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="form-actions">
              <button type="button" onClick={resetSelectedAttempts} disabled={!resetSelectedIds.length || resetLoading}><RefreshCw size={18} /> Reset Peserta Terpilih</button>
              <button type="button" className="ghost-button" onClick={closeResetExam}>Batal</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function ExamParticipants({ exams, students, attempts, onChanged }) {
  const [selectedExamId, setSelectedExamId] = useState(exams[0]?.id || "");
  const [classFilter, setClassFilter] = useState("");
  const [electiveFilter, setElectiveFilter] = useState("");
  const [religionFilter, setReligionFilter] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    if (!selectedExamId && exams[0]) setSelectedExamId(exams[0].id);
  }, [exams, selectedExamId]);

  const selectedExam = exams.find((exam) => exam.id === selectedExamId);
  const selectedStudentIds = new Set(attempts.filter((attempt) => attempt.examId === selectedExamId).map((attempt) => attempt.studentId));
  const classOptions = [...new Set(students.map((student) => student.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));
  const electiveOptions = [...new Set(students.flatMap((student) => formatElectiveSubjects(student)))].sort((a, b) => a.localeCompare(b, "id"));
  const religionOptions = [...new Set(students.map((student) => formatReligion(student)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));
  const filteredStudents = students.filter((student) => {
    const matchesClass = classFilter ? student.className === classFilter : true;
    const matchesSubject = electiveFilter ? formatElectiveSubjects(student).includes(electiveFilter) : true;
    const matchesReligion = religionFilter ? formatReligion(student) === religionFilter : true;
    const text = `${student.nis} ${student.name} ${student.className} ${formatReligion(student)} ${formatElectiveSubjects(student).join(" ")}`.toLowerCase();
    return matchesClass && matchesSubject && matchesReligion && text.includes(query.toLowerCase());
  });
  const paged = getPageItems(filteredStudents, page, pageSize);

  async function toggleParticipant(studentId, checked) {
    if (!selectedExam) return;
    const current = new Set(selectedStudentIds);
    if (checked) current.add(studentId);
    else current.delete(studentId);
    await api(`/exams/${selectedExam.id}/participants`, {
      method: "PUT",
      body: JSON.stringify({ studentIds: [...current] })
    });
    onChanged();
  }

  async function selectFilteredParticipants() {
    if (!selectedExam) return;
    const nextStudentIds = new Set(selectedStudentIds);
    for (const student of filteredStudents) nextStudentIds.add(student.id);
    await api(`/exams/${selectedExam.id}/participants`, {
      method: "PUT",
      body: JSON.stringify({ studentIds: [...nextStudentIds] })
    });
    onChanged();
  }

  async function unselectFilteredParticipants() {
    if (!selectedExam) return;
    const filteredIds = new Set(filteredStudents.map((student) => student.id));
    const nextStudentIds = [...selectedStudentIds].filter((studentId) => !filteredIds.has(studentId));
    await api(`/exams/${selectedExam.id}/participants`, {
      method: "PUT",
      body: JSON.stringify({ studentIds: nextStudentIds })
    });
    onChanged();
  }

  return (
    <section className="panel">
      <div className="participant-header">
        <div className="participant-heading">
          <Users size={18} />
          <strong>Peserta Ujian</strong>
          <span className="participant-separator">|</span>
          <span>{filteredStudents.length} Siswa Tampil</span>
          <span className="participant-separator">|</span>
          <span>{selectedStudentIds.size} sudah dipilih untuk ujian ini</span>
        </div>
        <div className="participant-controls">
          <label className="field-control">
            <span>Pilih Mata Pelajaran</span>
            <select value={selectedExamId} onChange={(event) => { setSelectedExamId(event.target.value); setPage(1); }}>
              {exams.map((exam) => <option value={exam.id} key={exam.id}>{exam.code} - {exam.subject}</option>)}
            </select>
          </label>
          <label className="field-control">
            <span>Kelas</span>
            <select value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setPage(1); }}>
              <option value="">Semua Siswa</option>
              {classOptions.map((className) => <option value={className} key={className}>{className}</option>)}
            </select>
          </label>
          <label className="field-control">
            <span>Mapel Pilihan</span>
            <select value={electiveFilter} onChange={(event) => { setElectiveFilter(event.target.value); setPage(1); }}>
              <option value="">Semua Mapel Pilihan</option>
              {electiveOptions.map((subject) => <option value={subject} key={subject}>{subject}</option>)}
            </select>
          </label>
          <label className="field-control">
            <span>Agama</span>
            <select value={religionFilter} onChange={(event) => { setReligionFilter(event.target.value); setPage(1); }}>
              <option value="">Semua Agama</option>
              {religionOptions.map((religion) => <option value={religion} key={religion}>{religion}</option>)}
            </select>
          </label>
          <label className="field-control participant-search-control">
            <span>Cari Peserta</span>
            <span className="search-box">
              <Search size={16} />
              <input value={query} placeholder="Cari peserta..." onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
            </span>
          </label>
          <div className="participant-actions" aria-label="Aksi peserta berdasarkan filter aktif">
            <button type="button" onClick={selectFilteredParticipants}>Pilih Semua</button>
            <button type="button" className="ghost-button" onClick={unselectFilteredParticipants}>Uncheck Semua</button>
          </div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="participant-table">
          <thead>
            <tr>
              <th>Pilih</th>
              <th>NIS</th>
              <th>Nama</th>
              <th>Kelas</th>
              <th>Agama</th>
              <th>Mapel Pilihan</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {paged.items.map((student) => {
              const selected = selectedStudentIds.has(student.id);
              return (
                <tr key={student.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => toggleParticipant(student.id, event.target.checked)}
                    />
                  </td>
                  <td><code>{student.nis}</code></td>
                  <td><strong>{student.name}</strong></td>
                  <td>{student.className}</td>
                  <td>{formatReligion(student) || "-"}</td>
                  <td>{formatElectiveSubjects(student).join(", ") || "-"}</td>
                  <td><span className={selected ? "status-pill selected" : "status-pill"}>{selected ? "Dipilih" : "Belum"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PaginationControls
        page={paged.currentPage}
        pageSize={pageSize}
        total={filteredStudents.length}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
      />
    </section>
  );
}

function formatStoredAnswer(question, answer) {
  if (answer === undefined || answer === null || answer === "") return "-";
  if (question?.type === "multiple_response") return Array.isArray(answer) && answer.length ? answer.join(", ") : "-";
  if (question?.type === "true_false") {
    const statements = question.statements || [];
    if (!statements.length || typeof answer !== "object") return "-";
    return statements.map((statement, index) => {
      const value = answer?.[statement.id];
      const label = value === "true" ? "Benar" : value === "false" ? "Salah" : "-";
      return `${index + 1}. ${label}`;
    }).join("; ");
  }
  if (question?.type === "matching") {
    const pairs = question.pairs || [];
    if (!pairs.length || typeof answer !== "object") return "-";
    return pairs.map((pair, index) => `${index + 1}. ${answer?.[pair.id] || "-"}`).join("; ");
  }
  if (Array.isArray(answer)) return answer.join(", ") || "-";
  if (typeof answer === "object") return JSON.stringify(answer);
  return String(answer);
}

function formatCorrectAnswerForReview(question) {
  if (!question) return "-";
  if (question.type === "multiple_choice") return question.answerKey || "-";
  if (question.type === "multiple_response") return (question.correctAnswers || []).join(", ") || "-";
  if (question.type === "true_false") {
    const statements = question.statements || [];
    return statements.length
      ? statements.map((statement, index) => {
        const label = statement.answer === "true" ? "Benar" : statement.answer === "false" ? "Salah" : "-";
        return `${index + 1}. ${label}`;
      }).join("; ")
      : "-";
  }
  if (question.type === "matching") {
    const pairs = question.pairs || [];
    return pairs.length ? pairs.map((pair, index) => `${index + 1}. ${pair.right || "-"}`).join("; ") : "-";
  }
  if (question.type === "short_answer") return question.shortAnswers?.join(" / ") || "-";
  if (question.type === "essay") return "Koreksi manual";
  return "-";
}

const ANSWER_EXCEL_STYLES = {
  correct: { "background-color": "#86efac", color: "#14532d", "font-weight": "700" },
  wrong: { "background-color": "#fca5a5", color: "#7f1d1d", "font-weight": "700" },
  partial: { "background-color": "#fde68a", color: "#78350f", "font-weight": "700" },
  manual: { "background-color": "#bfdbfe", color: "#1e3a8a", "font-weight": "700" },
  empty: { "background-color": "#e5e7eb", color: "#475569", "font-weight": "700" }
};

function answerReviewForQuestion(question, answer) {
  const filled = isQuestionAnswered(question, answer);
  if (!filled) {
    return {
      key: "empty",
      label: "Kosong",
      className: "answer-review-empty",
      excelStyle: ANSWER_EXCEL_STYLES.empty
    };
  }

  const score = scoreSimulationQuestion(question, answer);
  const earned = Number(score.earned || 0);
  const total = Number(score.total || 0);
  if (score.manualPending) {
    return {
      key: "manual",
      label: "Koreksi Manual",
      className: "answer-review-manual",
      excelStyle: ANSWER_EXCEL_STYLES.manual
    };
  }
  if (total > 0 && earned >= total) {
    return {
      key: "correct",
      label: "Benar",
      className: "answer-review-correct",
      excelStyle: ANSWER_EXCEL_STYLES.correct
    };
  }
  if (earned > 0) {
    return {
      key: "partial",
      label: `Sebagian ${roundScore(earned)}/${roundScore(total)}`,
      className: "answer-review-partial",
      excelStyle: ANSWER_EXCEL_STYLES.partial
    };
  }
  return {
    key: "wrong",
    label: "Salah",
    className: "answer-review-wrong",
    excelStyle: ANSWER_EXCEL_STYLES.wrong
  };
}

function summarizeAnswerReviewRows(rows) {
  return rows.reduce((summary, row) => {
    if (row.review.key === "correct") summary.correct += 1;
    else if (row.review.key === "manual") summary.manual += 1;
    else summary.wrong += 1;
    return summary;
  }, { correct: 0, wrong: 0, manual: 0 });
}

function CorrectWrongCount({ summary }) {
  if (!summary) return "-";
  return (
    <span className="correct-wrong-count" title={summary.manual ? `${summary.manual} jawaban menunggu koreksi manual` : "Jumlah jawaban benar dan salah"}>
      <span className="answer-count-badge correct">{summary.correct}</span>
      <span className="answer-count-separator">/</span>
      <span className="answer-count-badge wrong">{summary.wrong}</span>
      {summary.manual ? <span className="answer-count-badge manual">{summary.manual} manual</span> : null}
    </span>
  );
}

function ResultsDashboard({ results, students, exams, questions = [], violations = [] }) {
  const [examFilter, setExamFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [electiveFilter, setElectiveFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [answerDetail, setAnswerDetail] = useState(null);
  const [resultSort, setResultSort] = useState({ key: "", direction: "asc" });

  const studentById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const examById = useMemo(() => new Map(exams.map((exam) => [exam.id, exam])), [exams]);
  const questionsByExam = useMemo(() => {
    const map = new Map();
    for (const question of questions) {
      map.set(question.examId, [...(map.get(question.examId) || []), question]);
    }
    return map;
  }, [questions]);
  const violationCountsByResult = useMemo(() => {
    const map = new Map();
    for (const violation of violations) {
      const key = `${violation.examId}-${violation.studentId}`;
      const current = map.get(key) || { info: 0, warning: 0, critical: 0, total: 0 };
      const level = normalizeViolationLevel(violation.level);
      if (level === "info") current.info += 1;
      else if (level === "warning") current.warning += 1;
      else current.critical += 1;
      current.total += 1;
      map.set(key, current);
    }
    return map;
  }, [violations]);
  const classOptions = [...new Set(students.map((student) => student.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));
  const electiveOptions = [...new Set(students.flatMap((student) => formatElectiveSubjects(student)))].sort((a, b) => a.localeCompare(b, "id"));

  const enrichedResults = results.map((item) => {
    const student = studentById.get(item.studentId) || {};
    const exam = examById.get(item.examId) || {};
    const answerSummary = summarizeAnswerReviewRows(answerRowsFor(item));
    const violationCounts = violationCountsByResult.get(`${item.examId}-${item.studentId}`) || { info: 0, warning: 0, critical: 0, total: 0 };
    return {
      ...item,
      nis: student.nis || "",
      nisn: student.nisn || "",
      studentName: item.studentName || student.name || "-",
      className: item.className || student.className || "-",
      religion: formatReligion(student),
      examCode: item.examCode || exam.code || "-",
      subject: item.subject || exam.subject || "-",
      electiveSubjects: formatElectiveSubjects(student),
      answerSummary,
      violationCounts
    };
  });

  const filteredResults = enrichedResults.filter((item) => {
    const matchesExam = examFilter ? item.examId === examFilter : true;
    const matchesClass = classFilter ? item.className === classFilter : true;
    const matchesElective = electiveFilter ? item.electiveSubjects.includes(electiveFilter) : true;
    const matchesStatus = statusFilter ? item.status === statusFilter : true;
    const text = [
      item.nis,
      item.nisn,
      item.studentName,
      item.className,
      item.religion,
      item.examCode,
      item.subject,
      item.electiveSubjects.join(" ")
    ].join(" ").toLowerCase();
    return matchesExam && matchesClass && matchesElective && matchesStatus && text.includes(query.toLowerCase());
  });

  const sortedResults = applyTableSort(filteredResults, resultSort, {
    nis: (item) => item.nis,
    nisn: (item) => item.nisn,
    studentName: (item) => item.studentName,
    className: (item) => item.className,
    exam: (item) => `${item.examCode} ${item.subject}`,
    status: (item) => formatResultStatus(item.status),
    score: (item) => Number(item.score?.percent ?? -1),
    updatedAt: (item) => item.updatedAt ? new Date(item.updatedAt).getTime() : 0
  });
  const paged = getPageItems(sortedResults, page, pageSize);
  const submittedResults = filteredResults.filter((item) => item.status === "submitted");
  const averageScore = submittedResults.length
    ? Math.round(submittedResults.reduce((total, item) => total + Number(item.score?.percent || 0), 0) / submittedResults.length)
    : "-";

  function changeFilter(setter, value) {
    setter(value);
    setPage(1);
  }

  function changeResultSort(key) {
    setResultSort((current) => toggleTableSort(current, key));
    setPage(1);
  }

  function downloadFilteredResults() {
    const baseHeaders = ["nis", "nama", "kelas", "agama", "mapel_pilihan", "mata_pelajaran", "status", "nilai", "jawaban benar", "jawaban salah", "update", "log info", "log peringatan", "log berat", "total log"];
    const answerRowsByResult = new Map(sortedResults.map((item) => [item.id, answerRowsFor(item)]));
    const maxAnswerColumns = Math.max(0, ...Array.from(answerRowsByResult.values()).map((rows) => rows.length));
    const answerHeaderStyle = { "background-color": "#111827", color: "#ffffff", "font-weight": "700", "text-align": "center" };
    const answerHeaders = Array.from({ length: maxAnswerColumns }, (_, index) => ({
      value: `Jawaban ${index + 1}`,
      style: answerHeaderStyle
    }));
    const rows = sortedResults.map((item) => {
      const answerRows = answerRowsByResult.get(item.id) || [];
      const answerCells = Array.from({ length: maxAnswerColumns }, (_, index) => {
        const row = answerRows[index];
        if (!row) return { value: "", style: ANSWER_EXCEL_STYLES.empty };
        return {
          value: row.answer,
          style: row.review.excelStyle
        };
      });
      return [
        item.nis,
        item.studentName,
        item.className,
        item.religion,
        item.electiveSubjects.join("; "),
        item.subject,
        formatResultStatus(item.status),
        item.score?.percent ?? "",
        item.score ? item.answerSummary.correct : "",
        item.score ? item.answerSummary.wrong : "",
        item.updatedAt ? new Date(item.updatedAt).toLocaleString("id-ID") : "",
        item.violationCounts.info,
        item.violationCounts.warning,
        item.violationCounts.critical,
        item.violationCounts.total,
        ...answerCells
      ];
    });
    downloadHtmlExcel({
      filename: "hasil-nilai-dan-jawaban-cbt-sesuai-filter.xls",
      sheetTitle: "Hasil Nilai dan Jawaban CBT Sesuai Filter",
      headers: [...baseHeaders, ...answerHeaders],
      rows
    });
  }

  function answerRowsFor(item) {
    const examQuestions = questionsByExam.get(item.examId) || [];
    const byId = new Map(examQuestions.map((question) => [question.id, question]));
    const orderedIds = Array.isArray(item.questionOrder) && item.questionOrder.length
      ? item.questionOrder
      : examQuestions.map((question) => question.id);
    const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    const rest = examQuestions.filter((question) => !orderedIds.includes(question.id));
    return [...ordered, ...rest].map((question, index) => {
      const answer = item.answers?.[question.id];
      const review = answerReviewForQuestion(question, answer);
      return {
        question,
        number: index + 1,
        filled: review.key !== "empty",
        answer: formatStoredAnswer(question, answer),
        correctAnswer: formatCorrectAnswerForReview(question),
        review
      };
    });
  }

  return (
    <section className="panel">
      <div className="result-header">
        <PanelTitle icon={CheckCircle2} title="Hasil Nilai dan Status Peserta" />
        <button type="button" className="ghost-button" onClick={downloadFilteredResults}>
          <Download size={18} /> Download Excel
        </button>
      </div>
      <div className="result-summary">
        <StatCard icon={Users} label="Data Tampil" value={filteredResults.length} />
        <StatCard icon={CheckCircle2} label="Selesai" value={submittedResults.length} />
        <StatCard icon={PlayCircle} label="Sedang Mengerjakan" value={filteredResults.filter((item) => item.status === "in_progress").length} />
        <StatCard icon={ClipboardList} label="Rata-rata Nilai" value={averageScore} />
      </div>
      <div className="result-controls">
        <label className="field-control">
          <span>Ujian</span>
          <select value={examFilter} onChange={(event) => changeFilter(setExamFilter, event.target.value)}>
            <option value="">Semua Ujian</option>
            {exams.map((exam) => <option value={exam.id} key={exam.id}>{exam.code} - {exam.subject}</option>)}
          </select>
        </label>
        <label className="field-control">
          <span>Kelas</span>
          <select value={classFilter} onChange={(event) => changeFilter(setClassFilter, event.target.value)}>
            <option value="">Semua Kelas</option>
            {classOptions.map((className) => <option value={className} key={className}>{className}</option>)}
          </select>
        </label>
        <label className="field-control">
          <span>Mapel Pilihan</span>
          <select value={electiveFilter} onChange={(event) => changeFilter(setElectiveFilter, event.target.value)}>
            <option value="">Semua Mapel Pilihan</option>
            {electiveOptions.map((subject) => <option value={subject} key={subject}>{subject}</option>)}
          </select>
        </label>
        <label className="field-control">
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => changeFilter(setStatusFilter, event.target.value)}>
            <option value="">Semua Status</option>
            <option value="not_started">Belum Mengerjakan</option>
            <option value="in_progress">Sedang Mengerjakan</option>
            <option value="submitted">Selesai</option>
          </select>
        </label>
        <label className="field-control result-search-control">
          <span>Cari Siswa</span>
          <span className="search-box">
            <Search size={16} />
            <input value={query} placeholder="Cari siswa, NIS, ujian..." onChange={(event) => changeFilter(setQuery, event.target.value)} />
          </span>
        </label>
      </div>
      <div className="table-wrap">
        <table className="result-table">
          <thead>
            <tr>
              <th><SortHeader sort={resultSort} sortKey="nis" onSort={changeResultSort}>NIS</SortHeader></th>
              <th><SortHeader sort={resultSort} sortKey="nisn" onSort={changeResultSort}>NISN</SortHeader></th>
              <th><SortHeader sort={resultSort} sortKey="studentName" onSort={changeResultSort}>Nama</SortHeader></th>
              <th><SortHeader sort={resultSort} sortKey="className" onSort={changeResultSort}>Kelas</SortHeader></th>
              <th>Mapel Pilihan</th>
              <th><SortHeader sort={resultSort} sortKey="exam" onSort={changeResultSort}>Ujian</SortHeader></th>
              <th><SortHeader sort={resultSort} sortKey="status" onSort={changeResultSort}>Status</SortHeader></th>
              <th><SortHeader sort={resultSort} sortKey="score" onSort={changeResultSort}>Nilai</SortHeader></th>
              <th>Benar / Salah</th>
              <th><SortHeader sort={resultSort} sortKey="updatedAt" onSort={changeResultSort}>Update</SortHeader></th>
              <th>Jawaban</th>
            </tr>
          </thead>
          <tbody>
            {paged.items.map((item) => (
              <tr key={item.id}>
                <td><code>{item.nis || "-"}</code></td>
                <td>{item.nisn || "-"}</td>
                <td><strong>{item.studentName}</strong></td>
                <td>{item.className}</td>
                <td>{item.electiveSubjects.join(", ") || "-"}</td>
                <td><strong>{item.examCode}</strong><br /><span>{item.subject}</span></td>
                <td><span className={resultStatusClass(item.status)}>{formatResultStatus(item.status)}</span></td>
                <td>{item.score ? (item.score.manualPending ? `${item.score.percent}*` : item.score.percent) : "-"}</td>
                <td>{item.score ? <CorrectWrongCount summary={item.answerSummary} /> : "-"}</td>
                <td>{item.score?.manualPending ? "Menunggu koreksi uraian" : (item.updatedAt ? new Date(item.updatedAt).toLocaleString("id-ID") : "-")}</td>
                <td>
                  <button type="button" className="ghost-button compact-action" onClick={() => setAnswerDetail(item)}>
                    <ListChecks size={16} /> Jawaban
                  </button>
                </td>
              </tr>
            ))}
            {paged.items.length ? null : (
              <tr>
                <td colSpan="11">Belum ada data hasil sesuai filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls
        page={paged.currentPage}
        pageSize={pageSize}
        total={sortedResults.length}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
      />
      {answerDetail ? (
        <Modal title="Detail Jawaban Peserta" icon={ListChecks} onClose={() => setAnswerDetail(null)} wide>
          <div className="answer-detail-summary">
            <div><span>Peserta</span><strong>{answerDetail.studentName}</strong></div>
            <div><span>Ujian</span><strong>{answerDetail.examCode} - {answerDetail.subject}</strong></div>
            <div><span>Status</span><strong>{formatResultStatus(answerDetail.status)}</strong></div>
            <div><span>Terisi</span><strong>{answerRowsFor(answerDetail).filter((row) => row.filled).length}/{answerRowsFor(answerDetail).length}</strong></div>
          </div>
          <div className="table-wrap answer-detail-wrap">
            <table className="result-table answer-detail-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Tipe</th>
                  <th>Jawaban Masuk Server</th>
                  <th>Kunci</th>
                  <th>Benar / Salah</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {answerRowsFor(answerDetail).map((row) => (
                  <tr key={row.question.id}>
                    <td>{row.number}</td>
                    <td>{questionTypeLabel(row.question.type)}</td>
                    <td><code>{row.answer}</code></td>
                    <td><code>{row.correctAnswer}</code></td>
                    <td><span className={`answer-review-pill ${row.review.className}`}>{row.review.label}</span></td>
                    <td><span className={row.filled ? "status-pill selected" : "status-pill revision"}>{row.filled ? "Terisi" : "Kosong"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function ImageUploadField({ label, value, onChange, compact = false, buttonText = "Upload Gambar" }) {
  const [meta, setMeta] = useState("");
  const [error, setError] = useState("");

  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setMeta("Mengompres gambar...");
    try {
      const result = await compressImageFile(file);
      onChange(result.dataUrl);
      setMeta(`${Math.round(result.size / 1024)} KB | ${result.width}x${result.height}px`);
    } catch (err) {
      setError(err.message);
      setMeta("");
    } finally {
      event.target.value = "";
    }
  }

  if (compact) {
    return (
      <div className="image-upload-compact">
        {value ? <img src={value} alt={label} /> : null}
        <label className="file-button compact-file-button">
          <Upload size={16} />
          {buttonText}
          <input type="file" accept="image/*" onChange={upload} />
        </label>
        {value ? <button type="button" className="danger-button compact-danger" onClick={() => { onChange(""); setMeta(""); }}>Hapus</button> : null}
        {meta ? <span>{meta}</span> : null}
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="image-upload-box">
      <div className="image-upload-head">
        <strong>{label}</strong>
        {value ? <button type="button" className="danger-button" onClick={() => { onChange(""); setMeta(""); }}>Hapus</button> : null}
      </div>
      {value ? <img src={value} alt={label} /> : null}
      <label className="file-button">
        <Upload size={18} />
        Upload Gambar
        <input type="file" accept="image/*" onChange={upload} />
      </label>
      <p className="muted">{meta || "Gambar akan otomatis disesuaikan untuk HP/tablet dan maksimal 500 KB."}</p>
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}

function QuestionEditor({ form, setForm, exams, onSubmit, editingId, onCancel }) {
  const activeOptions = form.options || [];

  function updateOption(index, patch) {
    const options = [...activeOptions];
    options[index] = { ...options[index], ...patch };
    const optionKeys = options.map((option) => option.key);
    setForm({
      ...form,
      options,
      answerKey: optionKeys.includes(form.answerKey) ? form.answerKey : optionKeys[0] || "A",
      correctAnswers: (form.correctAnswers || []).filter((key) => optionKeys.includes(key))
    });
  }

  function addOption() {
    const used = new Set(activeOptions.map((option) => option.key));
    const nextKey = OPTION_KEYS.find((key) => !used.has(key));
    if (!nextKey) return;
    setForm({ ...form, options: [...activeOptions, { key: nextKey, text: "", image: "" }] });
  }

  function removeOption(key) {
    const options = activeOptions.filter((option) => option.key !== key);
    setForm({
      ...form,
      options,
      answerKey: form.answerKey === key ? options[0]?.key || "A" : form.answerKey,
      correctAnswers: (form.correctAnswers || []).filter((item) => item !== key)
    });
  }

  function toggleCorrectAnswer(key, checked) {
    const values = new Set(form.correctAnswers || []);
    if (checked) values.add(key);
    else values.delete(key);
    setForm({ ...form, correctAnswers: [...values] });
  }

  function updateStatement(index, patch) {
    const statements = [...(form.statements || [])];
    statements[index] = { ...statements[index], ...patch };
    setForm({ ...form, statements });
  }

  function updatePair(index, patch) {
    const pairs = [...(form.pairs || [])];
    pairs[index] = { ...pairs[index], ...patch };
    setForm({ ...form, pairs });
  }

  return (
    <form className="question-form" onSubmit={onSubmit}>
      <label>
        Paket Ujian
        <select value={form.examId} onChange={(event) => setForm({ ...createDefaultQuestion(event.target.value), examId: event.target.value })}>
          {exams.map((exam) => <option value={exam.id} key={exam.id}>{exam.code} - {exam.subject}</option>)}
        </select>
      </label>
      <div className="inline-fields">
        <label>
          Tipe Soal
          <select value={form.type} onChange={(event) => setForm({ ...normalizeQuestionForForm({ ...form, type: event.target.value }, form.examId), type: event.target.value })}>
            {QUESTION_TYPES.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}
          </select>
        </label>
        <label>
          Bobot
          <input type="number" min="0.1" step="0.01" value={form.score} onChange={(event) => setForm({ ...form, score: event.target.value })} />
        </label>
      </div>
      <div className="question-body-field">
        <div className="field-label-row">
          <span>Soal</span>
          <ImageUploadField label="Gambar Soal" value={form.image} onChange={(image) => setForm({ ...form, image })} compact buttonText="Upload Gambar Soal" />
        </div>
        <textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="Tulis pertanyaan..." required />
        <p className="muted">Semua gambar otomatis dikompres maksimal 500 KB dan disesuaikan untuk layar HP/tablet.</p>
      </div>

      {["multiple_choice", "multiple_response"].includes(form.type) ? (
        <div className="dynamic-section">
          <div className="section-head">
            <strong>Opsi Jawaban</strong>
            <button type="button" className="ghost-button" onClick={addOption} disabled={activeOptions.length >= OPTION_KEYS.length}><Plus size={16} /> Tambah Opsi</button>
          </div>
          <div className="option-editor-grid">
            {activeOptions.map((option, index) => (
              <div className="option-editor compact-option-editor" key={option.key}>
                <div className="option-editor-head">
                  <strong>Opsi {option.key}</strong>
                  <div className="option-head-actions">
                    <ImageUploadField label={`Gambar Opsi ${option.key}`} value={option.image || ""} onChange={(image) => updateOption(index, { image })} compact buttonText="Gambar" />
                    {activeOptions.length > 2 ? <button type="button" className="danger-button compact-danger" onClick={() => removeOption(option.key)}><Trash2 size={15} /></button> : null}
                  </div>
                </div>
                <input value={option.text} placeholder={`Teks opsi ${option.key}`} onChange={(event) => updateOption(index, { text: event.target.value })} />
                {form.type === "multiple_response" ? (
                  <label className="inline-check">
                    <input type="checkbox" checked={(form.correctAnswers || []).includes(option.key)} onChange={(event) => toggleCorrectAnswer(option.key, event.target.checked)} />
                    Jawaban benar
                  </label>
                ) : null}
              </div>
            ))}
          </div>
          {form.type === "multiple_choice" ? (
            <label>
              Kunci Jawaban
              <select value={form.answerKey} onChange={(event) => setForm({ ...form, answerKey: event.target.value })}>
                {activeOptions.map((option) => <option value={option.key} key={option.key}>{option.key}</option>)}
              </select>
            </label>
          ) : <p className="muted">Nilai checklist dihitung parsial: pilihan benar menambah poin, pilihan salah mengurangi bagian poin.</p>}
        </div>
      ) : null}

      {form.type === "true_false" ? (
        <div className="dynamic-section">
          <div className="section-head">
            <strong>Pernyataan Benar / Salah</strong>
            <button type="button" className="ghost-button" onClick={() => setForm({ ...form, statements: [...form.statements, { id: `st-${Date.now()}`, text: "", image: "", answer: "true" }] })}><Plus size={16} /> Tambah Pernyataan</button>
          </div>
          {form.statements.map((statement, index) => (
            <div className="statement-editor compact-statement-editor" key={statement.id}>
              <div className="option-editor-head">
                <strong>Pernyataan {index + 1}</strong>
                <div className="option-head-actions">
                  <ImageUploadField label={`Gambar Pernyataan ${index + 1}`} value={statement.image || ""} onChange={(image) => updateStatement(index, { image })} compact buttonText="Gambar" />
                  {form.statements.length > 1 ? <button type="button" className="danger-button compact-danger" onClick={() => setForm({ ...form, statements: form.statements.filter((item) => item.id !== statement.id) })}><Trash2 size={15} /></button> : null}
                </div>
              </div>
              <textarea value={statement.text} placeholder={`Pernyataan ${index + 1}`} onChange={(event) => updateStatement(index, { text: event.target.value })} />
              <label>
                Jawaban
                <select value={statement.answer} onChange={(event) => updateStatement(index, { answer: event.target.value })}>
                  <option value="true">Benar</option>
                  <option value="false">Salah</option>
                </select>
              </label>
            </div>
          ))}
          <p className="muted">Nilai benar/salah dihitung dari akurasi semua pernyataan. Jawaban yang tidak tepat tidak mendapat bagian poin.</p>
        </div>
      ) : null}

      {form.type === "matching" ? (
        <div className="dynamic-section">
          <div className="section-head">
            <strong>Pasangan Jawaban</strong>
            <button type="button" className="ghost-button" onClick={() => setForm({ ...form, pairs: [...form.pairs, { id: `pair-${Date.now()}`, left: "", right: "", leftImage: "", rightImage: "" }] })}><Plus size={16} /> Tambah Pasangan</button>
          </div>
          {form.pairs.map((pair, index) => (
            <div className="matching-editor compact-matching-editor" key={pair.id}>
              <div className="matching-pair-head">
                <strong>Pasangan {index + 1}</strong>
                {form.pairs.length > 2 ? <button type="button" className="danger-button compact-danger" onClick={() => setForm({ ...form, pairs: form.pairs.filter((item) => item.id !== pair.id) })}><Trash2 size={15} /></button> : null}
              </div>
              <div className="matching-field">
                <div className="field-label-row">
                  <span>Kolom Kiri</span>
                  <ImageUploadField label={`Gambar Kiri ${index + 1}`} value={pair.leftImage || ""} onChange={(image) => updatePair(index, { leftImage: image })} compact buttonText="Gambar" />
                </div>
                <input value={pair.left} placeholder="Isi kolom kiri..." onChange={(event) => updatePair(index, { left: event.target.value })} />
              </div>
              <div className="matching-field">
                <div className="field-label-row">
                  <span>Jawaban Pasangan</span>
                  <ImageUploadField label={`Gambar Jawaban ${index + 1}`} value={pair.rightImage || ""} onChange={(image) => updatePair(index, { rightImage: image })} compact buttonText="Gambar" />
                </div>
                <input value={pair.right} placeholder="Isi jawaban pasangan..." onChange={(event) => updatePair(index, { right: event.target.value })} />
              </div>
            </div>
          ))}
          <p className="muted">Nilai menjodohkan dihitung parsial berdasarkan jumlah pasangan yang benar dibanding total pasangan.</p>
        </div>
      ) : null}

      {form.type === "short_answer" ? (
        <div className="dynamic-section">
          <div className="section-head">
            <strong>Jawaban Benar Isian Singkat</strong>
            <button type="button" className="ghost-button" onClick={() => setForm({ ...form, shortAnswers: [...form.shortAnswers, ""] })}><Plus size={16} /> Tambah Alternatif</button>
          </div>
          <p className="muted">Masukkan jawaban benar dan variasi jawaban yang masih dianggap benar. Contoh: `Soekarno`, `Ir. Soekarno`, `Sukarno`.</p>
          {form.shortAnswers.map((answer, index) => (
            <label key={index}>
              Jawaban benar {index + 1}
              <input value={answer} onChange={(event) => {
                const shortAnswers = [...form.shortAnswers];
                shortAnswers[index] = event.target.value;
                setForm({ ...form, shortAnswers });
              }} />
            </label>
          ))}
          <div className="check-row">
            <label><input type="checkbox" checked={!form.answerRules.caseSensitive} onChange={(event) => setForm({ ...form, answerRules: { ...form.answerRules, caseSensitive: !event.target.checked } })} /> Abaikan huruf besar/kecil</label>
            <label><input type="checkbox" checked={form.answerRules.ignorePunctuation} onChange={(event) => setForm({ ...form, answerRules: { ...form.answerRules, ignorePunctuation: event.target.checked } })} /> Abaikan tanda baca ringan</label>
            <label><input type="checkbox" checked={form.answerRules.trimSpaces} onChange={(event) => setForm({ ...form, answerRules: { ...form.answerRules, trimSpaces: event.target.checked } })} /> Rapikan spasi otomatis</label>
          </div>
        </div>
      ) : null}

      {form.type === "essay" ? (
        <div className="info-box">
          Uraian panjang akan masuk ke status menunggu koreksi. Nilai akhir perlu diperiksa manual oleh guru/admin pada tahap koreksi berikutnya.
        </div>
      ) : null}

      <div className="form-actions">
        <button type="submit">{editingId ? <Save size={18} /> : <Plus size={18} />} {editingId ? "Simpan Perubahan" : "Simpan Soal"}</button>
        {editingId ? <button type="button" className="ghost-button" onClick={onCancel}>Batal</button> : null}
      </div>
    </form>
  );
}

function QuestionImage({ src, alt }) {
  return src ? <img className="question-image" src={src} alt={alt} /> : null;
}

function QuestionSummary({ question, index, showAnswers = true }) {
  return (
    <article>
      <span>Soal {index + 1} | {questionTypeLabel(question.type)}</span>
      <p>{question.body}</p>
      <QuestionImage src={question.image} alt={`Gambar soal ${index + 1}`} />
      {["multiple_choice", "multiple_response"].includes(question.type) ? (
        <div className="mini-options">
          {(question.options || []).map((option) => (
            <code key={option.key}>
              {option.key}. {option.text || "[Gambar]"}
              <QuestionImage src={option.image} alt={`Gambar opsi ${option.key}`} />
            </code>
          ))}
        </div>
      ) : null}
      {question.type === "true_false" ? (
        <div className="mini-options">
          {(question.statements || []).map((statement, idx) => <code key={statement.id}>{idx + 1}. {statement.text} {showAnswers ? `| ${statement.answer === "true" ? "Benar" : "Salah"}` : ""}</code>)}
        </div>
      ) : null}
      {question.type === "matching" ? (
        <div className="mini-options">
          {(question.pairs || []).map((pair, idx) => <code key={pair.id}>{idx + 1}. {pair.left} {showAnswers ? `-> ${pair.right}` : ""}</code>)}
        </div>
      ) : null}
      {showAnswers ? (
        <code>
          {question.type === "multiple_choice" ? `Kunci ${question.answerKey}` : null}
          {question.type === "multiple_response" ? `Kunci ${(question.correctAnswers || []).join(", ")}` : null}
          {question.type === "short_answer" ? `Jawaban ${question.shortAnswers?.join(" / ")}` : null}
          {question.type === "essay" ? "Koreksi manual" : null}
          {" | "}Bobot {question.score}
        </code>
      ) : null}
    </article>
  );
}

function formatQuestionKey(question) {
  if (question.type === "multiple_choice") return question.answerKey || "-";
  if (question.type === "multiple_response") return (question.correctAnswers || []).join(", ") || "-";
  if (question.type === "short_answer") return question.shortAnswers?.join(" / ") || "-";
  if (question.type === "essay") return "Koreksi manual";
  return "-";
}

function questionNeedsReview(question) {
  const hasPlaceholder = JSON.stringify(question).toLowerCase().includes("perlu dicek");
  if (hasPlaceholder) return true;
  if (["multiple_choice", "multiple_response"].includes(question.type) && (question.options || []).length < 2) return true;
  if (question.type === "multiple_choice" && !question.answerKey) return true;
  if (question.type === "multiple_response" && !(question.correctAnswers || []).length) return true;
  return false;
}

function QuestionCompactSummary({ question, index }) {
  const needsReview = questionNeedsReview(question);
  return (
    <article className="question-compact">
      <div className="question-compact-meta">
        <strong>Soal {index + 1}</strong>
        <span>{questionTypeLabel(question.type)}</span>
        <span>Bobot {question.score}</span>
        <span>Kunci {formatQuestionKey(question)}</span>
        {needsReview ? <span className="status-pill revision">Perlu Dicek</span> : <span className="status-pill selected">Lengkap</span>}
      </div>
      <p>{question.body}</p>
      {question.image ? <QuestionImage src={question.image} alt={`Gambar soal ${index + 1}`} /> : null}
    </article>
  );
}

function normalizeSimulationAnswer(value, rules = {}) {
  let text = String(value || "");
  if (rules.trimSpaces !== false) text = text.trim().replace(/\s+/g, " ");
  if (rules.ignorePunctuation !== false) text = text.replace(/[^\p{L}\p{N}\s]/gu, "");
  else text = text.replace(/,/g, ".");
  if (!rules.caseSensitive) text = text.toLowerCase();
  return text;
}

function roundScore(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function scoreSimulationQuestion(question, answer) {
  const score = Number(question.score || 1);
  if (question.type === "essay") return { earned: 0, total: score, manualPending: true };

  if (question.type === "short_answer") {
    const rules = question.answerRules || {};
    const expected = (question.shortAnswers || []).map((item) => normalizeSimulationAnswer(item, rules)).filter(Boolean);
    const actual = normalizeSimulationAnswer(answer, rules);
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

function calculateSimulationScore(questions, answers) {
  const parts = questions.map((question) => scoreSimulationQuestion(question, answers[question.id]));
  const earnedScore = roundScore(parts.reduce((sum, part) => sum + part.earned, 0));
  const totalScore = roundScore(parts.reduce((sum, part) => sum + part.total, 0));
  const manualPendingScore = roundScore(parts.filter((part) => part.manualPending).reduce((sum, part) => sum + part.total, 0));
  const percent = totalScore ? Math.round((earnedScore / totalScore) * 10000) / 100 : 0;
  return { earnedScore, totalScore, percent, manualPending: manualPendingScore > 0, manualPendingScore, parts };
}

function questionQualityIssues(question) {
  const issues = [];
  if (!String(question.body || "").trim()) issues.push("soal kosong");
  if (JSON.stringify(question).toLowerCase().includes("perlu dicek")) issues.push("ada teks perlu dicek");
  if (!Number(question.score || 0)) issues.push("bobot kosong/0");
  if (["multiple_choice", "multiple_response"].includes(question.type) && (question.options || []).length < 2) issues.push("opsi kurang dari 2");
  if (question.type === "multiple_choice" && !question.answerKey) issues.push("kunci kosong");
  if (question.type === "multiple_choice" && question.answerKey && !(question.options || []).some((option) => option.key === question.answerKey)) issues.push("kunci tidak ada di opsi");
  if (question.type === "multiple_response" && !(question.correctAnswers || []).length) issues.push("kunci checklist kosong");
  if (question.type === "true_false" && !(question.statements || []).length) issues.push("pernyataan kosong");
  if (question.type === "matching" && (question.pairs || []).length < 2) issues.push("pasangan kurang dari 2");
  if (question.type === "short_answer" && !(question.shortAnswers || []).length) issues.push("jawaban isian kosong");
  return issues;
}

function TeacherDashboard({ exams, questions, onQuestionCreated }) {
  const firstExam = exams[0];
  const [form, setForm] = useState(createDefaultQuestion(firstExam?.id || ""));
  const [editingId, setEditingId] = useState("");
  const [notice, setNotice] = useState("");
  const [importPreview, setImportPreview] = useState([]);
  const [questionModalOpen, setQuestionModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copySourceExamId, setCopySourceExamId] = useState("");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState("compact");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [generatingWeights, setGeneratingWeights] = useState(false);

  useEffect(() => {
    if (firstExam && !form.examId) {
      setForm((current) => ({ ...current, examId: firstExam.id }));
    }
  }, [firstExam, form.examId]);

  const selectedExam = exams.find((exam) => exam.id === form.examId) || firstExam;
  const selectedExamId = selectedExam?.id || "";
  const selectedExamQuestions = questions.filter((question) => question.examId === selectedExamId);
  const selectedExamTotalScoreRaw = selectedExamQuestions.reduce((sum, question) => sum + Number(question.score || 0), 0);
  const selectedExamTotalScore = Math.round(selectedExamTotalScoreRaw * 10000) / 10000;
  const selectedExamScoreIsComplete = selectedExamQuestions.length > 0 && Math.abs(selectedExamTotalScore - 100) < 0.01;
  const copySourceExams = exams
    .filter((exam) => exam.id !== selectedExamId && questions.some((question) => question.examId === exam.id))
    .map((exam) => ({ ...exam, questionCount: questions.filter((question) => question.examId === exam.id).length }));
  const effectiveCopySourceExamId = copySourceExamId || copySourceExams[0]?.id || "";
  const copySourceExam = copySourceExams.find((exam) => exam.id === effectiveCopySourceExamId);
  const copySourceQuestions = questions.filter((question) => question.examId === effectiveCopySourceExamId);
  const filteredQuestions = selectedExamQuestions.filter((question) => {
    const haystack = `${question.body} ${questionTypeLabel(question.type)} ${formatQuestionKey(question)}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  const pagedQuestions = getPageItems(filteredQuestions, page, pageSize);

  useEffect(() => {
    setPage(1);
  }, [selectedExamId, query, viewMode, pageSize]);

  function selectExam(examId) {
    setQuery("");
    setImportPreview([]);
    setNotice("");
    setCopyModalOpen(false);
    setCopySourceExamId("");
    resetForm(examId);
  }

  function resetForm(nextExamId = form.examId) {
    setEditingId("");
    setForm(createDefaultQuestion(nextExamId));
  }

  function openAddQuestion() {
    resetForm(selectedExamId);
    setQuestionModalOpen(true);
    setNotice("");
  }

  function edit(question) {
    setEditingId(question.id);
    setForm(normalizeQuestionForForm(question, selectedExamId));
    setQuestionModalOpen(true);
    setNotice("");
  }

  async function submit(event) {
    event.preventDefault();
    const payload = cleanQuestionForSubmit(form);
    if (editingId) {
      await api(`/questions/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      setNotice("Soal berhasil diperbarui.");
    } else {
      await api("/questions", { method: "POST", body: JSON.stringify(payload) });
      setNotice("Soal berhasil ditambahkan.");
    }
    resetForm(form.examId);
    setQuestionModalOpen(false);
    onQuestionCreated();
  }

  async function remove(question) {
    const ok = window.confirm(`Hapus soal ini dari ${question.examId}?`);
    if (!ok) return;
    await api(`/questions/${question.id}`, { method: "DELETE" });
    setNotice("Soal berhasil dihapus.");
    if (editingId === question.id) resetForm(question.examId);
    onQuestionCreated();
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file || !selectedExamId) return;
    const lowerName = file.name.toLowerCase();
    let parsed = [];
    if (lowerName.endsWith(".csv")) {
      parsed = parseQuestionRows(parseCsv(await file.text()), selectedExamId);
    } else if (lowerName.endsWith(".xlsx")) {
      parsed = parseQuestionRows(rowsToObjects(await readXlsxFile(file)), selectedExamId);
    } else if (lowerName.endsWith(".txt")) {
      parsed = parseQuestionText(await file.text(), selectedExamId);
    } else {
      const { default: mammoth } = await import("mammoth/mammoth.browser");
      const text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
      parsed = parseQuestionText(text, selectedExamId);
    }
    setImportPreview(parsed);
    setNotice(parsed.length ? `${parsed.length} soal terdeteksi dan siap disimpan.` : "Belum ada soal valid yang terbaca. Cek format nomor, opsi, dan kunci/header.");
    event.target.value = "";
  }

  async function saveImportedQuestions() {
    if (!importPreview.length) return;
    const result = await api("/questions/bulk", {
      method: "POST",
      body: JSON.stringify({ examId: selectedExamId, questions: importPreview })
    });
    setNotice(`Import tersimpan: ${result.created} soal, ${result.skipped} dilewati.`);
    setImportPreview([]);
    setImportModalOpen(false);
    onQuestionCreated();
  }

  function openCopyQuestions() {
    setCopySourceExamId(copySourceExams[0]?.id || "");
    setCopyModalOpen(true);
    setNotice("");
  }

  async function copyQuestionsFromExam() {
    if (!selectedExamId || !effectiveCopySourceExamId || !copySourceQuestions.length) return;
    const copiedQuestions = copySourceQuestions.map((question) => cleanQuestionForSubmit({ ...question, examId: selectedExamId }));
    const result = await api("/questions/bulk", {
      method: "POST",
      body: JSON.stringify({ examId: selectedExamId, questions: copiedQuestions })
    });
    setNotice(`Salin soal selesai: ${result.created} soal disalin, ${result.skipped} dilewati.`);
    setCopyModalOpen(false);
    setCopySourceExamId("");
    onQuestionCreated();
  }

  async function generateQuestionWeights() {
    if (!selectedExamId || !selectedExamQuestions.length || generatingWeights) return;
    const ok = window.confirm(`Generate bobot ${selectedExamQuestions.length} soal menjadi total 100? Bobot lama pada paket ini akan ditimpa.`);
    if (!ok) return;
    setGeneratingWeights(true);
    try {
      const result = await api("/questions/weights/generate", {
        method: "POST",
        body: JSON.stringify({ examId: selectedExamId, totalScore: 100 })
      });
      setNotice(`Bobot ${result.updated} soal berhasil digenerate. Total bobot sekarang ${result.totalScore}.`);
      onQuestionCreated();
    } finally {
      setGeneratingWeights(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-toolbar bank-toolbar">
          <div className="toolbar-actions bank-actions">
            <label className="mode-select">
              <select value={viewMode} onChange={(event) => setViewMode(event.target.value)}>
                <option value="compact">Mode Ringkas</option>
                <option value="full">Soal Lengkap</option>
              </select>
            </label>
            <label className="search-box">
              <Search size={17} />
              <input placeholder="Cari soal..." value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <button type="button" onClick={openAddQuestion}><Plus size={18} /> Tambah Soal</button>
            <button type="button" className="ghost-button" onClick={() => { setImportPreview([]); setImportModalOpen(true); }}><Upload size={18} /> Import Soal</button>
            <button type="button" className="ghost-button" onClick={generateQuestionWeights} disabled={!selectedExamQuestions.length || generatingWeights}>
              {generatingWeights ? "Memproses..." : "Generate Bobot 100"}
            </button>
            <span className={`bank-score-pill ${selectedExamScoreIsComplete ? "complete" : "warning"}`}>
              Total Bobot {roundScore(selectedExamTotalScore)} / 100
            </span>
            <label className="exam-select-compact">
              <select value={selectedExamId} onChange={(event) => selectExam(event.target.value)} disabled={!exams.length}>
                {exams.map((exam) => <option value={exam.id} key={exam.id}>Soal {exam.code} - {exam.subject}</option>)}
              </select>
            </label>
          </div>
        </div>
        {notice ? <div className={notice.includes("dilewati") || notice.includes("Belum") ? "error-box" : "success-box"}>{notice}</div> : null}
        {!exams.length ? <div className="info-box">Belum ada paket ujian yang ditugaskan ke akun guru ini.</div> : null}
        {exams.length && !selectedExamQuestions.length ? (
          <div className="empty-state">
            <BookOpen size={34} />
            <strong>Soal masih kosong.</strong>
            <p>Klik Tambah Soal untuk membuat soal manual, Import Soal untuk upload dari Word/CSV, atau salin dari paket lain yang pernah dibuat.</p>
            <div className="empty-state-actions">
              <button type="button" onClick={openAddQuestion}><Plus size={18} /> Tambah Soal</button>
              <button type="button" className="ghost-button" onClick={openCopyQuestions} disabled={!copySourceExams.length}><BookOpen size={18} /> Salin dari Paket Lain</button>
            </div>
          </div>
        ) : null}
        {selectedExamQuestions.length && !filteredQuestions.length ? (
          <div className="empty-state">
            <Search size={34} />
            <strong>Soal tidak ditemukan.</strong>
            <p>Coba gunakan kata kunci lain.</p>
          </div>
        ) : null}
        {filteredQuestions.length ? (
          <PaginationControls
            page={pagedQuestions.currentPage}
            pageSize={pageSize}
            total={filteredQuestions.length}
            pageSizeOptions={[5, 10, 15, 20]}
            itemLabel="soal"
            compact
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        ) : null}
        <div className="question-list">
          {pagedQuestions.items.map((question) => (
            <div className={`question-summary-card ${viewMode === "compact" ? "compact-summary-card" : "full-summary-card"}`} key={question.id}>
              {viewMode === "compact"
                ? <QuestionCompactSummary question={question} index={selectedExamQuestions.indexOf(question)} />
                : <QuestionSummary question={question} index={selectedExamQuestions.indexOf(question)} />}
              <div className="row-actions">
                <button type="button" className="small-button" onClick={() => edit(question)}>Edit</button>
                <button type="button" className="danger-button" onClick={() => remove(question)}><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
        {filteredQuestions.length ? (
          <PaginationControls
            page={pagedQuestions.currentPage}
            pageSize={pageSize}
            total={filteredQuestions.length}
            pageSizeOptions={[5, 10, 15, 20]}
            itemLabel="soal"
            compact
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        ) : null}
      </section>

      {questionModalOpen ? (
        <Modal title={editingId ? "Edit Soal" : "Tambah Soal"} icon={BookOpen} onClose={() => { resetForm(selectedExamId); setQuestionModalOpen(false); }} wide>
          <QuestionEditor
            form={form}
            setForm={setForm}
            exams={exams}
            onSubmit={submit}
            editingId={editingId}
            onCancel={() => { resetForm(selectedExamId); setQuestionModalOpen(false); }}
          />
        </Modal>
      ) : null}

      {importModalOpen ? (
        <Modal title="Import Soal Word/Teks/Excel/CSV" icon={Upload} onClose={() => { setImportPreview([]); setImportModalOpen(false); }} wide>
          <div className="import-box import-box-modal">
            <p>Format utama Word/Teks: gunakan penanda `[TIPE: PG]` atau `[TIPE: CHECKLIST]`, lalu `Soal:`, opsi `A.` sampai opsi terakhir, `Kunci:`, dan `Bobot:`.</p>
            <pre className="word-format-sample">{`[TIPE: PG]
Soal:
Apa yang dimaksud dengan literasi digital?

A. Kemampuan membaca dan menulis di perangkat digital.
B. Kemampuan menggunakan internet untuk belanja online.
C. Kemampuan memahami dan menggunakan informasi digital secara efektif.
D. Kemampuan mengunduh aplikasi dari internet.
E. Kemampuan bermain game online.

Kunci: C
Bobot: 2.5

[TIPE: CHECKLIST]
Soal:
Manakah pernyataan yang benar tentang keamanan digital?

A. Password sebaiknya dibuat berbeda untuk setiap akun.
B. OTP boleh dibagikan kepada teman dekat.
C. Verifikasi dua langkah dapat meningkatkan keamanan akun.
D. Link mencurigakan sebaiknya langsung dibuka tanpa dicek.
E. Data pribadi sebaiknya tidak disebarkan sembarangan.

Kunci: A, C, E
Bobot: 3`}</pre>
            <p>Excel/CSV: gunakan header `tipe`, `soal`, `opsi_a`, `opsi_b`, `opsi_c`, `opsi_d`, `opsi_e`, `kunci`, `bobot`. Isi `tipe` dengan `PG` atau `CHECKLIST`.</p>
            <div className="sample-table question-sample-table">
              <div>tipe</div><div>soal</div><div>opsi_a</div><div>opsi_b</div><div>opsi_c</div><div>opsi_d</div><div>opsi_e</div><div>kunci</div><div>bobot</div>
              <div>PG</div><div>Apa itu literasi digital?</div><div>Membaca perangkat digital</div><div>Belanja online</div><div>Menggunakan informasi digital efektif</div><div>Mengunduh aplikasi</div><div>Bermain game</div><div>C</div><div>2.5</div>
              <div>CHECKLIST</div><div>Pernyataan keamanan digital yang benar?</div><div>Password berbeda</div><div>OTP boleh dibagikan</div><div>Verifikasi dua langkah</div><div>Link mencurigakan dibuka</div><div>Data pribadi dijaga</div><div>A,C,E</div><div>3</div>
            </div>
            <div className="template-actions">
              <button type="button" className="ghost-button" onClick={downloadQuestionWordTemplate}><Download size={18} /> Download Template Word</button>
              <button type="button" className="ghost-button" onClick={downloadQuestionTemplate}><Download size={18} /> Download Contoh CSV</button>
            </div>
            <label className="file-button">
              <Upload size={18} />
              Pilih File Soal
              <input type="file" accept=".docx,.docm,.txt,.xlsx,.csv" onChange={importFile} />
            </label>
            {importPreview.length ? (
              <div className="import-preview">
                <strong>{importPreview.length} soal siap diimport</strong>
                <button type="button" onClick={saveImportedQuestions}><Save size={18} /> Simpan Hasil Import</button>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {copyModalOpen ? (
        <Modal title="Salin Soal dari Paket Lain" icon={BookOpen} onClose={() => setCopyModalOpen(false)} wide>
          <div className="copy-question-modal">
            <div className="info-box">
              Soal akan diduplikasi ke paket <strong>{selectedExam?.code} - {selectedExam?.subject}</strong>. Paket asal tetap aman dan tidak berubah.
            </div>
            <label>
              Paket sumber
              <select value={effectiveCopySourceExamId} onChange={(event) => setCopySourceExamId(event.target.value)} disabled={!copySourceExams.length}>
                {copySourceExams.map((exam) => (
                  <option value={exam.id} key={exam.id}>{exam.code} - {exam.subject} ({exam.questionCount} soal)</option>
                ))}
              </select>
            </label>
            {copySourceExam ? (
              <div className="copy-source-summary">
                <strong>{copySourceQuestions.length} soal akan disalin dari {copySourceExam.code}.</strong>
                <div className="copy-preview-list">
                  {copySourceQuestions.slice(0, 5).map((question, index) => (
                    <div key={question.id}>
                      <span>Soal {index + 1}</span>
                      <p>{question.body}</p>
                    </div>
                  ))}
                </div>
                {copySourceQuestions.length > 5 ? <p className="muted">Dan {copySourceQuestions.length - 5} soal lainnya.</p> : null}
              </div>
            ) : (
              <div className="info-box">Belum ada paket lain yang memiliki soal untuk disalin.</div>
            )}
            <div className="form-actions">
              <button type="button" onClick={copyQuestionsFromExam} disabled={!copySourceQuestions.length}><Save size={18} /> Salin Semua Soal</button>
              <button type="button" className="ghost-button" onClick={() => setCopyModalOpen(false)}>Batal</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function TeacherQuestionTest({ exams, questions }) {
  const firstExam = exams[0];
  const [selectedExamId, setSelectedExamId] = useState(firstExam?.id || "");
  const [deviceMode, setDeviceMode] = useState("phone");
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [numberModalOpen, setNumberModalOpen] = useState(false);

  useEffect(() => {
    if (!selectedExamId && firstExam) setSelectedExamId(firstExam.id);
  }, [firstExam, selectedExamId]);

  const selectedExam = exams.find((exam) => exam.id === selectedExamId);
  const selectedQuestions = questions.filter((question) => question.examId === selectedExamId);
  const currentQuestion = selectedQuestions[currentIndex];
  const answeredCount = selectedQuestions.filter((question) => isQuestionAnswered(question, answers[question.id])).length;
  const simulationTime = formatRemainingTime(Number(selectedExam?.durationMinutes || 90) * 60 * 1000);
  const score = submitted ? calculateSimulationScore(selectedQuestions, answers) : null;
  const issueRows = selectedQuestions
    .map((question, index) => ({ index, question, issues: questionQualityIssues(question) }))
    .filter((item) => item.issues.length);

  function selectExam(examId) {
    setSelectedExamId(examId);
    setAnswers({});
    setSubmitted(false);
    setCurrentIndex(0);
    setNumberModalOpen(false);
  }

  useEffect(() => {
    setCurrentIndex((index) => Math.min(index, Math.max(0, selectedQuestions.length - 1)));
  }, [selectedQuestions.length]);

  function choose(questionId, value) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    if (submitted) setSubmitted(false);
  }

  function toggleMulti(questionId, key, checked) {
    const current = new Set(Array.isArray(answers[questionId]) ? answers[questionId] : []);
    if (checked) current.add(key);
    else current.delete(key);
    choose(questionId, [...current]);
  }

  function chooseNested(questionId, itemId, value) {
    choose(questionId, { ...(answers[questionId] || {}), [itemId]: value });
  }

  function resetSimulation() {
    setAnswers({});
    setSubmitted(false);
    setCurrentIndex(0);
  }

  function SimulationNumberGrid({ closeOnPick = false }) {
    return (
      <div className="question-number-grid simulation-number-grid">
        {selectedQuestions.map((question, index) => {
          const answered = isQuestionAnswered(question, answers[question.id]);
          return (
            <button
              type="button"
              className={`${index === currentIndex ? "active" : ""} ${answered ? "answered" : ""}`}
              onClick={() => {
                setCurrentIndex(index);
                if (closeOnPick) setNumberModalOpen(false);
              }}
              key={question.id}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
    );
  }

  function renderSimulationQuestion(question, index) {
    if (!question) return null;
    return (
      <article className="question-item simulation-question active-question-card" key={question.id}>
        <div className="active-question-head">
          <strong>Soal {index + 1} | {questionTypeLabel(question.type)}</strong>
          <span>{isQuestionAnswered(question, answers[question.id]) ? "Sudah dijawab" : "Belum dijawab"}</span>
        </div>
        <p>{question.body}</p>
        <QuestionImage src={question.image} alt={`Gambar soal ${index + 1}`} />
        {question.type === "multiple_response" ? (
          <div className="answer-options">
            {(question.options || []).map((option, optionIndex) => (
              <label className="answer-option" key={option.key}>
                <input
                  type="checkbox"
                  checked={Array.isArray(answers[question.id]) && answers[question.id].includes(option.key)}
                  onChange={(event) => toggleMulti(question.id, option.key, event.target.checked)}
                />
                <span>{displayOptionLabel(optionIndex)}</span>
                <div>{option.text}<QuestionImage src={option.image} alt={`Gambar opsi ${option.key}`} /></div>
              </label>
            ))}
          </div>
        ) : null}
        {(!question.type || question.type === "multiple_choice") ? (
          <div className="answer-options">
            {(question.options || []).map((option, optionIndex) => (
              <label className="answer-option" key={option.key}>
                <input
                  type="radio"
                  name={`test-${question.id}`}
                  checked={answers[question.id] === option.key}
                  onChange={() => choose(question.id, option.key)}
                />
                <span>{displayOptionLabel(optionIndex)}</span>
                <div>{option.text}<QuestionImage src={option.image} alt={`Gambar opsi ${option.key}`} /></div>
              </label>
            ))}
          </div>
        ) : null}
        {question.type === "true_false" ? (
          <div className="statement-answer-list">
            {(question.statements || []).map((statement, statementIndex) => (
              <div className="statement-answer" key={statement.id}>
                <p>{statementIndex + 1}. {statement.text}</p>
                <QuestionImage src={statement.image} alt={`Gambar pernyataan ${statementIndex + 1}`} />
                <div className="row-actions">
                  <label><input type="radio" name={`test-${question.id}-${statement.id}`} checked={answers[question.id]?.[statement.id] === "true"} onChange={() => chooseNested(question.id, statement.id, "true")} /> Benar</label>
                  <label><input type="radio" name={`test-${question.id}-${statement.id}`} checked={answers[question.id]?.[statement.id] === "false"} onChange={() => chooseNested(question.id, statement.id, "false")} /> Salah</label>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {question.type === "matching" ? (
          <div className="matching-answer-list">
            {(question.pairs || []).map((pair, pairIndex) => {
              const options = question.matchingOptions || (question.pairs || []).map((item) => ({ value: item.right, image: item.rightImage || "" }));
              return (
                <label className="matching-answer" key={pair.id}>
                  <span>{pairIndex + 1}. {pair.left}</span>
                  <QuestionImage src={pair.leftImage} alt={`Gambar pasangan ${pairIndex + 1}`} />
                  <select value={answers[question.id]?.[pair.id] || ""} onChange={(event) => chooseNested(question.id, pair.id, event.target.value)}>
                    <option value="">Pilih pasangan...</option>
                    {options.map((option) => <option value={option.value} key={option.value}>{option.value}</option>)}
                  </select>
                </label>
              );
            })}
          </div>
        ) : null}
        {question.type === "short_answer" ? (
          <input
            className="short-answer-input"
            value={answers[question.id] || ""}
            placeholder="Tulis jawaban singkat..."
            onChange={(event) => choose(question.id, event.target.value)}
          />
        ) : null}
        {question.type === "essay" ? (
          <textarea
            className="essay-answer-input"
            value={answers[question.id] || ""}
            placeholder="Tulis jawaban uraian..."
            onChange={(event) => choose(question.id, event.target.value)}
          />
        ) : null}
        {submitted ? (
          <code>Skor soal: {roundScore(scoreSimulationQuestion(question, answers[question.id]).earned)} / {Number(question.score || 1)}</code>
        ) : null}
        <div className="question-step-actions">
          <button type="button" className="ghost-button" onClick={() => setCurrentIndex((value) => Math.max(0, value - 1))} disabled={index === 0}>Sebelumnya</button>
          {index >= selectedQuestions.length - 1 ? (
            <button type="button" onClick={() => setSubmitted(true)} disabled={!selectedQuestions.length}><Send size={18} /> Lihat Nilai</button>
          ) : (
            <button type="button" onClick={() => setCurrentIndex((value) => Math.min(selectedQuestions.length - 1, value + 1))}>Berikutnya</button>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="page-stack">
      <section className="panel test-toolbar">
        <div className="toolbar-actions test-controls">
          <select value={selectedExamId} onChange={(event) => selectExam(event.target.value)} disabled={!exams.length}>
            {exams.map((exam) => <option value={exam.id} key={exam.id}>Soal {exam.code} - {exam.subject}</option>)}
          </select>
          <div className="segmented-control" aria-label="Mode perangkat">
            {[
              ["phone", "HP"],
              ["tablet", "Tablet"],
              ["laptop", "Laptop"]
            ].map(([value, label]) => (
              <button type="button" className={deviceMode === value ? "active" : ""} onClick={() => setDeviceMode(value)} key={value}>{label}</button>
            ))}
          </div>
          <button type="button" className="ghost-button" onClick={resetSimulation}>Reset Jawaban</button>
          <button type="button" onClick={() => setSubmitted(true)} disabled={!selectedQuestions.length}><CheckCircle2 size={18} /> Lihat Nilai Simulasi</button>
        </div>
        {selectedExam ? <p className="muted">{selectedQuestions.length} soal | Simulasi tidak memengaruhi nilai siswa dan tidak membutuhkan token/jadwal.</p> : <div className="info-box">Belum ada paket ujian yang ditugaskan ke akun guru ini.</div>}
      </section>

      {score ? (
        <section className="panel simulation-score">
          <div>
            <span className="field-caption">Nilai Simulasi</span>
            <strong>{score.percent}</strong>
            <p>{score.earnedScore} dari {score.totalScore} poin{score.manualPending ? `, ${score.manualPendingScore} poin esai menunggu koreksi manual` : ""}.</p>
          </div>
          <div className="simulation-score-grid">
            <code>{Object.keys(answers).length}/{selectedQuestions.length} terjawab</code>
            <code>{issueRows.length} soal perlu dicek</code>
          </div>
        </section>
      ) : null}

      {issueRows.length ? (
        <section className="panel issue-panel">
          <PanelTitle icon={AlertTriangle} title="Catatan Pemeriksaan Soal" />
          <div className="issue-list">
            {issueRows.map((item) => (
              <div key={item.question.id}>
                <strong>Soal {item.index + 1}</strong>
                <span>{item.issues.join(", ")}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {selectedExam && !selectedQuestions.length ? (
        <div className="empty-state">
          <BookOpen size={34} />
          <strong>Soal masih kosong.</strong>
          <p>Tambahkan soal di menu Bank Soal terlebih dahulu.</p>
        </div>
      ) : null}

      {selectedQuestions.length ? (
        <section className="simulation-stage">
          <div className={`simulation-device ${deviceMode}`}>
            <div className="simulation-device-head simulation-exam-head">
              <div>
                <strong>{selectedExam?.subject}</strong>
                <span>{answeredCount}/{selectedQuestions.length} terjawab | Waktu: <code>{simulationTime}</code></span>
              </div>
              <div className="exam-icon-actions simulation-icon-actions">
                <button type="button" className="ghost-button icon-button" title="Reset jawaban" aria-label="Reset jawaban" onClick={resetSimulation}><RefreshCw size={16} /></button>
                <button type="button" className="ghost-button icon-button" title="Nomor soal" aria-label="Nomor soal" onClick={() => setNumberModalOpen(true)}><ListChecks size={16} /></button>
              </div>
            </div>
            <div className="simulation-paper simulation-exam-paper">
              {deviceMode !== "phone" ? (
                <aside className="simulation-nav-panel">
                  <strong>Nomor Soal</strong>
                  <SimulationNumberGrid />
                </aside>
              ) : null}
              {renderSimulationQuestion(currentQuestion, currentIndex)}
            </div>
          </div>
        </section>
      ) : null}
      {numberModalOpen ? (
        <Modal title="Nomor Soal" icon={ListChecks} onClose={() => setNumberModalOpen(false)}>
          <div className="mobile-question-picker">
            <SimulationNumberGrid closeOnPick />
            <div className="question-nav-legend">
              <span><i className="legend-current" /> Dibuka</span>
              <span><i className="legend-answered" /> Selesai</span>
              <span><i className="legend-empty" /> Belum</span>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function isQuestionAnswered(question, answer) {
  if (question.type === "multiple_response") return Array.isArray(answer) && answer.length > 0;
  if (question.type === "true_false") {
    const statements = question.statements || [];
    return statements.length > 0 && statements.every((statement) => answer?.[statement.id] === "true" || answer?.[statement.id] === "false");
  }
  if (question.type === "matching") {
    const pairs = question.pairs || [];
    return pairs.length > 0 && pairs.every((pair) => String(answer?.[pair.id] || "").trim());
  }
  return String(answer ?? "").trim().length > 0;
}

function hasAnyAnswerValue(answer) {
  if (Array.isArray(answer)) return answer.length > 0;
  if (answer && typeof answer === "object") return Object.values(answer).some((value) => String(value ?? "").trim());
  return String(answer ?? "").trim().length > 0;
}

function buildQuestionSlots(questions = [], manifest = []) {
  if (!manifest.length) return questions;
  const slots = Array.from({ length: manifest.length }, () => null);
  const indexById = new Map(manifest.map((item, index) => [item.id, index]));
  for (const question of questions || []) {
    const index = indexById.get(question.id);
    if (index !== undefined) slots[index] = question;
  }
  return slots;
}

function ExamTaking({ session, onFinished }) {
  const initialManifest = session.questionManifest?.length
    ? session.questionManifest
    : (session.questions || []).map((question, index) => ({ id: question.id, index, type: question.type }));
  const [questionManifest, setQuestionManifest] = useState(initialManifest);
  const [currentQuestions, setCurrentQuestions] = useState(() => buildQuestionSlots(session.questions || [], initialManifest));
  const [deliveryMode, setDeliveryMode] = useState(session.deliveryMode || "full");
  const [answers, setAnswers] = useState(session.attempt.answers || {});
  const answersRef = useRef(session.attempt.answers || {});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [numberModalOpen, setNumberModalOpen] = useState(false);
  const [fontModalOpen, setFontModalOpen] = useState(false);
  const [questionFontSize, setQuestionFontSize] = useState(() => {
    try {
      return localStorage.getItem(EXAM_FONT_SIZE_KEY) || "normal";
    } catch {
      return "normal";
    }
  });
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadNotice, setReloadNotice] = useState("");
  const [submittedAttempt, setSubmittedAttempt] = useState(null);
  const questionCardRef = useRef(null);
  const eventLogRef = useRef({});
  const loadingQuestionIndexesRef = useRef(new Set());
  const pendingAnswersRef = useRef({});
  const pendingAnswerCountRef = useRef(0);
  const autosaveTimerRef = useRef(null);
  const autosaveInFlightRef = useRef(false);
  const heartbeatTimerRef = useRef(null);
  const forceSyncInFlightRef = useRef(false);
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
  const [remainingMs, setRemainingMs] = useState(() => {
    if (Number.isFinite(session.availability?.remainingMs)) return session.availability.remainingMs;
    if (session.availability?.endAt && session.availability?.serverTime) {
      return Math.max(0, new Date(session.availability.endAt).getTime() - new Date(session.availability.serverTime).getTime());
    }
    return Number(session.exam.durationMinutes || 90) * 60 * 1000;
  });
  const runtimeSettings = session.examSettings || {};
  const answerSyncMode = runtimeSettings.answerSyncMode || "extra_high";
  const extraHighStability = answerSyncMode === "extra_high";
  const heartbeatEnabled = runtimeSettings.heartbeatEnabled !== false;
  const showStudentScores = runtimeSettings.showStudentScores !== false;
  const heartbeatIntervalSeconds = clampNumber(runtimeSettings.heartbeatIntervalSeconds, 15, 120, 30);
  const heartbeatJitterSeconds = clampNumber(runtimeSettings.heartbeatJitterSeconds, 0, 30, 10);
  const autosaveBatchSize = clampNumber(runtimeSettings.autosaveBatchSize, 1, 10, 3);
  const autosaveIntervalSeconds = clampNumber(runtimeSettings.autosaveIntervalSeconds, 5, 60, 20);
  const questionPrefetchCount = clampNumber(runtimeSettings.questionPrefetchCount, 0, 5, 2);

  function nativeExamClient() {
    if (typeof window === "undefined") return null;
    return window.CBTExamClient || null;
  }

  function readNativePendingAnswers() {
    const client = nativeExamClient();
    if (!client || typeof client.getPendingAnswers !== "function") return {};
    try {
      const raw = client.getPendingAnswers(session.attempt.id);
      const parsed = JSON.parse(raw || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function persistNativePendingAnswers() {
    const client = nativeExamClient();
    if (!client || typeof client.replacePendingAnswers !== "function") return;
    try {
      client.replacePendingAnswers(session.attempt.id, JSON.stringify(pendingAnswersRef.current));
    } catch {
      // Native storage is an extra safety layer; browser autosave continues without it.
    }
  }

  function saveNativePendingAnswer(questionId, value) {
    const client = nativeExamClient();
    if (!client || typeof client.savePendingAnswer !== "function") return;
    try {
      client.savePendingAnswer(session.attempt.id, questionId, JSON.stringify(value ?? null), String(Date.now()));
    } catch {
      // Ignore native storage failures so answering remains smooth.
    }
  }

  function clearNativePendingAnswers() {
    const client = nativeExamClient();
    if (!client || typeof client.clearPendingAnswers !== "function") return;
    try {
      client.clearPendingAnswers(session.attempt.id);
    } catch {
      // Ignore native storage cleanup failure.
    }
  }

  function updateAnswers(nextAnswersOrUpdater) {
    setAnswers((current) => {
      const base = { ...answersRef.current, ...current };
      const next = typeof nextAnswersOrUpdater === "function" ? nextAnswersOrUpdater(base) : nextAnswersOrUpdater;
      answersRef.current = next || {};
      return answersRef.current;
    });
  }

  function mergeServerAnswers(serverAnswers = {}) {
    const localSnapshot = readAnswerSnapshot();
    updateAnswers((current) => ({
      ...(serverAnswers || {}),
      ...localSnapshot,
      ...current,
      ...pendingAnswersRef.current
    }));
  }

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(pendingStorageKey()) || "{}");
      const snapshot = readAnswerSnapshot();
      const nativeSaved = readNativePendingAnswers();
      const merged = {
        ...snapshot,
        ...(saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {}),
        ...nativeSaved
      };
      if (merged && typeof merged === "object" && !Array.isArray(merged)) {
        const savedCount = Object.keys(merged).length;
        if (savedCount) {
          pendingAnswersRef.current = extraHighStability ? { ...(session.attempt.answers || {}), ...merged } : merged;
          pendingAnswerCountRef.current = savedCount;
          setPendingSaveCount(savedCount);
          updateAnswers((current) => ({ ...current, ...merged }));
          persistAnswerSnapshot({ ...(session.attempt.answers || {}), ...merged });
          persistPendingAnswers();
          persistNativePendingAnswers();
          if (!extraHighStability) scheduleAutosave();
        }
      }
    } catch {
      // Pending answers are a safety net only; corrupt local data should not block the exam.
    }

    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      if (heartbeatTimerRef.current) window.clearTimeout(heartbeatTimerRef.current);
    };
  }, [session.attempt.id, extraHighStability]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingMs((current) => Math.max(0, current - 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (remainingMs > 0 || submittedAttempt) return;
    submit();
  }, [remainingMs, submittedAttempt]);

  useEffect(() => {
    const warnBeforeExit = (event) => {
      event.preventDefault();
      event.returnValue = "Ujian sedang berlangsung. Tetap di halaman ujian sampai selesai.";
      return event.returnValue;
    };
    window.addEventListener("beforeunload", warnBeforeExit);
    return () => window.removeEventListener("beforeunload", warnBeforeExit);
  }, []);

  async function logExamEvent(type, message, level = "warning") {
    const now = Date.now();
    if (eventLogRef.current[type] && now - eventLogRef.current[type] < 8000) return;
    eventLogRef.current[type] = now;
    try {
      await api(`/attempts/${session.attempt.id}/heartbeat`, {
        method: "POST",
        body: JSON.stringify({ event: type, level, message })
      });
    } catch {
      // Event log should never interrupt the exam flow.
    }
  }

  useEffect(() => {
    const blockEvent = (event) => {
      event.preventDefault();
      const type = event.type === "contextmenu" ? "context_menu_blocked" : `${event.type}_blocked`;
      logExamEvent(type, "Aksi klik kanan/seleksi/copy-paste diblokir pada halaman ujian.");
    };
    const handleVisibility = () => {
      if (document.hidden) logExamEvent("visibility_hidden", "Halaman ujian tidak terlihat atau aplikasi berpindah.", "warning");
      else logExamEvent("visibility_visible", "Peserta kembali ke halaman ujian.", "info");
    };
    const handleBlur = () => logExamEvent("window_blur", "Jendela/browser ujian kehilangan fokus.", "warning");

    const blockedEvents = ["contextmenu", "copy", "cut", "paste", "dragstart", "selectstart"];
    blockedEvents.forEach((eventName) => document.addEventListener(eventName, blockEvent));
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("blur", handleBlur);
    logExamEvent("exam_screen_opened", "Halaman pengerjaan ujian dibuka atau dilanjutkan.", "info");

    return () => {
      blockedEvents.forEach((eventName) => document.removeEventListener(eventName, blockEvent));
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  function resetExamScroll() {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    if (questionCardRef.current) questionCardRef.current.scrollTop = 0;
  }

  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    document.documentElement.classList.add("exam-taking-active");
    document.body.classList.add("exam-taking-active");
    resetExamScroll();
    const firstFrame = window.requestAnimationFrame(resetExamScroll);
    const secondFrame = window.setTimeout(resetExamScroll, 120);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.clearTimeout(secondFrame);
      document.documentElement.classList.remove("exam-taking-active");
      document.body.classList.remove("exam-taking-active");
      if ("scrollRestoration" in window.history) window.history.scrollRestoration = previousRestoration || "auto";
    };
  }, []);

  useEffect(() => {
    resetExamScroll();
    loadQuestionAt(currentIndex);
    for (let offset = 1; offset <= questionPrefetchCount; offset += 1) {
      loadQuestionAt(currentIndex + offset, { silent: true });
    }
  }, [currentIndex, questionPrefetchCount]);

  useEffect(() => {
    try {
      localStorage.setItem(EXAM_FONT_SIZE_KEY, questionFontSize);
    } catch {
      // Font preference is helpful, but the exam should keep running if storage is blocked.
    }
  }, [questionFontSize]);

  const questionFontOptions = [
    {
      value: "xsmall",
      label: "Sangat Kecil",
      description: "Paling rapat untuk layar kecil atau soal yang panjang.",
      sample: "Teks soal sangat kecil."
    },
    {
      value: "small",
      label: "Kecil",
      description: "Tampilan lebih rapat untuk layar yang terbatas.",
      sample: "Teks soal ukuran kecil."
    },
    {
      value: "normal",
      label: "Sedang",
      description: "Ukuran standar yang nyaman untuk sebagian besar peserta.",
      sample: "Teks soal ukuran sedang."
    },
    {
      value: "large",
      label: "Besar",
      description: "Membantu peserta yang butuh tulisan lebih jelas.",
      sample: "Teks soal ukuran besar."
    },
    {
      value: "xlarge",
      label: "Paling Besar",
      description: "Ukuran paling jelas, cocok untuk peserta yang kesulitan membaca.",
      sample: "Teks soal paling besar."
    }
  ];
  const currentQuestion = currentQuestions[currentIndex];
  const questionCount = questionManifest.length || currentQuestions.length;
  const answeredCount = questionManifest.length
    ? questionManifest.filter((item, index) => {
      const question = currentQuestions[index];
      return question ? isQuestionAnswered(question, answers[item.id]) : hasAnyAnswerValue(answers[item.id]);
    }).length
    : currentQuestions.filter((question) => question && isQuestionAnswered(question, answers[question.id])).length;
  const submitUnlockMinutes = Number(session.exam.submitUnlockMinutes ?? 30);
  const submitUnlockMs = Math.max(0, submitUnlockMinutes) * 60 * 1000;
  const canSubmitNow = remainingMs <= submitUnlockMs || remainingMs <= 0;
  const submitLockedText = `Submit tersedia ${submitUnlockMinutes} menit terakhir`;
  const unansweredCount = Math.max(0, questionCount - answeredCount);

  function handleSubmittedAttempt(attempt) {
    if (attempt?.status !== "submitted") return false;
    setSubmittedAttempt(attempt);
    setSubmitConfirmOpen(false);
    clearPendingAnswers();
    clearAnswerSnapshot();
    setReloadNotice("Ujian sudah diselesaikan oleh sistem/admin.");
    return true;
  }

  function buildFinalAnswers() {
    return {
      ...(session.attempt.answers || {}),
      ...readAnswerSnapshot(),
      ...readNativePendingAnswers(),
      ...answersRef.current,
      ...answers,
      ...pendingAnswersRef.current
    };
  }

  async function syncForceFinish(serverAttempt) {
    if (!serverAttempt || serverAttempt.status !== "force_finishing") return handleSubmittedAttempt(serverAttempt);
    if (submittedAttempt || forceSyncInFlightRef.current) return true;
    forceSyncInFlightRef.current = true;
    setSaving(true);
    setSubmitConfirmOpen(false);
    setReloadNotice("Admin menghentikan ujian. Mengirim jawaban terakhir dari perangkat...");
    const finalAnswers = buildFinalAnswers();
    persistAnswerSnapshot(finalAnswers);
    persistPendingAnswers();
    try {
      const result = await api(`/attempts/${session.attempt.id}/final-sync`, {
        method: "POST",
        body: JSON.stringify({ answers: finalAnswers })
      });
      const finalAttempt = result.attempt || result;
      clearPendingAnswers();
      clearAnswerSnapshot();
      setSubmittedAttempt(finalAttempt);
      setReloadNotice("Ujian dihentikan admin. Jawaban terakhir sudah terkirim ke server.");
      return true;
    } catch (error) {
      if (handleSubmittedAttempt(error.data?.attempt)) return true;
      setReloadNotice("Admin menghentikan ujian. Jawaban lokal masih tersimpan dan akan dicoba sinkron ulang.");
      persistPendingAnswers();
      return false;
    } finally {
      forceSyncInFlightRef.current = false;
      setSaving(false);
    }
  }

  async function handleServerAttemptState(attempt) {
    if (!attempt) return false;
    if (attempt.status === "force_finishing") return syncForceFinish(attempt);
    return handleSubmittedAttempt(attempt);
  }

  function pendingStorageKey() {
    return `cbt_sman94_pending_answers_${session.attempt.id}`;
  }

  function answerSnapshotKey() {
    return `cbt_sman94_answer_snapshot_${session.attempt.id}`;
  }

  function readAnswerSnapshot() {
    try {
      const parsed = JSON.parse(localStorage.getItem(answerSnapshotKey()) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function persistAnswerSnapshot(nextAnswers = answersRef.current) {
    try {
      localStorage.setItem(answerSnapshotKey(), JSON.stringify(nextAnswers || {}));
    } catch {
      // Snapshot lokal adalah lapisan pengaman; ujian tetap berjalan jika storage penuh/diblokir.
    }
  }

  function clearAnswerSnapshot() {
    try {
      localStorage.removeItem(answerSnapshotKey());
    } catch {
      // Ignore storage cleanup failure.
    }
  }

  function persistPendingAnswers() {
    try {
      localStorage.setItem(pendingStorageKey(), JSON.stringify(pendingAnswersRef.current));
    } catch {
      // Local queue is a safety net; autosave still continues if storage is blocked.
    }
    persistNativePendingAnswers();
  }

  function clearPendingAnswers() {
    pendingAnswersRef.current = {};
    pendingAnswerCountRef.current = 0;
    setPendingSaveCount(0);
    try {
      localStorage.removeItem(pendingStorageKey());
    } catch {
      // Ignore storage cleanup failure.
    }
    clearNativePendingAnswers();
  }

  async function flushAnswers({ force = false } = {}) {
    if (extraHighStability) return true;
    if (submittedAttempt || autosaveInFlightRef.current) return false;
    const answersPatch = { ...pendingAnswersRef.current };
    const patchCount = Object.keys(answersPatch).length;
    if (!patchCount && !force) return true;
    if (!patchCount) return true;
    autosaveInFlightRef.current = true;
    setSaving(true);
    try {
      const result = await api(`/attempts/${session.attempt.id}/answers`, { method: "PUT", body: JSON.stringify({ answersPatch }) });
      for (const [questionId, value] of Object.entries(answersPatch)) {
        if (JSON.stringify(pendingAnswersRef.current[questionId]) === JSON.stringify(value)) {
          delete pendingAnswersRef.current[questionId];
        }
      }
      pendingAnswerCountRef.current = Object.keys(pendingAnswersRef.current).length;
      setPendingSaveCount(pendingAnswerCountRef.current);
      persistPendingAnswers();
      if (result?.answers) mergeServerAnswers(result.answers);
      handleSubmittedAttempt(result);
      if (!pendingAnswerCountRef.current) setReloadNotice("");
      return true;
    } catch (error) {
      if (!await handleServerAttemptState(error.data?.attempt)) setReloadNotice(error.message);
      persistPendingAnswers();
      return false;
    } finally {
      autosaveInFlightRef.current = false;
      setSaving(false);
    }
  }

  function scheduleAutosave() {
    if (extraHighStability) return;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      flushAnswers();
    }, autosaveIntervalSeconds * 1000);
  }

  function queueAnswer(questionId, value, nextAnswers = answersRef.current) {
    if (extraHighStability) {
      pendingAnswersRef.current = { ...(nextAnswers || {}) };
      pendingAnswerCountRef.current = Object.keys(pendingAnswersRef.current).length;
      setPendingSaveCount(pendingAnswerCountRef.current);
      saveNativePendingAnswer(questionId, value);
      persistAnswerSnapshot(pendingAnswersRef.current);
      persistPendingAnswers();
      return;
    }

    pendingAnswersRef.current = { ...pendingAnswersRef.current, [questionId]: value };
    pendingAnswerCountRef.current = Object.keys(pendingAnswersRef.current).length;
    setPendingSaveCount(pendingAnswerCountRef.current);
    saveNativePendingAnswer(questionId, value);
    persistAnswerSnapshot({ ...answersRef.current, [questionId]: value });
    persistPendingAnswers();
    if (pendingAnswerCountRef.current >= autosaveBatchSize) {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      flushAnswers();
    } else {
      scheduleAutosave();
    }
  }

  function choose(questionId, value) {
    if (submittedAttempt) return;
    const nextAnswers = { ...answersRef.current, ...answers, [questionId]: value };
    updateAnswers(nextAnswers);
    persistAnswerSnapshot(nextAnswers);
    queueAnswer(questionId, value, nextAnswers);
  }

  function toggleMulti(questionId, key, checked) {
    const currentAnswers = answersRef.current || answers;
    const current = new Set(Array.isArray(currentAnswers[questionId]) ? currentAnswers[questionId] : []);
    if (checked) current.add(key);
    else current.delete(key);
    choose(questionId, [...current]);
  }

  function chooseNested(questionId, itemId, value) {
    const currentAnswers = answersRef.current || answers;
    choose(questionId, { ...(currentAnswers[questionId] || {}), [itemId]: value });
  }

  async function submit() {
    if (submittedAttempt) return;
    setSaving(true);
    const finalAnswers = buildFinalAnswers();
    persistAnswerSnapshot(finalAnswers);
    try {
      if (!extraHighStability) await flushAnswers({ force: true });
      const result = await api(`/attempts/${session.attempt.id}/submit`, { method: "POST", body: JSON.stringify({ answers: finalAnswers }) });
      clearPendingAnswers();
      clearAnswerSnapshot();
      setSubmittedAttempt(result);
    } catch (error) {
      if (!await handleServerAttemptState(error.data?.attempt)) setReloadNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function loadQuestionAt(index, { force = false, silent = false } = {}) {
    if (deliveryMode !== "progressive") return;
    if (!questionManifest[index]) return;
    if (!force && currentQuestions[index]) return;
    if (loadingQuestionIndexesRef.current.has(index)) return;
    loadingQuestionIndexesRef.current.add(index);
    if (!silent) setLoadingQuestion(true);
    try {
      const result = await api(`/attempts/${session.attempt.id}/question/${index}`);
      setCurrentQuestions((current) => {
        const next = [...current];
        next[index] = result.question;
        return next;
      });
      if (result.questionManifest?.length) setQuestionManifest(result.questionManifest);
      if (result.attempt?.answers) mergeServerAnswers(result.attempt.answers);
      if (result.availability?.remainingMs !== undefined) setRemainingMs(result.availability.remainingMs);
    } catch (error) {
      if (!await handleServerAttemptState(error.data?.attempt) && !silent) setReloadNotice(error.message);
    } finally {
      loadingQuestionIndexesRef.current.delete(index);
      if (!silent) setLoadingQuestion(false);
    }
  }

  async function reloadQuestions() {
    setSaving(true);
    setReloadNotice("");
    try {
      if (deliveryMode === "progressive") {
        await loadQuestionAt(currentIndex, { force: true });
        setReloadNotice("Soal aktif berhasil dimuat ulang tanpa keluar ujian.");
        return;
      }
      const result = await api(`/attempts/${session.attempt.id}/reload`);
      const nextManifest = result.questionManifest?.length
        ? result.questionManifest
        : (result.questions || []).map((question, index) => ({ id: question.id, index, type: question.type }));
      setQuestionManifest(nextManifest);
      setDeliveryMode(result.deliveryMode || "full");
      setCurrentQuestions(buildQuestionSlots(result.questions || [], nextManifest));
      mergeServerAnswers(result.attempt?.answers || {});
      if (result.availability?.remainingMs !== undefined) setRemainingMs(result.availability.remainingMs);
      setCurrentIndex((index) => Math.min(index, Math.max(0, nextManifest.length - 1)));
      setReloadNotice("Soal berhasil dimuat ulang tanpa keluar ujian.");
    } catch (error) {
      if (!await handleServerAttemptState(error.data?.attempt)) setReloadNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function checkAttemptStatus() {
    if (submittedAttempt) return;
    try {
      const result = heartbeatEnabled
        ? await api(`/attempts/${session.attempt.id}/heartbeat`, {
          method: "POST",
          body: JSON.stringify({ event: "heartbeat" })
        })
        : await api(`/attempts/${session.attempt.id}/status`);
      await handleServerAttemptState(result.attempt);
    } catch (error) {
      await handleServerAttemptState(error.data?.attempt);
      // Status checks must not interrupt the exam screen.
    }
  }

  useEffect(() => {
    if (submittedAttempt) return undefined;
    const schedule = () => {
      const jitterMs = heartbeatJitterSeconds > 0 ? Math.floor(Math.random() * heartbeatJitterSeconds * 1000) : 0;
      const baseIntervalMs = heartbeatEnabled ? heartbeatIntervalSeconds * 1000 : 10000;
      heartbeatTimerRef.current = window.setTimeout(async () => {
        await checkAttemptStatus();
        if (!submittedAttempt) schedule();
      }, baseIntervalMs + jitterMs);
    };
    schedule();
    return () => {
      if (heartbeatTimerRef.current) window.clearTimeout(heartbeatTimerRef.current);
    };
  }, [submittedAttempt, session.attempt.id, heartbeatEnabled, heartbeatIntervalSeconds, heartbeatJitterSeconds]);

  function QuestionNumberGrid({ closeOnPick = false }) {
    const items = questionManifest.length
      ? questionManifest
      : currentQuestions.map((question, index) => ({ id: question.id, index, type: question.type }));
    return (
      <div className="question-number-grid">
        {items.map((item, index) => {
          const question = currentQuestions[index];
          const answered = question ? isQuestionAnswered(question, answers[item.id]) : hasAnyAnswerValue(answers[item.id]);
          return (
            <button
              type="button"
              className={`${index === currentIndex ? "active" : ""} ${answered ? "answered" : ""}`}
              onClick={() => {
                setCurrentIndex(index);
                if (closeOnPick) setNumberModalOpen(false);
              }}
              key={item.id}
              aria-label={`Soal ${index + 1}${answered ? " sudah dijawab" : " belum dijawab"}`}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
    );
  }

  if (submittedAttempt) {
    return (
      <section className="panel exam-entry">
        <PanelTitle icon={CheckCircle2} title="Ujian Selesai" />
        {showStudentScores ? (
          <>
            <h2>Nilai: {submittedAttempt.score?.percent ?? 0}</h2>
            <p>Benar {submittedAttempt.score?.earnedScore ?? 0} dari total {submittedAttempt.score?.totalScore ?? 0} poin. {submittedAttempt.score?.manualPending ? `Masih ada ${submittedAttempt.score.manualPendingScore} poin uraian yang menunggu koreksi guru.` : "Nilai juga sudah masuk ke halaman hasil admin/guru."}</p>
          </>
        ) : (
          <>
            <h2>Jawaban Terkirim</h2>
            <p>Ujian sudah selesai. Nilai tidak ditampilkan di portal peserta dan hanya dapat dilihat oleh admin/guru.</p>
          </>
        )}
        <button type="button" onClick={() => onFinished(submittedAttempt)}><CheckCircle2 size={18} /> Kembali ke Portal</button>
      </section>
    );
  }

  return (
    <div className="exam-workspace">
      <section className="panel exam-header">
        <div>
          <PanelTitle icon={ListChecks} title={session.exam.subject} />
          <p>{answeredCount}/{questionCount} terjawab | Waktu: <code>{formatRemainingTime(remainingMs)}</code></p>
          {session.payloadAnalysis ? (
            <span className={`payload-mode-note ${session.payloadAnalysis.level || "small"}`}>
              Paket {session.payloadAnalysis.label || formatBytes(session.payloadAnalysis.bytes)} | {deliveryMode === "progressive" ? "Mode bertahap" : "Mode penuh"}
            </span>
          ) : null}
        </div>
        <div className="exam-icon-actions">
          <button type="button" className="ghost-button icon-button" title="Muat ulang soal" aria-label="Muat ulang soal" onClick={reloadQuestions} disabled={saving}><RefreshCw size={18} /></button>
          <button type="button" className="ghost-button icon-button" title="Ukuran soal" aria-label="Ukuran soal" onClick={() => setFontModalOpen(true)}><ALargeSmall size={18} /></button>
          <button type="button" className="ghost-button icon-button mobile-number-button" title="Nomor soal" aria-label="Nomor soal" onClick={() => setNumberModalOpen(true)}><ListChecks size={18} /></button>
        </div>
        <span className="autosave-status">
          {saving ? "Menyimpan..." : extraHighStability ? `${pendingSaveCount || answeredCount} jawaban tersimpan lokal` : pendingSaveCount ? `${pendingSaveCount} jawaban menunggu autosave` : "Autosave aktif"}
        </span>
        {reloadNotice ? <span className="reload-status">{reloadNotice}</span> : null}
      </section>
      <section className="exam-taking-grid">
        <aside className="panel question-nav-panel">
          <strong>Nomor Soal</strong>
          <QuestionNumberGrid />
          <div className="question-nav-legend">
            <span><i className="legend-current" /> Dibuka</span>
            <span><i className="legend-answered" /> Selesai</span>
            <span><i className="legend-empty" /> Belum</span>
          </div>
        </aside>
        {currentQuestion ? (
          <article className={`panel question-item active-question-card question-size-${questionFontSize}`} ref={questionCardRef} key={currentQuestion.id}>
            <div className="active-question-head">
              <strong>Soal {currentIndex + 1} | {questionTypeLabel(currentQuestion.type)}</strong>
              <span>{isQuestionAnswered(currentQuestion, answers[currentQuestion.id]) ? "Sudah dijawab" : "Belum dijawab"}</span>
            </div>
            <p>{currentQuestion.body}</p>
            <QuestionImage src={currentQuestion.image} alt={`Gambar soal ${currentIndex + 1}`} />
            {currentQuestion.type === "multiple_response" ? (
              <div className="answer-options">
                {(currentQuestion.options || []).map((option, optionIndex) => (
                  <label className="answer-option" key={option.key}>
                    <input
                      type="checkbox"
                      checked={Array.isArray(answers[currentQuestion.id]) && answers[currentQuestion.id].includes(option.key)}
                      onChange={(event) => toggleMulti(currentQuestion.id, option.key, event.target.checked)}
                    />
                    <span>{displayOptionLabel(optionIndex)}</span>
                    <div>{option.text}<QuestionImage src={option.image} alt={`Gambar opsi ${option.key}`} /></div>
                  </label>
                ))}
              </div>
            ) : null}
            {(!currentQuestion.type || currentQuestion.type === "multiple_choice") ? (
              <div className="answer-options">
                {(currentQuestion.options || []).map((option, optionIndex) => (
                  <label className="answer-option" key={option.key}>
                    <input
                      type="radio"
                      name={currentQuestion.id}
                      checked={answers[currentQuestion.id] === option.key}
                      onChange={() => choose(currentQuestion.id, option.key)}
                    />
                    <span>{displayOptionLabel(optionIndex)}</span>
                    <div>{option.text}<QuestionImage src={option.image} alt={`Gambar opsi ${option.key}`} /></div>
                  </label>
                ))}
              </div>
            ) : null}
            {currentQuestion.type === "true_false" ? (
              <div className="statement-answer-list">
                {(currentQuestion.statements || []).map((statement, statementIndex) => (
                  <div className="statement-answer" key={statement.id}>
                    <p>{statementIndex + 1}. {statement.text}</p>
                    <QuestionImage src={statement.image} alt={`Gambar pernyataan ${statementIndex + 1}`} />
                    <div className="row-actions">
                      <label><input type="radio" name={`${currentQuestion.id}-${statement.id}`} checked={answers[currentQuestion.id]?.[statement.id] === "true"} onChange={() => chooseNested(currentQuestion.id, statement.id, "true")} /> Benar</label>
                      <label><input type="radio" name={`${currentQuestion.id}-${statement.id}`} checked={answers[currentQuestion.id]?.[statement.id] === "false"} onChange={() => chooseNested(currentQuestion.id, statement.id, "false")} /> Salah</label>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {currentQuestion.type === "matching" ? (
              <div className="matching-answer-list">
                {(currentQuestion.pairs || []).map((pair, pairIndex) => (
                  <label className="matching-answer" key={pair.id}>
                    <span>{pairIndex + 1}. {pair.left}</span>
                    <QuestionImage src={pair.leftImage} alt={`Gambar pasangan ${pairIndex + 1}`} />
                    <select value={answers[currentQuestion.id]?.[pair.id] || ""} onChange={(event) => chooseNested(currentQuestion.id, pair.id, event.target.value)}>
                      <option value="">Pilih pasangan...</option>
                      {(currentQuestion.matchingOptions || []).map((option) => <option value={option.value} key={option.value}>{option.value}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            ) : null}
            {currentQuestion.type === "short_answer" ? (
              <input
                className="short-answer-input"
                value={answers[currentQuestion.id] || ""}
                placeholder="Tulis jawaban singkat..."
                onChange={(event) => choose(currentQuestion.id, event.target.value)}
                onBlur={(event) => choose(currentQuestion.id, event.target.value)}
              />
            ) : null}
            {currentQuestion.type === "essay" ? (
              <textarea
                className="essay-answer-input"
                value={answers[currentQuestion.id] || ""}
                placeholder="Tulis jawaban uraian..."
                onChange={(event) => choose(currentQuestion.id, event.target.value)}
                onBlur={(event) => choose(currentQuestion.id, event.target.value)}
              />
            ) : null}
            <div className="question-step-actions">
              <button type="button" className="ghost-button" onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))} disabled={currentIndex === 0}>Sebelumnya</button>
              {currentIndex >= questionCount - 1 ? (
                <button type="button" onClick={() => setSubmitConfirmOpen(true)} disabled={!canSubmitNow || remainingMs <= 0 || saving}>
                  <Send size={18} /> {canSubmitNow ? "Submit" : "Submit belum tersedia"}
                </button>
              ) : (
                <button type="button" onClick={() => setCurrentIndex((index) => Math.min(questionCount - 1, index + 1))}>Berikutnya</button>
              )}
            </div>
          </article>
        ) : (
          <div className="empty-state">
            <BookOpen size={34} />
            <strong>{loadingQuestion ? "Memuat soal..." : "Soal tidak tersedia."}</strong>
            <p>{loadingQuestion ? "Mohon tunggu sebentar." : "Coba tekan Muat Ulang Soal atau hubungi pengawas."}</p>
          </div>
        )}
      </section>
      {numberModalOpen ? (
        <Modal title="Nomor Soal" icon={ListChecks} onClose={() => setNumberModalOpen(false)}>
          <div className="mobile-question-picker">
            <QuestionNumberGrid closeOnPick />
            <div className="question-nav-legend">
              <span><i className="legend-current" /> Dibuka</span>
              <span><i className="legend-answered" /> Selesai</span>
              <span><i className="legend-empty" /> Belum</span>
            </div>
          </div>
        </Modal>
      ) : null}
      {fontModalOpen ? (
        <Modal title="Ukuran Soal" icon={ALargeSmall} onClose={() => setFontModalOpen(false)}>
          <div className="font-size-picker">
            <p className="muted">Pilih ukuran teks soal dan pilihan jawaban. Pengaturan ini tersimpan di perangkat yang sedang dipakai.</p>
            <div className="font-size-options">
              {questionFontOptions.map((option) => (
                <button
                  type="button"
                  className={`font-size-option${questionFontSize === option.value ? " active" : ""}`}
                  onClick={() => setQuestionFontSize(option.value)}
                  key={option.value}
                >
                  <span className={`font-size-sample ${option.value}`}>A</span>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                    <em>{option.sample}</em>
                  </span>
                </button>
              ))}
            </div>
            <div className={`font-size-preview question-size-${questionFontSize}`}>
              <strong>Contoh tampilan</strong>
              <p>Manakah pilihan yang paling tepat untuk contoh soal ini?</p>
              <div className="font-preview-option"><span>A</span><b>Contoh pilihan jawaban yang akan terbaca dengan ukuran ini.</b></div>
            </div>
          </div>
        </Modal>
      ) : null}
      {submitConfirmOpen ? (
        <Modal title="Konfirmasi Submit" icon={Send} onClose={() => setSubmitConfirmOpen(false)}>
          <div className="submit-confirm">
            <div className={unansweredCount ? "warning-box" : "success-box"}>
              {unansweredCount ? (
                <span>Masih ada {unansweredCount} soal belum dijawab. Jawaban tetap bisa disubmit, tetapi tidak bisa diubah lagi setelah final.</span>
              ) : (
                <span>Semua soal sudah memiliki jawaban. Setelah submit, jawaban menjadi final.</span>
              )}
            </div>
            <div className="submit-confirm-summary">
              <div><span>Terjawab</span><strong>{answeredCount}/{questionCount}</strong></div>
              <div><span>Waktu</span><strong>{formatRemainingTime(remainingMs)}</strong></div>
            </div>
            <p>Yakin ingin mengirim jawaban sekarang?</p>
            <div className="form-actions">
              <button type="button" onClick={() => { setSubmitConfirmOpen(false); submit(); }} disabled={saving}><Send size={18} /> Ya, Submit Final</button>
              <button type="button" className="ghost-button" onClick={() => setSubmitConfirmOpen(false)}>Kembali Mengerjakan</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function StudentDashboard({ user, onExamModeChange }) {
  const [studentExams, setStudentExams] = useState([]);
  const [tokenByExam, setTokenByExam] = useState({});
  const [session, setSession] = useState(null);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState("");
  const [activeTab, setActiveTab] = useState("ready");
  const [selectedExam, setSelectedExam] = useState(null);
  const [rulesAccepted, setRulesAccepted] = useState(false);

  async function load({ silent = false } = {}) {
    if (!silent) setRefreshing(true);
    try {
      const data = await api(`/student/${user.id}/exams`);
      setStudentExams(data);
      setLastLoadedAt(new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } finally {
      if (!silent) setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, [user.id]);

  useEffect(() => {
    if (session) return undefined;
    const timer = window.setInterval(() => {
      load({ silent: true }).catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, [session, user.id]);

  useEffect(() => {
    onExamModeChange?.(Boolean(session));
    return () => onExamModeChange?.(false);
  }, [session, onExamModeChange]);

  async function start(examId) {
    setNotice("");
    try {
      const result = await api("/attempts/start", {
        method: "POST",
        body: JSON.stringify({ studentId: user.id, examId, token: tokenByExam[examId] || "" })
      });
      setSelectedExam(null);
      setRulesAccepted(false);
      setSession(result);
    } catch (err) {
      setNotice(err.message);
    }
  }

  function beginExam(item) {
    if (item.status === "in_progress") {
      start(item.exam.id);
      return;
    }
    openRules(item);
  }

  if (session) {
    return <ExamTaking session={session} onFinished={() => { setSession(null); load(); }} />;
  }

  const counts = {
    ready: studentExams.filter((item) => item.canStart && item.status !== "submitted").length,
    upcoming: studentExams.filter((item) => ["upcoming", "closed", "invalid_schedule"].includes(item.scheduleStatus) && item.status !== "submitted").length,
    finished: studentExams.filter((item) => item.status === "submitted" || item.scheduleStatus === "ended").length,
    all: studentExams.length
  };
  const tabs = [
    { key: "ready", icon: PlayCircle, label: "Bisa Dikerjakan", count: counts.ready },
    { key: "finished", icon: CheckCircle2, label: "Selesai", count: counts.finished },
    { key: "upcoming", icon: CalendarDays, label: "Akan Datang", count: counts.upcoming },
    { key: "all", icon: ListChecks, label: "Semua", count: counts.all }
  ];
  const filteredExams = studentExams.filter((item) => {
    if (activeTab === "ready") return item.canStart && item.status !== "submitted";
    if (activeTab === "upcoming") return ["upcoming", "closed", "invalid_schedule"].includes(item.scheduleStatus) && item.status !== "submitted";
    if (activeTab === "finished") return item.status === "submitted" || item.scheduleStatus === "ended";
    return true;
  });

  function openRules(examItem) {
    setNotice("");
    setSelectedExam(examItem);
    setRulesAccepted(false);
  }

  return (
    <section className="panel student-portal-panel">
      <div className="student-portal-head">
        <div>
          <PanelTitle icon={ShieldCheck} title="Portal Peserta" />
          <h2>{user.name}</h2>
          <p>{user.className || "Siswa"}</p>
          <div className="portal-actions">
            <button type="button" className="ghost-button" onClick={() => load()} disabled={refreshing}>
              <RefreshCw size={18} /> {refreshing ? "Memuat..." : "Muat Ulang Jadwal"}
            </button>
            {lastLoadedAt ? <span>Update {lastLoadedAt}</span> : null}
          </div>
        </div>
        <div className="student-stat-strip" role="tablist" aria-label="Filter ujian peserta">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button type="button" className={`student-stat-filter${activeTab === tab.key ? " active" : ""}`} onClick={() => setActiveTab(tab.key)} key={tab.key}>
                <span className="student-stat-icon"><Icon size={18} /></span>
                <strong>{tab.count}</strong>
                <small>{tab.label}</small>
              </button>
            );
          })}
        </div>
      </div>
      {notice ? <div className="error-box">{notice}</div> : null}
      <div className="student-exam-list">
        {filteredExams.length ? filteredExams.map((item) => {
          const { exam, status, score, questionCount, canStart, scheduleStatus, scheduleMessage, remainingMs } = item;
          return (
            <div className="exam-ticket" key={exam.id}>
              <div className="exam-ticket-main">
                <strong>{exam.subject}</strong>
                <span>{exam.date} | {formatExamTimeRange(exam)} | {exam.durationMinutes} menit | {questionCount} soal</span>
                <span>Status pengerjaan: {formatResultStatus(status)}</span>
                <span className={scheduleStatusClass(scheduleStatus)}>{formatScheduleStatus(scheduleStatus)}</span>
                {scheduleStatus === "active" ? <code>Sisa waktu jadwal: {formatRemainingTime(remainingMs)}</code> : null}
                {scheduleMessage ? <p className="muted">{scheduleMessage}</p> : null}
                {score ? <code>Nilai: {score.percent}</code> : null}
              </div>
              <div className="exam-ticket-action">
                {status === "submitted" ? <span className="status-pill selected">Selesai</span> : canStart ? (
                  <button type="button" onClick={() => beginExam(item)}><PlayCircle size={18} /> {status === "in_progress" ? "Lanjutkan" : "Mulai"}</button>
                ) : (
                  <button type="button" className="ghost-button" disabled><PlayCircle size={18} /> Belum Bisa Mulai</button>
                )}
              </div>
            </div>
          );
        }) : <p className="muted">Tidak ada ujian pada kategori ini.</p>}
      </div>

      {selectedExam ? (
        <Modal title="Aturan Exam Client" icon={MonitorSmartphone} onClose={() => setSelectedExam(null)}>
          <div className="exam-rule-modal">
            <strong>{selectedExam.exam.subject}</strong>
            <p className="muted">{selectedExam.exam.date} | {formatExamTimeRange(selectedExam.exam)} | Sisa waktu {formatRemainingTime(selectedExam.remainingMs)}</p>
            <ul className="rule-list">
              <li>Jangan keluar dari aplikasi selama ujian.</li>
              <li>Setiap keluar aplikasi akan tercatat di dashboard pengawas.</li>
              <li>Login hanya berlaku untuk satu perangkat.</li>
              <li>Jawaban tersimpan otomatis selama koneksi tersedia.</li>
              <li>Waktu ujian mengikuti jadwal sekolah, bukan waktu mulai pribadi.</li>
            </ul>
            {selectedExam.tokenRequired ? (
              <label>
                Token ujian
                <input
                  placeholder="Masukkan token ujian"
                  value={tokenByExam[selectedExam.exam.id] || ""}
                  onChange={(event) => setTokenByExam({ ...tokenByExam, [selectedExam.exam.id]: event.target.value.toUpperCase() })}
                />
              </label>
            ) : <div className="info-box">Ujian ini tidak membutuhkan token. Pastikan nama dan mata pelajaran sudah benar sebelum lanjut.</div>}
            <label className="inline-check">
              <input type="checkbox" checked={rulesAccepted} onChange={(event) => setRulesAccepted(event.target.checked)} />
              Saya memahami dan menyetujui aturan ujian.
            </label>
            <div className="form-actions">
              <button type="button" disabled={!rulesAccepted || (selectedExam.tokenRequired && !(tokenByExam[selectedExam.exam.id] || "").trim())} onClick={() => start(selectedExam.exam.id)}>
                <PlayCircle size={18} /> Lanjut Ujian
              </button>
              <button type="button" className="ghost-button" onClick={() => setSelectedExam(null)}>Batal</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function PanelTitle({ icon: Icon, title }) {
  return <h2 className="panel-title"><Icon size={18} /> {title}</h2>;
}

function PasswordConfirmModal({
  title,
  icon = AlertTriangle,
  description,
  confirmText,
  passwordLabel = "Password akun",
  actionLabel = "Konfirmasi",
  reason,
  setReason,
  password,
  setPassword,
  confirmation,
  setConfirmation,
  loading = false,
  onCancel,
  onConfirm
}) {
  const ready = password.trim() && (!confirmText || confirmation.trim().toUpperCase() === confirmText) && (setReason ? reason.trim() : true);
  return (
    <Modal title={title} icon={icon} onClose={onCancel}>
      <form className="student-form danger-confirm-form" onSubmit={(event) => { event.preventDefault(); if (ready && !loading) onConfirm(); }}>
        <div className="error-box">{description}</div>
        {setReason ? (
          <label>Alasan
            <textarea value={reason} placeholder="Contoh: pelanggaran saat ujian" onChange={(event) => setReason(event.target.value)} required />
          </label>
        ) : null}
        {confirmText ? (
          <label>Ketik Konfirmasi
            <input value={confirmation} placeholder={confirmText} onChange={(event) => setConfirmation(event.target.value.toUpperCase())} required />
          </label>
        ) : null}
        <label>{passwordLabel}
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <div className="form-actions">
          <button type="submit" className="danger-button" disabled={!ready || loading}><AlertTriangle size={18} /> {loading ? "Memproses..." : actionLabel}</button>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={loading}>Batal</button>
        </div>
      </form>
    </Modal>
  );
}

function DataTable({ headers, rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, index) => (
            <tr key={index}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell}</td>)}</tr>
          )) : (
            <tr><td colSpan={headers.length}>Belum ada data.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(() => readSession()?.user || null);
  const [view, setView] = useState("dashboard");
  const [summary, setSummary] = useState({});
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [exams, setExams] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [violations, setViolations] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [results, setResults] = useState([]);
  const [accessControl, setAccessControl] = useState({ studentMode: "browser_token", browserTokens: [] });
  const [examSettings, setExamSettings] = useState({ examWithoutToken: false, tokenIntervalMinutes: 15, submitUnlockMinutes: 30, showStudentScores: true });
  const [studentExamActive, setStudentExamActive] = useState(false);
  const [monitoringTab, setMonitoringTab] = useState("active");

  const roleLabel = useMemo(() => {
    if (!user) return "";
    return { admin: "Admin", guru: "Guru", pengawas: "Pengawas", siswa: "Peserta" }[user.role] || user.role;
  }, [user]);

  const navItems = useMemo(() => {
    if (!user) return [];
    if (user.role === "admin") {
      return [
        { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
        { view: "teachers", label: "Data Guru", icon: UserRound },
        { view: "students", label: "Data Siswa", icon: Users },
        { view: "cards", label: "Kartu Peserta", icon: CreditCard },
        { view: "exams", label: "Ujian", icon: ClipboardList },
        { view: "examParticipants", label: "Peserta Ujian", icon: Users },
        { view: "results", label: "Hasil", icon: CheckCircle2 },
        { view: "monitoring", label: "Monitoring", icon: MonitorSmartphone },
        { view: "settings", label: "Pengaturan", icon: Settings }
      ];
    }
    if (user.role === "guru") {
      return [
        { view: "questions", label: "Bank Soal", icon: BookOpen },
        { view: "questionTest", label: "Test Soal", icon: MonitorSmartphone },
        { view: "results", label: "Hasil", icon: CheckCircle2 }
      ];
    }
    if (user.role === "pengawas") {
      return [
        { view: "dashboard", label: "Monitoring", icon: MonitorSmartphone },
        { view: "results", label: "Hasil", icon: CheckCircle2 }
      ];
    }
    return [{ view: "dashboard", label: "Portal Peserta", icon: ShieldCheck }];
  }, [user]);

  async function refresh(scope = "full") {
    if (!user || user.role === "siswa") return;
    try {
      if (scope === "monitoring") {
        const [summaryData, violationsData, attemptsData] = await Promise.all([
          api("/summary"),
          api("/violations"),
          api("/attempts")
        ]);
        setSummary(summaryData);
        setViolations(violationsData);
        setAttempts(attemptsData);
        return;
      }

      const [summaryData, studentsData, teachersData, examsData, questionsData, violationsData, attemptsData, resultsData, accessControlData, examSettingsData] = await Promise.all([
        api("/summary"),
        api("/students"),
        api("/teachers"),
        api("/exams"),
        api("/questions"),
        api("/violations"),
        api("/attempts"),
        api("/results"),
        api("/access-control"),
        api("/exam-settings")
      ]);
      setSummary(summaryData);
      setStudents(studentsData);
      setTeachers(teachersData);
      setExams(examsData);
      setQuestions(questionsData);
      setViolations(violationsData);
      setAttempts(attemptsData);
      setResults(resultsData);
      setAccessControl(accessControlData);
      setExamSettings(examSettingsData);
    } catch {
      if (!readSession()) {
        setUser(null);
        setView("dashboard");
      }
    }
  }

  useEffect(() => {
    if (user) refresh();
  }, [user]);

  useEffect(() => {
    if (!user || user.role === "siswa") return undefined;
    const monitoringRefreshMs = clampNumber(examSettings.monitoringRefreshSeconds, 5, 60, 10) * 1000;
    const refreshMs = view === "monitoring" || user.role === "pengawas" ? monitoringRefreshMs : 30000;
    const timer = window.setInterval(() => {
      refresh(view === "monitoring" || user.role === "pengawas" ? "monitoring" : "full").catch(() => {});
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [user, view, examSettings.monitoringRefreshSeconds]);

  if (!user) return <Login onLogin={setUser} />;

  function logout() {
    clearSession();
    setUser(null);
    setView("dashboard");
    setStudentExamActive(false);
  }

  function updateUser(nextUser) {
    const currentSession = readSession();
    if (currentSession?.token) saveSession({ ...currentSession, user: nextUser });
    setUser(nextUser);
  }

  if (user.role === "siswa" && user.accessState?.required && !user.accessState?.granted) {
    return <BrowserAccessGate user={user} onAuthorized={updateUser} onLogout={logout} />;
  }

  function renderContent() {
    if (user.role === "guru") {
      if (view === "results") return <ResultsDashboard results={results} students={students} exams={exams} questions={questions} violations={violations} />;
      if (view === "questionTest") return <TeacherQuestionTest exams={exams} questions={questions} />;
      return <TeacherDashboard exams={exams} questions={questions} onQuestionCreated={refresh} />;
    }
    if (user.role === "siswa") {
      return <StudentDashboard user={user} exams={exams} onExamModeChange={setStudentExamActive} />;
    }
    if (user.role === "pengawas") {
      if (view === "results") return <ResultsDashboard results={results} students={students} exams={exams} questions={questions} violations={violations} />;
      return <MonitoringDashboard attempts={attempts} students={students} exams={exams} violations={violations} activeTab={monitoringTab} onTabChange={setMonitoringTab} onChanged={refresh} canDeleteViolations={false} />;
    }
    if (view === "students") {
      return <StudentManager students={students} onChanged={refresh} onExit={() => setView("dashboard")} />;
    }
    if (view === "teachers") {
      return <TeacherManager teachers={teachers} exams={exams} onChanged={refresh} />;
    }
    if (view === "cards") {
      return <ParticipantCards students={students} />;
    }
    if (view === "exams") {
      return <ExamManager exams={exams} questions={questions} teachers={teachers} onChanged={refresh} onExit={() => setView("dashboard")} />;
    }
    if (view === "examParticipants") {
      return <ExamParticipants exams={exams} students={students} attempts={attempts} onChanged={refresh} />;
    }
    if (view === "results") {
      return <ResultsDashboard results={results} students={students} exams={exams} questions={questions} violations={violations} />;
    }
    if (view === "monitoring") {
      return <MonitoringDashboard attempts={attempts} students={students} exams={exams} violations={violations} activeTab={monitoringTab} onTabChange={setMonitoringTab} onChanged={refresh} canDeleteViolations={user.role === "admin"} />;
    }
    if (view === "settings") {
      return <SettingsDashboard accessControl={accessControl} examSettings={examSettings} onAccessControlChanged={setAccessControl} onExamSettingsChanged={setExamSettings} />;
    }
    return <AdminDashboard summary={summary} students={students} exams={exams} questions={questions} attempts={attempts} results={results} violations={violations} />;
  }

  function pageTitle() {
    if (user.role === "guru" && view === "questionTest") return "Dashboard Test Soal";
    if (user.role === "guru" && view === "results") return "Dashboard Hasil";
    if (user.role === "guru") return "Dashboard Bank Soal";
    if (user.role === "siswa") return "Portal Peserta";
    if (user.role === "pengawas" || view === "monitoring") return "Dashboard Monitoring";
    if (view === "settings") return "Pengaturan Ujian";
    return "Dashboard Aplikasi Ujian";
  }

  function renderTopbarActions() {
    const isMonitoring = user.role === "pengawas" || view === "monitoring";
    if (!isMonitoring || studentExamActive) return null;
    return (
      <div className="topbar-actions">
        <div className="exam-tabs topbar-tabs">
          <button type="button" className={monitoringTab === "active" ? "active" : ""} onClick={() => setMonitoringTab("active")}>
            Monitoring Aktif
          </button>
          <button type="button" className={monitoringTab === "violations" ? "active" : ""} onClick={() => setMonitoringTab("violations")}>
            Pelanggaran
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className={`app-shell ${user.role === "siswa" ? "student-shell" : ""} ${studentExamActive ? "exam-mode" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <ShieldCheck size={26} />
          <div>
            <strong>CBT SMAN 94</strong>
            <span>Tahap 1</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button type="button" className={view === item.view ? "active" : ""} onClick={() => setView(item.view)} key={item.view}>
                <Icon size={18} /> {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span>{user.name || user.username}</span>
            <strong>{roleLabel}</strong>
          </div>
          <button className="sidebar-logout-button" type="button" onClick={logout}>
            <LogOut size={18} /> Logout
          </button>
        </div>
      </aside>
      <section className="main-section">
        <header className="topbar">
          <div>
            <span className="eyebrow">{roleLabel}</span>
            <div className="topbar-title-row">
              <h1>{pageTitle()}</h1>
              {renderTopbarActions()}
            </div>
          </div>
        </header>
        {renderContent()}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
