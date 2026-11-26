<#
  PDA BLISS FLOW - EP00 quality-gate runner (local Windows workstation only).

  Run from the project folder in PowerShell:
      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep00-verify.ps1

  -ExecutionPolicy Bypass applies to this single process only; no system setting changes.

  What it does:
    G01  records toolchain versions, git status, PostgreSQL presence and port availability (read-only)
    G02  npm install (creates package-lock.json), npm ls, npm audit, licence listing
    G03  npm run typecheck
    G04  npm run format (applies Prettier to project sources), npm run lint, npm run format:check
    G05  npm run test
    G06  npm run build (+ showcase-exclusion check), npm run build:showcase (local QA bundle)
    G08  npm run check:secrets
    API smoke: starts the built API on 127.0.0.1 for a few seconds, calls GET /health, stops ONLY that process

  What it never does: touch production, kill other processes, change firewall/OneDrive/PM2/global settings,
  create a git remote, commit, or push. Logs are written to .qa\ (git-ignored).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $ProjectRoot

$Qa = Join-Path $ProjectRoot '.qa'
if (-not (Test-Path -LiteralPath $Qa)) { New-Item -ItemType Directory -Path $Qa | Out-Null }
$Summary = Join-Path $Qa 'summary.txt'
"EP00 verification run: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')" | Out-File -LiteralPath $Summary -Encoding utf8
"Project: $ProjectRoot" | Out-File -LiteralPath $Summary -Append -Encoding utf8

function Write-Result([string]$Gate, [string]$Command, [int]$Code) {
  $status = if ($Code -eq 0) { 'PASS' } else { 'FAIL' }
  $line = '{0,-5} {1,-4} exit={2,-3} {3}' -f $Gate, $status, $Code, $Command
  Write-Host $line -ForegroundColor ($(if ($Code -eq 0) { 'Green' } else { 'Red' }))
  $line | Out-File -LiteralPath $Summary -Append -Encoding utf8
}

function Invoke-Step([string]$Gate, [string]$Name, [string]$Command) {
  $log = Join-Path $Qa "$Name.log"
  Write-Host ">> [$Gate] $Command" -ForegroundColor Cyan
  # cmd.exe redirection keeps node's UTF-8 output intact and gives a reliable exit code.
  cmd.exe /d /c "$Command > `"$log`" 2>&1"
  $code = $LASTEXITCODE
  Write-Result $Gate $Command $code
  return $code
}

# ------------------------------------------------------------------ G01 (read-only)
$envLog = Join-Path $Qa 'g01-environment.log'
& {
  "Working directory : $((Get-Location).Path)"
  "Expected          : D:\One Drive\OneDrive\Desktop\project\pdabliss_flow"
  "PowerShell        : $($PSVersionTable.PSVersion)"
  "OS                : $([System.Environment]::OSVersion.VersionString)"
  foreach ($tool in @('node', 'npm', 'git', 'psql')) {
    $cmd = Get-Command $tool -ErrorAction SilentlyContinue
    if ($cmd) {
      $ver = (& cmd.exe /d /c "$tool --version" 2>&1 | Select-Object -First 1)
      "{0,-18}: {1}  ({2})" -f $tool, $ver, $cmd.Source
    } else {
      "{0,-18}: NOT FOUND" -f $tool
    }
  }
  "--- PostgreSQL services (status only) ---"
  Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name): $($_.Status)" }
  "--- Port availability (listeners only; nothing is stopped) ---"
  foreach ($port in @(6767, 6768, 5432)) {
    $listen = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($listen) {
      $owners = ($listen | ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName } | Sort-Object -Unique) -join ', '
      "port $port : IN USE by $owners"
    } else {
      "port $port : free"
    }
  }
  "--- Git ---"
  cmd.exe /d /c "git rev-parse --is-inside-work-tree 2>&1"
  cmd.exe /d /c "git status --short --branch 2>&1"
} *>&1 | Out-File -LiteralPath $envLog -Encoding utf8
Write-Result 'G01' 'environment discovery (see .qa\g01-environment.log)' 0

$nodeMajor = 0
try { $nodeMajor = [int]((& node -p "process.versions.node.split('.')[0]") 2>$null) } catch { }
if ($nodeMajor -lt 22) {
  Write-Host "Node.js 22.12+ is required (found major $nodeMajor). Stopping before installing anything." -ForegroundColor Red
  "STOP: Node.js 22.12+ required (found major $nodeMajor)" | Out-File -LiteralPath $Summary -Append -Encoding utf8
  exit 1
}

# ------------------------------------------------------------------ G02
$install = Invoke-Step 'G02' 'g02-npm-install' 'npm install --no-fund'
if ($install -ne 0) {
  Write-Host 'npm install failed - see .qa\g02-npm-install.log. Later gates skipped.' -ForegroundColor Red
  exit 1
}
Invoke-Step 'G02' 'g02-npm-ls' 'npm ls --depth=0' | Out-Null
Invoke-Step 'G02' 'g02-npm-audit' 'npm audit --omit=dev' | Out-Null
Invoke-Step 'G02' 'g02-npm-audit-all' 'npm audit' | Out-Null
Invoke-Step 'G02' 'g02-licenses' 'node scripts/list-licenses.mjs' | Out-Null
if (Test-Path -LiteralPath (Join-Path $ProjectRoot 'package-lock.json')) { Write-Result 'G02' 'package-lock.json present' 0 } else { Write-Result 'G02' 'package-lock.json present' 1 }

# ------------------------------------------------------------------ G03-G06, G08
Invoke-Step 'G03' 'g03-typecheck' 'npm run typecheck' | Out-Null
Invoke-Step 'G04' 'g04-format-apply' 'npm run format' | Out-Null
Invoke-Step 'G04' 'g04-lint' 'npm run lint' | Out-Null
Invoke-Step 'G04' 'g04-format' 'npm run format:check' | Out-Null
Invoke-Step 'G05' 'g05-test' 'npm run test' | Out-Null
Invoke-Step 'G06' 'g06-build' 'npm run build' | Out-Null
Invoke-Step 'G06' 'g06-build-showcase' 'npm run build:showcase' | Out-Null
Invoke-Step 'G06' 'g06-worker-run' 'node apps/worker/dist/index.js' | Out-Null
Invoke-Step 'G08' 'g08-secrets' 'npm run check:secrets' | Out-Null

# ------------------------------------------------------------------ API smoke test
$smokeLog = Join-Path $Qa 'api-smoke.log'
$apiEntry = Join-Path $ProjectRoot 'apps\api\dist\server.js'
$portBusy = Get-NetTCPConnection -LocalPort 6768 -State Listen -ErrorAction SilentlyContinue
if ($portBusy) {
  'SKIPPED: port 6768 already in use by another process (left untouched).' | Out-File -LiteralPath $smokeLog -Encoding utf8
  Write-Result 'SMOKE' 'GET http://127.0.0.1:6768/health (skipped: port in use)' 1
} elseif (-not (Test-Path -LiteralPath $apiEntry)) {
  'SKIPPED: API build output missing.' | Out-File -LiteralPath $smokeLog -Encoding utf8
  Write-Result 'SMOKE' 'GET /health (skipped: no build)' 1
} else {
  $apiOut = Join-Path $Qa 'api-smoke-server.log'
  $apiErr = Join-Path $Qa 'api-smoke-server.err.log'
  $proc = Start-Process -FilePath 'node' -ArgumentList "`"$apiEntry`"" -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr
  $code = 1
  try {
    $ok = $false
    for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
      Start-Sleep -Milliseconds 500
      try {
        $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:6768/health' -UseBasicParsing -TimeoutSec 3
        $ok = $true
        & {
          "HTTP $($resp.StatusCode)"
          'Headers:'
          $resp.Headers.GetEnumerator() | Sort-Object Key | ForEach-Object { "  $($_.Key): $($_.Value)" }
          'Body:'
          $resp.Content
        } | Out-File -LiteralPath $smokeLog -Encoding utf8
        if ($resp.StatusCode -eq 200 -and $resp.Content -match '"status":"ok"') { $code = 0 }
      } catch { }
    }
    if (-not $ok) { 'API did not respond on 127.0.0.1:6768 within 10 s.' | Out-File -LiteralPath $smokeLog -Encoding utf8 }
    try {
      $nf = Invoke-WebRequest -Uri 'http://127.0.0.1:6768/nope' -UseBasicParsing -TimeoutSec 3
      "404 check unexpected status $($nf.StatusCode)" | Out-File -LiteralPath $smokeLog -Append -Encoding utf8
    } catch {
      "404 check: $($_.Exception.Response.StatusCode.value__)" | Out-File -LiteralPath $smokeLog -Append -Encoding utf8
    }
  } finally {
    # Stop only the process this script started.
    if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue }
  }
  Write-Result 'SMOKE' 'GET http://127.0.0.1:6768/health (built API, then stopped)' $code
}

Write-Host ''
Write-Host "Done. Summary: $Summary" -ForegroundColor Cyan
Get-Content -LiteralPath $Summary
