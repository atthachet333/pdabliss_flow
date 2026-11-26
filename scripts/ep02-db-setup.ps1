<#
  PDA BLISS FLOW - EP02 local MariaDB setup (development + test only). Idempotent.

      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep02-db-setup.ps1
      powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep02-db-setup.ps1 -RotatePasswords

  What it does (and nothing more):
    1. Finds an EXISTING MariaDB server on this computer (service + client). It never installs,
       upgrades, reconfigures or restarts MariaDB. No server -> instructions, exit 2.
    2. Asks for a MariaDB administrator login locally (masked input; never stored, never echoed,
       passed to the client through a temporary option file readable only by you).
    3. Creates ONLY these databases (utf8mb4 / utf8mb4_unicode_ci, InnoDB):
         pdabliss_flow_dev   pdabliss_flow_test   pdabliss_flow_shadow
       The production database pdabliss_flow is never created, named in SQL, or touched.
    4. Creates four least-privilege accounts (localhost + 127.0.0.1 only, random passwords):
         flow_dev_app      SELECT/INSERT/UPDATE/DELETE on pdabliss_flow_dev   (API runtime)
         flow_dev_migrate  ALL on pdabliss_flow_dev                           (migrations)
         flow_test         ALL on pdabliss_flow_test                          (automated tests)
         flow_shadow       ALL on pdabliss_flow_shadow                        (drift check)
       No global privileges. Accounts belonging to other systems are never reused or changed.
    5. Writes the connection strings to the external secret folder (outside Git/OneDrive):
         %USERPROFILE%\.pdabliss\flow\dev.env   DATABASE_URL, DATABASE_MIGRATE_URL, SHADOW_DATABASE_URL
         %USERPROFILE%\.pdabliss\flow\test.env  TEST_DATABASE_URL
       Existing keys are kept unless -RotatePasswords. Values are never printed.
    6. Applies the committed migrations to dev and test (`node scripts/db.mjs deploy`; never
       reset, never db push) and confirms the connected database names.
    7. Owner: imports the EP01 owner if the EP01 access file is present in the secret folder;
       otherwise prints the new-workstation bootstrap steps.
#>
[CmdletBinding()]
param([switch]$RotatePasswords, [string]$AdminUser = 'root', [int]$Port = 3306)

$ErrorActionPreference = 'Continue'  # native tools write to stderr; every step checks its exit code
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $ProjectRoot
$SecretDir = if ($env:FLOW_SECRET_DIR) { $env:FLOW_SECRET_DIR } else { Join-Path $env:USERPROFILE '.pdabliss\flow' }
$DevEnv = Join-Path $SecretDir 'dev.env'
$TestEnv = Join-Path $SecretDir 'test.env'
$Me = "$env:USERDOMAIN\$env:USERNAME"

function Fail([string]$m, [int]$code = 1) { Write-Host $m -ForegroundColor Red; exit $code }
function Step([string]$m) { Write-Host ">> $m" -ForegroundColor Cyan }

if ($SecretDir -match '(?i)onedrive') { Fail 'The secret folder must not be inside OneDrive. Set FLOW_SECRET_DIR to a local folder.' }

# ------------------------------------------------------------------ 1. find MariaDB (no install)
Step 'Looking for an existing MariaDB server on this computer'
$svc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)^(mariadb|mysql)' -or $_.DisplayName -match '(?i)mariadb' }
$client = $null
foreach ($name in @('mariadb.exe', 'mysql.exe')) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if ($c) { $client = $c.Source; break }
}
if (-not $client) {
  $cand = Get-ChildItem -Path "$env:ProgramFiles\MariaDB*\bin\mariadb.exe", "$env:ProgramFiles\MariaDB*\bin\mysql.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cand) { $client = $cand.FullName }
}
if (-not $svc -or -not $client) {
  Write-Host @'
No local MariaDB server was found (service and/or client missing). Nothing was changed.

Install ONE MariaDB server for development (not done automatically):
  * MariaDB Community Server, current LTS (11.4 or 11.8), Windows x64 MSI, from https://mariadb.org/download/
  * During setup: keep port 3306 (or pass -Port), set a root password, leave "Enable access
    from remote machines for root" UNCHECKED, UTF8 default charset ON.
If MariaDB/MySQL is already installed for another system, do not install a second server -
re-run this script with that server's port; it only adds FLOW databases and FLOW accounts.
Then run this script again.
'@ -ForegroundColor Yellow
  exit 2
}
$svcInfo = ($svc | ForEach-Object { "$($_.Name)=$($_.Status)" }) -join ', '
Write-Host "   service: $svcInfo"
Write-Host "   client : $client"
if (-not ($svc | Where-Object { $_.Status -eq 'Running' })) { Fail 'The MariaDB service exists but is not running. Start it (services.msc), then re-run. (Not started automatically.)' 2 }

# ------------------------------------------------------------------ 2. admin login (local, masked)
Step "MariaDB administrator login for 127.0.0.1:$Port (input is not shown or stored)"
$u = Read-Host "Admin user [$AdminUser]"
if ($u) { $AdminUser = $u }
$sec = Read-Host -AsSecureString 'Admin password'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$adminPwd = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$opt = Join-Path $env:TEMP ("flow-db-" + [guid]::NewGuid().ToString('N') + '.cnf')
function Remove-Opt { if (Test-Path -LiteralPath $opt) { Remove-Item -LiteralPath $opt -Force -ErrorAction SilentlyContinue } }
try {
  Set-Content -ErrorAction Stop -LiteralPath $opt -Encoding ascii -Value @("[client]", "user=$AdminUser", "password=`"$(($adminPwd -replace '\\', '\\') -replace '"', '\"')`"", 'host=127.0.0.1', "port=$Port", 'default-character-set=utf8mb4')
  & icacls.exe $opt /inheritance:r /grant:r "${Me}:F" | Out-Null
  $adminPwd = $null

  function Invoke-Sql([string]$sql, [switch]$Quiet) {
    $out = $sql | & $client "--defaults-extra-file=$opt" --batch --skip-column-names 2>&1
    if ($LASTEXITCODE -ne 0) {
      # The client's own error text never contains the password; show only its first line.
      $first = ($out | Select-Object -First 1) -replace 'password', '***'
      throw "MariaDB command failed: $first"
    }
    if (-not $Quiet) { return $out }
  }

  $version = (Invoke-Sql 'SELECT VERSION();') -join ''
  Write-Host "   server : $version"
  if ($version -notmatch '(?i)mariadb') { Write-Host '   NOTE: this server does not report itself as MariaDB. FLOW is tested on MariaDB.' -ForegroundColor Yellow }
  $tz = (Invoke-Sql "SELECT IF(CONVERT_TZ('2026-01-01 00:00:00','+00:00','+07:00') IS NULL,'no','yes');") -join ''
  Write-Host "   numeric time-zone conversion: $tz (FLOW uses '+00:00' sessions; named zone tables are not required)"

  # ------------------------------------------------------------------ 3-4. databases + accounts
  $existing = @{}
  if (Test-Path -LiteralPath $DevEnv) { Get-Content -LiteralPath $DevEnv | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)\s*=') { $existing[$Matches[1]] = $true } } }
  if (Test-Path -LiteralPath $TestEnv) { Get-Content -LiteralPath $TestEnv | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)\s*=') { $existing[$Matches[1]] = $true } } }
  $haveAll = $existing.DATABASE_URL -and $existing.DATABASE_MIGRATE_URL -and $existing.SHADOW_DATABASE_URL -and $existing.TEST_DATABASE_URL

  Step 'Creating databases (if missing): pdabliss_flow_dev, pdabliss_flow_test, pdabliss_flow_shadow'
  foreach ($db in @('pdabliss_flow_dev', 'pdabliss_flow_test', 'pdabliss_flow_shadow')) {
    Invoke-Sql "CREATE DATABASE IF NOT EXISTS ``$db`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" -Quiet
  }

  function New-Password { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ }) }
  $accounts = [ordered]@{
    flow_dev_app     = @{ db = 'pdabliss_flow_dev'; grant = 'SELECT, INSERT, UPDATE, DELETE'; file = 'dev'; key = 'DATABASE_URL' }
    flow_dev_migrate = @{ db = 'pdabliss_flow_dev'; grant = 'ALL PRIVILEGES'; file = 'dev'; key = 'DATABASE_MIGRATE_URL' }
    flow_shadow      = @{ db = 'pdabliss_flow_shadow'; grant = 'ALL PRIVILEGES'; file = 'dev'; key = 'SHADOW_DATABASE_URL' }
    flow_test        = @{ db = 'pdabliss_flow_test'; grant = 'ALL PRIVILEGES'; file = 'test'; key = 'TEST_DATABASE_URL' }
  }
  $newValues = @{ dev = [ordered]@{}; test = [ordered]@{} }
  if ($haveAll -and -not $RotatePasswords) {
    Step 'Connection strings already exist in the secret folder - accounts left unchanged (use -RotatePasswords to rotate)'
  } else {
    Step 'Creating/updating FLOW accounts (localhost + 127.0.0.1 only, no global privileges)'
    foreach ($name in $accounts.Keys) {
      $a = $accounts[$name]
      $pw = New-Password
      foreach ($h in @('localhost', '127.0.0.1')) {
        Invoke-Sql "CREATE USER IF NOT EXISTS '$name'@'$h' IDENTIFIED BY '$pw'; ALTER USER '$name'@'$h' IDENTIFIED BY '$pw'; REVOKE ALL PRIVILEGES, GRANT OPTION FROM '$name'@'$h'; GRANT $($a.grant) ON ``$($a.db)``.* TO '$name'@'$h';" -Quiet
      }
      $newValues[$a.file][$a.key] = "mysql://${name}:$pw@127.0.0.1:$Port/$($a.db)"
      $pw = $null
    }
    Invoke-Sql 'FLUSH PRIVILEGES;' -Quiet
  }
  # Verify: no FLOW account has global privileges.
  $global = Invoke-Sql "SELECT CONCAT(User,'@',Host) FROM mysql.user WHERE User LIKE 'flow\_%' AND (Super_priv='Y' OR Grant_priv='Y' OR File_priv='Y' OR Create_user_priv='Y');"
  if ($global) { Fail "A FLOW account has global privileges: $global. Not continuing." }
  Write-Host '   OK: FLOW accounts have database-level privileges only.'
} finally {
  Remove-Opt
}

# ------------------------------------------------------------------ 5. secret files (never printed)
function Write-Keys([string]$file, $values) {
  if ($values.Count -eq 0) { return }
  if (-not (Test-Path -LiteralPath $SecretDir)) {
    New-Item -ItemType Directory -Path $SecretDir -Force | Out-Null
    & icacls.exe $SecretDir /inheritance:r /grant:r "${Me}:(OI)(CI)F" | Out-Null
  }
  $lines = @()
  if (Test-Path -LiteralPath $file) { $lines = @(Get-Content -LiteralPath $file | Where-Object { $_ -notmatch "^\s*($(($values.Keys) -join '|'))\s*=" }) }
  foreach ($k in $values.Keys) { $lines += "$k=$($values[$k])" }
  [IO.File]::WriteAllLines($file, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
  & icacls.exe $file /inheritance:r /grant:r "${Me}:F" | Out-Null
  Write-Host "   wrote keys $((@($values.Keys)) -join ', ') to $file (values not shown)"
}
Write-Keys $DevEnv $newValues.dev
Write-Keys $TestEnv $newValues.test

# ------------------------------------------------------------------ 6. migrations (committed only)
Step 'Prisma client + committed migrations (never reset, never db push)'
foreach ($cmd in @('node scripts/db.mjs generate', 'node scripts/db.mjs deploy dev', 'node scripts/db.mjs deploy test', 'node scripts/db.mjs whoami dev', 'node scripts/db.mjs whoami test')) {
  Write-Host "   $cmd"
  cmd.exe /d /c $cmd
  if ($LASTEXITCODE -ne 0) { Fail "Failed: $cmd (see output above). Nothing was reset." }
}

# ------------------------------------------------------------------ 7. owner
Step 'Owner authorization'
if (Test-Path -LiteralPath (Join-Path $SecretDir 'access.json')) {
  cmd.exe /d /c 'npm.cmd run admin -- import-ep01-owner'
  if ($LASTEXITCODE -ne 0) { Fail 'Owner import failed (no changes beyond what is reported above).' }
} else {
  Write-Host @'
   No EP01 access file on this computer (it stays on the office workstation). Either:
   A) copy %USERPROFILE%\.pdabliss\flow\access.json from the office PC (USB, not cloud) into the
      same folder here and run:   npm.cmd run admin -- import-ep01-owner
   B) or bootstrap here: start FLOW, open it from LINE once (do NOT submit an access request), then
        npm.cmd run admin -- recent-signins
      compare the masked LINE user ID with "Your user ID" in the LINE Developers console, and run
        npm.cmd run admin -- bootstrap-owner <user-uuid> --confirm
'@ -ForegroundColor Yellow
}
Write-Host 'EP02 database setup finished.' -ForegroundColor Green
exit 0
