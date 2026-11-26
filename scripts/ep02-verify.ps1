<#
  PDA BLISS FLOW - EP02 consolidated verification (local Windows workstation only).

      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep02-verify.ps1

  Every gate reports PASS / FAIL / SKIPPED / BLOCKED. A mandatory gate that cannot run is
  BLOCKED, never PASS. Exit code: 0 only when every mandatory gate passed; 1 on any FAIL;
  2 when nothing failed but something mandatory was BLOCKED.

  V01 environment + Git baseline (4421d6f ancestor) + MariaDB service + secret files (keys only)
  V02 dependencies: npm ci if missing; strict npm tree check; both npm audits
  V03 database safety: guarded names (db.mjs whoami dev/test) - never production, never reset
  V04 Prisma: validate, generate, migrate status, deploy to TEST, drift (committed migrations
      vs schema via the shadow database)
  V05 typecheck   V06 format (apply + check) + lint
  V07 regression tests (all workspaces, MemoryStore + pure)
  V08 MariaDB integration tests on pdabliss_flow_test (store contract, 9-role matrix, scenarios)
  V09 production + showcase builds (+ dev-page exclusion)
  V10 secret scans: files, full Git history, real secret values vs. builds
  V11 smoke on loopback: A fail-closed (no DB), B configured on the TEST database (synthetic
      LINE values, no LINE calls), C database unreachable -> API refuses to start (E14)
  Logs: .qa\ep02\ (git-ignored). Uses npm.cmd. Never: tunnels, LINE calls with real
  credentials, real messages, commits, pushes, killing other processes, touching pdabliss_flow.
#>
[CmdletBinding()]
param([switch]$SkipInstall)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $ProjectRoot
$Qa = Join-Path $ProjectRoot '.qa\ep02'
if (-not (Test-Path -LiteralPath $Qa)) { New-Item -ItemType Directory -Path $Qa -Force | Out-Null }
$Summary = Join-Path $Qa 'summary.txt'
"EP02 verification run: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')" | Out-File -LiteralPath $Summary -Encoding utf8
$SecretDir = if ($env:FLOW_SECRET_DIR) { $env:FLOW_SECRET_DIR } else { Join-Path $env:USERPROFILE '.pdabliss\flow' }
$script:fail = 0
$script:blocked = 0
$NpmVerify = 'npm.cmd exec --yes --package=npm@11.21.3 -- npm'
$env:CI = 'true'

function Write-Result([string]$Gate, [string]$Command, [int]$Code, [string]$Status = '') {
  if (-not $Status) { $Status = if ($Code -eq 0) { 'PASS' } else { 'FAIL' } }
  if ($Status -eq 'FAIL') { $script:fail++ }
  if ($Status -eq 'BLOCKED') { $script:blocked++ }
  $line = '{0,-4} {1,-8} exit={2,-3} {3}' -f $Gate, $Status, $Code, $Command
  $color = switch ($Status) { 'PASS' { 'Green' } 'SKIPPED' { 'Yellow' } 'WARN' { 'Yellow' } 'BLOCKED' { 'Magenta' } default { 'Red' } }
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
function Read-EnvKeys([string]$file) {
  $h = @{}
  if (Test-Path -LiteralPath $file) {
    foreach ($l in Get-Content -LiteralPath $file -Encoding UTF8) { if ($l -match '^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$') { $h[$Matches[1]] = $Matches[2].Trim('"', "'") } }
  }
  return $h
}

# ------------------------------------------------------------------ V01
$dev = Read-EnvKeys (Join-Path $SecretDir 'dev.env')
$test = Read-EnvKeys (Join-Path $SecretDir 'test.env')
$haveDb = [bool]($dev.DATABASE_URL -and $dev.DATABASE_MIGRATE_URL -and $test.TEST_DATABASE_URL)
$nodeVersion = & node -v
$npmVersion = & cmd.exe /d /c 'npm.cmd -v'
$branch = & git rev-parse --abbrev-ref HEAD
& git merge-base --is-ancestor 4421d6f HEAD 2>$null
$hasBaseline = $LASTEXITCODE -eq 0
$maria = @(Get-Service -ErrorAction SilentlyContinue | Where-Object {
  ($_.Name -match '(?i)^(mariadb|mysql)' -or $_.DisplayName -match '(?i)mariadb') -and $_.Status -eq 'Running'
})
& {
  "Working directory : $((Get-Location).Path)"
  "Windows           : $([Environment]::OSVersion.VersionString)"
  "Node              : $nodeVersion"
  "npm (npm.cmd)     : $npmVersion"
  "Git               : $(& git --version)"
  "Branch            : $branch"
  "HEAD              : $(& git rev-parse --short HEAD)"
  "Contains 4421d6f  : $hasBaseline"
  '--- status (short) ---'
  & git status --short --branch
  '--- ports ---'
  foreach ($port in @(6767, 6768, 6769, 3306)) {
    $l = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($l) { "port $port : IN USE ($((($l | ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName }) | Sort-Object -Unique) -join ', '))" } else { "port $port : free" }
  }
  '--- MariaDB service ---'
  $maria | ForEach-Object { "$($_.Name): $($_.Status)" }
  '--- external secret files (key names only) ---'
  "dev.env  keys: $((@($dev.Keys) | Sort-Object) -join ', ')"
  "test.env keys: $((@($test.Keys) | Sort-Object) -join ', ')"
} *>&1 | Out-File -LiteralPath (Join-Path $Qa 'v01-environment.log') -Encoding utf8
$environmentOk = $nodeVersion -match '^v\d+\.\d+\.\d+$' -and $npmVersion -match '^\d+\.\d+\.\d+$' -and $branch -eq 'main' -and $hasBaseline -and $maria.Count -gt 0
Write-Result 'V01' 'Windows tools, main baseline and MariaDB service (see v01-environment.log)' ([int](-not $environmentOk))

# ------------------------------------------------------------------ V02
$needInstall = -not (Test-Path -LiteralPath 'node_modules\prisma\package.json') -or -not (Test-Path -LiteralPath 'node_modules\@prisma\adapter-mariadb\package.json') -or -not (Select-String -LiteralPath 'package-lock.json' -Pattern '"node_modules/@prisma/client"' -Quiet)
if ($needInstall) {
  if ($SkipInstall) {
    Write-Result 'V02' 'npm ci required for missing dependencies, suppressed by -SkipInstall' 2 'BLOCKED'
    exit 2
  }
  if ((Invoke-Step 'V02' 'v02-npm-install' "$NpmVerify ci --no-fund") -ne 0) { exit 1 }
} else { Write-Result 'V02' 'npm ci skipped because Prisma dependencies are present; the tree is checked below' 0 'SKIPPED' }
Invoke-Step 'V02' 'v02-npm-version' "$NpmVerify --version" | Out-Null
Invoke-Step 'V02' 'v02-npm-ls' "$NpmVerify ls --all" | Out-Null
Invoke-Step 'V02' 'v02-effect' "$NpmVerify ls effect" | Out-Null
Invoke-Step 'V02' 'v02-prisma-versions' 'node -p "[''prisma'',''@prisma/client'',''@prisma/adapter-mariadb''].map(p=>p+''@''+require(''./node_modules/''+p+''/package.json'').version).join('' '')"' | Out-Null
Invoke-Step 'V02' 'v02-npm-audit-full' "$NpmVerify audit --audit-level=low" | Out-Null
Invoke-Step 'V02' 'v02-npm-audit' "$NpmVerify audit --omit=dev --audit-level=low" | Out-Null
Invoke-Step 'V02' 'v02-licenses' 'node scripts/list-licenses.mjs' | Out-Null

# ------------------------------------------------------------------ V03 / V04
if (-not $haveDb) {
  Write-Result 'V03' 'database safety (no DATABASE_URL / TEST_DATABASE_URL - run scripts\ep02-db-setup.ps1)' 0 'BLOCKED'
  Write-Result 'V04' 'Prisma migrations (blocked: no database configured)' 0 'BLOCKED'
} else {
  Invoke-Step 'V03' 'v03-whoami-dev' 'node scripts/db.mjs whoami dev' | Out-Null
  Invoke-Step 'V03' 'v03-whoami-test' 'node scripts/db.mjs whoami test' | Out-Null
  Invoke-Step 'V04' 'v04-validate' 'node scripts/db.mjs validate' | Out-Null
  Invoke-Step 'V04' 'v04-generate' 'node scripts/db.mjs generate' | Out-Null
  Invoke-Step 'V04' 'v04-status-dev' 'node scripts/db.mjs status dev' | Out-Null
  Invoke-Step 'V04' 'v04-deploy-test' 'node scripts/db.mjs deploy test' | Out-Null
  Invoke-Step 'V04' 'v04-status-test' 'node scripts/db.mjs status test' | Out-Null
  if ($dev.SHADOW_DATABASE_URL) { Invoke-Step 'V04' 'v04-drift' 'node scripts/db.mjs drift' | Out-Null }
  else { Write-Result 'V04' 'drift check (no SHADOW_DATABASE_URL)' 0 'BLOCKED' }
}

# ------------------------------------------------------------------ V05-V07
Invoke-Step 'V05' 'v05-typecheck' 'npm.cmd run typecheck' | Out-Null
Invoke-Step 'V06' 'v06-format-apply' 'npm.cmd run format' | Out-Null
Invoke-Step 'V06' 'v06-format-check' 'npm.cmd run format:check' | Out-Null
$v1Hash = (Get-FileHash -LiteralPath 'apps/api/src/http/v1.ts').Hash
Invoke-Step 'V06' 'v06-format-apply-repeat' 'npm.cmd run format' | Out-Null
Invoke-Step 'V06' 'v06-format-check-repeat' 'npm.cmd run format:check' | Out-Null
Write-Result 'V06' 'v1.ts SHA-256 unchanged on second formatting pass' ([int]($v1Hash -ne (Get-FileHash -LiteralPath 'apps/api/src/http/v1.ts').Hash))
Invoke-Step 'V06' 'v06-lint' 'npm.cmd run lint' | Out-Null
Invoke-Step 'V07' 'v07-test' 'npm.cmd run test' | Out-Null

# ------------------------------------------------------------------ V08 real MariaDB
if ($haveDb) { Invoke-Step 'V08' 'v08-test-db' 'npm.cmd run test:db' | Out-Null }
else { Write-Result 'V08' 'MariaDB integration tests (no TEST_DATABASE_URL)' 0 'BLOCKED' }

# ------------------------------------------------------------------ V09 / V10
Invoke-Step 'V09' 'v09-build' 'npm.cmd run build' | Out-Null
Invoke-Step 'V09' 'v09-build-showcase' 'npm.cmd run build:showcase' | Out-Null
Invoke-Step 'V10' 'v10-secrets-files' 'npm.cmd run check:secrets' | Out-Null
Invoke-Step 'V10' 'v10-secrets-history' 'npm.cmd run check:secrets:history' | Out-Null
Invoke-Step 'V10' 'v10-secret-values' 'node scripts/check-secret-values.mjs' | Out-Null

# ------------------------------------------------------------------ V11 smoke
$smoke = Join-Path $Qa 'v11-smoke.log'
"V11 smoke $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')" | Out-File -LiteralPath $smoke -Encoding utf8
$script:smokeFail = 0
$ENV_KEYS = @('LINE_LOGIN_CHANNEL_ID', 'LINE_MESSAGING_CHANNEL_ID', 'LINE_LIFF_ID', 'LINE_MESSAGING_CHANNEL_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_BOT_USER_ID', 'SESSION_SECRET', 'FLOW_ALLOWED_LINE_USER_IDS', 'PUBLIC_BASE_URL',
  'CORS_ORIGINS', 'NODE_ENV', 'FLOW_ENV_FILE', 'FLOW_SECRET_DIR', 'API_HOST', 'API_PORT', 'GATEWAY_PORT', 'DATABASE_URL', 'FLOW_DB_PURPOSE',
  'SMOKE_CHANNEL_SECRET', 'SMOKE_BOT_USER_ID', 'SMOKE_LIFF_ID')
function Smoke-Log([string]$m) { $m | Out-File -LiteralPath $smoke -Append -Encoding utf8 }
function New-RandomHex([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}
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
function Wait-PortsFree { for ($i = 0; $i -lt 20; $i++) { if (-not (@(6768, 6769) | Where-Object { Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue })) { return }; Start-Sleep -Milliseconds 250 } }
function Invoke-SmokePhase([string]$Phase, [hashtable]$ServerVars, [hashtable]$HarnessVars) {
  Smoke-Log ''
  $busy = @(6768, 6769) | Where-Object { Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue }
  if ($busy) { Smoke-Log "BAD  port(s) $($busy -join ', ') in use - phase $Phase not run (other processes left untouched)"; $script:smokeFail++; return }
  $tag = $Phase.ToLower(); $procs = @()
  try {
    $saved = Set-ChildEnv $ServerVars
    try {
      $procs += Start-Process -FilePath 'node' -ArgumentList '"apps\api\dist\server.js"' -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Qa "smoke-$tag-api.log") -RedirectStandardError (Join-Path $Qa "smoke-$tag-api.err.log") -ErrorAction Stop
      $procs += Start-Process -FilePath 'node' -ArgumentList '"apps\api\dist\gateway.js"' -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Qa "smoke-$tag-gateway.log") -RedirectStandardError (Join-Path $Qa "smoke-$tag-gateway.err.log") -ErrorAction Stop
    } finally { Restore-Env $saved }
    $saved = Set-ChildEnv $HarnessVars
    try { $code = Invoke-Harness "--phase $Phase --wait-ms 20000" } finally { Restore-Env $saved }
    if ($code -ne 0) { $script:smokeFail++ }
  } catch {
    Smoke-Log "BAD  phase $Phase process or harness failed"
    $script:smokeFail++
  } finally {
    foreach ($p in $procs) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -ErrorAction SilentlyContinue } }
    Wait-PortsFree
  }
}

function Test-ApiListening {
  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  return [bool]($listeners | Where-Object { $_.Port -eq 6768 })
}

function Invoke-StartupRefusal([string]$NoFile, [string]$TempDir) {
  Smoke-Log ''; Smoke-Log '=== Phase C: database unreachable (E14) ==='
  if (Test-ApiListening) { Smoke-Log 'BAD  API port already in use'; $script:smokeFail++; return }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = (Get-Command node.exe -ErrorAction Stop).Source
  $info.Arguments = 'apps\api\dist\server.js'
  $info.WorkingDirectory = $ProjectRoot
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  $started = $false
  try {
    $saved = Set-ChildEnv @{ FLOW_ENV_FILE = $NoFile; FLOW_SECRET_DIR = $TempDir; NODE_ENV = 'test'; FLOW_DB_PURPOSE = 'test'; DATABASE_URL = 'mysql://flow_test:unreachable@127.0.0.1:1/pdabliss_flow_test'; LINE_LOGIN_CHANNEL_ID = '1000000001'; LINE_LIFF_ID = '1000000001-SYNTHTST'; SESSION_SECRET = (New-RandomHex 32) }
    try { $started = $process.Start() } finally { Restore-Env $saved }
    if (-not $started) { throw 'Node did not start' }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    $listened = $false
    do {
      if (Test-ApiListening) { $listened = $true }
      $exited = $process.WaitForExit(100)
    } while (-not $exited -and $deadline.ElapsedMilliseconds -lt 30000)
    if (Test-ApiListening) { $listened = $true }
    $code = if ($exited) { $process.ExitCode } else { 'unavailable' }
    $expected = $exited -and [string]::IsNullOrWhiteSpace($stdout.Result) -and $stderr.Result.Trim() -ceq 'FLOW API not started: database check failed for 127.0.0.1:1/pdabliss_flow_test (connection refused or not ready). Start MariaDB or run scripts/ep02-db-setup.ps1.'
    if ($exited -and $code -eq 1 -and $expected -and -not $listened) {
      Smoke-Log "OK   API refused to start (exit $code); confirmed sanitized database failure and no listening port"
    } else {
      Smoke-Log "BAD  startup refusal (exited=$exited exit=$code sanitizedReason=$expected listened=$listened)"
      $script:smokeFail++
    }
  } catch {
    Smoke-Log 'BAD  Phase C process or exit verification failed'
    $script:smokeFail++
  } finally {
    if ($started -and -not $process.HasExited) { $process.Kill(); $null = $process.WaitForExit(5000) }
    $process.Dispose()
  }
}

Smoke-Log '=== Harness self-test ==='
if ((Invoke-Harness '--self-test') -ne 0) { $script:smokeFail++ }
$tmp = Join-Path $env:TEMP ("flow-ep02-" + (New-RandomHex 6))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$noFile = Join-Path $tmp 'absent.env'
try {
  # A: nothing configured (no LINE, no database) -> every auth/app route answers 503.
  Invoke-SmokePhase 'A' @{ FLOW_ENV_FILE = $noFile; FLOW_SECRET_DIR = $tmp } @{}
  if ($haveDb) {
    # B: synthetic LINE values + the TEST database (guarded: pdabliss_flow_test only).
    $chSecret = New-RandomHex 16; $botId = 'U' + (New-RandomHex 16); $liffId = '1000000001-SYNTHTST'
    Invoke-SmokePhase 'B' @{
      FLOW_ENV_FILE = $noFile; FLOW_SECRET_DIR = $tmp; NODE_ENV = 'test'; FLOW_DB_PURPOSE = 'test'; DATABASE_URL = $test.TEST_DATABASE_URL
      LINE_LOGIN_CHANNEL_ID = '1000000001'; LINE_LIFF_ID = $liffId
      SESSION_SECRET = (New-RandomHex 32); LINE_MESSAGING_CHANNEL_SECRET = $chSecret; LINE_BOT_USER_ID = $botId
    } @{ SMOKE_CHANNEL_SECRET = $chSecret; SMOKE_BOT_USER_ID = $botId; SMOKE_LIFF_ID = $liffId }

    # C (E14): configured database unreachable -> the API must refuse to start (no fallback).
    Invoke-StartupRefusal $noFile $tmp
  } else { Smoke-Log 'Phases B and C BLOCKED: no TEST_DATABASE_URL.' }
} finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
if ($haveDb) { Write-Result 'V11' 'local smoke: self-test + A (fail-closed) + B (test DB) + C (DB down) - see .qa\ep02\v11-smoke.log' $script:smokeFail }
else { Write-Result 'V11' 'local smoke: phase A ran; B/C need the test database' $script:smokeFail 'BLOCKED' }

Write-Host ''
Write-Host 'Not covered by this script (recorded separately): visual QA at 6 widths on the built app, real LINE acceptance.' -ForegroundColor Yellow
Write-Host "Summary: $Summary" -ForegroundColor Cyan
Get-Content -LiteralPath $Summary
if ($script:fail -gt 0) { exit 1 }
if ($script:blocked -gt 0) { exit 2 }
exit 0
