<#
  PDA BLISS FLOW - EP01 quality gates (local Windows workstation; nothing is exposed publicly).

      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-verify.ps1
      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-verify.ps1 -G09Only
      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-verify.ps1 -SmokeOnly
      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-verify.ps1 -Final

  -Final: closure run. Every gate of the full run EXCEPT dependency installation (G02 uses
  the existing install: npm ls + audit + licences only). Rebuilds everything (API, worker,
  web, showcase). Summary: .qa\ep01\summary-final.txt.

  -G09Only: targeted re-run after the G09 fix. No npm install, no web builds. Rebuilds shared + API,
  then API typecheck, lint, format check, API tests, secret scan and the two-phase G09 smoke.
  Summary goes to .qa\ep01\summary-g09.txt (the full-run summary is left untouched).
  -SmokeOnly: when only the smoke harness changed. Reuses the already verified API build (refuses
  if that build predates the G09 application fix), checks the changed harness files (Prettier,
  ESLint, secret scan), then runs the harness self-test and phases A+B.
  Summary: .qa\ep01\summary-smoke.txt.

  G01 baseline + environment   G02 npm install (adds @line/liff), lockfile, audit, licences
  G03 typecheck   G04 format + lint   G05 all tests (EP00 regression + EP01)
  G06 production + showcase builds (+ dev-page exclusion)
  G08 secret scan (files + full Git history + real secret values vs. builds)
  G09/G10 local smoke on loopback. PowerShell only starts/stops the API + gateway with an
          isolated environment; scripts\ep01-smoke.mjs (Node, no dependencies) sends the probes
          and validates status + documented error code/state (the real secret file is never read):
          A fail-closed: no configuration -> 503s; foreign origins still 403
          B configured with SYNTHETIC per-run values (no LINE calls): origin, media type,
            logout contract, token rejection, webhook signature/destination
  Uses npm.cmd (no execution-policy change). Logs: .qa\ep01\ (git-ignored).
  Never: tunnels, LINE calls with real credentials, commits, pushes, killing other processes.
#>
[CmdletBinding()]
param([switch]$G09Only, [switch]$SmokeOnly, [switch]$Final)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $ProjectRoot
$Qa = Join-Path $ProjectRoot '.qa\ep01'
if (-not (Test-Path -LiteralPath $Qa)) { New-Item -ItemType Directory -Path $Qa -Force | Out-Null }
$Mode = if ($SmokeOnly) { 'smoke' } elseif ($G09Only) { 'g09' } elseif ($Final) { 'final' } else { 'full' }
$Summary = Join-Path $Qa (@{ smoke = 'summary-smoke.txt'; g09 = 'summary-g09.txt'; final = 'summary-final.txt'; full = 'summary.txt' }[$Mode])
"EP01 verification run$(@{ smoke = ' (smoke only)'; g09 = ' (G09 targeted)'; final = ' (final, no reinstall)'; full = '' }[$Mode]): $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')" | Out-File -LiteralPath $Summary -Encoding utf8

function Write-Result([string]$Gate, [string]$Command, [int]$Code, [string]$Status = '') {
  if (-not $Status) { $Status = if ($Code -eq 0) { 'PASS' } else { 'FAIL' } }
  $line = '{0,-5} {1,-7} exit={2,-3} {3}' -f $Gate, $Status, $Code, $Command
  $color = switch ($Status) { 'PASS' { 'Green' } 'SKIPPED' { 'Yellow' } default { 'Red' } }
  Write-Host $line -ForegroundColor $color
  $line | Out-File -LiteralPath $Summary -Append -Encoding utf8
}

function Invoke-Step([string]$Gate, [string]$Name, [string]$Command) {
  $log = Join-Path $Qa "$Name.log"
  Write-Host ">> [$Gate] $Command" -ForegroundColor Cyan
  cmd.exe /d /c "$Command > `"$log`" 2>&1"
  $code = $LASTEXITCODE
  Write-Result $Gate $Command $code
  return $code
}


if ($SmokeOnly) {
  # Only the smoke harness changed: reuse the verified build, check the changed files.
  $routes = Join-Path $ProjectRoot 'apps\api\dist\auth\routes.js'
  if (-not (Test-Path -LiteralPath $routes) -or -not (Select-String -LiteralPath $routes -Pattern 'requireAllowedOrigin' -Quiet)) {
    Write-Result 'G06' 'API build contains the G09 application fix' 1
    Write-Host 'The API build is missing or older than the G09 fix - run with -G09Only instead.' -ForegroundColor Red
    exit 1
  }
  Write-Result 'G06' 'API build contains the G09 application fix (reused, not rebuilt)' 0
  Invoke-Step 'G04' 'smoke-format-check' 'node node_modules/prettier/bin/prettier.cjs --check scripts/ep01-smoke.mjs docs/EP01-REPORT.md docs/EP01-OWNER-CHECKLIST.md' | Out-Null
  Invoke-Step 'G04' 'smoke-lint' 'node node_modules/eslint/bin/eslint.js --max-warnings=0 scripts/ep01-smoke.mjs' | Out-Null
  Invoke-Step 'G08' 'smoke-secrets-files' 'node scripts/check-secrets.mjs' | Out-Null
} elseif ($G09Only) {
  # Targeted: rebuild only what the G09 fix touched (API) on top of the existing install.
  if ((Invoke-Step 'G06' 'g09only-build-shared' 'npm.cmd run build:shared') -ne 0) { exit 1 }
  if ((Invoke-Step 'G06' 'g09only-build-api' 'npm.cmd run build -w @flow/api') -ne 0) { exit 1 }
  Invoke-Step 'G03' 'g09only-typecheck-api' 'npm.cmd run typecheck -w @flow/api' | Out-Null
  Invoke-Step 'G04' 'g09only-lint' 'npm.cmd run lint' | Out-Null
  Invoke-Step 'G04' 'g09only-format-check' 'npm.cmd run format:check' | Out-Null
  Invoke-Step 'G05' 'g09only-test-api' 'npm.cmd run test -w @flow/api' | Out-Null
  Invoke-Step 'G08' 'g09only-secrets-files' 'node scripts/check-secrets.mjs' | Out-Null
} else {
  # ------------------------------------------------------------------ G01
  & {
    "Working directory : $((Get-Location).Path)"
    "Node              : $(& node -v)"
    "npm (npm.cmd)     : $(& cmd.exe /d /c 'npm.cmd -v')"
    "Git               : $(& git --version)"
    "Branch            : $(& git rev-parse --abbrev-ref HEAD)"
    "HEAD              : $(& git rev-parse --short HEAD)"
    & git merge-base --is-ancestor 3c6af13 HEAD 2>$null
    "Contains 3c6af13  : $(if ($LASTEXITCODE -eq 0) { 'yes' } else { 'NO' })"
    "Remote            : $(& git remote get-url origin)"
    '--- status (short) ---'
    & git status --short --branch
    '--- ports ---'
    foreach ($port in @(6767, 6768, 6769)) {
      $l = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
      if ($l) { "port $port : IN USE ($((($l | ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName }) | Sort-Object -Unique) -join ', '))" } else { "port $port : free" }
    }
    '--- external secret file ---'
    $sf = Join-Path $env:USERPROFILE '.pdabliss\flow\dev.env'
    if (Test-Path -LiteralPath $sf) {
      'present (values not shown); keys: ' + ((Get-Content -LiteralPath $sf | Where-Object { $_ -match '^[A-Z][A-Z0-9_]*=' } | ForEach-Object { ($_ -split '=')[0] }) -join ', ')
      '--- ACL ---'
      & icacls.exe (Split-Path $sf) 2>&1
    } else { 'not present (auth/webhook will answer 503 = fail closed)' }
    '--- cloudflared ---'
    $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cf) { & cloudflared --version 2>&1 } else { 'not installed' }
    $cfg = @('config.yml', 'config.yaml') | ForEach-Object { Join-Path $env:USERPROFILE ".cloudflared\$_" } | Where-Object { Test-Path -LiteralPath $_ }
    if ($cfg) { 'NOTE: a cloudflared config file exists in the user profile (Quick Tunnels refuse to start while it is present; it will NOT be modified).' }
  } *>&1 | Out-File -LiteralPath (Join-Path $Qa 'g01-environment.log') -Encoding utf8
  Write-Result 'G01' 'baseline + environment (see .qa\ep01\g01-environment.log)' 0

  # ------------------------------------------------------------------ G02
  if ($Final) {
    Write-Result 'G02' 'npm install skipped (-Final reuses the verified install)' 0 'SKIPPED'
  } elseif ((Invoke-Step 'G02' 'g02-npm-install' 'npm.cmd install --no-fund') -ne 0) { Write-Host 'npm install failed; stopping.' -ForegroundColor Red; exit 1 }
  Invoke-Step 'G02' 'g02-npm-ls' 'npm.cmd ls --depth=0' | Out-Null
  Invoke-Step 'G02' 'g02-npm-audit' 'npm.cmd audit' | Out-Null
  Invoke-Step 'G02' 'g02-licenses' 'node scripts/list-licenses.mjs' | Out-Null
  Invoke-Step 'G02' 'g02-liff-version' 'node -p "require(''./node_modules/@line/liff/package.json'').version"' | Out-Null

  # ------------------------------------------------------------------ G03-G06
  Invoke-Step 'G03' 'g03-typecheck' 'npm.cmd run typecheck' | Out-Null
  Invoke-Step 'G04' 'g04-format-apply' 'npm.cmd run format' | Out-Null
  Invoke-Step 'G04' 'g04-lint' 'npm.cmd run lint' | Out-Null
  Invoke-Step 'G04' 'g04-format-check' 'npm.cmd run format:check' | Out-Null
  Invoke-Step 'G05' 'g05-test' 'npm.cmd run test' | Out-Null
  Invoke-Step 'G06' 'g06-build' 'npm.cmd run build' | Out-Null
  Invoke-Step 'G06' 'g06-build-showcase' 'npm.cmd run build:showcase' | Out-Null

  # ------------------------------------------------------------------ G08
  Invoke-Step 'G08' 'g08-secrets-files' 'node scripts/check-secrets.mjs' | Out-Null
  Invoke-Step 'G08' 'g08-secrets-history' 'node scripts/check-secrets.mjs --history' | Out-Null
  Invoke-Step 'G08' 'g08-secret-values' 'node scripts/check-secret-values.mjs' | Out-Null

}

# ------------------------------------------------------------------ G09/G10 local smoke
# PowerShell: process orchestration + isolated environment only.
# scripts\ep01-smoke.mjs: every HTTP probe and assertion (status + JSON error code/state).
$smoke = Join-Path $Qa (@{ smoke = 'smoke-only-smoke.log'; g09 = 'g09only-smoke.log'; final = 'final-smoke.log'; full = 'g09-smoke.log' }[$Mode])
"G09 smoke $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')" | Out-File -LiteralPath $smoke -Encoding utf8
$script:smokeFail = 0
$ENV_KEYS = @('LINE_LOGIN_CHANNEL_ID', 'LINE_MESSAGING_CHANNEL_ID', 'LINE_LIFF_ID', 'LINE_MESSAGING_CHANNEL_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_BOT_USER_ID', 'SESSION_SECRET', 'FLOW_ALLOWED_LINE_USER_IDS', 'PUBLIC_BASE_URL',
  'CORS_ORIGINS', 'NODE_ENV', 'FLOW_ENV_FILE', 'FLOW_SECRET_DIR', 'API_PORT', 'GATEWAY_PORT',
  'SMOKE_CHANNEL_SECRET', 'SMOKE_BOT_USER_ID', 'SMOKE_LIFF_ID')

function Smoke-Log([string]$m) { $m | Out-File -LiteralPath $smoke -Append -Encoding utf8 }

function New-RandomHex([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}

# Runs the Node harness; its stdout/stderr go to the smoke log. Returns the harness exit code.
function Invoke-Harness([string]$HarnessArgs) {
  $out = Join-Path $Qa 'smoke-harness.tmp'
  cmd.exe /d /c "node scripts\ep01-smoke.mjs $HarnessArgs > `"$out`" 2>&1"
  $code = $LASTEXITCODE
  Get-Content -LiteralPath $out -Encoding UTF8 | Out-File -LiteralPath $smoke -Append -Encoding utf8
  Remove-Item -LiteralPath $out -ErrorAction SilentlyContinue
  Smoke-Log "harness exit=$code"
  return $code
}

function Set-ChildEnv([hashtable]$Vars) {
  $saved = @{}
  foreach ($k in $ENV_KEYS) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process'); [Environment]::SetEnvironmentVariable($k, $null, 'Process') }
  foreach ($k in $Vars.Keys) { [Environment]::SetEnvironmentVariable($k, [string]$Vars[$k], 'Process') }
  return $saved
}
function Restore-Env([hashtable]$Saved) { foreach ($k in $ENV_KEYS) { [Environment]::SetEnvironmentVariable($k, $Saved[$k], 'Process') } }

function Invoke-SmokePhase([string]$Phase, [hashtable]$ServerVars, [hashtable]$HarnessVars) {
  Smoke-Log ''
  $busy = @(6768, 6769) | Where-Object { Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue }
  if ($busy) { Smoke-Log "BAD  port(s) $($busy -join ', ') in use - phase $Phase not run (other processes left untouched)"; $script:smokeFail++; return }
  $tag = $Phase.ToLower()
  $procs = @()
  $saved = Set-ChildEnv $ServerVars
  try {
    $procs += Start-Process -FilePath 'node' -ArgumentList '"apps\api\dist\server.js"' -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Qa "smoke-$tag-api.log") -RedirectStandardError (Join-Path $Qa "smoke-$tag-api.err.log")
    $procs += Start-Process -FilePath 'node' -ArgumentList '"apps\api\dist\gateway.js"' -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Qa "smoke-$tag-gateway.log") -RedirectStandardError (Join-Path $Qa "smoke-$tag-gateway.err.log")
  } finally { Restore-Env $saved }
  try {
    # The harness waits for /api/health itself (bounded), then probes.
    $saved = Set-ChildEnv $HarnessVars
    try { $code = Invoke-Harness "--phase $Phase --wait-ms 20000" } finally { Restore-Env $saved }
    if ($code -ne 0) { $script:smokeFail++ }
  } finally {
    foreach ($p in $procs) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -ErrorAction SilentlyContinue } }
    for ($i = 0; $i -lt 20; $i++) {
      if (-not (@(6768, 6769) | Where-Object { Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue })) { break }
      Start-Sleep -Milliseconds 250
    }
  }
}

# Harness self-test: proves error bodies (Content-Length and chunked) are read and that wrong
# codes/states/statuses are detected. No servers of ours involved.
Smoke-Log '=== Harness self-test ==='
if ((Invoke-Harness '--self-test') -ne 0) { $script:smokeFail++ }

# Isolated per-run temp dir: never the real secret file, never the OneDrive project folder.
$tmp = Join-Path $env:TEMP ("flow-g09-" + (New-RandomHex 6))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$noFile = Join-Path $tmp 'absent.env'   # deliberately missing -> no secrets loaded
try {
  # Phase A: fail-closed (nothing configured)
  Invoke-SmokePhase 'A' @{ FLOW_ENV_FILE = $noFile; FLOW_SECRET_DIR = $tmp } @{}

  # Phase B: configured with synthetic per-run values (no LINE network calls)
  $chSecret = New-RandomHex 16      # 32 hex chars, generated now, never stored
  $botId = 'U' + (New-RandomHex 16)
  $liffId = '1000000001-SYNTHTST'
  Invoke-SmokePhase 'B' @{
    FLOW_ENV_FILE = $noFile; FLOW_SECRET_DIR = $tmp
    LINE_LOGIN_CHANNEL_ID = '1000000001'; LINE_LIFF_ID = $liffId
    SESSION_SECRET = (New-RandomHex 32); LINE_MESSAGING_CHANNEL_SECRET = $chSecret; LINE_BOT_USER_ID = $botId
  } @{ SMOKE_CHANNEL_SECRET = $chSecret; SMOKE_BOT_USER_ID = $botId; SMOKE_LIFF_ID = $liffId }
  Smoke-Log ''
  Smoke-Log 'Not covered here (needs a real LINE session): missing/invalid/valid CSRF on an active session -> G05 API tests (auth.test.ts).'
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Result 'G09' "local smoke: harness self-test + phases A+B (see .qa\ep01\$(Split-Path $smoke -Leaf))" $script:smokeFail

Write-Host ''
Write-Host "Done. Summary: $Summary" -ForegroundColor Cyan
Get-Content -LiteralPath $Summary
