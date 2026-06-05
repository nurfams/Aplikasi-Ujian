# Setup PostgreSQL CBT SMAN 94

Dokumen ini dipakai saat aplikasi sudah siap dipindahkan dari mode JSON lokal ke PostgreSQL.

## Status Saat Ini

- Aplikasi tetap berjalan memakai `data/cbt-store.json` selama file `.env` belum berisi `DATABASE_URL`.
- Schema database tersedia di `db/schema.sql`.
- Script setup tersedia lewat:

```bash
npm run db:setup
```

Script tersebut akan:

1. Membuat database sesuai nama di `DATABASE_URL` jika belum ada.
2. Membuat semua tabel dan index.
3. Mengisi database dari `data/cbt-store.json` jika database masih kosong.
4. Menampilkan jumlah data per tabel setelah setup.

## File `.env`

Buat file `.env` dari `.env.example` saat sudah mau mengaktifkan PostgreSQL:

```env
PORT=4100
DATABASE_URL=postgres://postgres:PASSWORD_POSTGRES@localhost:5432/cbt_sman94
AUTH_SECRET=ganti-dengan-random-secret-panjang
TOKEN_TTL_HOURS=8
```

Catatan:

- Jangan isi `DATABASE_URL` dengan password contoh saat masih memakai mode JSON.
- Jika `DATABASE_URL` aktif, server akan memakai PostgreSQL sebagai sumber data utama.
- Jika `.env` belum ada, server otomatis memakai JSON lokal.

## Urutan Aktivasi Nanti

1. Backup file `data/cbt-store.json`.
2. Pastikan PostgreSQL berjalan.
3. Buat/isi file `.env`.
4. Jalankan:

```bash
npm run db:setup
```

5. Jalankan server:

```bash
npm run dev
```

6. Cek health:

```text
http://127.0.0.1:4100/api/health
```

Jika berhasil, hasilnya memuat:

```json
{
  "storage": "postgresql"
}
```

## Rollback Aman

Jika ingin kembali sementara ke mode JSON:

1. Hapus atau kosongkan `DATABASE_URL` di `.env`.
2. Restart server.
3. Health check akan kembali menampilkan:

```json
{
  "storage": "json"
}
```

## Tabel Utama

- `users`: akun admin, guru, pengawas, siswa.
- `students`: data siswa dan mapel pilihan.
- `exams`: paket ujian, jadwal, token, status publish.
- `questions`: bank soal semua tipe.
- `attempts`: pengerjaan, jawaban, dan nilai siswa.
- `violations`: log pelanggaran/exam client.
