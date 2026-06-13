# Benchmark CBT SMAN 94

Folder ini berisi benchmark untuk mengukur performa API web ujian.

## Tool yang dipakai

Gunakan **k6**.

Install di Windows:

1. Buka PowerShell.
2. Jalankan salah satu:

```powershell
winget install k6
```

atau jika memakai Chocolatey:

```powershell
choco install k6
```

Cek instalasi:

```powershell
k6 version
```

## Pastikan aplikasi berjalan

Jalankan server aplikasi:

```powershell
npm run dev
```

Untuk benchmark login massal, lebih baik jalankan server dengan threadpool Node lebih besar:

```powershell
$env:UV_THREADPOOL_SIZE="16"
npm run dev
```

Ini membantu proses verifikasi password banyak peserta berjalan paralel dan tidak mengunci event loop Node.js.

Cek API:

```powershell
Invoke-RestMethod http://localhost:4100/api/health
```

## Benchmark 1: Smoke Test Admin

Tes ini aman karena hanya membaca endpoint dashboard/admin.

```powershell
k6 run benchmark/smoke.js
```

Dengan beban lebih besar:

```powershell
$env:VUS="20"
$env:DURATION="1m"
k6 run benchmark/smoke.js
```

## Siapkan akun peserta untuk simulasi ujian

Script simulasi peserta membutuhkan file `benchmark/students.csv` berisi:

```csv
username,password
10684,abc123
10693,def456
```

Bisa dibuat otomatis dari data siswa aplikasi:

```powershell
$env:LIMIT="100"
node benchmark/export-students.mjs
```

Untuk 648 siswa:

```powershell
$env:LIMIT="648"
node benchmark/export-students.mjs
```

> Penting: `benchmark/students.csv` berisi password peserta. Jangan dibagikan.

## Benchmark 2: Simulasi Peserta Ujian

Tes ini meniru alur:

1. peserta login
2. membuka portal peserta
3. memilih ujian yang bisa dikerjakan
4. mulai ujian
5. autosave beberapa jawaban
6. heartbeat exam browser

Default `exam-flow.js` memakai mode `once`, artinya setiap virtual user menjalankan alur ujian satu kali. Ini lebih mirip kondisi nyata saat peserta mulai ujian bersama-sama dan tidak membuat login berulang-ulang tanpa henti.

Jalankan 50 siswa virtual:

```powershell
$env:TARGET_VUS="50"
k6 run benchmark/exam-flow.js
```

Jalankan 100 siswa virtual:

```powershell
$env:TARGET_VUS="100"
k6 run benchmark/exam-flow.js
```

Jika posisi terminal sedang berada di folder `benchmark`, gunakan:

```powershell
$env:TARGET_VUS="100"
k6 run exam-flow.js
```

Jika ujian masih membutuhkan token:

```powershell
$env:EXAM_TOKEN="AB12"
k6 run benchmark/exam-flow.js
```

Jika ingin submit otomatis di akhir simulasi:

```powershell
$env:SUBMIT="true"
k6 run benchmark/exam-flow.js
```

> Saran: untuk benchmark serius, gunakan database testing atau backup database dulu. Simulasi peserta akan mengubah status attempt dan jawaban.
> Jika benchmark dijalankan ulang dengan akun dan ujian yang sama, sebagian peserta bisa masuk kategori `no_ready_exam` karena attempt mereka sudah selesai. Reset attempt ujian percobaan atau gunakan ujian testing baru sebelum mengukur ulang.

## Mode Soak / Stress

Jika ingin test server dalam durasi tertentu dengan login/alur berulang, pakai mode `soak`.

```powershell
$env:MODE="soak"
$env:TARGET_VUS="100"
$env:RAMP_UP="2m"
$env:HOLD="5m"
$env:RAMP_DOWN="1m"
k6 run benchmark/exam-flow.js
```

Mode ini lebih berat karena peserta virtual akan mengulang alur selama durasi test. Gunakan setelah mode `once` sudah stabil.

## Benchmark 3: Simulasi Ujian Nyata

Gunakan `real-exam-flow.js` untuk simulasi yang lebih mirip kondisi ujian sebenarnya:

1. peserta login 1 kali
2. membuka portal 1 kali
3. mulai ujian 1 kali
4. selama durasi ujian hanya mengirim autosave, heartbeat, dan fetch soal bertahap
5. sebagian kecil peserta bisa disimulasikan login ulang karena koneksi/app tertutup

Tes 217 peserta selama 30 menit:

```powershell
$env:TARGET_VUS="217"
$env:EXAM_DURATION="30m"
$env:HEARTBEAT_INTERVAL_SECONDS="20"
$env:ANSWER_INTERVAL_SECONDS="15"
$env:RELOGIN_PERCENT="5"
$env:SUBMIT="false"
k6 run benchmark/real-exam-flow.js
```

Jika terminal sedang berada di folder `benchmark`:

```powershell
$env:TARGET_VUS="217"
$env:EXAM_DURATION="30m"
k6 run real-exam-flow.js
```

Tes 217 peserta selama 90 menit:

```powershell
$env:TARGET_VUS="217"
$env:EXAM_DURATION="90m"
$env:HEARTBEAT_INTERVAL_SECONDS="20"
$env:ANSWER_INTERVAL_SECONDS="20"
$env:RELOGIN_PERCENT="5"
k6 run benchmark/real-exam-flow.js
```

Jika ujian membutuhkan token:

```powershell
$env:EXAM_TOKEN="AB12"
k6 run benchmark/real-exam-flow.js
```

Variabel penting:

- `TARGET_VUS`: jumlah peserta virtual.
- `EXAM_DURATION`: lama simulasi ujian, contoh `30m` atau `90m`.
- `HEARTBEAT_INTERVAL_SECONDS`: jarak heartbeat peserta.
- `ANSWER_INTERVAL_SECONDS`: jarak peserta menjawab soal.
- `QUESTION_PREFETCH`: jumlah soal berikutnya yang ikut diambil saat progressive loading.
- `RELOGIN_PERCENT`: persentase peserta yang login ulang sekali di tengah ujian.
- `SUBMIT`: isi `true` kalau ingin peserta submit di akhir simulasi.

Untuk uji realistis, `students.csv` sebaiknya berisi jumlah akun yang sama dengan `TARGET_VUS`:

```powershell
$env:LIMIT="217"
node benchmark/export-students.mjs
```

## Benchmark 4: Simulasi Ujian Nyata Sampai Submit

Gunakan `real-submit-flow.js` kalau ingin simulasi yang lebih dekat dengan ujian sekolah:

1. siswa login bertahap, bukan semua di detik yang sama
2. siswa membuka portal
3. siswa menekan mulai ujian bertahap
4. siswa menjawab soal dengan jeda acak
5. autosave dikirim per jawaban
6. heartbeat dikirim berkala
7. sebagian kecil siswa login ulang sekali
8. siswa submit di akhir simulasi

Sebelum menjalankan, pastikan akun di `benchmark/students.csv` memang peserta dari ujian yang sedang aktif dan belum selesai mengerjakan. Kalau tidak, metrik `no_ready_exam` akan naik.

Tes 217 peserta:

```powershell
$env:LIMIT="217"
node benchmark/export-students.mjs

$env:TARGET_VUS="217"
$env:EXAM_DURATION="30m"
$env:LOGIN_SPREAD_SECONDS="120"
$env:START_BUTTON_SPREAD_SECONDS="60"
$env:HEARTBEAT_INTERVAL_SECONDS="60"
$env:ANSWER_INTERVAL_SECONDS="0"
$env:QUESTION_PREFETCH="1"
$env:RELOGIN_PERCENT="3"
$env:WRITE_RETRIES="1"
$env:HTTP_TIMEOUT="60s"
k6 run benchmark/real-submit-flow.js *> "$env:USERPROFILE\Desktop\benchmark-217-real-submit.txt"
```

Tes 648 peserta:

```powershell
$env:LIMIT="648"
node benchmark/export-students.mjs

$env:TARGET_VUS="648"
$env:EXAM_DURATION="30m"
$env:LOGIN_SPREAD_SECONDS="300"
$env:START_BUTTON_SPREAD_SECONDS="120"
$env:HEARTBEAT_INTERVAL_SECONDS="60"
$env:ANSWER_INTERVAL_SECONDS="0"
$env:QUESTION_PREFETCH="1"
$env:RELOGIN_PERCENT="3"
$env:WRITE_RETRIES="1"
$env:HTTP_TIMEOUT="60s"
k6 run benchmark/real-submit-flow.js *> "$env:USERPROFILE\Desktop\benchmark-648-real-submit.txt"
```

Jika ingin semua peserta dibuat lebih serentak, kecilkan `LOGIN_SPREAD_SECONDS` dan `START_BUTTON_SPREAD_SECONDS`. Untuk simulasi paling realistis di sekolah, biarkan login menyebar 3-5 menit.

Variabel tambahan:

- `LOGIN_SPREAD_SECONDS`: rentang waktu login peserta disebar.
- `START_BUTTON_SPREAD_SECONDS`: rentang waktu klik mulai ujian setelah login.
- `ANSWER_INTERVAL_SECONDS`: isi `0` agar script menghitung jeda otomatis supaya soal selesai sebelum durasi ujian habis.
- `ANSWER_JITTER_SECONDS`: variasi jeda jawab agar tidak semua peserta autosave bersamaan.
- `EXAM_CLIENT`: default `true`, request akan memakai header seperti Exam Browser.
- `EXAM_CLIENT_KEY`: key Exam Browser jika nanti diubah di pengaturan server.
- `DEBUG_LOGIN`: isi `true` untuk melihat username dan status ketika login gagal.
- `WRITE_RETRIES`: jumlah retry untuk autosave, heartbeat, final sync, dan submit jika koneksi sempat putus. Default `1`.

Jika ingin tes seperti browser biasa, bukan Exam Browser:

```powershell
$env:EXAM_CLIENT="false"
k6 run benchmark/real-submit-flow.js
```

## Simulasi Bertahap

Mulai dari kecil:

```powershell
$env:TARGET_VUS="25"; k6 run benchmark/exam-flow.js
$env:TARGET_VUS="100"; k6 run benchmark/exam-flow.js
$env:TARGET_VUS="300"; k6 run benchmark/exam-flow.js
$env:TARGET_VUS="648"; $env:MAX_DURATION="30m"; k6 run benchmark/exam-flow.js
```

## Angka yang perlu diperhatikan

Di hasil k6, perhatikan:

- `http_req_failed`: sebaiknya di bawah 1-3%.
- `http_req_duration p(95)`: sebaiknya di bawah 1-2 detik.
- `student_login_failed`: harus mendekati 0.
- `exam_start_failed`: tinggi jika token salah, jadwal belum aktif, atau peserta tidak punya ujian aktif.
- `autosave_failed`: harus mendekati 0.
- `heartbeat_failed`: harus mendekati 0.

Pantau juga di Windows:

- CPU
- RAM
- Disk aktif
- koneksi PostgreSQL

## Contoh target awal untuk server sekolah

Untuk server CPU Xeon E-2324G, RAM 16 GB:

- 100 siswa: harus ringan.
- 300 siswa: harus tetap stabil.
- 648 siswa: target realistis jika autosave/heartbeat tidak terlalu sering dan PostgreSQL stabil.

Jika `p95` mulai naik di atas 2 detik atau error meningkat, biasanya titik yang perlu dicek:

- endpoint `/api/attempts/:id/answers`
- endpoint `/api/attempts/:id/heartbeat`
- query monitoring admin
- write ke PostgreSQL
