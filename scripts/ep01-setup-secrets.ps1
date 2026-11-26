<#
  PDA BLISS FLOW - EP01 local secret setup (run on the owner's Windows workstation).

      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-setup-secrets.ps1

  Creates %USERPROFILE%\.pdabliss\flow\dev.env OUTSIDE the project and OneDrive, restricts
  the folder to the current Windows user, and asks for each value locally.
  Secrets are typed into hidden prompts and are never printed, logged or sent anywhere.
  Re-running keeps existing values unless you choose to replace them.
#>
[CmdletBinding()]
param([string]$Dir = (Join-Path $env:USERPROFILE '.pdabliss\flow'))

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$Dir = [System.IO.Path]::GetFullPath($Dir)

function Fail([string]$m) { Write-Host $m -ForegroundColor Red; exit 1 }

# --- location safety -------------------------------------------------------------
$unsafe = @()
if ($Dir.StartsWith($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) { $unsafe += 'inside the project' }
foreach ($seg in $Dir.Split([char[]]@('\', '/'))) { if ($seg -match '^(one ?drive.*|dropbox|google ?drive|my ?drive|icloud ?drive|icloud)$') { $unsafe += 'inside a synced folder'; break } }
foreach ($v in @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial)) {
  if ($v -and $Dir.StartsWith([System.IO.Path]::GetFullPath($v), [System.StringComparison]::OrdinalIgnoreCase)) { $unsafe += 'inside OneDrive'; break }
}
if ($unsafe.Count -gt 0) { Fail "Refusing to store secrets at $Dir ($($unsafe -join ', '))." }

# --- folder + ACL (current user only) --------------------------------------------
if (-not (Test-Path -LiteralPath $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
$who = "$env:USERDOMAIN\$env:USERNAME"
& icacls.exe $Dir /inheritance:r /grant:r "${who}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Could not restrict folder permissions (icacls).' }
$File = Join-Path $Dir 'dev.env'

# --- existing values (names only are ever shown) --------------------------------
$values = [ordered]@{}
if (Test-Path -LiteralPath $File) {
  foreach ($line in [System.IO.File]::ReadAllLines($File)) {
    if ($line -match '^\s*([A-Z][A-Z0-9_]*)=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim() }
  }
}

function Read-Plain([string]$name, [string]$default, [string]$pattern) {
  $current = if ($values.Contains($name)) { $values[$name] } else { $default }
  $answer = Read-Host "$name [$current]"
  if (-not $answer) { $answer = $current }
  if ($pattern -and $answer -notmatch $pattern) { Fail "$name has an unexpected format." }
  $values[$name] = $answer
}

function Read-Secret([string]$name, [string]$pattern, [bool]$optional) {
  $has = $values.Contains($name) -and $values[$name]
  $label = if ($has) { "$name (already set - press Enter to keep)" } elseif ($optional) { "$name (optional - Enter to skip)" } else { $name }
  $sec = Read-Host -AsSecureString $label
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  if (-not $plain) {
    if ($has -or $optional) { return }
    Fail "$name is required."
  }
  $plain = $plain.Trim()
  if ($pattern -and $plain -notmatch $pattern) { Fail "$name has an unexpected format (value not shown)." }
  $values[$name] = $plain
}

Write-Host 'Public identifiers (press Enter to accept the value in brackets):' -ForegroundColor Cyan
Read-Plain 'LINE_LOGIN_CHANNEL_ID' '2012804685' '^\d{10}$'
Read-Plain 'LINE_MESSAGING_CHANNEL_ID' '2012804462' '^\d{10}$'
Read-Plain 'LINE_LIFF_ID' '2012804685-QPWPdFGL' '^\d{10}-[A-Za-z0-9]{8}$'

Write-Host 'Secrets (input is hidden):' -ForegroundColor Cyan
Read-Secret 'LINE_MESSAGING_CHANNEL_SECRET' '^[0-9a-f]{32}$' $false
Read-Secret 'LINE_CHANNEL_ACCESS_TOKEN' '^[A-Za-z0-9+/=._-]{40,}$' $true

if (-not ($values.Contains('SESSION_SECRET') -and $values['SESSION_SECRET'])) {
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $values['SESSION_SECRET'] = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  Write-Host 'SESSION_SECRET generated.' -ForegroundColor Green
}

$lines = @('# PDA BLISS FLOW dev secrets - local only. Never copy into the project, chat or screenshots.')
foreach ($k in $values.Keys) { if ($values[$k]) { $lines += "$k=$($values[$k])" } }
[System.IO.File]::WriteAllText($File, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
& icacls.exe $File /inheritance:r /grant:r "${who}:F" | Out-Null

Write-Host ''
Write-Host "Saved: $File" -ForegroundColor Green
Write-Host ("Keys set: " + (($values.Keys | Where-Object { $values[$_] }) -join ', '))
Write-Host 'Access is restricted to this Windows account. Values were not displayed.'
