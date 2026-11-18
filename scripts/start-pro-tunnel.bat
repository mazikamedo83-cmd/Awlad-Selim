@echo off
title AWLAD SELIM - Professional Remote Connection (Cloudflare Named Tunnel)
chcp 65001 >nul
echo ============================================================
echo   AWLAD SELIM - Professional Remote Connection (Named Tunnel)
echo   تشغيل الاتصال الخارجي الاحترافي بدومين ثابت مشفر HTTPS
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

REM تحميل CLOUDFLARE_TUNNEL_TOKEN من .env عند عدم تمريره في البيئة دون حفظه في الكود
if "%CLOUDFLARE_TUNNEL_TOKEN%"=="" (
  for /f "usebackq delims=" %%T in (`node -e "const fs=require('fs'),path=require('path');const c=[path.join(process.env.APPDATA||'','AWLAD SELIM','.env'),path.join(process.cwd(),'.env')];for(const f of c){if(fs.existsSync(f)){for(const l of fs.readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^\s*CLOUDFLARE_TUNNEL_TOKEN\s*=\s*(.+)\s*$/);if(m){console.log(m[1].replace(/^['\"]|['\"]$/g,'').trim());process.exit(0);}}}}"`) do set "CLOUDFLARE_TUNNEL_TOKEN=%%T"
)

if "%CLOUDFLARE_TUNNEL_TOKEN%"=="" (
  echo [!] متغير CLOUDFLARE_TUNNEL_TOKEN غير مضبوط في البيئة أو ملف .env.
  echo ضع التوكن في "%APPDATA%\AWLAD SELIM\.env" أو ".env" ثم أعد التشغيل.
  pause
  exit /b 1
)

echo [*] جاري تشغيل Cloudflare Named Tunnel نحو http://127.0.0.1:%TARGET_PORT% ...
echo [*] لإيقاف النفق اضغط Ctrl+C
echo.
node scripts\tunnel-supervisor.mjs --mode=named --port=%TARGET_PORT% --token="%CLOUDFLARE_TUNNEL_TOKEN%"
if errorlevel 1 (
  echo.
  echo [Error] توقف مراقب النفق الاحترافي.
  pause
)
