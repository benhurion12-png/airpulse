param(
  [switch]$NoSimulator
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath ".env")) {
  Copy-Item -LiteralPath ".env.example" -Destination ".env"
  Write-Host "Создан .env из шаблона."
}

if ($NoSimulator) {
  docker compose up --build
} else {
  docker compose --profile demo up --build
}

