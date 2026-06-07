# CBT SMAN 94 Exam Browser Android

Aplikasi Android native Kotlin untuk membuka CBT SMAN 94 dalam WebView terkunci tahap awal.

## Fitur awal

- WebView fullscreen immersive.
- Mengirim identitas Exam Browser resmi ke API login.
- Browser biasa tetap membutuhkan Token Akses Browser dari admin, tetapi aplikasi ini tidak.
- Disable screenshot/screen recording dengan `FLAG_SECURE`.
- Tombol back Android diblokir dan dicatat sebagai pelanggaran saat ujian aktif.
- Keep screen awake selama aplikasi dibuka.
- Whitelist hanya host CBT dan API.
- Deteksi aplikasi masuk background/kembali foreground dan kirim heartbeat saat attempt aktif.
- Blok long press/context menu/select start melalui injeksi JavaScript.

## Konfigurasi server

Edit `app/build.gradle.kts`:

```kotlin
buildConfigField("String", "CBT_BASE_URL", "\"http://192.168.1.3:5173/\"")
buildConfigField("String", "CBT_API_BASE_URL", "\"http://192.168.1.3:4100/api\"")
buildConfigField("String", "EXAM_CLIENT_KEY", "\"dev-exam-client-key\"")
```

Nilai `EXAM_CLIENT_KEY` harus sama dengan `.env` web server.

## Build APK

Buka folder `android-exam-browser` di Android Studio, lalu pilih:

```text
Build > Build Bundle(s) / APK(s) > Build APK(s)
```

Untuk build dari terminal diperlukan Android SDK, Gradle, dan JDK 17.

## Catatan keamanan

Ini fondasi tahap awal. Penguncian lebih kuat membutuhkan Lock Task/Kiosk Mode, MDM, atau perangkat sekolah yang dikelola sebagai device owner.
