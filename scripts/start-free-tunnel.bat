@echo off
title AWLAD SELIM - Free Remote Connection (Auto Cloudflare Quick Tunnel)
chcp 65001 >nul
echo ============================================================
echo   AWLAD SELIM - Free Remote Connection (Quick Tunnel)
echo   تشغيل الاتصال الخارجي المجاني مع التحديث التلقائي للرابط
echo ============================================================
echo.
cd /d "%~dp0.."

set TARGET_PORT=%1
if "%TARGET_PORT%"=="" (
  if "%PORT%"=="" (set TARGET_PORT=3000) else (set TARGET_PORT=%PORT%)
)

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js غير مثبت أو غير مضاف إلى PATH.
  pause
  exit /b 1
)

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [!] cloudflared غير مثبت أو غير مضاف إلى PATH.
  echo.
  echo لتثبيته على ويندوز نفذ في PowerShell أو CMD:
  echo   winget install --id Cloudflare.cloudflared
  echo.
  echo أو نزّل الملف الرسمي من موقع Cloudflare وأعد المحاولة.
  pause
  exit /b 1
)

echo [*] جاري تشغيل مراقب النفق المجاني التلقائي إلى http://127.0.0.1:%TARGET_PORT% ...
echo [*] سيتم التقاط رابط https://xxxx.trycloudflare.com وتحديثه في السيرفر تلقائياً عند ظهوره أو تغيّره.
echo [*] تنبيه: رابط Quick Tunnel مؤقت وقد يتغير عند إعادة تشغيل النفق.
echo [*] لإيقاف النفق اضغط Ctrl+C
echo.
node scripts\tunnel-supervisor.mjs --mode=quick --port=%TARGET_PORT%
if errorlevel 1 (
  echo.
  echo [Error] توقف مراقب النفق المجاني.
  pause
)
