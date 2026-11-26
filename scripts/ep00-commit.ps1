<#
  PDA BLISS FLOW - EP00 local commit (run only after the EP00 gates have been reviewed).

      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep00-commit.ps1

  - Initialises Git (branch "main") only if this folder is not already a repository.
  - Re-runs the secret scan and refuses to commit if it fails.
  - Commit 1: the EP00 foundation, with YOUR git identity.
  - Commit 2: writes commit 1's hash into docs/EP00-REPORT.md (replacing PENDING_EP00_COMMIT).
  - Never adds a remote and never pushes. Results are written to .qa\git.log.
#>
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $ProjectRoot
$Qa = Join-Path $ProjectRoot '.qa'
if (-not (Test-Path -LiteralPath $Qa)) { New-Item -ItemType Directory -Path $Qa | Out-Null }
$Log = Join-Path $Qa 'git.log'
"EP00 commit run: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')" | Out-File -LiteralPath $Log -Encoding utf8

$name = (git config user.name)
$email = (git config user.email)
if (-not $name -or -not $email) {
  Write-Host 'git user.name / user.email are not configured. Set them, then re-run.' -ForegroundColor Yellow
  exit 1
}

cmd.exe /d /c "git rev-parse --is-inside-work-tree >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
  git init -b main | Out-File -LiteralPath $Log -Append -Encoding utf8
} else {
  'Existing repository detected - not re-initialising.' | Out-File -LiteralPath $Log -Append -Encoding utf8
}

git add -A
cmd.exe /d /c "node scripts/check-secrets.mjs >> `"$Log`" 2>&1"
if ($LASTEXITCODE -ne 0) {
  git reset -q
  Write-Host 'Secret scan failed - nothing committed. See .qa\git.log' -ForegroundColor Red
  exit 1
}

$msg1 = @'
EP00: FLOW signature identity, design system and engineering foundation

- npm workspaces: apps/web (Vite + React LIFF shell), apps/api (Fastify, /health),
  apps/worker (scaffold, no scheduler), packages/shared (domain logic),
  packages/design-system (CSS custom-property tokens + styles)
- Sally: owner-approved anthropomorphic car mascot (canonical reference image,
  web derivatives, 6 vector expressions), FLOW mark, rich menu concept
- Dev-only /dev/design-showcase with interactive appointment prototype (mock data only),
  excluded from production builds
- Docs: master spec, roadmap, design system, IA, architecture, security, LINE plan
  (owner-prepared non-secret LINE settings), notification engine, deployment, EP00 report

Quality gates: 17/17 PASS on Windows (79/79 tests). No production access,
no LINE credentials, no messages sent.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XyLBsqLb32wcE8rM65Mw8i
'@
$msgFile = Join-Path $Qa 'commit-message.txt'
[System.IO.File]::WriteAllText($msgFile, $msg1, (New-Object System.Text.UTF8Encoding($false)))
git commit -q -F $msgFile
if ($LASTEXITCODE -ne 0) { Write-Host 'git commit failed - see output above.' -ForegroundColor Red; exit 1 }
$hash1 = (git rev-parse HEAD).Trim()

# Record the foundation commit hash in the report (UTF-8 without BOM, LF preserved).
$report = Join-Path $ProjectRoot 'docs\EP00-REPORT.md'
$text = [System.IO.File]::ReadAllText($report, [System.Text.Encoding]::UTF8)
if ($text.Contains('PENDING_EP00_COMMIT')) {
  $text = $text.Replace('PENDING_EP00_COMMIT', $hash1)
  [System.IO.File]::WriteAllText($report, $text, (New-Object System.Text.UTF8Encoding($false)))
  # Keep the report Prettier-clean (the hash changes table column widths).
  cmd.exe /d /c "node node_modules/prettier/bin/prettier.cjs --write docs/EP00-REPORT.md --log-level warn"
  git add -- docs/EP00-REPORT.md
  $msg2 = @"
docs(EP00): record foundation commit hash in EP00 report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XyLBsqLb32wcE8rM65Mw8i
"@
  [System.IO.File]::WriteAllText($msgFile, $msg2, (New-Object System.Text.UTF8Encoding($false)))
  git commit -q -F $msgFile
  if ($LASTEXITCODE -ne 0) { Write-Host 'Second commit failed - see output above.' -ForegroundColor Red; exit 1 }
}

& {
  "foundation commit: $hash1"
  "HEAD: $(git rev-parse HEAD)"
  "branch: $(git rev-parse --abbrev-ref HEAD)"
  "author: $(git log -1 --format='%an <%ae>' $hash1)"
  "remotes: [$((git remote) -join ', ')]"
  '--- log ---'
  git log --oneline -n 5
  '--- status (empty = clean) ---'
  git status --short --branch
  '--- tracked file count ---'
  (git ls-files | Measure-Object).Count
} | Out-File -LiteralPath $Log -Append -Encoding utf8
Write-Host "Committed $($hash1.Substring(0,10)) (+ report hash commit) on $(git rev-parse --abbrev-ref HEAD). No remote, nothing pushed." -ForegroundColor Green
Get-Content -LiteralPath $Log
