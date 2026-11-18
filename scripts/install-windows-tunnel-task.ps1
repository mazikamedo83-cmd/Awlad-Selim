# AWLAD SELIM - تسجيل مهمة التشغيل التلقائي لنفق Cloudflare على Windows 10/11
# يجب تشغيل PowerShell بصلاحية المسؤول (Run as Administrator)

param(
  [ValidateSet("quick", "named")]
  [string]$Mode = "quick",
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

$ScriptFile = if ($Mode -eq "named") {
  Join-Path $ProjectRoot "scripts\start-pro-tunnel.bat"
} else {
  Join-Path $ProjectRoot "scripts\start-free-tunnel.bat"
}

if (-not (Test-Path $ScriptFile)) {
  throw "لم يتم العثور على ملف التشغيل: $ScriptFile"
}

$TaskName = if ($Mode -eq "named") { "AWLAD_SELIM_Pro_Tunnel" } else { "AWLAD_SELIM_Free_Tunnel" }

$Action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"set PORT=$Port&& `"$ScriptFile`" $Port`"" `
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
  -Description "تشغيل نفق الاتصال الخارجي Cloudflare ($Mode) لنظام أولاد سليم تلقائياً" `
  -Force | Out-Null

Write-Host "[OK] تم تسجيل مهمة النفق ($TaskName) على المنفذ $Port بوضع $Mode بنجاح." -ForegroundColor Green
