# Isi Paket Deploy Server

Paket deploy server berisi file minimum untuk menjalankan aplikasi CBT web dan API di komputer server.

## Wajib Ada

- `server`: backend API Node.js.
- `src`: frontend React.
- `db`: referensi schema dan catatan PostgreSQL.
- `docs`: dokumentasi deploy dan operasional.
- `scripts`: file `.bat` untuk start/stop server dan auto-start Windows.
- `index.html`: entry frontend.
- `package.json`: daftar dependency dan script.
- `package-lock.json`: versi dependency terkunci.
- `vite.config.js`: konfigurasi build frontend.
- `.env.example`: contoh konfigurasi environment server.
- `README.md`: catatan project.

## Sengaja Tidak Ikut

- `.env`: rahasia server, dibuat manual di server.
- `node_modules`: install ulang dengan `npm ci`.
- `dist`: build ulang dengan `npm run build`.
- `.git`: tidak wajib untuk deploy manual.
- `data`: tidak ikut karena produksi memakai PostgreSQL. Copy manual hanya jika ingin migrasi JSON lama.
- `benchmark`: alat test, copy terpisah bila diperlukan.
- `android-exam-browser`: project APK, build dari komputer development.
- `electron-exam-browser`: project EXE, belum dipakai untuk deploy server.
- `artifacts`: hasil build/paket lain.
- file log: tidak diperlukan di server baru.

## Setelah Copy Ke Server

Ikuti panduan:

```text
docs\DEPLOY-SERVER.md
```

Urutan ringkas:

1. Buat `.env` dari `.env.example`.
2. Jalankan `npm ci`.
3. Jalankan `npm run db:setup`.
4. Jalankan `npm run build`.
5. Jalankan API dengan PM2.
6. Sajikan frontend dari `dist` atau `npm run preview`.
7. Opsional: jalankan `scripts\install-startup-shortcut.bat` agar server otomatis nyala saat Windows login.
