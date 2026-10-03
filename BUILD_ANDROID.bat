@echo off
title Homoeo Pulse - Android Build Tool
color 0B
cd /d "%~dp0"
cls

echo ==============================================================================
echo           HOMOEO PULSE - ANDROID APK & PLAY STORE AAB BUILDER
echo ==============================================================================
echo.

echo [*] Step 1: Syncing Web Assets to Android...
call npx.cmd cap sync android
if %errorlevel% neq 0 (
    echo [!] Failed to sync web assets.
    pause
    exit /b %errorlevel%
)

echo.
echo [*] Step 2: Compiling Release APK and Play Store AAB Bundle...
cd android
call gradlew.bat assembleRelease bundleRelease
if %errorlevel% neq 0 (
    echo [!] Build failed! Check output above.
    cd ..
    pause
    exit /b %errorlevel%
)
cd ..

echo.
echo ==============================================================================
echo   SUCCESS! BUILD COMPLETED!
echo ==============================================================================
echo.
echo   1. Test APK (Install on your phone directly):
echo      android\app\build\outputs\apk\release\app-release.apk
echo.
echo   2. Play Store AAB (Upload to Google Play Console):
echo      android\app\build\outputs\bundle\release\app-release.aab
echo.
echo   Opening build output folder...
start "" "%~dp0android\app\build\outputs"
echo ==============================================================================
echo.
pause
