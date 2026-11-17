# AWLAD SELIM - إعداد السيرفر المركزي والتشغيل التلقائي وجدار الحماية على Windows 10/11
# يجب تشغيل PowerShell بصلاحية المسؤول (Run as Administrator)

param(
  [int]$Port = 3000,
  [string]$DataDir = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$NodeExe = (Get-Command node -ErrorAction Stop).Source

Write-Host "=== AWLAD SELIM Central Server Setup ===" -ForegroundColor Cyan
Write-Host "Project Root : $ProjectRoot"
Write-Host "Node Binary  : $NodeExe"
Write-Host "ListeningPort: $Port"

# 1. فتح منفذ جدار الحماية (Windows Defender Firewall) لشبكة المحل LAN
$RuleName = "AWLAD SELIM Central Server (TCP $Port)"
$ExistingRule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if (-not $ExistingRule) {
  New-NetFirewallRule `
    -DisplayName $RuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile Private,Domain `
    -Description "Allow AWLAD SELIM mobile apps on local shop Wi-Fi/LAN to connect to Laptop Central Server" | Out-Null
  Write-Host "[OK] تم فتح المنفذ $Port في جدار الحماية لشبكات Private/Domain." -ForegroundColor Green
} else {
  Write-Host "[OK] قاعدة جدار الحماية موجودة بالفعل: $RuleName" -ForegroundColor Green
}

# 2. تحديد مجلد البيانات المركزي إن لم يتم تمريره
if ([string]::IsNullOrWhiteSpace($DataDir)) {
  $AppDataDir = Join-Path $env:APPDATA "AWLAD SELIM\data"
  if (Test-Path (Join-Path $AppDataDir "database.json")) {
    $DataDir = $AppDataDir
  } else {
    $DataDir = Join-Path $ProjectRoot "server\data"
  }
}
Write-Host "Data Dir     : $DataDir" -ForegroundColor Yellow

# 3. إنشاء مهمة تشغيل تلقائي عند إقلاع الويندوز (Windows Task Scheduler)
$TaskName = "AWLAD_SELIM_Central_Server"
$BatPath = Join-Path $ProjectRoot "scripts\start-central-server.bat"

$Action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"set PORT=$Port&& set AWLAD_DATA_DIR=$DataDir&& `"$BatPath`"`"" `
  -WorkingDirectory $ProjectRoot

$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "تشغيل السيرفر المركزي لنظام أولاد سليم تلقائياً لاستقبال طلبات الموبايل والأجهزة" `
  -Force | Out-Null

Write-Host "[OK] تم تسجيل مهمة التشغيل التلقائي ($TaskName) بنجاح." -ForegroundColor Green
Write-Host "لعرض عناوين الشبكة المحلية المتاحة:" -ForegroundColor Cyan
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.254.*" } | ForEach-Object {
  Write-Host "  -> http://$($_.IPAddress):$Port" -ForegroundColor White
}
