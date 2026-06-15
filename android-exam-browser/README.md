# CBT SMAN 94 Exam Browser Android

Aplikasi Android native Kotlin untuk membuka CBT SMAN 94 melalui WebView/Overlay resmi sekolah.

## Status Produksi

APK produksi tidak lagi menampilkan halaman setting IP/port ke peserta. Alamat server ditanam saat build APK melalui `BuildConfig`.

Alur peserta:

1. Buka aplikasi.
2. Aplikasi cek izin `Appear on top` jika memakai varian Overlay.
3. Jika izin belum aktif, peserta wajib mengaktifkan izin terlebih dahulu.
4. Aplikasi membuka halaman login peserta.
5. Aplikasi hanya menerima login role `siswa`.
6. Peserta masuk portal, memilih ujian, lalu mulai ujian.
7. Jawaban disimpan lokal dan disinkronkan ke server.
8. Setelah selesai, peserta logout.
9. Tombol `Keluar Aplikasi` hanya tersedia di halaman login.

## Fitur

- WebView fullscreen immersive.
- Mode Overlay yang membutuhkan izin `Appear on top`.
- Mengirim identitas Exam Browser resmi ke API.
- Menolak penggunaan akun admin/guru/pengawas dari APK.
- Disable screenshot/screen recording dengan `FLAG_SECURE`.
- Tombol back Android diblokir dan dicatat saat ujian aktif.
- Keep screen awake selama aplikasi dibuka.
- Whitelist hanya host CBT dan API.
- Deteksi aplikasi masuk background/kembali foreground.
- Deteksi izin overlay dimatikan saat ujian berlangsung.
- Penyimpanan lokal jawaban untuk mengurangi risiko jawaban hilang.
- Tombol keluar aplikasi disisipkan khusus di halaman login.

## Lokasi Setup URL Server

File utama:

```text
android-exam-browser/app/build.gradle.kts
```

Bagian yang mengatur alamat server:

```kotlin
val cbtBaseUrl = configValue("CBT_BASE_URL", "http://192.168.1.3:5173/").trim().trimEnd('/') + "/"
val cbtApiBaseUrl = configValue("CBT_API_BASE_URL", "http://192.168.1.3:4100/api").trim().trimEnd('/')
val examClientKey = configValue("EXAM_CLIENT_KEY", "dev-exam-client-key").trim()
```

Untuk produksi dengan domain dan reverse proxy, contoh yang disarankan:

```text
CBT_BASE_URL=https://cbt.sman94.sch.id/
CBT_API_BASE_URL=https://cbt.sman94.sch.id/api
```

Untuk produksi tanpa reverse proxy:

```text
CBT_BASE_URL=http://IP-SERVER:5173/
CBT_API_BASE_URL=http://IP-SERVER:4100/api
```

Nilai `EXAM_CLIENT_KEY` harus sama dengan `.env` web server.

## Build APK Dari Android Studio

1. Buka Android Studio.
2. Pilih `Open`.
3. Buka folder:

```text
C:\Users\nurfa\Desktop\Aplikasi Ujian\android-exam-browser
```

4. Tunggu Gradle sync selesai.
5. Buka file:

```text
app/build.gradle.kts
```

6. Ubah default `CBT_BASE_URL`, `CBT_API_BASE_URL`, dan `EXAM_CLIENT_KEY` jika diperlukan.
7. Pilih varian build `overlayRelease` untuk APK ujian yang memakai overlay.
8. Klik:

```text
Build > Build Bundle(s) / APK(s) > Build APK(s)
```

Hasil APK biasanya ada di:

```text
android-exam-browser/app/build/outputs/apk/overlay/release/
```

atau untuk debug:

```text
android-exam-browser/app/build/outputs/apk/overlay/debug/
```

## Build APK Dari Terminal

Masuk ke folder Android:

```powershell
cd "C:\Users\nurfa\Desktop\Aplikasi Ujian\android-exam-browser"
```

Jika PowerShell masih memakai Java 8, arahkan dulu ke JBR bawaan Android Studio:

```powershell
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$env:Path="$env:JAVA_HOME\bin;$env:Path"
java -version
```

Build overlay debug dengan URL default di `app/build.gradle.kts`:

```powershell
.\gradlew.bat assembleOverlayDebug
```

Build overlay debug sambil mengganti URL server tanpa mengedit file:

```powershell
.\gradlew.bat assembleOverlayDebug `
  -PCBT_BASE_URL="https://cbt.sman94.sch.id/" `
  -PCBT_API_BASE_URL="https://cbt.sman94.sch.id/api" `
  -PEXAM_CLIENT_KEY="isi-sama-dengan-env-server"
```

Build overlay release:

```powershell
.\gradlew.bat assembleOverlayRelease `
  -PCBT_BASE_URL="https://cbt.sman94.sch.id/" `
  -PCBT_API_BASE_URL="https://cbt.sman94.sch.id/api" `
  -PEXAM_CLIENT_KEY="isi-sama-dengan-env-server"
```

Catatan: release APK sebaiknya ditandatangani dengan signing key sekolah sebelum disebarkan massal.

## Jika Server Pindah URL

Ada dua cara.

### Cara A: Edit File

1. Buka:

```text
android-exam-browser/app/build.gradle.kts
```

2. Ubah nilai default:

```kotlin
val cbtBaseUrl = configValue("CBT_BASE_URL", "https://domain-baru/").trim().trimEnd('/') + "/"
val cbtApiBaseUrl = configValue("CBT_API_BASE_URL", "https://domain-baru/api").trim().trimEnd('/')
```

3. Build ulang APK.
4. Sebarkan APK baru ke peserta.

### Cara B: Tanpa Edit File

Jalankan build dengan parameter:

```powershell
.\gradlew.bat assembleOverlayDebug `
  -PCBT_BASE_URL="https://domain-baru/" `
  -PCBT_API_BASE_URL="https://domain-baru/api" `
  -PEXAM_CLIENT_KEY="key-server"
```

## Varian Build

- `hybridDebug` / `hybridRelease`: WebView fullscreen tanpa wajib overlay.
- `overlayDebug` / `overlayRelease`: varian utama ujian, wajib izin `Appear on top`.

Untuk ujian sekolah, gunakan varian:

```text
overlay
```

## Catatan Keamanan

- Jangan memakai `dev-exam-client-key` untuk produksi.
- Samakan `EXAM_CLIENT_KEY` APK dengan `.env` server.
- APK hanya untuk peserta. Admin/guru/pengawas harus login dari dashboard web biasa.
- Jangan sebar APK debug untuk ujian resmi jika release APK sudah siap.
- Pastikan server memakai HTTPS jika diakses lewat internet.
