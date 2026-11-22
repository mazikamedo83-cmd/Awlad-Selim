@echo off
chcp 65001 > nul
title AWLAD SELIM - السيرفر المركزي الرئيسي (Central Server)
echo ============================================================
echo   AWLAD SELIM - تشغيل السيرفر المركزي الرئيسي على اللابتوب
echo ============================================================

cd /d "%~dp0.."

if "%PORT%"=="" set PORT=3000
if "%API_PORT%"=="" set API_PORT=%PORT%
if "%TRUST_PROXY%"=="" set TRUST_PROXY=1
if "%ALLOW_MOBILE_LAN_HTTP%"=="" set ALLOW_MOBILE_LAN_HTTP=true
if "%AWLAD_DATA_DIR%"=="" (
  if exist "%APPDATA%\AWLAD SELIM\data\database.json" (
    set "AWLAD_DATA_DIR=%APPDATA%\AWLAD SELIM\data"
  )
)

echo [Info] Port: %PORT%
if defined AWLAD_DATA_DIR (
  echo [Info] Data Directory: "%AWLAD_DATA_DIR%"
) else (
  echo [Info] Data Directory: "%cd%\server\data"
)

node server\index.js
if errorlevel 1 (
  echo.
  echo [Error] تعذر تشغيل السيرفر المركزي. تأكد من تثبيت Node.js v20+ وحزم المشروع.
  pause
)
