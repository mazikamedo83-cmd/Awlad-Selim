# AWLAD SELIM - تسجيل مهمة التشغيل التلقائي لنفق Cloudflare على Windows 10/11
# يدعم الوضعين:
#   -quick  (افتراضي: الاتصال الخارجي المجاني مع التقاط الرابط تلقائياً)
#   -named  (الاتصال الاحترافي بدومين ثابت باستخدام CLOUDFLARE_TUNNEL_TOKEN من .env)

param(
  [ValidateSet("quick", "named")]
  [string]$Mode = "quick",
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$null = Get-Command node -ErrorAction Stop
$null = Get-Command cloudflared -ErrorAction Stop

$TaskName = "AWLAD_SELIM_Cloudflare_Tunnel"
$BatFile = if ($Mode -eq "named") { "scripts\start-pro-tunnel.bat" } else { "scripts\start-free-tunnel.bat" }
$BatPath = Join-Path $ProjectRoot $BatFile

$Action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"set PORT=$Port&& `"$BatPath`" $Port`"" `
  -WorkingDirectory $ProjectRoot

$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "تشغيل نفق Cloudflare تلقائياً للسيرفر المركزي AWLAD SELIM (وضع: $Mode)" `
  -Force | Out-Null

Write-Host "[OK] تم تسجيل مهمة التشغيل التلقائي للنفق ($TaskName) على الوضع ($Mode) والمنفذ ($Port)." -ForegroundColor Green
Write-Host "لتشغيل المهمة فوراً دون إعادة تسجيل الدخول:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName $TaskName" -ForegroundColor White
