# Aplikasi Ujian SMAN 94

Fondasi aplikasi CBT tahap pertama berbasis Node.js, Express, dan React.

## Menjalankan aplikasi

```powershell
npm.cmd install
npm.cmd run dev
```

URL aplikasi:

```text
http://127.0.0.1:5173/
```

URL API:

```text
http://127.0.0.1:4100/api/health
```

## Database PostgreSQL

Aplikasi sudah disiapkan untuk memakai PostgreSQL. Jika file `.env` belum dibuat, server tetap memakai penyimpanan demo di `data/cbt-store.json` supaya pengembangan web bisa tetap berjalan.

Langkah aktivasi PostgreSQL:

```powershell
Copy-Item .env.example .env
```

Edit `.env`, lalu isi password PostgreSQL:

```text
PORT=4100
DATABASE_URL=postgres://postgres:PASSWORD_POSTGRES_ANDA@localhost:5432/cbt_sman94
AUTH_SECRET=ISI_DENGAN_RANDOM_SECRET_PANJANG
TOKEN_TTL_HOURS=8
EXAM_CLIENT_KEY=GANTI_DENGAN_KEY_RAHASIA_EXAM_BROWSER
```

Buat database `cbt_sman94` lewat pgAdmin atau PowerShell:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres cbt_sman94
```

Saat `npm.cmd run dev` dijalankan, backend otomatis membuat tabel dan mengisi data awal jika database masih kosong. Status storage bisa dicek di:

```text
http://127.0.0.1:4100/api/health
```

Jika aktif, respons API akan menampilkan `storage: "postgresql"`.

## Akses Exam Browser

Siswa dari browser biasa dapat diwajibkan memasukkan `Token Akses Browser` yang dibuat admin di Dashboard. Aplikasi Exam Browser resmi tidak perlu token browser, tetapi harus mengirim header berikut saat login:

```text
x-cbt-exam-client: sman94-exam-browser
x-cbt-exam-client-key: nilai_EXAM_CLIENT_KEY_di_env
```

Mode akses siswa di Dashboard admin:

```text
Wajib Exam Browser
Exam Browser / Token Browser
Terbuka Sementara
```

Untuk produksi, isi `EXAM_CLIENT_KEY` dengan nilai rahasia yang panjang dan berbeda dari contoh development.

Project Android awal tersedia di:

```text
android-exam-browser/
```

Buka folder tersebut dengan Android Studio untuk build APK. Konfigurasi alamat server ada di `android-exam-browser/app/build.gradle.kts`.

## Akun demo

```text
Admin  : admin / admin123
Guru   : guru_informatika / guru123
Siswa  : 10676 / 10676
```

## Fitur tahap 1

- Login role admin, guru, pengawas, dan siswa.
- Dashboard admin dengan ringkasan siswa, guru, ujian, dan log pelanggaran.
- Daftar jadwal ujian.
- Monitoring log pelanggaran.
- Dashboard guru untuk input soal pilihan ganda.
- Portal peserta sederhana.
- Backend API dengan penyimpanan data awal di `data/cbt-store.json`.

## Fitur tahap 2

- CRUD data siswa dari dashboard admin.
- Import siswa dari Excel/CSV.
- Sinkron otomatis data siswa dengan akun login siswa.
- Cetak kartu peserta dari browser.
- QR code pada kartu peserta.
- Filter daftar siswa dan kartu peserta.

## Fitur tahap 3

- CRUD ujian dari dashboard admin.
- Publish/tutup ujian.
- Atur peserta ujian per paket.
- Dashboard hasil nilai dan status peserta.
- Portal siswa menampilkan ujian sesuai peserta.
- Mulai ujian memakai token.
- Halaman pengerjaan ujian pilihan ganda.
- Autosave jawaban ke server.
- Submit final dan hitung nilai otomatis.
- Endpoint heartbeat/log event untuk dasar Android exam client.

## Fitur tahap 4

- Adapter PostgreSQL untuk data user, siswa, ujian, soal, attempt, nilai, dan pelanggaran.
- Fallback JSON lokal jika PostgreSQL belum dikonfigurasi.
- Schema SQL tersedia di `db/schema.sql`.
- Health check menampilkan storage aktif: `json` atau `postgresql`.
- Session token bertanda tangan untuk login admin, guru, pengawas, dan siswa.
- Pembatasan akses API berdasarkan role.
- Guru hanya melihat dan mengelola ujian/soal miliknya.
- Peserta hanya bisa membuka jadwal, attempt, jawaban, submit, dan heartbeat miliknya sendiri.

## Fitur tahap 5

- CRUD soal pilihan ganda dari dashboard guru.
- Edit dan hapus soal dengan pembatasan hak akses per guru.
- Import banyak soal dari file `.docx`, `.docm`, atau `.txt`.
- Bulk import soal dari API `/api/questions/bulk`.
- Nilai siswa tampil langsung setelah submit ujian.
- Nilai juga terlihat di menu `Hasil` untuk admin/guru/pengawas.

## Fitur tahap 6

- Data siswa mendukung `NISN`, `L/P`, `Mapel Pilihan 1`, sampai `Mapel Pilihan 5`.
- Import siswa dari Excel/CSV bisa membaca kolom mapel pilihan.
- Halaman Data Siswa menampilkan contoh format import yang benar.
- Tombol download contoh CSV tersedia di kotak import siswa.
- Tabel Data Siswa menampilkan kolom mapel pilihan di samping kelas.
- Pengaturan peserta ujian bisa difilter berdasarkan mapel pilihan, misalnya `Informatika 2` atau `Sejarah TL 2`.
- Tombol `Pilih Semua Filter` menambahkan semua siswa sesuai filter tanpa menghapus peserta yang sudah dipilih sebelumnya.
- Data testing kelas XII sudah diimpor dari `absen 2025-2026 (1).xls` dan `Mapel Pilihan XII.xlsx`.

Ringkasan data testing kelas XII:

```text
Total siswa: 218
XII.1: 36
XII.2: 36
XII.3: 37
XII.4: 36
XII.5: 37
XII.6: 36
Siswa dengan mapel pilihan: 216
```

## Fitur tahap 7

- Data Siswa tampil sebagai daftar utama tanpa form permanen di samping.
- Tambah siswa manual memakai modal `Tambah Siswa`.
- Upload massal siswa memakai modal `Upload Bulk`.
- Daftar siswa memakai pagination default 50 data per halaman.
- Kartu peserta memakai pagination saat dilihat di layar.
- Saat cetak kartu, semua kartu sesuai filter ikut dicetak.
- Layout cetak kartu peserta memiliki mode Besar, Sedang, dan Hemat.
- QR code pada kartu peserta disembunyikan sementara sampai fitur scan pengawas/guru dipakai.
- Password siswa baru otomatis random 6 karakter huruf/angka jika kolom password dikosongkan.
- Data Siswa memiliki tombol generate ulang password sesuai filter yang sedang aktif.
- Halaman Ujian hanya berisi daftar ujian dan modal tambah/edit ujian.
- Peserta Ujian dipisah ke halaman/menu tersendiri.

Catatan PostgreSQL:

```text
Mode default tanpa .env tetap memakai data/cbt-store.json.
Untuk mengaktifkan PostgreSQL:
1. Buat file .env dari .env.example.
2. Isi DATABASE_URL, contoh postgres://postgres:PASSWORD@localhost:5432/cbt_sman94.
3. Jalankan npm run db:setup.
4. Restart npm run dev.

Saat PostgreSQL kosong, data awal akan dimigrasikan dari data/cbt-store.json agar data siswa, guru, ujian, soal, peserta, hasil, dan pelanggaran yang sudah dibuat tidak hilang.
Health check /api/health akan menampilkan storage: postgresql jika DATABASE_URL aktif.
Panduan teknis lengkap tersedia di db/SETUP_POSTGRES.md.
```

Format import siswa yang disarankan:

```text
nis,nisn,name,gender,className,username,password,Mapel Pilihan 1,Mapel Pilihan 2,Mapel Pilihan 3,Mapel Pilihan 4,Mapel Pilihan 5
10676,0062721508,AGISFA ROCHMANY ALFATH,L,XII.2,10676,10676,Informatika 2,Sejarah TL 2,,,
10690,0061606839,AMELIA RASHEEDAH,P,XII.3,10690,10690,Sejarah TL 1,Sosiologi 1,,,
```

Format import soal yang didukung:

```text
1. Pertanyaan pertama
A. Opsi pertama
B. Opsi kedua
C. Opsi ketiga
D. Opsi keempat
E. Opsi kelima
Kunci: C
Bobot: 1

2. Pertanyaan kedua
A. Opsi pertama
B. Opsi kedua
C. Opsi ketiga
D. Opsi keempat
E. Opsi kelima
Kunci: A
```

## Alur demo ujian

1. Login admin: `admin / admin123`.
2. Buka menu `Ujian`, pastikan `INFOR-XII-01` berstatus `published`.
3. Login guru: `guru_informatika / guru123`, lalu tambah/edit/import soal pada Bank Soal.
4. Login siswa: `10676 / 10676`.
5. Masukkan token `IN94`.
6. Kerjakan soal, jawaban akan autosave.
7. Submit ujian, siswa langsung melihat nilai.
8. Admin/guru dapat melihat status dan nilai di menu `Hasil`.

## Catatan pengembangan berikutnya

- Import soal dari Word.
- Dashboard pengawas real-time.
- Android exam client dengan fullscreen, heartbeat, device binding, dan log keluar aplikasi.
- Role dan hak akses lebih ketat per guru, mapel, kelas, dan jadwal ujian.
- Backup otomatis PostgreSQL harian.
