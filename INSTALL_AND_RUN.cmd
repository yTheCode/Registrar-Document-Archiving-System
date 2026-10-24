@echo off
:: ============================================================
::  AdZU Registrar Archive - Install and Run
::  This script always runs with elevated Administrator rights.
:: ============================================================

:: --- Automatic UAC elevation --------------------------------
:: "NET SESSION" only succeeds for an elevated (Administrator) token.
:: If it fails we are running as a standard user, so relaunch this
:: same script through the Windows "Run as Administrator" UAC prompt.
NET SESSION >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Requesting administrative privileges...
    echo A Windows UAC prompt will appear - click "Yes" to continue.
    echo.
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: --- Set working directory ----------------------------------
:: The elevated relaunch starts in C:\Windows\System32, so anchor
:: execution back to this script's own folder before doing anything.
cd /d "%~dp0"

echo ========================================
echo  AdZU Registrar Archive - Installation
echo ========================================
echo.

:: --- Pre-create the Electron userData folders ----------------
:: Electron stores its data in AppData\Roaming\adzu-registrar-archive
:: and archives documents under an "Archive" subfolder. Creating these
:: up front (with admin rights) ensures Node/Electron fs.mkdir(Sync)
:: can freely build further subdirectories without hitting
:: "EPERM: operation not permitted".
set "APP_USERDATA=%APPDATA%\adzu-registrar-archive"
if not exist "%APP_USERDATA%" (
    echo Preparing application data folder: "%APP_USERDATA%"
    mkdir "%APP_USERDATA%" 2>nul
)
if not exist "%APP_USERDATA%\Archive" (
    mkdir "%APP_USERDATA%\Archive" 2>nul
)

echo [1/3] Installing dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo [2/3] Rebuilding better-sqlite3 for Electron...
call npx @electron/rebuild -f -w better-sqlite3
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to rebuild better-sqlite3
    echo Trying alternative method...
    call npm run rebuild
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: All rebuild attempts failed
        echo Please see README.md - "How to Run and Build" - for manual steps
        pause
        exit /b 1
    )
)

echo.
echo [3/3] Starting application...
echo.
echo ========================================
echo  Installation complete! Starting app...
echo ========================================
echo.
call npm run dev
