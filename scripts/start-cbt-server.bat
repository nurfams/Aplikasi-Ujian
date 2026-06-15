@echo off
setlocal EnableExtensions

rem ============================================================
rem CBT SMAN 94 - Auto Start Server
rem Menyalakan API port 4100 dan web port 5173.
rem Jalankan file ini lewat shortcut Startup, jangan dipindahkan
rem dari folder scripts agar path project tetap benar.
rem ============================================================

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "APP_DIR=%%~fI"

if not exist "%APP_DIR%\package.json" (
  echo [ERROR] Folder aplikasi tidak ditemukan dari path: %APP_DIR%
  echo Pastikan file ini tetap berada di folder scripts project CBT.
  pause
  exit /b 1
)

cd /d "%APP_DIR%"

if not exist "logs" mkdir "logs"

echo ============================================================
echo CBT SMAN 94 - Start Server
echo Folder: %APP_DIR%
echo ============================================================

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js belum terinstall atau belum masuk PATH.
  pause
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm belum terinstall atau belum masuk PATH.
  pause
  exit /b 1
)

where pm2.cmd >nul 2>&1
if errorlevel 1 (
  echo [INFO] PM2 belum ditemukan. Menginstall PM2 global...
  call npm.cmd install -g pm2
  if errorlevel 1 (
    echo [ERROR] Gagal install PM2.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo [ERROR] File .env belum ada.
  echo Buat dulu dari .env.example dan isi DATABASE_URL, AUTH_SECRET, EXAM_CLIENT_KEY.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] node_modules belum ada. Menjalankan npm ci...
  call npm.cmd ci
  if errorlevel 1 (
    echo [ERROR] npm ci gagal.
    pause
    exit /b 1
  )
)

if not exist "dist\index.html" (
  echo [INFO] dist belum ada. Menjalankan npm run build...
  call npm.cmd run build
  if errorlevel 1 (
    echo [ERROR] Build frontend gagal.
    pause
    exit /b 1
  )
)

set "NODE_OPTIONS=--max-old-space-size=4096"

call pm2.cmd describe cbt-sman94-api >nul 2>&1
if errorlevel 1 (
  echo [INFO] Menjalankan API port 4100 dengan PM2...
  call pm2.cmd start server/server.js --name cbt-sman94-api --update-env
) else (
  echo [INFO] Restart API port 4100 dengan PM2...
  call pm2.cmd restart cbt-sman94-api --update-env
)

if errorlevel 1 (
  echo [ERROR] API gagal dijalankan oleh PM2.
  pause
  exit /b 1
)

call pm2.cmd save >nul 2>&1

for /f %%A in ('powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }"') do set "WEB_RUNNING=%%A"

if /I "%WEB_RUNNING%"=="yes" (
  echo [INFO] Web port 5173 sudah berjalan.
) else (
  echo [INFO] Menjalankan web port 5173...
  start "CBT SMAN 94 Web 5173" /min cmd /c "cd /d ""%APP_DIR%"" && npm.cmd run preview -- --host 0.0.0.0 --port 5173 >> ""logs\frontend-preview.log"" 2>&1"
)

echo [INFO] Mengecek API health...
powershell -NoProfile -Command "try { Invoke-RestMethod 'http://127.0.0.1:4100/api/health' -TimeoutSec 8 | ConvertTo-Json -Compress } catch { Write-Host '[WARN] API belum merespons. Cek pm2 logs cbt-sman94-api.' }"

echo ============================================================
echo Selesai.
echo API : http://127.0.0.1:4100/api/health
echo Web : http://127.0.0.1:5173
echo Log web: %APP_DIR%\logs\frontend-preview.log
echo ============================================================

endlocal
