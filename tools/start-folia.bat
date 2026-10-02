@echo off
rem ============================================================
rem  Folia launcher (Bodian music source)
rem
rem  Starts the vite dev server, waits for port 3000, then opens
rem  Electron against it with CDP on 9444.
rem
rem  ELECTRON_DEV=true is NOT optional:
rem    - loads http://localhost:3000 instead of dist/index.html,
rem      so edits under folia/src take effect at all;
rem    - with app.isPackaged=false the mod loader also scans the
rem      repo's folia/mods directory, which is where this mod
rem      lives (installed builds only scan %APPDATA%\Folia\mods).
rem  Without it the UI silently keeps running the last build.
rem
rem  Keep this file ASCII-only: cmd.exe parses .bat as GBK on
rem  zh-CN Windows, so non-ASCII comments break the script.
rem ============================================================
title Folia

set "FOLIA_DIR=G:\BoDianBoFangQi\folia"

if not exist "%FOLIA_DIR%\package.json" (
    echo [ERROR] Folia directory not found: %FOLIA_DIR%
    pause
    exit /b 1
)

cd /d "%FOLIA_DIR%"

echo ============================================
echo   Folia  -  starting
echo ============================================
echo.

netstat -an | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if %errorlevel% neq 0 (
    echo [1/2] starting vite dev server ...
    start "folia-vite" /min cmd /c "node_modules\.bin\vite.cmd"
) else (
    echo [1/2] vite already running on port 3000, skip
)

echo [2/2] waiting for port 3000 ...
set /a tries=0

:waitloop
timeout /t 1 /nobreak >nul
netstat -an | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 goto ready
set /a tries+=1
if %tries% lss 30 goto waitloop

echo [WARN] vite not ready after 30s, launching Folia anyway ...

:ready
echo.
echo launching Electron window ...
set ELECTRON_DEV=true
start "" "node_modules\electron\dist\electron.exe" . --remote-debugging-port=9444

echo.
echo DevTools opens on purpose in this mode; close it with:
echo   curl http://127.0.0.1:9444/json/list   (then /json/close/^<id^>)
echo This window can be closed.
timeout /t 3 /nobreak >nul
exit /b 0
