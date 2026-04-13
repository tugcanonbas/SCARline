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
$OverlayControlPort = if ($env:OVERLAY_CONTROL_PORT) { $env:OVERLAY_CONTROL_PORT } else { "4097" }

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

function Wait-ForComposeHealth {
  param([string[]]$Services)
  for ($attempt = 0; $attempt -lt 36; $attempt++) {
    $unhealthy = $false
    foreach ($service in $Services) {
      $json = Invoke-Compose @("ps", "--format", "json", $service) 2>$null
      if (-not $json) {
        $unhealthy = $true
        break
      }
      if ($json -match '"Health"\s*:\s*"(starting|unhealthy)"' -or $json -match '"State"\s*:\s*"exited"') {
        $unhealthy = $true
        break
      }
    }
    if (-not $unhealthy) {
      return
    }
    Start-Sleep -Seconds 5
  }
  throw "Timed out waiting for docker compose health: $($Services -join ', ')"
}

function Wait-ForComposeExit {
  param([string]$Service)
  for ($attempt = 0; $attempt -lt 36; $attempt++) {
    $json = Invoke-Compose @("ps", "-a", "--format", "json", $Service) 2>$null
    if (-not $json) {
      Start-Sleep -Seconds 2
      continue
    }

    if ($json -match '"State"\s*:\s*"exited"') {
      if ($json -match '"ExitCode"\s*:\s*0') {
        return
      }
      Write-Error "$Service exited with a non-zero status"
      Invoke-Compose @("logs", "--no-color", $Service)
      throw "$Service bootstrap failed"
    }

    if ($json -match '"State"\s*:\s*"(dead|removing)"') {
      Invoke-Compose @("logs", "--no-color", $Service)
      throw "$Service entered an invalid container state"
    }

    Start-Sleep -Seconds 2
  }

  Invoke-Compose @("logs", "--no-color", $Service)
  throw "Timed out waiting for $Service to complete"
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

function Start-OverlayDesktop {
  if ($NoOverlay) {
    return
  }
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Warning "pnpm not installed; skipping transparent overlay launch"
    return
  }

  $pidFile = Join-Path $PidDir "overlay.pid"
  if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile
    if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
      return
    }
  }

  $env:OVERLAY_URL = if ($env:OVERLAY_URL) { $env:OVERLAY_URL } else { "http://localhost:$env:SCARLINE_PORT/overlay/?chrome=transparent" }
  $env:OVERLAY_CONTROL_PORT = $OverlayControlPort
  $process = Start-Process -FilePath "pnpm" -ArgumentList @("--dir", (Join-Path $RootDir "apps/desktop-overlay"), "start") -RedirectStandardOutput (Join-Path $LogDir "overlay-desktop.log") -RedirectStandardError (Join-Path $LogDir "overlay-desktop.err.log") -PassThru
  Set-Content -Path $pidFile -Value $process.Id
}

function Stop-OverlayDesktop {
  $pidFile = Join-Path $PidDir "overlay.pid"
  if (Test-Path $pidFile) {
    $pid = Get-Content $pidFile
    Stop-Process -Id $pid -ErrorAction SilentlyContinue
    Remove-Item $pidFile -Force
  }
}

function Start-IpcServer {
  if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Warning "python not installed; skipping process manager IPC server"
    return
  }

  $pidFile = Join-Path $PidDir "ipc.pid"
  if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile
    if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
      return
    }
  }

  $socketPath = "tcp://127.0.0.1:4098"
  $env:OVERLAY_CONTROL_PORT = $OverlayControlPort
  $process = Start-Process -FilePath "python" -ArgumentList @((Join-Path $RootDir "infra/process-manager/ipc_server.py"), $socketPath, $RuntimeDir) -RedirectStandardOutput (Join-Path $LogDir "process-manager-ipc.log") -RedirectStandardError (Join-Path $LogDir "process-manager-ipc.err.log") -PassThru
  Set-Content -Path $pidFile -Value $process.Id
}

function Stop-IpcServer {
  $pidFile = Join-Path $PidDir "ipc.pid"
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
$env:PM_SOCKET_PATH = if ($env:PM_SOCKET_PATH) { $env:PM_SOCKET_PATH } else { "http://host.docker.internal:4098" }

switch ($Command) {
  "start" {
    Invoke-Compose @("up", "--build", "-d", "postgres", "rabbitmq", "schema-bootstrap")
    Wait-ForComposeHealth @("postgres", "rabbitmq")
    Wait-ForComposeExit "schema-bootstrap"
    Invoke-Compose @("up", "--build", "-d", "core-api", "sim-bridge", "admin-panel", "overlay-web", "docs", "io-client", "nginx")
    Wait-ForComposeHealth @("core-api", "sim-bridge", "admin-panel", "overlay-web", "nginx")
    if ($NoCarla) {
      Invoke-Compose @("up", "--build", "-d", "mock-simulator")
    } else {
      Invoke-Compose @("up", "--build", "-d", "mock-simulator", "carla-client")
      Start-Carla
    }
    Start-OverlayDesktop
    Start-IpcServer
    Open-Admin
    Write-Host "SCARline started on http://localhost:$env:SCARLINE_PORT"
  }
  "stop" {
    Stop-IpcServer
    Stop-OverlayDesktop
    Stop-Carla
    Invoke-Compose @("down")
  }
  "restart" {
    Stop-IpcServer
    Stop-OverlayDesktop
    Stop-Carla
    Invoke-Compose @("down")
    Invoke-Compose @("up", "--build", "-d", "postgres", "rabbitmq", "schema-bootstrap")
    Wait-ForComposeHealth @("postgres", "rabbitmq")
    Wait-ForComposeExit "schema-bootstrap"
    Invoke-Compose @("up", "--build", "-d", "core-api", "sim-bridge", "admin-panel", "overlay-web", "docs", "io-client", "nginx", "mock-simulator")
    if (-not $NoCarla) {
      Invoke-Compose @("up", "--build", "-d", "carla-client")
      Start-Carla
    }
    Start-OverlayDesktop
    Start-IpcServer
    Open-Admin
  }
  "status" {
    Invoke-Compose @("ps")
    if (Test-Path (Join-Path $PidDir "overlay.pid")) {
      Write-Host "overlay-desktop: host pid $(Get-Content (Join-Path $PidDir "overlay.pid"))"
    }
    if (Test-Path (Join-Path $PidDir "ipc.pid")) {
      Write-Host "process-manager-ipc: host pid $(Get-Content (Join-Path $PidDir "ipc.pid"))"
    }
  }
  "logs" {
    Invoke-Compose @(@("logs", "-f") + $Rest)
  }
  "reset-db" {
    Invoke-Compose @("run", "--rm", "-e", "POSTGRES_HOST=postgres", "-e", "POSTGRES_PORT=5432", "-e", "POSTGRES_DB=$env:POSTGRES_DB", "-e", "POSTGRES_USER=$env:POSTGRES_USER", "-e", "POSTGRES_PASSWORD=$env:POSTGRES_PASSWORD", "schema-bootstrap", "/bin/sh", "/workspace/infra/database/scripts/reset_dev.sh")
  }
}
