# Panduan Deploy Server CBT SMAN 94

Dokumen ini dipakai untuk memasang aplikasi CBT di komputer server sekolah. Fokusnya adalah server produksi web dan API. Android APK, Windows EXE, benchmark, dan file development tidak wajib ikut ke server utama.

## 1. Ringkasan Arsitektur

Mode produksi yang disarankan:

- Frontend React dibuild menjadi folder `dist`.
- Backend API Node.js berjalan di port `4100` memakai PM2.
- Database memakai PostgreSQL.
- HP/Android Exam Browser membuka URL frontend.
- Frontend mengirim request ke API `http://IP-SERVER:4100/api` atau `/api` jika nanti memakai reverse proxy.

Untuk tahap awal tanpa reverse proxy:

```text
Frontend: http://IP-SERVER:5173
API     : http://IP-SERVER:4100/api
DB      : PostgreSQL lokal di server
```

Untuk produksi yang lebih rapi dengan reverse proxy:

```text
Frontend + API: http://IP-SERVER/ atau https://domain-sekolah/
API diproxy dari /api ke http://127.0.0.1:4100/api
```

## 2. Paket Deploy Yang Harus Dicopy

Paket server bersih sudah dibuat dari komputer development ke folder:

```text
artifacts\deploy-server-cbt-sman94-YYYYMMDD-HHMMSS
```

Isi yang wajib ada di paket deploy:

- `server`
- `src`
- `db`
- `docs`
- `scripts`
- `index.html`
- `package.json`
- `package-lock.json`
- `vite.config.js`
- `.env.example`
- `README.md`

Folder/file yang sengaja tidak ikut:

- `.env`, karena berisi rahasia server.
- `node_modules`, karena harus install ulang dengan `npm ci`.
- `dist`, karena dibuat ulang dengan `npm run build`.
- `.git`, karena server tidak wajib menyimpan riwayat Git jika deploy manual.
- `data`, karena produksi memakai PostgreSQL. Jika data lama ingin dimigrasikan dari JSON, copy manual `data\cbt-store.json`.
- `benchmark`, karena hanya alat test. Simpan terpisah.
- `android-exam-browser`, karena hanya untuk build APK.
- `electron-exam-browser`, karena EXE belum dipakai untuk produksi.
- `artifacts`, karena berisi hasil build/paket lain.
- file log seperti `api-server*.log`, `dev-server*.log`, `vite-server*.log`.

## 3. Software Yang Perlu Diinstall Di Server

Install ini di komputer server:

- Node.js LTS.
- PostgreSQL.
- Git, opsional jika nanti update via Git.
- PM2 untuk menjalankan backend.
- Reverse proxy, opsional: Caddy, Nginx, atau IIS.
- k6, opsional untuk benchmark.

Cek dari PowerShell:

```powershell
node -v
npm -v
psql --version
```

Jika `psql` belum dikenali, tambahkan folder PostgreSQL `bin` ke PATH, contoh:

```powershell
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Program Files\PostgreSQL\18\bin", "Machine")
```

Tutup PowerShell lalu buka lagi.

## 4. Copy Project Ke Server

Buat folder aplikasi:

```powershell
New-Item -ItemType Directory -Force C:\Apps | Out-Null
```

Copy isi paket deploy ke:

```text
C:\Apps\aplikasi-ujian
```

Masuk ke folder aplikasi:

```powershell
cd C:\Apps\aplikasi-ujian
```

Pastikan isi folder tidak membawa `node_modules`, `dist`, `benchmark`, `android-exam-browser`, atau `electron-exam-browser`.

## 5. Setup File `.env`

Salin file contoh:

```powershell
Copy-Item .env.example .env
notepad .env
```

Contoh isi produksi lokal:

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

Catatan penting:

- `AUTH_SECRET` jangan diganti setelah ujian berjalan, kecuali semua user siap login ulang.
- `EXAM_CLIENT_KEY` harus sama dengan key di Android Exam Browser.
- `.env` jangan dibagikan dan jangan diupload ke GitHub.

## 6. Setup PostgreSQL

Pastikan service PostgreSQL berjalan dari `services.msc`.

Install dependency aplikasi:

```powershell
npm ci
```

Jalankan setup database:

```powershell
npm run db:setup
```

Perilaku setup:

- Membuat database sesuai `DATABASE_URL` jika belum ada.
- Membuat tabel dan index.
- Jika ada `data\cbt-store.json`, data akan dimigrasikan.
- Jika tidak ada `data\cbt-store.json`, database dibuat kosong dengan akun awal:

```text
username: admin
password: admin123
```

Setelah berhasil login pertama kali, segera buka `Pengaturan > Akun Admin`, buat admin baru atau ubah password admin.

## 7. Test API Manual

Jalankan API sementara:

```powershell
node server/server.js
```

Buka PowerShell lain:

```powershell
curl http://127.0.0.1:4100/api/health
```

Hasil yang benar memuat:

```json
{
  "ok": true,
  "storage": "postgresql"
}
```

Hentikan API sementara dengan `Ctrl + C`.

## 8. Build Frontend

Jalankan:

```powershell
npm run build
```

Hasilnya folder:

```text
dist
```

Jika nanti ada update kode frontend, jalankan ulang `npm run build`.

## 9. Jalankan Backend Dengan PM2

Install PM2:

```powershell
npm install -g pm2
```

Jalankan API:

```powershell
$env:NODE_OPTIONS="--max-old-space-size=4096"
pm2 start server/server.js --name cbt-sman94-api --update-env
pm2 save
```

Cek:

```powershell
pm2 status
pm2 logs cbt-sman94-api --lines 50
```

Restart setelah update:

```powershell
pm2 restart cbt-sman94-api --update-env
```

Mode yang dipakai saat ini: `fork`. Untuk aplikasi ini, `fork` lebih aman dulu karena state ujian, cache, dan sesi lebih mudah dikontrol. Cluster boleh diuji nanti setelah sistem stabil di server produksi.

## 9A. Auto Start Saat Komputer Server Menyala

Folder `scripts` berisi file `.bat` untuk menyalakan server otomatis:

```text
scripts\start-cbt-server.bat
scripts\stop-cbt-server.bat
scripts\install-startup-shortcut.bat
```

Fungsi:

- `start-cbt-server.bat`: menyalakan API port `4100` lewat PM2 dan web port `5173`.
- `stop-cbt-server.bat`: menghentikan API dan web preview.
- `install-startup-shortcut.bat`: membuat shortcut di Startup Windows.

Cara pasang auto-start:

```powershell
cd C:\Apps\aplikasi-ujian
scripts\install-startup-shortcut.bat
```

Setelah itu restart komputer server atau logout-login Windows. Server akan otomatis menjalankan:

```text
API : http://127.0.0.1:4100/api/health
Web : http://127.0.0.1:5173
```

Catatan:

- Jangan copy langsung `start-cbt-server.bat` ke Startup. Gunakan `install-startup-shortcut.bat` agar path project tetap benar.
- Auto-start lewat Startup berjalan setelah user Windows login.
- Jika ingin server tetap nyala sebelum user login, gunakan Task Scheduler atau Windows Service. Itu bisa dibuat nanti setelah server produksi sudah stabil.
- File log web preview ada di `logs\frontend-preview.log`.

## 10. Menjalankan Frontend

### Opsi cepat untuk LAN sekolah

Jalankan preview:

```powershell
npm run preview -- --host 0.0.0.0 --port 5173
```

Buka dari HP:

```text
http://IP-SERVER:5173
```

### Opsi produksi lebih rapi

Gunakan Caddy/Nginx/IIS:

- Static frontend diarahkan ke folder `dist`.
- Request `/api/*` diproxy ke `http://127.0.0.1:4100/api/*`.

Jika memakai domain dan HTTPS, APK Android harus dibuild ulang memakai URL tersebut.

## 11. Firewall Windows

Buka port API dan frontend:

```powershell
New-NetFirewallRule -DisplayName "CBT API 4100" -Direction Inbound -Protocol TCP -LocalPort 4100 -Action Allow
New-NetFirewallRule -DisplayName "CBT Web 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
```

Jika pakai reverse proxy:

```powershell
New-NetFirewallRule -DisplayName "CBT HTTP 80" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "CBT HTTPS 443" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

Cek IP server:

```powershell
ipconfig
```

## 12. Tuning PostgreSQL Awal

Untuk RAM 16 GB, konfigurasi awal konservatif:

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

File biasanya ada di:

```text
C:\Program Files\PostgreSQL\<versi>\data\postgresql.conf
```

Setelah ubah konfigurasi, restart PostgreSQL dari `services.msc`.

## 13. Checklist Sebelum Ujian

Satu hari sebelum ujian:

- Login admin berhasil.
- Password admin default sudah diganti.
- Data siswa dan guru sudah benar.
- Peserta ujian sudah dipilih.
- Soal sudah masuk.
- Total bobot soal mendekati atau tepat 100.
- Jadwal dan status publish sudah benar.
- Pengaturan token sudah benar.
- APK Android sudah mengarah ke URL server produksi.
- Test 5-10 perangkat nyata.
- Backup database.

Pagi hari ujian:

```powershell
pm2 status
pm2 logs cbt-sman94-api --lines 50
curl http://127.0.0.1:4100/api/health
```

Cek juga:

- IP server tidak berubah.
- Wi-Fi stabil.
- Storage cukup.
- RAM server lega.
- PostgreSQL running.
- Firewall terbuka.

## 14. Backup Database

Buat folder backup:

```powershell
New-Item -ItemType Directory -Force C:\Backup\CBT | Out-Null
```

Backup manual:

```powershell
pg_dump -U postgres -d cbt_sman94 -F c -f C:\Backup\CBT\cbt_sman94.backup
```

Restore:

```powershell
pg_restore -U postgres -d cbt_sman94 --clean --if-exists C:\Backup\CBT\cbt_sman94.backup
```

Saran waktu backup:

- Sebelum import siswa/guru besar.
- Sebelum ujian resmi.
- Setelah ujian selesai.
- Sebelum update aplikasi.

## 15. Update Aplikasi Di Server

Jika deploy manual:

1. Stop frontend preview jika sedang jalan.
2. Backup database.
3. Copy paket deploy baru ke folder sementara.
4. Copy file kode baru ke `C:\Apps\aplikasi-ujian`.
5. Jangan overwrite `.env`.

Lalu:

```powershell
cd C:\Apps\aplikasi-ujian
npm ci
npm run db:setup
npm run build
pm2 restart cbt-sman94-api --update-env
curl http://127.0.0.1:4100/api/health
```

Jika memakai Git:

```powershell
cd C:\Apps\aplikasi-ujian
git pull
npm ci
npm run db:setup
npm run build
pm2 restart cbt-sman94-api --update-env
```

## 16. Jika Server Pindah IP atau Domain

Yang perlu diubah:

- URL akses frontend di perangkat siswa.
- Build APK Android, karena URL server ditanam di APK.
- Firewall jika port berubah.
- Reverse proxy jika memakai domain.

Lokasi konfigurasi build APK ada di:

```text
android-exam-browser\README.md
android-exam-browser\app\build.gradle.kts
```

Contoh build ulang APK dari komputer development:

```powershell
cd C:\Users\nurfa\Desktop\Aplikasi Ujian\android-exam-browser
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$env:Path="$env:JAVA_HOME\bin;$env:Path"
.\gradlew.bat assembleOverlayDebug `
  -PCBT_BASE_URL="http://IP-SERVER:5173/" `
  -PCBT_API_BASE_URL="http://IP-SERVER:4100/api" `
  -PEXAM_CLIENT_KEY="isi-sama-dengan-EXAM_CLIENT_KEY-di-env-server"
```

## 17. Benchmark Opsional

Folder benchmark tidak masuk paket server utama. Jika ingin benchmark di server, copy folder `benchmark` secara terpisah.

Contoh test realistis:

```powershell
cd C:\Apps\aplikasi-ujian\benchmark
$env:BASE_URL="http://127.0.0.1:4100"
$env:TARGET_VUS="648"
$env:MODE="real"
k6 run real-submit-flow.js
```

Target sebelum ujian besar:

- `http_req_failed` rendah.
- Tidak ada timeout besar.
- Memory Node tidak naik tanpa turun terus-menerus.
- Login dan submit berhasil.
- Saat test perangkat nyata, jawaban tetap masuk.

## 18. Troubleshooting Cepat

API tidak hidup:

```powershell
pm2 status
pm2 logs cbt-sman94-api --lines 100
pm2 restart cbt-sman94-api --update-env
```

Database tidak konek:

```powershell
Get-Service *postgres*
psql -U postgres -d cbt_sman94
```

Frontend tidak bisa dibuka dari HP:

- Cek IP server.
- Cek firewall port 5173 atau 80/443.
- Pastikan `npm run preview -- --host 0.0.0.0 --port 5173` berjalan jika belum pakai reverse proxy.

APK tidak bisa login:

- Cek `CBT_BASE_URL` dan `CBT_API_BASE_URL` saat build APK.
- Cek `EXAM_CLIENT_KEY` sama dengan `.env` server.
- Cek HP dan server berada di jaringan yang sama.

Admin tidak bisa login:

- Jika database baru, gunakan `admin/admin123`.
- Jika sudah diganti, gunakan admin baru.
- Jika lupa semua password admin, jangan reset database. Backup dulu, lalu lakukan perbaikan akun via PostgreSQL.

## 19. Urutan Deploy Singkat

```powershell
cd C:\Apps\aplikasi-ujian
Copy-Item .env.example .env
notepad .env
npm ci
npm run db:setup
npm run build
npm install -g pm2
$env:NODE_OPTIONS="--max-old-space-size=4096"
pm2 start server/server.js --name cbt-sman94-api --update-env
pm2 save
curl http://127.0.0.1:4100/api/health
npm run preview -- --host 0.0.0.0 --port 5173
```

Setelah berhasil:

- Login admin.
- Ubah password admin default.
- Import siswa/guru.
- Buat ujian.
- Test dari Android.
- Backup database.
