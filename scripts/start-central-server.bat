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

where node >nul 2>nul
if errorlevel 1 (
  echo [Error] Node.js غير مثبت أو غير مضاف إلى PATH.
  pause
  exit /b 1
)

REM فحص منع التكرار على المنفذ قبل التشغيل (إذا كان Electron أو نسخة أخرى تعمل بالفعل على نفس المنفذ)
node -e "const http=require('http');const p=Number(process.env.PORT||3000);const req=http.get('http://127.0.0.1:'+p+'/api/health',{timeout:1500},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{try{const j=JSON.parse(b);if(j&&j.ok){process.exit(10);}process.exit(11);}catch{process.exit(11);}});});req.on('error',()=>process.exit(0));req.on('timeout',()=>{req.destroy();process.exit(11);});"
set PORT_CHECK=%errorlevel%

if "%PORT_CHECK%"=="10" (
  echo [Info] السيرفر المركزي AWLAD SELIM يعمل بالفعل على المنفذ %PORT% ^(عبر برنامج سطح المكتب أو مثيل سابق^).
  echo [Info] لا حاجة لتشغيل نسخة إضافية لتجنب تعارض المنفذ وقاعدة البيانات.
  exit /b 0
)

if "%PORT_CHECK%"=="11" (
  echo [Error] المنفذ %PORT% مشغول حالياً ببرنامج آخر غير السيرفر المركزي!
  echo [Error] أغلق البرنامج الذي يستخدم المنفذ %PORT% أو حدد منفذاً آخر عبر PORT=...
  pause
  exit /b 1
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
