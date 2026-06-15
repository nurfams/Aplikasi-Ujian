@echo off
setlocal EnableExtensions

rem ============================================================
rem CBT SMAN 94 - Stop Server
rem Menghentikan API PM2 dan web preview port 5173.
rem ============================================================

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "APP_DIR=%%~fI"

cd /d "%APP_DIR%" 2>nul

echo ============================================================
echo CBT SMAN 94 - Stop Server
echo ============================================================

where pm2.cmd >nul 2>&1
if not errorlevel 1 (
  echo [INFO] Menghentikan API PM2...
  call pm2.cmd stop cbt-sman94-api >nul 2>&1
) else (
  echo [INFO] PM2 tidak ditemukan, lewati API.
)

echo [INFO] Menghentikan proses yang memakai port 5173...
powershell -NoProfile -Command "$items = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue; if ($items) { $items | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Host ('Stopped PID ' + $_) } } else { Write-Host 'Tidak ada proses di port 5173.' }"

echo Selesai.
endlocal
