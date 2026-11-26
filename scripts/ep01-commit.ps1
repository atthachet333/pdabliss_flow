<#
  PDA BLISS FLOW - EP01 commit + push (public repository). Run only after gate review.

      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-commit.ps1

  Preflight (aborts on any problem, nothing committed):
    - Git identity shown; branch must be main; history must contain 3c6af13 (no rewrite).
    - origin/main fetched; local must not be behind (no force push, ever).
    - .qa\ep01\summary-final.txt (ep01-verify.ps1 -Final) exists with no FAIL and a passing G09.
  - Secret scan of files AND full history; real secret values vs. builds; Prettier check.
    - Forbidden paths (.env, .qa, dist, node_modules, keys) must not be staged.
  Then: one EP01 commit, normal `git push origin main`, remote sync + clean tree verified.
  The commit hash is written to .qa\ep01\git.log (NOT into tracked files).
#>
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $ProjectRoot
$Qa = Join-Path $ProjectRoot '.qa\ep01'
if (-not (Test-Path -LiteralPath $Qa)) { New-Item -ItemType Directory -Path $Qa -Force | Out-Null }
$Log = Join-Path $Qa 'git.log'
"EP01 commit run: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')" | Out-File -LiteralPath $Log -Encoding utf8
function Note([string]$m) { $m | Out-File -LiteralPath $Log -Append -Encoding utf8; Write-Host $m }
function Fail([string]$m) { Note "ABORT: $m"; Write-Host $m -ForegroundColor Red; exit 1 }

$name = (git config user.name); $email = (git config user.email)
if (-not $name -or -not $email) { Fail 'git user.name / user.email not configured.' }
Note "identity: $name <$email>"
if ((git rev-parse --abbrev-ref HEAD) -ne 'main') { Fail 'Not on branch main.' }
git merge-base --is-ancestor 3c6af13 HEAD; if ($LASTEXITCODE -ne 0) { Fail 'History does not contain 3c6af13.' }

# The closure gate run (ep01-verify.ps1 -Final) must exist and contain no FAIL line.
$final = Join-Path $Qa 'summary-final.txt'
if (-not (Test-Path -LiteralPath $final)) { Fail 'No .qa\ep01\summary-final.txt - run scripts\ep01-verify.ps1 -Final first.' }
$failed = @(Get-Content -LiteralPath $final | Where-Object { $_ -match '^G\d\d\s+FAIL' })
if ($failed.Count -gt 0) { Fail "Final gate run has $($failed.Count) FAIL line(s) - see .qa\ep01\summary-final.txt" }
if (-not (Select-String -LiteralPath $final -Pattern '^G09\s+PASS' -Quiet)) { Fail 'Final gate run has no passing G09 smoke.' }
Note 'ok: final gate run (summary-final.txt) has no FAIL'

cmd.exe /d /c "git fetch origin main >> `"$Log`" 2>&1"
if ($LASTEXITCODE -ne 0) { Fail 'git fetch failed (network or credentials).' }
$behind = [int](git rev-list --count HEAD..origin/main)
if ($behind -gt 0) { Fail "Local main is $behind commit(s) behind origin/main - reconcile first (no force push)." }

foreach ($step in @(
    @('secret scan (files)', 'node scripts/check-secrets.mjs'),
    @('secret scan (history)', 'node scripts/check-secrets.mjs --history'),
    @('secret values vs builds', 'node scripts/check-secret-values.mjs'),
    @('prettier check', 'npm.cmd run format:check'))) {
  cmd.exe /d /c "$($step[1]) >> `"$Log`" 2>&1"
  if ($LASTEXITCODE -ne 0) { Fail "$($step[0]) failed - see .qa\ep01\git.log" }
  Note "ok: $($step[0])"
}

git add -A
$staged = @(git diff --cached --name-only)
$bad = $staged | Where-Object { $_ -match '(^|/)\.env($|\.)' -and $_ -notmatch '\.env\.example$' -or $_ -match '^\.qa/|/dist/|^dist/|dist-showcase/|node_modules/|\.(pem|key|pfx)$' }
if ($bad) { git reset -q; Fail ("Forbidden paths staged: " + ($bad -join ', ')) }
if ($staged.Count -eq 0) { Fail 'Nothing to commit.' }
Note "staged files: $($staged.Count)"
git diff --cached --stat | Out-File -LiteralPath $Log -Append -Encoding utf8

$msg = @'
EP01: LINE integration & authentication foundation

- LIFF (@line/liff 2.32) login flow: single-flight, loop guard, retry cooldown;
  ID token sent once in a POST body, never stored
- API: official ID-token verification, dev in-memory sessions (HttpOnly __Host- cookie,
  rotation, idle/absolute expiry, revocation on logout), CSRF + origin checks (origin
  enforced before body parsing), per-client rate limiting with Retry-After
- Dedicated Thai rate-limit screen (K) with accessible countdown; no automatic retries
- Private access list (deny by default), local-only owner enrollment CLI with
  freshness-aware launcher (no rebuild during an integration session)
- Signed LINE webhook (raw-body HMAC, destination check, dedupe, metadata only)
- Read-only Messaging API adapter (bot info, quota, consumption); no sending
- Dev gateway (allow-listed routes, validated client address, forwarding headers
  dropped) + owner-approved Quick Tunnel scripts
- Cross-platform G09 smoke harness (Node, no dependencies) + PowerShell orchestration
- External secret file outside OneDrive; secret scans incl. Git history
- Auth screens A-K with Sally; EP01 docs and final report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XyLBsqLb32wcE8rM65Mw8i
'@
$msgFile = Join-Path $Qa 'commit-message.txt'
[System.IO.File]::WriteAllText($msgFile, $msg, (New-Object System.Text.UTF8Encoding($false)))
git commit -q -F $msgFile
if ($LASTEXITCODE -ne 0) { Fail 'git commit failed.' }
$hash = (git rev-parse HEAD).Trim()
Note "commit: $hash"

cmd.exe /d /c "git push origin main >> `"$Log`" 2>&1"
if ($LASTEXITCODE -ne 0) { Fail "Commit $hash created locally but push failed (see log). Nothing was forced." }
cmd.exe /d /c "git fetch origin main >> `"$Log`" 2>&1"
$remote = (git rev-parse origin/main).Trim()
Note "origin/main: $remote"
Note "synchronized: $(if ($remote -eq $hash) { 'yes' } else { 'NO' })"
$dirty = @(git status --porcelain)
Note "working tree: $(if ($dirty.Count -eq 0) { 'clean' } else { "$($dirty.Count) change(s)" })"
Write-Host "EP01 committed and pushed: $($hash.Substring(0,10))" -ForegroundColor Green
