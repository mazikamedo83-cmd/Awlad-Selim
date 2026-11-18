@echo off
title AWLAD SELIM - Free Remote Connection (Cloudflare Quick Tunnel)
chcp 65001 >nul
echo ============================================================
echo   AWLAD SELIM - Free Remote Connection (Quick Tunnel)
echo   تشغيل الاتصال الخارجي المجاني عبر Cloudflare Quick Tunnel
echo ============================================================
echo.
set TARGET_PORT=%1
if "%TARGET_PORT%"=="" set TARGET_PORT=3000

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

echo [*] جاري فتح نفق HTTPS مجاني إلى السيرفر المحلي http://127.0.0.1:%TARGET_PORT% ...
echo [*] عند ظهور رابط https://xxxx.trycloudflare.com انسخه وضعه في:
echo     الإعدادات ^> Server ^& Connection Settings ^> Free Remote Connection
echo [*] لإيقاف النفق اضغط Ctrl+C
echo.
cloudflared tunnel --url http://127.0.0.1:%TARGET_PORT%
pause
