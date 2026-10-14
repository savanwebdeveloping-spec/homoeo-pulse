@echo off
title Homoeo Pulse - GitHub Push Tool
color 0A
cd /d "%~dp0"
cls

echo ==============================================================================
echo                HOMOEO PULSE - 1-CLICK GITHUB PUSH
echo ==============================================================================
echo.
echo [*] Current Directory: %cd%
echo [*] Target Repository: https://github.com/savanwebdeveloping-spec/homoeo-pulse.git
echo.
echo [*] Uploading code to GitHub...
echo.

git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ==============================================================================
    echo   [SUCCESS] Code successfully pushed to GitHub!
    echo ==============================================================================
    echo.
    echo   You can now open Render.com and deploy the web service!
) else (
    echo.
    echo ==============================================================================
    echo   [NOTICE] If a browser window opened, please click "Authorize/Sign in".
    echo ==============================================================================
)

echo.
pause
