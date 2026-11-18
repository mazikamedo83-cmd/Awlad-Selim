@echo off
title AWLAD SELIM - Professional Remote Connection (Cloudflare Named Tunnel)
chcp 65001 >nul
echo ============================================================
echo   AWLAD SELIM - Professional Remote Connection (Named Tunnel)
echo   تشغيل الاتصال الخارجي الاحترافي بدومين ثابت + HTTPS
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
  echo لتثبيته على ويندوز:
  echo   winget install --id Cloudflare.cloudflared
  pause
  exit /b 1
)

echo [*] ملاحظة أمنية: يتم قراءة CLOUDFLARE_TUNNEL_TOKEN من متغيرات النظام أو ملف .env فقط.
echo [*] تشغيل Named Tunnel إلى السيرفر المحلي على المنفذ %TARGET_PORT% ...
echo.
node scripts\tunnel-supervisor.mjs --mode=named --port=%TARGET_PORT%
if errorlevel 1 (
  echo.
  echo [Error] تعذر تشغيل Named Tunnel. تأكد من ضبط CLOUDFLARE_TUNNEL_TOKEN في ملف .env.
  pause
)
