<#
  PDA BLISS FLOW - EP01 owner-approved real LINE integration session.

  START (only after you approve temporary public exposure):
      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-integration.ps1 -Start -IApprovePublicExposure
  STATUS:
      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-integration.ps1 -Status
  STOP (always run when finished):
      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-integration.ps1 -Stop

  What -Start does, in this order (fails closed at every step):
    1. Checks: built API + web exist, secret file present with LINE Login, LIFF, channel secret,
       cloudflared installed, no cloudflared config file in your profile (Quick Tunnels refuse it).
    2. Starts the FLOW dev gateway on 127.0.0.1:6769 (allow-listed routes only).
    3. Starts a Cloudflare QUICK tunnel -> 127.0.0.1:6769 (temporary random trycloudflare.com URL).
       Never touches the company production tunnel, DNS, PM2 or firewall.
    4. Starts the API on 127.0.0.1:6768 with PUBLIC_BASE_URL = that tunnel URL.
    5. Prints the LIFF Endpoint URL and Webhook URL for you to paste into LINE Developers.
  -Stop stops ONLY the processes recorded by -Start (verified by PID + start time).
#>
[CmdletBinding()]
param([switch]$Start, [switch]$Stop, [switch]$Status, [switch]$IApprovePublicExposure)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $ProjectRoot
$RunDir = Join-Path $ProjectRoot '.qa\ep01\run'
$State = Join-Path $RunDir 'processes.json'
if (-not (Test-Path -LiteralPath $RunDir)) { New-Item -ItemType Directory -Path $RunDir -Force | Out-Null }

function Fail([string]$m) { Write-Host $m -ForegroundColor Red; exit 1 }

function Read-State { if (Test-Path -LiteralPath $State) { Get-Content -LiteralPath $State -Raw | ConvertFrom-Json } else { $null } }

function Stop-Recorded {
  $s = Read-State
  if (-not $s) { Write-Host 'Nothing recorded - nothing to stop.'; return }
  foreach ($p in $s.processes) {
    $proc = Get-Process -Id $p.pid -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq $p.name -and $proc.StartTime.ToString('o') -eq $p.started) {
      Stop-Process -Id $p.pid -ErrorAction SilentlyContinue
      Write-Host "Stopped $($p.role) (pid $($p.pid))."
    } else {
      Write-Host "$($p.role) (pid $($p.pid)) is no longer ours or already stopped - left untouched."
    }
  }
  Remove-Item -LiteralPath $State -ErrorAction SilentlyContinue
  Write-Host ''
  Write-Host 'Tunnel closed. In LINE Developers, now:' -ForegroundColor Yellow
  Write-Host '  - Messaging API channel > Messaging API tab > Webhook settings: turn OFF "Use webhook".'
  Write-Host '  - Keep the LINE Login channel in "Developing".'
  Write-Host '  - LIFF Endpoint URL may stay as the dead tunnel URL or be set back to https://flow.pdabliss.com/ .'
}

if ($Stop) { Stop-Recorded; exit 0 }

if ($Status) {
  $s = Read-State
  if (-not $s) { Write-Host 'No integration session recorded.'; exit 0 }
  Write-Host "Tunnel URL : $($s.publicBaseUrl)"
  foreach ($p in $s.processes) {
    $alive = Get-Process -Id $p.pid -ErrorAction SilentlyContinue
    Write-Host ("{0,-8} pid {1,-6} {2}" -f $p.role, $p.pid, $(if ($alive) { 'running' } else { 'stopped' }))
  }
  exit 0
}

if (-not $Start) { Get-Help $MyInvocation.MyCommand.Path; exit 0 }
if (-not $IApprovePublicExposure) { Fail 'Public exposure needs your explicit approval: add -IApprovePublicExposure.' }
if (Read-State) { Fail 'A session is already recorded. Run -Stop first.' }

# ---- 1. preflight ------------------------------------------------------------
foreach ($f in @('apps\api\dist\server.js', 'apps\api\dist\gateway.js', 'apps\web\dist\index.html')) {
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $f))) { Fail "Missing $f - run scripts\ep01-verify.ps1 first." }
}
$secretFile = Join-Path $env:USERPROFILE '.pdabliss\flow\dev.env'
if (-not (Test-Path -LiteralPath $secretFile)) { Fail 'No secret file - run scripts\ep01-setup-secrets.ps1 first.' }
$keys = Get-Content -LiteralPath $secretFile | Where-Object { $_ -match '^[A-Z][A-Z0-9_]*=.+' } | ForEach-Object { ($_ -split '=')[0] }
foreach ($k in @('LINE_LOGIN_CHANNEL_ID', 'LINE_LIFF_ID', 'LINE_MESSAGING_CHANNEL_SECRET', 'SESSION_SECRET')) {
  if ($keys -notcontains $k) { Fail "Secret file is missing $k - rerun scripts\ep01-setup-secrets.ps1." }
}
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) { Fail 'cloudflared is not installed. Install it yourself (e.g. winget install --id Cloudflare.cloudflared), then retry.' }
$cfg = @('config.yml', 'config.yaml') | ForEach-Object { Join-Path $env:USERPROFILE ".cloudflared\$_" } | Where-Object { Test-Path -LiteralPath $_ }
if ($cfg) { Fail "A cloudflared config exists at $cfg. Quick Tunnels refuse to run while it is present; this script will not modify it. Decide yourself whether to move it temporarily." }
foreach ($port in @(6768, 6769)) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { Fail "Port $port is in use - stop that service first (not done automatically)." }
}

$records = @()
function Track($proc, [string]$role) {
  $p = Get-Process -Id $proc.Id
  $script:records += [pscustomobject]@{ role = $role; pid = $p.Id; name = $p.ProcessName; started = $p.StartTime.ToString('o') }
  [pscustomobject]@{ publicBaseUrl = $script:publicUrl; processes = $script:records } | ConvertTo-Json -Depth 4 | Out-File -LiteralPath $State -Encoding utf8
}
$publicUrl = $null

try {
  # ---- 2. gateway (secured first) ---------------------------------------------
  $gw = Start-Process -FilePath 'node' -ArgumentList '"apps\api\dist\gateway.js"' -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $RunDir 'gateway.log') -RedirectStandardError (Join-Path $RunDir 'gateway.err.log')
  Track $gw 'gateway'

  # ---- 3. quick tunnel ---------------------------------------------------------
  $cfLog = Join-Path $RunDir 'cloudflared.log'
  $tunnel = Start-Process -FilePath $cf.Source -ArgumentList 'tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:6769' -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $RunDir 'cloudflared.out.log') -RedirectStandardError $cfLog
  Track $tunnel 'tunnel'
  for ($i = 0; $i -lt 60 -and -not $publicUrl; $i++) {
    Start-Sleep -Milliseconds 500
    $text = (Get-Content -LiteralPath $cfLog -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath (Join-Path $RunDir 'cloudflared.out.log') -Raw -ErrorAction SilentlyContinue)
    if ($text -match '(https://[a-z0-9-]+\.trycloudflare\.com)') { $publicUrl = $Matches[1] }
  }
  if (-not $publicUrl) { throw 'Quick tunnel URL not received within 30 s (see .qa\ep01\run\cloudflared.log).' }

  # ---- 4. API with the tunnel origin -------------------------------------------
  $env:PUBLIC_BASE_URL = $publicUrl
  $api = Start-Process -FilePath 'node' -ArgumentList '"apps\api\dist\server.js"' -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $RunDir 'api.log') -RedirectStandardError (Join-Path $RunDir 'api.err.log')
  Remove-Item Env:\PUBLIC_BASE_URL
  Track $api 'api'
  $ok = $false
  for ($i = 0; $i -lt 30 -and -not $ok; $i++) { Start-Sleep -Milliseconds 500; try { $ok = (Invoke-WebRequest -Uri 'http://127.0.0.1:6769/api/health' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { } }
  if (-not $ok) { throw 'API did not become healthy (see .qa\ep01\run\api.err.log).' }
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Stop-Recorded
  exit 1
}

Write-Host ''
Write-Host 'Temporary integration session is LIVE.' -ForegroundColor Green
Write-Host "  LIFF Endpoint URL : $publicUrl/"
Write-Host "  Webhook URL       : $publicUrl/api/line/webhook"
Write-Host ''
Write-Host 'Paste these into LINE Developers (see docs\EP01-OWNER-CHECKLIST.md), test, then run:'
Write-Host '  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-integration.ps1 -Stop'
