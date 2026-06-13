# CBT SMAN 94 Exam Browser Windows

Aplikasi Windows berbasis Electron untuk membuka CBT SMAN 94 sebagai Exam Browser resmi.

## Fitur awal

- Halaman konfigurasi IP/domain server, port web, dan port API.
- Menyisipkan header Exam Browser resmi ke semua request:
  - `x-cbt-exam-client`
  - `x-cbt-exam-client-key`
  - `x-cbt-exam-platform`
- Server akan menolak login admin/guru/pengawas dari Exam Browser.
- Mode kiosk/fullscreen saat ujian dibuka.
- Memblok klik kanan, DevTools, shortcut reload, shortcut tab baru, dan shortcut umum lain.
- Membatasi navigasi hanya ke host web/API yang dikonfigurasi.

## Menjalankan mode development

Pastikan web dan API sudah berjalan:

```powershell
npm run dev
```

Jalankan Electron:

```powershell
npm run electron:win:dev
```

Isi konfigurasi awal:

- IP/domain server: `127.0.0.1` atau IP komputer server sekolah.
- Port web: `5173` untuk mode development.
- Port API: `4100`.

## Build EXE

```powershell
npm run electron:win:build
```

Hasil aplikasi Windows akan dibuat di:

```text
artifacts/windows-exam-browser/CBT SMAN 94 Exam Browser-win32-x64/
```

File utama yang dibuka siswa:

```text
CBT SMAN 94 Exam Browser.exe
```

## Produksi

Untuk produksi, samakan `EXAM_CLIENT_KEY` di server dan build app.

Server `.env`:

```env
EXAM_CLIENT_KEY=isi-key-produksi-yang-panjang
```

Build Electron:

```powershell
$env:EXAM_CLIENT_KEY="isi-key-produksi-yang-panjang"
npm run electron:win:build
```

Catatan: key di aplikasi client tetap bisa dibongkar oleh orang yang sangat teknis. Server tetap harus memakai validasi tambahan seperti satu akun satu perangkat, token browser biasa untuk mode darurat, jadwal ujian, dan monitoring pelanggaran.
