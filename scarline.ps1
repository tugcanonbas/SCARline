param(
  [Parameter(Position = 0)]
  [ValidateSet("start", "stop", "restart", "status", "logs", "reset-db")]
  [string]$Command = "status",

  [switch]$Dev,
  [switch]$NoCarla,
  [switch]$NoOverlay,
  [switch]$NoBrowser,
  [switch]$WidgetTest,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigFile = if ($env:SCARLINE_CONFIG) { $env:SCARLINE_CONFIG } else { Join-Path $RootDir ".scarline.yaml" }
$RuntimeDir = Join-Path $RootDir ".scarline-runtime"
$LogDir = Join-Path $RuntimeDir "logs"
$PidDir = Join-Path $RuntimeDir "pids"

New-Item -ItemType Directory -Force -Path $RuntimeDir, $LogDir, $PidDir | Out-Null

function Get-ConfigValue {
  param([string]$Key, [string]$Default = "")
  if (-not (Test-Path $ConfigFile)) {
    return $Default
  }

  $content = Get-Content $ConfigFile
  for ($i = 0; $i -lt $content.Length; $i++) {
    if ($content[$i] -match "^$Key\s*:\s*(.+)$") {
      return $Matches[1].Trim().Trim("'").Trim('"')
    }
  }
  return $Default
}

function ComposeArgs {
  $args = @("-f", (Join-Path $RootDir "docker-compose.yml"))
  if ($Dev) {
    $args += @("-f", (Join-Path $RootDir "docker-compose.dev.yml"))
  }
  if ($WidgetTest) {
    $args += @("-f", (Join-Path $RootDir "docker-compose.widget-test.yml"))
  }
  return $args
}

function Invoke-Compose {
  param([string[]]$Args)
  & docker compose @((ComposeArgs) + $Args)
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Start-Carla {
  if ($NoCarla) {
    return
  }

  $carlaPath = Get-ConfigValue "server_path" ""
  $carlaPort = if ($env:CARLA_SERVER_PORT) { $env:CARLA_SERVER_PORT } else { "2000" }
  if (-not $carlaPath -or -not (Test-Path $carlaPath)) {
    Write-Warning "CARLA server path not configured; skipping CARLA startup"
    return
  }

  $process = Start-Process -FilePath $carlaPath -ArgumentList @("-carla-rpc-port=$carlaPort", "-quality-level=Epic", "-windowed", "-ResX=1920", "-ResY=1080") -PassThru
  Set-Content -Path (Join-Path $PidDir "carla.pid") -Value $process.Id
}

function Stop-Carla {
  $pidFile = Join-Path $PidDir "carla.pid"
  if (Test-Path $pidFile) {
    $pid = Get-Content $pidFile
    Stop-Process -Id $pid -ErrorAction SilentlyContinue
    Remove-Item $pidFile -Force
  }
}

function Open-Admin {
  if ($NoBrowser) {
    return
  }

  $port = if ($env:SCARLINE_PORT) { $env:SCARLINE_PORT } else { "8088" }
  Start-Process "http://localhost:$port/admin/dashboard" | Out-Null
}

Require-Command docker

$env:POSTGRES_DB = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "scarline" }
$env:POSTGRES_USER = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "scarline" }
$env:POSTGRES_PASSWORD = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { "scarline" }
$env:RABBITMQ_USER = if ($env:RABBITMQ_USER) { $env:RABBITMQ_USER } else { "scarline" }
$env:RABBITMQ_PASSWORD = if ($env:RABBITMQ_PASSWORD) { $env:RABBITMQ_PASSWORD } else { "scarline" }
$env:SCARLINE_PORT = if ($env:SCARLINE_PORT) { $env:SCARLINE_PORT } else { "8088" }

switch ($Command) {
  "start" {
    Invoke-Compose @("up", "--build", "-d", "postgres", "rabbitmq", "schema-bootstrap")
    Invoke-Compose @("up", "--build", "-d", "core-api", "sim-bridge", "admin-panel", "overlay-web", "docs", "io-client", "nginx")
    if ($NoCarla) {
      Invoke-Compose @("up", "--build", "-d", "mock-simulator")
    } else {
      Invoke-Compose @("up", "--build", "-d", "mock-simulator", "carla-client")
      Start-Carla
    }
    Open-Admin
    Write-Host "SCARline started on http://localhost:$env:SCARLINE_PORT"
  }
  "stop" {
    Stop-Carla
    Invoke-Compose @("down")
  }
  "restart" {
    Stop-Carla
    Invoke-Compose @("down")
    Invoke-Compose @("up", "--build", "-d")
    if (-not $NoCarla) {
      Start-Carla
    }
    Open-Admin
  }
  "status" {
    Invoke-Compose @("ps")
  }
  "logs" {
    Invoke-Compose @(@("logs", "-f") + $Rest)
  }
  "reset-db" {
    Invoke-Compose @("run", "--rm", "-e", "POSTGRES_HOST=postgres", "-e", "POSTGRES_PORT=5432", "-e", "POSTGRES_DB=$env:POSTGRES_DB", "-e", "POSTGRES_USER=$env:POSTGRES_USER", "-e", "POSTGRES_PASSWORD=$env:POSTGRES_PASSWORD", "schema-bootstrap", "/bin/sh", "/workspace/infra/database/scripts/reset_dev.sh")
  }
}
