@echo off
title Homoeo Pulse - Unified Launcher Hub
color 0A
cd /d "%~dp0"
cls

echo ==============================================================================
echo           HOMOEO PULSE - AYUSH ACADEMIC & CLINICAL PLATFORM
echo                Unified Single Launcher (Separate Portals)
echo ==============================================================================
echo.

:: 1. Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js not detected in system PATH.
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b
)

:: 2. Free port 3000 if already occupied by an old process
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do (
    taskkill /f /pid %%a >nul 2>nul
)

:: 3. Start Backend Server
echo [*] Starting Backend REST API Server on http://localhost:3000 ...
start /B node server.js

:: 4. Wait briefly for server initialization
timeout /t 2 /nobreak >nul

echo.
echo ==============================================================================
echo   Select what you want to open (Ya enter dabao to open Launcher Hub):
echo ==============================================================================
echo.
echo   [1] 📱 Student Mobile App (Public)       -> Opens http://localhost:3000
echo   [2] 💻 Faculty Admin Dashboard (Private) -> Opens http://localhost:3000/admin
echo   [3] ⚡ Both in Separate Windows          -> Opens Both
echo   [4] 🌐 Portal Hub Launcher (Default)     -> Opens http://localhost:3000/hub
echo   [5] 🤖 Build Android APK & Play Store AAB-> Runs BUILD_ANDROID.bat
echo.
echo ==============================================================================
set choice=4
set /p choice="Enter your choice (1, 2, 3, 4, or 5) [Default 4]: "

if "%choice%"=="1" (
    echo [*] Opening Student Mobile App...
    start "" "http://localhost:3000"
) else if "%choice%"=="2" (
    echo [*] Opening Faculty Admin Dashboard...
    start "" "http://localhost:3000/admin"
) else if "%choice%"=="3" (
    echo [*] Opening Both in separate windows...
    start "" "http://localhost:3000"
    start "" "http://localhost:3000/admin"
) else if "%choice%"=="5" (
    echo [*] Launching Android Build Tool...
    call BUILD_ANDROID.bat
) else (
    echo [*] Opening Unified Portal Hub...
    start "" "http://localhost:3000/hub"
)

echo.
echo ==============================================================================
echo   [STATUS] Server is running! Press any key or close this window to stop.
echo ==============================================================================
echo.

pause >nul
