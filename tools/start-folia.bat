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
rem
rem  WHY Electron is started through PowerShell with redirection:
rem  `start "" electron.exe .` gives the GUI process no usable
rem  stdout, and Folia's main process writes console logs -- the
rem  first write dies with "EPIPE: broken pipe" and kills the
rem  process a few seconds in (window stays on the loading screen).
rem  Redirecting both streams to files fixes that and keeps the
rem  [Mod:bodian-source] log reachable at tools\out\folia.log.
rem ============================================================
title Folia

set "FOLIA_DIR=G:\BoDianBoFangQi\folia"
set "OUT_DIR=G:\BoDianBoFangQi\tools\out"
set "TOOLS_DIR=%~dp0"

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
ping -n 2 127.0.0.1 >nul
netstat -an | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 goto ready
set /a tries+=1
if %tries% lss 30 goto waitloop

echo [WARN] vite not ready after 30s, launching Folia anyway ...

:ready
echo.
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
echo launching Electron window ...
echo   log: %OUT_DIR%\folia.log
set ELECTRON_DEV=true
start "folia-electron" /min powershell -NoProfile -Command "Start-Process -FilePath 'node_modules\electron\dist\electron.exe' -WorkingDirectory '%FOLIA_DIR%' -ArgumentList '.','--remote-debugging-port=9444' -RedirectStandardOutput '%OUT_DIR%\folia.log' -RedirectStandardError '%OUT_DIR%\folia.err.log'"

rem dev 运行时会自动弹出 DevTools（那是给排查用的）。这里让它就绪后自己关掉，省得每次手点。
start "folia-close-devtools" /min cmd /c "node %TOOLS_DIR%folia-cdp.mjs close-devtools --wait"

echo.
echo This window can be closed.
ping -n 4 127.0.0.1 >nul
exit /b 0
