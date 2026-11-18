# AWLAD SELIM - Production Android Release Keystore Generator (RSA 4096-bit)
# Stores the keystore, encrypted backup, and Base64 export strictly OUTSIDE the Git repository.
# NEVER commit keystore files, *.b64, or keystore.properties into GitHub!

param(
  [string]$OutputDir = "",
  [string]$BackupDir = "",
  [string]$Alias = "awladselim_release",
  [int]$ValidityDays = 10000
)

$ErrorActionPreference = "Stop"

$UserHome = if ($env:USERPROFILE) { $env:USERPROFILE } else { [Environment]::GetFolderPath("UserProfile") }
if ([string]::IsNullOrWhiteSpace($UserHome)) {
  Write-Error "Unable to resolve Windows user profile directory. Pass -OutputDir explicitly outside the project folder."
  exit 1
}

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $UserHome ".awlad-selim-keys"
}
if ([string]::IsNullOrWhiteSpace($BackupDir)) {
  $BackupDir = Join-Path $OutputDir "backups"
}

$ProjectRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
$ProjectRootFull = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
$CwdFull = [System.IO.Path]::GetFullPath((Get-Location).Path).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar

$ResolvedOutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$ResolvedBackupDir = [System.IO.Path]::GetFullPath($BackupDir)

function Test-InsideDirectory {
  param(
    [string]$CandidatePath,
    [string]$BaseDirWithSep
  )
  $CandidateWithSep = $CandidatePath.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
  return $CandidateWithSep.StartsWith($BaseDirWithSep, [System.StringComparison]::OrdinalIgnoreCase)
}

if ((Test-InsideDirectory -CandidatePath $ResolvedOutputDir -BaseDirWithSep $ProjectRootFull) -or
    (Test-InsideDirectory -CandidatePath $ResolvedOutputDir -BaseDirWithSep $CwdFull)) {
  Write-Error "Refusing to create production keystore inside the project directory: $ResolvedOutputDir"
  exit 1
}

if ((Test-InsideDirectory -CandidatePath $ResolvedBackupDir -BaseDirWithSep $ProjectRootFull) -or
    (Test-InsideDirectory -CandidatePath $ResolvedBackupDir -BaseDirWithSep $CwdFull)) {
  Write-Error "Refusing to store production keystore backups inside the project directory: $ResolvedBackupDir"
  exit 1
}

function Find-KeytoolPath {
  $cmd = Get-Command keytool -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }

  $candidates = @()
  if ($env:JAVA_HOME) {
    $candidates += (Join-Path $env:JAVA_HOME "bin\keytool.exe")
  }
  $candidates += @(
    "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe",
    "C:\Program Files\Android\Android Studio\jre\bin\keytool.exe"
  )

  $jdkRoots = @(
    "C:\Program Files\Eclipse Adoptium",
    "C:\Program Files\Java",
    "C:\Program Files\Microsoft",
    "C:\Program Files\Amazon Corretto"
  )
  foreach ($root in $jdkRoots) {
    if (Test-Path $root) {
      $found = Get-ChildItem -Path $root -Filter "keytool.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($found) { $candidates += $found.FullName }
    }
  }

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

$KeytoolPath = Find-KeytoolPath
if (-not $KeytoolPath) {
  Write-Error "JDK keytool not found on PATH, JAVA_HOME, or Android Studio JBR. Install JDK 21 (Temurin/Oracle) and ensure keytool is available."
  exit 1
}

New-Item -ItemType Directory -Force -Path $ResolvedOutputDir | Out-Null
New-Item -ItemType Directory -Force -Path $ResolvedBackupDir | Out-Null

$KeystorePath = Join-Path $ResolvedOutputDir "awlad-selim-release.keystore"
if (Test-Path $KeystorePath) {
  Write-Error "Refusing to overwrite existing production keystore at: $KeystorePath. Back it up or move it intentionally if rotating."
  exit 1
}

function New-StrongPassword {
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $sb = New-Object System.Text.StringBuilder
    foreach ($b in $bytes) {
      [void]$sb.Append($chars[$b % $chars.Length])
    }
    return $sb.ToString()
  } finally {
    $rng.Dispose()
  }
}

# PKCS12 requires storepass and keypass to match so Gradle/apksigner/jarsigner always unlock cleanly
$StorePassword = New-StrongPassword
$KeyPassword = $StorePassword
$DName = "CN=AWLAD SELIM ERP, OU=Mobile Engineering, O=AWLAD SELIM, L=Cairo, ST=Cairo, C=EG"

Write-Host "=== Generating RSA 4096-bit Android Production Keystore ===" -ForegroundColor Cyan
Write-Host "Keystore Path : $KeystorePath"
Write-Host "Key Alias     : $Alias"

$Sha256 = "(unavailable)"
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupPath = Join-Path $ResolvedBackupDir "awlad-selim-release-$Stamp.keystore"
$Base64Path = Join-Path $ResolvedOutputDir "ANDROID_KEYSTORE_BASE64.txt"
$SecretsNotePath = Join-Path $ResolvedOutputDir "GITHUB_SECRETS_REFERENCE.txt"

$env:AWLAD_TMP_KEYSTORE_PASS = $StorePassword
try {
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $genOutput = (& $KeytoolPath -genkeypair `
      -keystore $KeystorePath `
      -storetype PKCS12 `
      -keyalg RSA `
      -keysize 4096 `
      -validity $ValidityDays `
      -alias $Alias `
      -storepass:env AWLAD_TMP_KEYSTORE_PASS `
      -keypass:env AWLAD_TMP_KEYSTORE_PASS `
      -dname $DName 2>&1 | Out-String)
    $genExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }

  if ($genExit -ne 0 -or -not (Test-Path $KeystorePath)) {
    Write-Error "keytool failed to create keystore (exit code $genExit). $genOutput"
    exit 1
  }

  Copy-Item -Path $KeystorePath -Destination $BackupPath -Force

  $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $Bytes = [System.IO.File]::ReadAllBytes($KeystorePath)
  [System.IO.File]::WriteAllText($Base64Path, [Convert]::ToBase64String($Bytes), $Utf8NoBom)

  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $FingerprintOutput = (& $KeytoolPath -list -v `
      -keystore $KeystorePath `
      -storepass:env AWLAD_TMP_KEYSTORE_PASS `
      -alias $Alias 2>&1 | Out-String)
    $listExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }

  if ($listExit -ne 0) {
    Write-Error "Failed to verify generated keystore with keytool (exit code $listExit)."
    exit 1
  }

  $Sha256Match = [regex]::Match($FingerprintOutput, "SHA256:\s*([0-9A-Fa-f:]+)")
  if ($Sha256Match.Success) {
    $Sha256 = $Sha256Match.Groups[1].Value
  }

  $SecretsContent = @"
AWLAD SELIM - Android Production Release Secrets (KEEP STRICTLY OUTSIDE GIT / GITHUB REPO)
=========================================================================================
Keystore File        : $KeystorePath
External Backup      : $BackupPath
Base64 Export File   : $Base64Path
Certificate SHA-256  : $Sha256

GitHub Actions Repository Secrets to configure manually in Settings -> Secrets and variables -> Actions:
1. ANDROID_KEYSTORE_BASE64    = <full single-line contents of $Base64Path>
2. ANDROID_KEYSTORE_PASSWORD  = $StorePassword
3. ANDROID_KEY_ALIAS          = $Alias
4. ANDROID_KEY_PASSWORD       = $KeyPassword

IMPORTANT:
- NEVER upload this file, $KeystorePath, or *.keystore/*.jks/*.p12 to GitHub.
- Previous Debug/old-key APK installs CANNOT be upgraded in-place; uninstall the old APK once before installing the new production-signed APK.
"@
  [System.IO.File]::WriteAllText($SecretsNotePath, $SecretsContent, $Utf8NoBom)
} finally {
  Remove-Item Env:AWLAD_TMP_KEYSTORE_PASS -ErrorAction SilentlyContinue
  $StorePassword = $null
  $KeyPassword = $null
  $SecretsContent = $null
}

Write-Host ""
Write-Host "[OK] Production Keystore created outside project: $KeystorePath" -ForegroundColor Green
Write-Host "[OK] Backup created outside project            : $BackupPath" -ForegroundColor Green
Write-Host "[OK] Base64 saved outside project              : $Base64Path" -ForegroundColor Green
Write-Host "[OK] Secrets & SHA-256 reference saved to      : $SecretsNotePath" -ForegroundColor Yellow
Write-Host "Certificate SHA-256 Fingerprint: $Sha256" -ForegroundColor Cyan
