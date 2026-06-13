# Panduan Deploy Server CBT SMAN 94

Dokumen ini dipakai saat aplikasi ujian akan dipasang di server sekolah. Fokusnya adalah mode produksi yang stabil, bukan mode development.

## 1. Rekomendasi Server

Spesifikasi server yang ada:

- CPU: Intel Xeon E-2324G
- RAM: 16 GB DDR4
- Storage: 1 TB
- Database: PostgreSQL

Rekomendasi penggunaan awal:

- 100-250 peserta per sesi: aman untuk tahap awal setelah benchmark stabil.
- 300-400 peserta per sesi: boleh dicoba setelah benchmark 217 peserta stabil.
- 648 peserta serentak: jangan dipakai dulu sebelum soak test 60-90 menit stabil.

Upgrade paling disarankan:

- Gunakan SSD/NVMe untuk PostgreSQL.
- RAM 32 GB jika ingin mendekati 648 peserta serentak.
- Hindari HDD biasa untuk beban ujian besar karena query dan write autosave bisa lambat.

## 2. Software Yang Dibutuhkan

Install di server:

- Node.js LTS 22 atau terbaru yang stabil.
- PostgreSQL 16/17/18.
- Git.
- PM2 untuk menjalankan backend.
- k6 untuk benchmark.
- Opsional: Nginx/Caddy/IIS sebagai reverse proxy.

Cek instalasi:

```powershell
node -v
npm -v
psql --version
git --version
k6 version
```

## 3. Ambil Project Ke Server

Masuk ke folder tempat aplikasi akan disimpan, misalnya:

```powershell
cd C:\Apps
git clone <URL_REPOSITORY_ANDA> aplikasi-ujian
cd C:\Apps\aplikasi-ujian
```

Kalau project dipindah manual dari komputer pengembangan, pastikan folder berikut ikut:

- `server`
- `src`
- `benchmark`
- `android-exam-browser`
- `package.json`
- `package-lock.json`
- `.env.example`

Jangan wajib ikut:

- `node_modules`
- `dist`
- file log lama

Install dependency:

```powershell
npm ci
```

Jika `npm ci` gagal karena `package-lock.json` tidak cocok, gunakan:

```powershell
npm install
```

## 4. Setup PostgreSQL

Buat database:

```powershell
psql -U postgres
```

Di dalam `psql`:

```sql
CREATE DATABASE cbt_sman94;
\q
```

Jika ingin user khusus aplikasi:

```sql
CREATE USER cbt_user WITH PASSWORD 'password-kuat-di-sini';
GRANT ALL PRIVILEGES ON DATABASE cbt_sman94 TO cbt_user;
```

Untuk tahap awal boleh memakai user `postgres`, tapi untuk produksi lebih rapi memakai user khusus.

## 5. Buat File `.env`

Salin contoh:

```powershell
Copy-Item .env.example .env
notepad .env
```

Contoh isi `.env`:

```env
PORT=4100
DATABASE_URL=postgres://postgres:password_postgres@localhost:5432/cbt_sman94
AUTH_SECRET=ganti-dengan-random-secret-panjang-minimal-32-karakter
TOKEN_TTL_HOURS=8
EXAM_CLIENT_KEY=ganti-dengan-key-rahasia-exam-browser
POSTGRES_STORE_CACHE_MS=2000
EXAM_CLIENT_HEARTBEAT_TIMEOUT_SECONDS=25
EXAM_CLIENT_HEARTBEAT_REPEAT_SECONDS=120
EXAM_PAYLOAD_SOFT_LIMIT_BYTES=512000
EXAM_PAYLOAD_HARD_LIMIT_BYTES=2097152
EXAM_PROGRESSIVE_PARTICIPANT_LIMIT=100
EXAM_MASS_PARTICIPANT_LIMIT=300
```

Catatan:

- `AUTH_SECRET` jangan diganti setelah aplikasi dipakai, karena token login lama akan invalid.
- `EXAM_CLIENT_KEY` harus sama dengan yang dipakai aplikasi Android Exam Browser.
- Jangan upload `.env` ke GitHub.

## 6. Inisialisasi Database

Jalankan:

```powershell
npm run db:setup
```

Lalu tes API:

```powershell
$env:PORT="4100"
node server/server.js
```

Buka terminal lain:

```powershell
curl http://127.0.0.1:4100/api/health
```

Harus muncul kira-kira:

```json
{"ok":true,"service":"CBT SMAN 94 API","storage":"postgresql"}
```

Jika sudah berhasil, hentikan server manual dengan `Ctrl + C`.

## 7. Build Frontend

Jalankan:

```powershell
npm run build
```

Hasil build ada di folder:

```text
dist
```

Folder `dist` inilah yang dipakai untuk frontend produksi.

## 8. Jalankan Backend Dengan PM2

Install PM2:

```powershell
npm install -g pm2
```

Jalankan API:

```powershell
$env:NODE_OPTIONS="--max-old-space-size=4096"
pm2 start server/server.js --name cbt-sman94-api
pm2 save
```

Cek status:

```powershell
pm2 status
pm2 logs cbt-sman94-api
```

Restart setelah update kode:

```powershell
pm2 restart cbt-sman94-api --update-env
```

Stop:

```powershell
pm2 stop cbt-sman94-api
```

Catatan penting:

- Jangan jalankan produksi dengan `npm run dev`.
- `npm run dev` hanya untuk pengembangan karena menjalankan Vite dan API bersamaan.
- Saat ujian, jalankan API saja dengan PM2.

## 9. Menyajikan Frontend

### Opsi A: sementara dengan Vite preview

Untuk uji coba internal:

```powershell
npm run preview -- --host 0.0.0.0 --port 5173
```

Ini boleh untuk tes, tetapi bukan pilihan terbaik untuk produksi jangka panjang.

### Opsi B: reverse proxy/static server

Untuk produksi, gunakan Nginx/Caddy/IIS:

- Frontend: arahkan ke folder `dist`.
- API: proxy request `/api` ke `http://127.0.0.1:4100`.

Contoh konsep routing:

```text
http://server-sekolah/
  -> dist/index.html dan asset frontend

http://server-sekolah/api/*
  -> http://127.0.0.1:4100/api/*
```

Jika belum memakai reverse proxy, Android/HP dapat mengakses sementara:

```text
http://IP-SERVER:5173
```

Pastikan API di frontend mengarah ke server yang benar. Jika frontend dan API beda port, pastikan konfigurasi API base URL sudah sesuai di kode/build.

## 10. Firewall Windows

Buka port yang dipakai:

```powershell
New-NetFirewallRule -DisplayName "CBT Web 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
New-NetFirewallRule -DisplayName "CBT API 4100" -Direction Inbound -Protocol TCP -LocalPort 4100 -Action Allow
```

Jika nanti pakai reverse proxy di port 80/443:

```powershell
New-NetFirewallRule -DisplayName "CBT HTTP 80" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "CBT HTTPS 443" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

Cek IP server:

```powershell
ipconfig
```

Dari HP siswa/guru, tes:

```text
http://IP-SERVER:5173
```

## 11. PostgreSQL Tuning Awal

Untuk RAM 16 GB, tuning awal yang konservatif:

```conf
shared_buffers = 4GB
effective_cache_size = 10GB
work_mem = 16MB
maintenance_work_mem = 512MB
max_connections = 100
checkpoint_timeout = 15min
wal_buffers = 16MB
random_page_cost = 1.1
```

Lokasi file biasanya:

```text
C:\Program Files\PostgreSQL\<versi>\data\postgresql.conf
```

Setelah ubah konfigurasi, restart service PostgreSQL dari `services.msc`.

Catatan:

- Jangan menaikkan `max_connections` terlalu tinggi jika RAM 16 GB.
- Lebih baik koneksi stabil dan query cepat daripada koneksi banyak tapi memory penuh.

## 12. Benchmark Sebelum Ujian

Masuk folder benchmark:

```powershell
cd C:\Apps\aplikasi-ujian\benchmark
```

Tes kecil:

```powershell
$env:BASE_URL="http://127.0.0.1:4100"
$env:TARGET_VUS="50"
$env:MODE="once"
k6 run exam-flow.js
```

Tes 100 peserta:

```powershell
$env:TARGET_VUS="100"
$env:MODE="once"
k6 run exam-flow.js
```

Tes soak:

```powershell
$env:TARGET_VUS="217"
$env:MODE="soak"
k6 run exam-flow.js
```

Target minimal sebelum ujian:

- API tidak crash.
- Memory Node tidak naik terus sampai habis.
- `http_req_failed` kurang dari 1-3%.
- `student_login_failed` mendekati 0.
- `autosave_failed` mendekati 0.
- `heartbeat_failed` rendah.
- p95 endpoint ringan ideal di bawah 2 detik.

Jika soak 217 masih crash:

- Jangan pakai 648 peserta serentak.
- Bagi ujian menjadi sesi 100-250 peserta.
- Jalankan benchmark ulang setelah optimasi backend.

## 13. SOP Sebelum Hari Ujian

Satu hari sebelum ujian:

- Import data siswa.
- Import data guru.
- Buat jadwal ujian.
- Assign peserta ujian.
- Pastikan total bobot soal 100.
- Guru test soal.
- Admin cek soal bila ujian resmi.
- Cek status publish.
- Jalankan benchmark kecil 50-100 VU.
- Backup database.

Pagi hari ujian:

```powershell
pm2 status
pm2 logs cbt-sman94-api --lines 50
curl http://127.0.0.1:4100/api/health
```

Cek juga:

- Storage kosong cukup.
- RAM tidak penuh.
- PostgreSQL running.
- IP server tidak berubah.
- Wi-Fi sekolah stabil.
- Android Exam Browser sudah diarahkan ke IP/domain server yang benar.

## 14. Backup Database

Backup manual:

```powershell
pg_dump -U postgres -d cbt_sman94 -F c -f C:\Backup\cbt_sman94_%DATE:~-4%%DATE:~3,2%%DATE:~0,2%.backup
```

Restore:

```powershell
pg_restore -U postgres -d cbt_sman94 --clean --if-exists C:\Backup\nama_file.backup
```

Saran:

- Backup sebelum import data besar.
- Backup sebelum ujian resmi.
- Backup setelah ujian selesai.
- Simpan backup ke disk lain atau komputer lain.

## 15. Update Aplikasi Di Server

Jika menggunakan Git:

```powershell
cd C:\Apps\aplikasi-ujian
git pull
npm ci
npm run build
pm2 restart cbt-sman94-api --update-env
```

Tes:

```powershell
curl http://127.0.0.1:4100/api/health
```

Jika ada error setelah update, cek:

```powershell
pm2 logs cbt-sman94-api
git status
git log --oneline -10
```

## 16. Jika Terjadi Masalah Saat Ujian

### API tidak bisa diakses

```powershell
pm2 status
pm2 restart cbt-sman94-api --update-env
curl http://127.0.0.1:4100/api/health
```

### PostgreSQL mati

```powershell
Get-Service *postgres*
```

Restart dari `services.msc`.

### Memory Node naik terus

Langkah darurat:

```powershell
pm2 restart cbt-sman94-api --update-env
```

Langkah operasional:

- Jangan langsung lanjut 648 peserta.
- Pecah sesi ujian.
- Cek log PM2.
- Jalankan benchmark ulang setelah ujian.

### Banyak siswa tidak bisa masuk

Cek:

- Jadwal ujian sudah masuk waktu.
- Status ujian `published`.
- Peserta sudah diassign.
- Token global aktif atau mode tanpa token benar.
- IP/domain di Android Exam Browser benar.
- Firewall tidak memblokir port.

## 17. Catatan Produksi Penting

Untuk produksi:

- Jangan gunakan `npm run dev`.
- Jangan menjalankan banyak server Node bersamaan di port berbeda tanpa alasan.
- Gunakan PM2 agar API otomatis restart jika crash.
- Gunakan domain lokal atau IP statis untuk server.
- Idealnya gunakan SSD/NVMe.
- Lakukan benchmark setelah perubahan besar.
- Commit Git sebelum deploy agar mudah rollback.

## 18. Urutan Deploy Singkat

Ringkasnya:

```powershell
cd C:\Apps\aplikasi-ujian
npm ci
Copy-Item .env.example .env
notepad .env
npm run db:setup
npm run build
npm install -g pm2
$env:NODE_OPTIONS="--max-old-space-size=4096"
pm2 start server/server.js --name cbt-sman94-api
pm2 save
curl http://127.0.0.1:4100/api/health
```

Setelah itu:

- Sajikan folder `dist` melalui reverse proxy/static server.
- Buka firewall.
- Tes dari HP Android.
- Jalankan benchmark.
- Baru gunakan untuk ujian sebenarnya.
