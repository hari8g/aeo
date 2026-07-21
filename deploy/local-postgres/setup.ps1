# Setup local Postgres for AEO Studio (no Docker).
# Prerequisites: PostgreSQL installed and "psql" on PATH.
#
# Usage (from repo root):
#   .\deploy\local-postgres\setup.ps1
#   .\deploy\local-postgres\setup.ps1 -PgPassword "your_postgres_superuser_password"
#   .\deploy\local-postgres\setup.ps1 -DbPort 5432 -PgUser postgres

param(
  [string]$PgHost = "localhost",
  [int]$DbPort = 5432,
  [string]$PgUser = "postgres",
  [string]$PgPassword = "",
  [string]$DbName = "avp",
  [string]$AppUser = "avp",
  [string]$AppPassword = "avp_dev_password"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$PlatformEnv = Join-Path $RepoRoot "packages\platform\.env"
$StudioEnv = Join-Path $RepoRoot "packages\studio-web\.env.local"
function Resolve-PsqlPath {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($c in @(
      "C:\Program Files\PostgreSQL\17\bin\psql.exe",
      "C:\Program Files\PostgreSQL\16\bin\psql.exe",
      "C:\Program Files\PostgreSQL\15\bin\psql.exe",
      "C:\Program Files\PostgreSQL\14\bin\psql.exe"
    )) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

$Psql = Resolve-PsqlPath
if (-not $Psql) {
  Write-Error "psql not found. Add PostgreSQL bin to PATH (e.g. C:\Program Files\PostgreSQL\16\bin) and retry."
}

if ($PgPassword) {
  $env:PGPASSWORD = $PgPassword
}

Write-Host "Using psql: $Psql"
Write-Host "Creating role '$AppUser' and database '$DbName' on ${PgHost}:${DbPort} ..."

# Avoid DO $$ in -c (PowerShell / Windows quoting breaks dollar-quoted blocks).
# Use plain SELECT + CREATE/ALTER instead.
$roleExists = (& $Psql -h $PgHost -p $DbPort -U $PgUser -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$AppUser'").Trim()
if ($roleExists -ne "1") {
  & $Psql -h $PgHost -p $DbPort -U $PgUser -d postgres -v ON_ERROR_STOP=1 `
    -c "CREATE ROLE $AppUser LOGIN PASSWORD '$AppPassword';"
  Write-Host "Created role $AppUser"
} else {
  & $Psql -h $PgHost -p $DbPort -U $PgUser -d postgres -v ON_ERROR_STOP=1 `
    -c "ALTER ROLE $AppUser WITH LOGIN PASSWORD '$AppPassword';"
  Write-Host "Updated password for role $AppUser"
}

# Optional: also apply init-avp.sql (idempotent role ensure) via -f if present
if (Test-Path $InitSql) {
  & $Psql -h $PgHost -p $DbPort -U $PgUser -d postgres -v ON_ERROR_STOP=1 -f $InitSql | Out-Null
}

$dbExists = (& $Psql -h $PgHost -p $DbPort -U $PgUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName'").Trim()
if ($dbExists -ne "1") {
  & $Psql -h $PgHost -p $DbPort -U $PgUser -d postgres -v ON_ERROR_STOP=1 `
    -c "CREATE DATABASE $DbName OWNER $AppUser;"
  Write-Host "Created database $DbName"
} else {
  Write-Host "Database $DbName already exists — skipping CREATE DATABASE"
  & $Psql -h $PgHost -p $DbPort -U $PgUser -d postgres `
    -c "GRANT ALL PRIVILEGES ON DATABASE $DbName TO $AppUser;"
}

@(
  "PORT=7070"
  "DB_HOST=$PgHost"
  "DB_PORT=$DbPort"
  "DB_NAME=$DbName"
  "DB_USER=$AppUser"
  "DB_PASSWORD=$AppPassword"
  "STUDIO_SECRET=avp-studio-dev-secret"
) | Set-Content -Path $PlatformEnv -Encoding utf8

if (-not (Test-Path $StudioEnv)) {
  @(
    "PLATFORM_URL=http://localhost:7070"
    "STUDIO_SECRET=avp-studio-dev-secret"
    "DEMO_BYPASS=1"
    "NEXTAUTH_URL=http://localhost:3001"
    "NEXTAUTH_SECRET=dev-local-secret-change-me"
  ) | Set-Content -Path $StudioEnv -Encoding utf8
  Write-Host "Wrote $StudioEnv"
} else {
  Write-Host "Kept existing $StudioEnv"
}

Write-Host ""
Write-Host "Wrote $PlatformEnv"
Write-Host "Next (from repo root):"
Write-Host "  pnpm install"
Write-Host "  pnpm -F @avp/shared build"
Write-Host '  pnpm -r --filter "./packages/agents/**" build'
Write-Host "  pnpm -F @avp/platform build"
Write-Host "  pnpm -F @avp/platform db:seed"
Write-Host '  $env:STUDIO_SECRET="avp-studio-dev-secret"; pnpm -F @avp/platform dev'
Write-Host "  (other window) cd packages\studio-web; pnpm run dev:3001"
Write-Host "Open http://localhost:3001"
