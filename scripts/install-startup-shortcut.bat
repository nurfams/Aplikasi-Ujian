@echo off
setlocal EnableExtensions

rem ============================================================
rem CBT SMAN 94 - Install Startup Shortcut
rem Membuat shortcut di Startup Windows agar server otomatis nyala
rem saat user Windows login.
rem ============================================================

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "APP_DIR=%%~fI"
set "START_SCRIPT=%SCRIPT_DIR%start-cbt-server.bat"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_DIR%\CBT SMAN 94 Server.lnk"

if not exist "%START_SCRIPT%" (
  echo [ERROR] File start-cbt-server.bat tidak ditemukan.
  pause
  exit /b 1
)

if not exist "%STARTUP_DIR%" mkdir "%STARTUP_DIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('%SHORTCUT_PATH%'); $shortcut.TargetPath = '%START_SCRIPT%'; $shortcut.WorkingDirectory = '%APP_DIR%'; $shortcut.WindowStyle = 7; $shortcut.Description = 'Auto start CBT SMAN 94 API 4100 dan Web 5173'; $shortcut.Save()"

if errorlevel 1 (
  echo [ERROR] Gagal membuat shortcut Startup.
  pause
  exit /b 1
)

echo Shortcut Startup berhasil dibuat:
echo %SHORTCUT_PATH%
echo.
echo Server akan otomatis nyala saat user Windows ini login.
pause
endlocal
