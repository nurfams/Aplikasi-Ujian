import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import readXlsxFile from "read-excel-file/browser";
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  KeyRound,
  ListChecks,
  LayoutDashboard,
  LogOut,
  MonitorSmartphone,
  PlayCircle,
  Plus,
  Printer,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  Users
} from "lucide-react";
import "./styles.css";

const API = "http://127.0.0.1:4100/api";
const SESSION_KEY = "cbt_sman94_session";

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
    throw new Error(error.message || "Request gagal.");
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
  const questions = [];
  let current = null;

  function finishCurrent() {
    if (!current) return;
    current.body = current.body.trim();
    if (current.body && current.options.length >= 2 && current.answerKey) {
      questions.push(current);
    }
  }

  for (const line of lines) {
    const questionMatch = line.match(/^\d+[\).]\s*(.+)$/);
    const optionMatch = line.match(/^([A-E])[\).]\s*(.+)$/i);
    const keyMatch = line.match(/^(kunci|jawaban|answer)\s*[:=]?\s*([A-E])\b/i);
    const scoreMatch = line.match(/^(bobot|skor|score)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);

    if (questionMatch) {
      finishCurrent();
      current = {
        examId,
        body: questionMatch[1],
        options: [],
        answerKey: "",
        score: 1
      };
    } else if (current && optionMatch) {
      current.options.push({ key: optionMatch[1].toUpperCase(), text: optionMatch[2] });
    } else if (current && keyMatch) {
      current.answerKey = keyMatch[2].toUpperCase();
    } else if (current && scoreMatch) {
      current.score = Number(scoreMatch[2].replace(",", ".")) || 1;
    } else if (current) {
      current.body = `${current.body}\n${line}`;
    }
  }

  finishCurrent();
  return questions;
}

function formatElectiveSubjects(student) {
  return Array.isArray(student.electiveSubjects) ? student.electiveSubjects : [];
}

function downloadStudentTemplate() {
  const headers = ["nis", "nisn", "name", "gender", "className", "username", "password", "room", "session", "Mapel Pilihan 1", "Mapel Pilihan 2", "Mapel Pilihan 3", "Mapel Pilihan 4", "Mapel Pilihan 5"];
  const rows = [
    ["10676", "0062721508", "AGISFA ROCHMANY ALFATH", "L", "XII.2", "10676", "10676", "Lab 1", "Sesi 1", "Informatika 2", "Sejarah TL 2", "", "", ""],
    ["10690", "0061606839", "AMELIA RASHEEDAH", "P", "XII.3", "10690", "10690", "Lab 1", "Sesi 1", "Sejarah TL 1", "Sosiologi 1", "", "", ""]
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

function PaginationControls({ page, pageSize, total, onPageChange, onPageSizeChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total ? (Math.min(page, totalPages) - 1) * pageSize + 1 : 0;
  const end = Math.min(Math.min(page, totalPages) * pageSize, total);

  return (
    <div className="pagination-bar">
      <span>{start}-{end} dari {total} data</span>
      <div className="pagination-actions">
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {[25, 50, 100].map((size) => <option value={size} key={size}>{size}/halaman</option>)}
        </select>
        <button type="button" className="ghost-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Sebelumnya</button>
        <code>{Math.min(page, totalPages)} / {totalPages}</code>
        <button type="button" className="ghost-button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Berikutnya</button>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-icon"><Icon size={20} /></div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function Login({ onLogin }) {
  const [form, setForm] = useState({ username: "admin", password: "admin123" });
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
            <p>Fondasi aplikasi ujian tahap pertama</p>
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
        <div className="demo-users">
          <span>Demo:</span>
          <code>admin/admin123</code>
          <code>guru_informatika/guru123</code>
          <code>10676/10676</code>
        </div>
      </section>
    </main>
  );
}

function AdminDashboard({ summary, students, exams, violations }) {
  return (
    <div className="content-grid">
      <section className="span-full stat-grid">
        <StatCard icon={Users} label="Siswa" value={summary.students ?? 0} />
        <StatCard icon={UserRound} label="Guru" value={summary.teachers ?? 0} />
        <StatCard icon={ClipboardList} label="Ujian" value={summary.exams ?? 0} />
        <StatCard icon={AlertTriangle} label="Log Pelanggaran" value={summary.violations ?? 0} />
      </section>
      <section className="panel">
        <PanelTitle icon={CalendarDays} title="Jadwal Ujian" />
        <DataTable
          headers={["Kode", "Mapel", "Tanggal", "Durasi", "Status"]}
          rows={exams.map((exam) => [exam.code, exam.subject, `${exam.date} ${exam.startTime}`, `${exam.durationMinutes} menit`, exam.status])}
        />
      </section>
      <section className="panel">
        <PanelTitle icon={CreditCard} title="Kartu Peserta" />
        <div className="card-preview-list">
          {students.slice(0, 3).map((student) => (
            <div className="participant-card" key={student.id}>
              <strong>{student.name}</strong>
              <span>{student.className} | {student.room} | {student.session}</span>
              <code>{student.username} / {student.password}</code>
            </div>
          ))}
        </div>
      </section>
      <section className="panel span-full">
        <PanelTitle icon={MonitorSmartphone} title="Monitoring Pelanggaran" />
        <DataTable
          headers={["Waktu", "Siswa", "Ujian", "Level", "Catatan"]}
          rows={violations.map((item) => [
            new Date(item.createdAt).toLocaleString("id-ID"),
            item.studentName,
            item.examCode,
            item.level,
            item.message
          ])}
        />
      </section>
    </div>
  );
}

function StudentManager({ students, onChanged, onExit }) {
  const emptyForm = { nis: "", nisn: "", name: "", gender: "", username: "", password: "", className: "", room: "", session: "", mapelPilihan1: "", mapelPilihan2: "", mapelPilihan3: "", mapelPilihan4: "", mapelPilihan5: "" };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const filtered = students.filter((student) => {
    const haystack = `${student.nis} ${student.name} ${student.username} ${student.className} ${formatElectiveSubjects(student).join(" ")} ${student.room} ${student.session}`.toLowerCase();
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
      username: student.username,
      password: student.password,
      className: student.className,
      room: student.room,
      session: student.session,
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
      className: form.className,
      room: form.room,
      session: form.session,
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

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-toolbar">
          <div className="toolbar-actions">
            <button type="button" onClick={() => setModal("bulk")}><Upload size={18} /> Upload Bulk</button>
            <button type="button" onClick={() => { reset(); setModal("form"); }}><Plus size={18} /> Tambah Siswa</button>
            <button type="button" className="ghost-button" onClick={onExit}>Keluar</button>
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
                <th>Kelas</th>
                <th>Mapel Pilihan 1</th>
                <th>Mapel Pilihan 2</th>
                <th>Mapel Pilihan 3</th>
                <th>Mapel Pilihan 4</th>
                <th>Mapel Pilihan 5</th>
                <th>Username</th>
                <th>Ruang</th>
                <th>Sesi</th>
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
                  <td>{student.className}</td>
                  <td>{formatElectiveSubjects(student)[0] || "-"}</td>
                  <td>{formatElectiveSubjects(student)[1] || "-"}</td>
                  <td>{formatElectiveSubjects(student)[2] || "-"}</td>
                  <td>{formatElectiveSubjects(student)[3] || "-"}</td>
                  <td>{formatElectiveSubjects(student)[4] || "-"}</td>
                  <td><code>{student.username}</code></td>
                  <td>{student.room}</td>
                  <td>{student.session}</td>
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
              <label>Password<input value={form.password} placeholder="Default NIS" onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
            </div>
            <div className="inline-fields">
              <label>Ruang<input value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} /></label>
              <label>Sesi<input value={form.session} onChange={(event) => setForm({ ...form, session: event.target.value })} /></label>
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
            <p>Header yang didukung: `nis`, `nisn`, `name`, `gender`, `className`, `username`, `password`, `room`, `session`, `Mapel Pilihan 1`, sampai `Mapel Pilihan 5`.</p>
            <p>Gunakan file `.xlsx` atau `.csv`. Jika file masih `.xls` lama, buka di Excel lalu `Save As` menjadi `.xlsx` terlebih dahulu.</p>
            <div className="sample-table">
              <div>nis</div><div>nisn</div><div>name</div><div>className</div><div>Mapel Pilihan 1</div><div>Mapel Pilihan 2</div>
              <div>10676</div><div>0062721508</div><div>AGISFA ROCHMANY ALFATH</div><div>XII.2</div><div>Informatika 2</div><div>Sejarah TL 2</div>
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
    </div>
  );
}

function ParticipantCards({ students }) {
  const [qrMap, setQrMap] = useState({});
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const filtered = students.filter((student) => {
    const text = `${student.nis} ${student.name} ${student.className} ${formatElectiveSubjects(student).join(" ")} ${student.room} ${student.session}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });
  const paged = getPageItems(filtered, page, pageSize);

  useEffect(() => {
    let alive = true;
    async function buildQr() {
      const pairs = await Promise.all(students.map(async (student) => {
        const payload = `CBT94|${student.username}|${student.className}|${student.session}`;
        const url = await QRCode.toDataURL(payload, { margin: 1, width: 128 });
        return [student.id, url];
      }));
      if (alive) setQrMap(Object.fromEntries(pairs));
    }
    buildQr();
    return () => { alive = false; };
  }, [students]);

  function Card({ student }) {
    return (
      <article className="print-card" key={student.id}>
        <div className="print-card-head">
          <div>
            <span>CBT SMAN 94 Jakarta</span>
            <strong>Kartu Peserta Ujian</strong>
          </div>
          {qrMap[student.id] ? <img src={qrMap[student.id]} alt={`QR ${student.name}`} /> : <div className="qr-placeholder" />}
        </div>
        <div className="student-name">{student.name}</div>
        <div className="print-fields">
          <span>NIS</span><strong>{student.nis}</strong>
          <span>Kelas</span><strong>{student.className}</strong>
          <span>Ruang</span><strong>{student.room}</strong>
          <span>Sesi</span><strong>{student.session}</strong>
          <span>Username</span><code>{student.username}</code>
          <span>Password</span><code>{student.password}</code>
        </div>
      </article>
    );
  }

  return (
    <div className="cards-page">
      <section className="panel no-print">
        <div className="panel-toolbar">
          <PanelTitle icon={CreditCard} title="Cetak Kartu Peserta" />
          <div className="print-actions">
            <label className="search-box">
              <Search size={16} />
              <input value={query} placeholder="Filter kartu..." onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
            </label>
            <button type="button" onClick={() => window.print()}><Printer size={18} /> Cetak</button>
          </div>
        </div>
        <p className="muted">Layar memakai pagination agar browser ringan. Saat klik cetak, semua kartu sesuai filter akan ikut tercetak. Default cetak disiapkan sekitar 15 kartu per A4.</p>
      </section>
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
        />
      </div>
      <section className="print-grid print-only">
        {filtered.map((student) => <Card student={student} key={student.id} />)}
      </section>
    </div>
  );
}

function ExamManager({ exams, onChanged, onExit }) {
  const emptyForm = {
    code: "",
    subject: "",
    date: "",
    startTime: "",
    durationMinutes: 90,
    token: "",
    status: "draft",
    randomizeQuestions: true,
    randomizeOptions: true
  };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [notice, setNotice] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  function edit(exam) {
    setEditingId(exam.id);
    setForm({
      code: exam.code,
      subject: exam.subject,
      date: exam.date,
      startTime: exam.startTime,
      durationMinutes: exam.durationMinutes,
      token: exam.token,
      status: exam.status,
      randomizeQuestions: exam.randomizeQuestions,
      randomizeOptions: exam.randomizeOptions
    });
    setNotice("");
    setModalOpen(true);
  }

  function reset() {
    setEditingId("");
    setForm(emptyForm);
  }

  async function submit(event) {
    event.preventDefault();
    const payload = { ...form, durationMinutes: Number(form.durationMinutes) };
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
    await api(`/exams/${exam.id}`, { method: "PUT", body: JSON.stringify({ ...exam, status }) });
    setNotice(status === "published" ? "Ujian dipublish dan bisa diakses peserta." : "Status ujian diperbarui.");
    onChanged();
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
            <button type="button" className="ghost-button" onClick={onExit}>Keluar</button>
          </div>
        </div>
        <PanelTitle icon={ClipboardList} title="Daftar Ujian" />
        {notice ? <div className="success-box">{notice}</div> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Mapel</th>
                <th>Jadwal</th>
                <th>Token</th>
                <th>Status</th>
                <th>Peserta</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {exams.map((exam) => (
                <tr key={exam.id}>
                  <td>{exam.code}</td>
                  <td>{exam.subject}</td>
                  <td>{exam.date} {exam.startTime}</td>
                  <td><code>{exam.token}</code></td>
                  <td>{exam.status}</td>
                  <td>{exam.participantCount}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="small-button" onClick={() => edit(exam)}>Edit</button>
                      <button type="button" className="small-button" onClick={() => setStatus(exam, exam.status === "published" ? "closed" : "published")}>
                        {exam.status === "published" ? "Tutup" : "Publish"}
                      </button>
                      <button type="button" className="danger-button" onClick={() => remove(exam)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {modalOpen ? (
        <Modal title={editingId ? "Edit Ujian" : "Tambah Ujian"} icon={CalendarDays} onClose={() => { reset(); setModalOpen(false); }} wide>
          <form className="student-form" onSubmit={submit}>
            <div className="inline-fields">
              <label>Kode Ujian<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required /></label>
              <label>Token<input value={form.token} onChange={(event) => setForm({ ...form, token: event.target.value.toUpperCase() })} required /></label>
            </div>
            <label>Mata Pelajaran<input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} required /></label>
            <div className="inline-fields">
              <label>Tanggal<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></label>
              <label>Jam Mulai<input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} required /></label>
            </div>
            <div className="inline-fields">
              <label>Durasi Menit<input type="number" min="1" value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} /></label>
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
    </div>
  );
}

function ExamParticipants({ exams, students, attempts, onChanged }) {
  const [selectedExamId, setSelectedExamId] = useState(exams[0]?.id || "");
  const [participantFilter, setParticipantFilter] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    if (!selectedExamId && exams[0]) setSelectedExamId(exams[0].id);
  }, [exams, selectedExamId]);

  const selectedExam = exams.find((exam) => exam.id === selectedExamId);
  const selectedStudentIds = new Set(attempts.filter((attempt) => attempt.examId === selectedExamId).map((attempt) => attempt.studentId));
  const electiveOptions = [...new Set(students.flatMap((student) => formatElectiveSubjects(student)))].sort((a, b) => a.localeCompare(b, "id"));
  const filteredStudents = students.filter((student) => {
    const matchesSubject = participantFilter ? formatElectiveSubjects(student).includes(participantFilter) : true;
    const text = `${student.nis} ${student.name} ${student.className} ${formatElectiveSubjects(student).join(" ")}`.toLowerCase();
    return matchesSubject && text.includes(query.toLowerCase());
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

  async function selectAllParticipants() {
    if (!selectedExam) return;
    const nextStudentIds = new Set(selectedStudentIds);
    for (const student of filteredStudents) nextStudentIds.add(student.id);
    await api(`/exams/${selectedExam.id}/participants`, {
      method: "PUT",
      body: JSON.stringify({ studentIds: [...nextStudentIds] })
    });
    onChanged();
  }

  return (
    <section className="panel">
      <div className="panel-toolbar">
        <PanelTitle icon={Users} title="Peserta Ujian" />
        <div className="toolbar-actions">
          <select value={selectedExamId} onChange={(event) => { setSelectedExamId(event.target.value); setPage(1); }}>
            {exams.map((exam) => <option value={exam.id} key={exam.id}>{exam.code} - {exam.subject}</option>)}
          </select>
          <select value={participantFilter} onChange={(event) => { setParticipantFilter(event.target.value); setPage(1); }}>
            <option value="">Semua siswa</option>
            {electiveOptions.map((subject) => <option value={subject} key={subject}>{subject}</option>)}
          </select>
          <button type="button" className="ghost-button" onClick={selectAllParticipants}>Pilih Semua Filter</button>
        </div>
      </div>
      <div className="panel-toolbar">
        <p className="muted">{filteredStudents.length} siswa tampil. {selectedStudentIds.size} peserta sudah dipilih untuk ujian ini.</p>
        <label className="search-box">
          <Search size={16} />
          <input value={query} placeholder="Cari peserta..." onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        </label>
      </div>
      <div className="participant-checks participant-checks-table">
        {paged.items.map((student) => (
          <label className="check-row" key={student.id}>
            <input
              type="checkbox"
              checked={selectedStudentIds.has(student.id)}
              onChange={(event) => toggleParticipant(student.id, event.target.checked)}
            />
            {student.name} <span>{student.className} | {formatElectiveSubjects(student).join(", ") || "Tanpa mapel pilihan"}</span>
          </label>
        ))}
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

function ResultsDashboard({ results }) {
  return (
    <section className="panel">
      <PanelTitle icon={CheckCircle2} title="Hasil Nilai dan Status Peserta" />
      <DataTable
        headers={["Siswa", "Kelas", "Ujian", "Status", "Nilai", "Benar/Total", "Update"]}
        rows={results.map((item) => [
          item.studentName,
          item.className,
          item.examCode,
          item.status,
          item.score ? `${item.score.percent}` : "-",
          item.score ? `${item.score.earnedScore}/${item.score.totalScore}` : "-",
          item.updatedAt ? new Date(item.updatedAt).toLocaleString("id-ID") : "-"
        ])}
      />
    </section>
  );
}

function TeacherDashboard({ exams, questions, onQuestionCreated }) {
  const firstExam = exams[0];
  const emptyQuestion = {
    examId: firstExam?.id || "",
    body: "",
    answerKey: "A",
    score: 1,
    options: [
      { key: "A", text: "" },
      { key: "B", text: "" },
      { key: "C", text: "" },
      { key: "D", text: "" },
      { key: "E", text: "" }
    ]
  };
  const [form, setForm] = useState(emptyQuestion);
  const [editingId, setEditingId] = useState("");
  const [notice, setNotice] = useState("");
  const [importPreview, setImportPreview] = useState([]);

  useEffect(() => {
    if (firstExam && !form.examId) {
      setForm((current) => ({ ...current, examId: firstExam.id }));
    }
  }, [firstExam, form.examId]);

  const selectedExamQuestions = questions.filter((question) => question.examId === form.examId);

  function resetForm(nextExamId = form.examId) {
    setEditingId("");
    setForm({
      ...emptyQuestion,
      examId: nextExamId,
      options: emptyQuestion.options.map((option) => ({ ...option }))
    });
  }

  function edit(question) {
    setEditingId(question.id);
    setForm({
      examId: question.examId,
      body: question.body,
      answerKey: question.answerKey,
      score: question.score,
      options: question.options.map((option) => ({ ...option }))
    });
    setNotice("");
  }

  async function submit(event) {
    event.preventDefault();
    if (editingId) {
      await api(`/questions/${editingId}`, { method: "PUT", body: JSON.stringify(form) });
      setNotice("Soal berhasil diperbarui.");
    } else {
      await api("/questions", { method: "POST", body: JSON.stringify(form) });
      setNotice("Soal berhasil ditambahkan.");
    }
    resetForm(form.examId);
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
    if (!file || !form.examId) return;
    const lowerName = file.name.toLowerCase();
    let text = "";
    if (lowerName.endsWith(".txt")) {
      text = await file.text();
    } else {
      const { default: mammoth } = await import("mammoth/mammoth.browser");
      text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    }
    const parsed = parseQuestionText(text, form.examId);
    setImportPreview(parsed);
    setNotice(parsed.length ? `${parsed.length} soal terdeteksi dan siap disimpan.` : "Belum ada soal valid yang terbaca. Cek format nomor, opsi, dan kunci.");
    event.target.value = "";
  }

  async function saveImportedQuestions() {
    if (!importPreview.length) return;
    const result = await api("/questions/bulk", {
      method: "POST",
      body: JSON.stringify({ examId: form.examId, questions: importPreview })
    });
    setNotice(`Import tersimpan: ${result.created} soal, ${result.skipped} dilewati.`);
    setImportPreview([]);
    onQuestionCreated();
  }

  return (
    <div className="content-grid">
      <section className="panel">
        <PanelTitle icon={BookOpen} title={editingId ? "Edit Soal" : "Input Soal Langsung"} />
        <form className="question-form" onSubmit={submit}>
          <label>
            Paket Ujian
            <select
              value={form.examId}
              onChange={(event) => {
                resetForm(event.target.value);
                setImportPreview([]);
              }}
            >
              {exams.map((exam) => <option value={exam.id} key={exam.id}>{exam.code} - {exam.subject}</option>)}
            </select>
          </label>
          <label>
            Soal
            <textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="Tulis pertanyaan..." required />
          </label>
          <div className="option-grid">
            {form.options.map((option, index) => (
              <label key={option.key}>
                Opsi {option.key}
                <input
                  value={option.text}
                  onChange={(event) => {
                    const options = [...form.options];
                    options[index] = { ...option, text: event.target.value };
                    setForm({ ...form, options });
                  }}
                  required
                />
              </label>
            ))}
          </div>
          <div className="inline-fields">
            <label>
              Kunci
              <select value={form.answerKey} onChange={(event) => setForm({ ...form, answerKey: event.target.value })}>
                {form.options.map((option) => <option value={option.key} key={option.key}>{option.key}</option>)}
              </select>
            </label>
            <label>
              Bobot
              <input type="number" min="1" value={form.score} onChange={(event) => setForm({ ...form, score: event.target.value })} />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit">{editingId ? <Save size={18} /> : <Plus size={18} />} {editingId ? "Simpan Perubahan" : "Simpan Soal"}</button>
            {editingId ? <button type="button" className="ghost-button" onClick={() => resetForm(form.examId)}>Batal</button> : null}
          </div>
        </form>
        <div className="import-box">
          <strong>Import Soal Word/Teks</strong>
          <p>Format: `1. Pertanyaan`, `A. Opsi`, `B. Opsi`, sampai opsi terakhir, lalu `Kunci: C`. File `.docx`, `.docm`, dan `.txt` didukung.</p>
          <label className="file-button">
            <Upload size={18} />
            Pilih File Soal
            <input type="file" accept=".docx,.docm,.txt" onChange={importFile} />
          </label>
          {importPreview.length ? (
            <div className="import-preview">
              <strong>{importPreview.length} soal siap diimport</strong>
              <button type="button" onClick={saveImportedQuestions}><Save size={18} /> Simpan Hasil Import</button>
            </div>
          ) : null}
        </div>
        {notice ? <div className={notice.includes("dilewati") || notice.includes("Belum") ? "error-box" : "success-box"}>{notice}</div> : null}
      </section>
      <section className="panel">
        <PanelTitle icon={ClipboardList} title={`Bank Soal (${selectedExamQuestions.length})`} />
        <div className="question-list">
          {selectedExamQuestions.map((question, index) => (
            <article key={question.id}>
              <span>Soal {index + 1}</span>
              <p>{question.body}</p>
              <div className="mini-options">
                {question.options.map((option) => <code key={option.key}>{option.key}. {option.text}</code>)}
              </div>
              <code>Kunci {question.answerKey} | Bobot {question.score}</code>
              <div className="row-actions">
                <button type="button" className="small-button" onClick={() => edit(question)}>Edit</button>
                <button type="button" className="danger-button" onClick={() => remove(question)}><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
          {selectedExamQuestions.length ? null : <p className="muted">Belum ada soal untuk paket ujian ini.</p>}
        </div>
      </section>
    </div>
  );
}

function ExamTaking({ session, onFinished }) {
  const [answers, setAnswers] = useState(session.attempt.answers || {});
  const [saving, setSaving] = useState(false);
  const [submittedAttempt, setSubmittedAttempt] = useState(null);

  async function choose(questionId, value) {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    setSaving(true);
    await api(`/attempts/${session.attempt.id}/answers`, { method: "PUT", body: JSON.stringify({ answers: next }) });
    setSaving(false);
  }

  async function submit() {
    const ok = window.confirm("Submit jawaban sekarang? Jawaban akan menjadi final.");
    if (!ok) return;
    const result = await api(`/attempts/${session.attempt.id}/submit`, { method: "POST", body: JSON.stringify({ answers }) });
    setSubmittedAttempt(result);
  }

  async function markViolation() {
    await api(`/attempts/${session.attempt.id}/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ event: "focus_lost_simulation", level: "warning", message: "Simulasi event keluar aplikasi dari portal siswa." })
    });
  }

  if (submittedAttempt) {
    return (
      <section className="panel exam-entry">
        <PanelTitle icon={CheckCircle2} title="Ujian Selesai" />
        <h2>Nilai: {submittedAttempt.score?.percent ?? 0}</h2>
        <p>Benar {submittedAttempt.score?.earnedScore ?? 0} dari total {submittedAttempt.score?.totalScore ?? 0} poin. Nilai juga sudah masuk ke halaman hasil admin/guru.</p>
        <button type="button" onClick={() => onFinished(submittedAttempt)}><CheckCircle2 size={18} /> Kembali ke Portal</button>
      </section>
    );
  }

  return (
    <div className="exam-workspace">
      <section className="panel exam-header">
        <div>
          <PanelTitle icon={ListChecks} title={session.exam.subject} />
          <p>{session.exam.code} | Durasi {session.exam.durationMinutes} menit | {Object.keys(answers).length}/{session.questions.length} terjawab</p>
        </div>
        <div className="form-actions">
          <button type="button" className="ghost-button" onClick={markViolation}>Simulasi Log Keluar App</button>
          <button type="button" onClick={submit}><Send size={18} /> Submit</button>
        </div>
        <span className="autosave-status">{saving ? "Menyimpan..." : "Autosave aktif"}</span>
      </section>
      <section className="question-paper">
        {session.questions.map((question, index) => (
          <article className="panel question-item" key={question.id}>
            <strong>Soal {index + 1}</strong>
            <p>{question.body}</p>
            <div className="answer-options">
              {question.options.map((option) => (
                <label className="answer-option" key={option.key}>
                  <input
                    type="radio"
                    name={question.id}
                    checked={answers[question.id] === option.key}
                    onChange={() => choose(question.id, option.key)}
                  />
                  <span>{option.key}</span>
                  {option.text}
                </label>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function StudentDashboard({ user }) {
  const [studentExams, setStudentExams] = useState([]);
  const [tokenByExam, setTokenByExam] = useState({});
  const [session, setSession] = useState(null);
  const [notice, setNotice] = useState("");

  async function load() {
    const data = await api(`/student/${user.id}/exams`);
    setStudentExams(data);
  }

  useEffect(() => {
    load();
  }, [user.id]);

  async function start(examId) {
    setNotice("");
    try {
      const result = await api("/attempts/start", {
        method: "POST",
        body: JSON.stringify({ studentId: user.id, examId, token: tokenByExam[examId] || "" })
      });
      setSession(result);
    } catch (err) {
      setNotice(err.message);
    }
  }

  if (session) {
    return <ExamTaking session={session} onFinished={() => { setSession(null); load(); }} />;
  }

  return (
    <div className="student-layout">
      <section className="panel exam-entry">
        <PanelTitle icon={ShieldCheck} title="Portal Peserta" />
        <h2>{user.name}</h2>
        <p>{user.className || "Siswa"}</p>
        {notice ? <div className="error-box">{notice}</div> : null}
        {studentExams.length ? studentExams.map(({ exam, status, score, questionCount }) => (
          <div className="exam-ticket" key={exam.id}>
            <strong>{exam.subject}</strong>
            <span>{exam.date} | {exam.startTime} | {exam.durationMinutes} menit | {questionCount} soal</span>
            <span>Status: {status}</span>
            {score ? <code>Nilai: {score.percent}</code> : null}
            {status === "submitted" ? null : (
              <div className="token-row">
                <input
                  placeholder="Token ujian"
                  value={tokenByExam[exam.id] || ""}
                  onChange={(event) => setTokenByExam({ ...tokenByExam, [exam.id]: event.target.value })}
                />
                <button type="button" onClick={() => start(exam.id)}><PlayCircle size={18} /> Mulai</button>
              </div>
            )}
          </div>
        )) : <p>Belum ada jadwal ujian untuk akun ini.</p>}
      </section>
      <section className="panel">
        <PanelTitle icon={MonitorSmartphone} title="Aturan Exam Client" />
        <ul className="rule-list">
          <li>Jangan keluar dari aplikasi selama ujian.</li>
          <li>Setiap keluar aplikasi akan tercatat di dashboard pengawas.</li>
          <li>Login hanya berlaku untuk satu perangkat.</li>
          <li>Jawaban tersimpan otomatis selama koneksi tersedia.</li>
        </ul>
      </section>
    </div>
  );
}

function PanelTitle({ icon: Icon, title }) {
  return <h2 className="panel-title"><Icon size={18} /> {title}</h2>;
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
  const [exams, setExams] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [violations, setViolations] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [results, setResults] = useState([]);

  const roleLabel = useMemo(() => {
    if (!user) return "";
    return { admin: "Admin", guru: "Guru", pengawas: "Pengawas", siswa: "Peserta" }[user.role] || user.role;
  }, [user]);

  const navItems = useMemo(() => {
    if (!user) return [];
    if (user.role === "admin") {
      return [
        { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
        { view: "students", label: "Data Siswa", icon: Users },
        { view: "cards", label: "Kartu Peserta", icon: CreditCard },
        { view: "exams", label: "Ujian", icon: ClipboardList },
        { view: "examParticipants", label: "Peserta Ujian", icon: Users },
        { view: "results", label: "Hasil", icon: CheckCircle2 },
        { view: "monitoring", label: "Monitoring", icon: MonitorSmartphone }
      ];
    }
    if (user.role === "guru") {
      return [
        { view: "questions", label: "Bank Soal", icon: BookOpen },
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

  async function refresh() {
    if (!user || user.role === "siswa") return;
    const [summaryData, studentsData, examsData, questionsData, violationsData, attemptsData, resultsData] = await Promise.all([
      api("/summary"),
      api("/students"),
      api("/exams"),
      api("/questions"),
      api("/violations"),
      api("/attempts"),
      api("/results")
    ]);
    setSummary(summaryData);
    setStudents(studentsData);
    setExams(examsData);
    setQuestions(questionsData);
    setViolations(violationsData);
    setAttempts(attemptsData);
    setResults(resultsData);
  }

  useEffect(() => {
    if (user) refresh();
  }, [user]);

  if (!user) return <Login onLogin={setUser} />;

  function logout() {
    clearSession();
    setUser(null);
    setView("dashboard");
  }

  function renderContent() {
    if (user.role === "guru") {
      if (view === "results") return <ResultsDashboard results={results} />;
      return <TeacherDashboard exams={exams} questions={questions} onQuestionCreated={refresh} />;
    }
    if (user.role === "siswa") {
      return <StudentDashboard user={user} exams={exams} />;
    }
    if (view === "students") {
      return <StudentManager students={students} onChanged={refresh} onExit={() => setView("dashboard")} />;
    }
    if (view === "cards") {
      return <ParticipantCards students={students} />;
    }
    if (view === "exams") {
      return <ExamManager exams={exams} onChanged={refresh} onExit={() => setView("dashboard")} />;
    }
    if (view === "examParticipants") {
      return <ExamParticipants exams={exams} students={students} attempts={attempts} onChanged={refresh} />;
    }
    if (view === "results") {
      return <ResultsDashboard results={results} />;
    }
    return <AdminDashboard summary={summary} students={students} exams={exams} violations={violations} />;
  }

  return (
    <main className="app-shell">
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
      </aside>
      <section className="main-section">
        <header className="topbar">
          <div>
            <span className="eyebrow">{roleLabel}</span>
            <h1>Dashboard Aplikasi Ujian</h1>
          </div>
          <button className="ghost-button" type="button" onClick={logout}>
            <LogOut size={18} /> Keluar
          </button>
        </header>
        {renderContent()}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
