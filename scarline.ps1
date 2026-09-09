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

function Test-RuntimeRequirements {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Error: Node.js is not installed."
  }

  $nodeVersionStr = node -v
  if ($nodeVersionStr -match "v(\d+)\.") {
    $nodeVersion = [int]$Matches[1]
    if ($nodeVersion -lt 20) {
      throw "Error: Node.js version 20 or higher is required. Found $nodeVersionStr"
    }
  }

  if (-not (Get-Command npm -ErrorAction SilentlyContinue) -and -not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw "Error: npm or pnpm is required."
  }
}

function Ensure-OverlayDependencies {
  if ($NoOverlay) {
    return
  }

  function Test-OverlayElectronBinary {
    $electronPath = Join-Path $RootDir "apps\desktop-overlay\node_modules\.bin\electron.cmd"
    if (-not (Test-Path $electronPath)) { return $false }
    & $electronPath --version *> $null
    return ($LASTEXITCODE -eq 0)
  }

  if (Test-OverlayElectronBinary) {
    return
  }

  Write-Host "Preparing desktop overlay dependencies"
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    & npm.cmd run build -w @scarline/desktop-overlay
  } elseif (Get-Command pnpm -ErrorAction SilentlyContinue) {
    & pnpm.cmd install --filter "@scarline/desktop-overlay..."
  }

  if (-not (Test-OverlayElectronBinary)) {
    Write-Warning "Electron runtime not yet ready; building overlay packages"
    & npm.cmd run build:overlays
  }

  if (-not (Test-OverlayElectronBinary)) {
    throw "Failed to prepare Electron runtime for desktop overlay"
  }
}

function Get-ConfigValue {
  param([string]$Key, [string]$Default = "")
  if (-not (Test-Path $ConfigFile)) {
    return $Default
  }

  if (Get-Command ConvertFrom-Yaml -ErrorAction SilentlyContinue) {
    try {
      $yaml = (Get-Content $ConfigFile -Raw | ConvertFrom-Yaml)
      $value = $yaml
      foreach ($part in ($Key -split "\.")) {
        if ($null -eq $value) {
          return $Default
        }
        $value = $value.$part
      }
      if ($null -ne $value -and "$value" -ne "") {
        return "$value"
      }
    } catch {
      # fallback to line scanner below
    }
  }

  # carla connection - 2026-09-01: fallback line scanner that supports dotted
  # nested YAML keys (e.g. "carla.server_path") without requiring ConvertFrom-Yaml.
  # Walks indentation levels: for "a.b.c" it finds "a:" then inside finds "b:" then "c: value".
  $content = Get-Content $ConfigFile
  $parts = $Key -split "\."

  # Try flat key first (backward-compat)
  foreach ($line in $content) {
    if ($line -match "^$Key\s*:\s*(.+)$") {
      return $Matches[1].Trim().Trim("'").Trim('"')
    }
  }

  # Walk nested key levels
  $currentDepth = 0
  $partIndex = 0
  for ($i = 0; $i -lt $content.Length; $i++) {
    $line = $content[$i]
    if ($line -match "^(\s*)([\w_-]+)\s*:\s*(.*)$") {
      $indent  = $Matches[1].Length
      $lineKey = $Matches[2]
      $lineVal = $Matches[3].Trim().Trim("'").Trim('"')

      if ($indent -eq $currentDepth -and $lineKey -eq $parts[$partIndex]) {
        if ($partIndex -eq $parts.Length - 1) {
          # Reached the final key
          if ($lineVal -ne "") { return $lineVal }
          return $Default
        }
        $partIndex++
        $currentDepth = $indent + 2  # expect next level indented by 2
      } elseif ($indent -lt $currentDepth -and $partIndex -gt 0) {
        # Stepped back out — reset search
        $partIndex = 0
        $currentDepth = 0
        $i--  # re-evaluate this line at the root level
      }
    }
  }
  return $Default
}

function ComposeArgs {
  $baseCompose = if (Test-Path (Join-Path $RootDir "compose.yml")) { "compose.yml" } else { "docker-compose.yml" }
  $args = @("-f", (Join-Path $RootDir $baseCompose))
  if ($Dev) {
    if (Test-Path (Join-Path $RootDir "compose.dev.yml")) {
      $args += @("-f", (Join-Path $RootDir "compose.dev.yml"))
    } elseif (Test-Path (Join-Path $RootDir "docker-compose.dev.yml")) {
      $args += @("-f", (Join-Path $RootDir "docker-compose.dev.yml"))
    }
  }
  if ($WidgetTest) {
    if (Test-Path (Join-Path $RootDir "compose.widget-test.yml")) {
      $args += @("-f", (Join-Path $RootDir "compose.widget-test.yml"))
    } elseif (Test-Path (Join-Path $RootDir "docker-compose.widget-test.yml")) {
      $args += @("-f", (Join-Path $RootDir "docker-compose.widget-test.yml"))
    }
  }
  if (-not $NoCarla) {
    $args += @("--profile", "carla")
  }
  return $args
}

function Invoke-Compose {
  param([string[]]$CommandArgs)
  $FullArgs = (ComposeArgs) + $CommandArgs
  & docker compose $FullArgs
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

  $carlaPath = Get-ConfigValue "carla.server_path" ""
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
    $targetPid = Get-Content $pidFile
    Stop-Process -Id $targetPid -ErrorAction SilentlyContinue
    Remove-Item $pidFile -Force
  }
}

function Start-KeyboardDriver {
  if ($NoCarla) {
    return
  }

  # carla connection - 2026-09-01: carla==0.9.16 wheel requires Python 3.10+.
  # Prefer py -3.12 (which has the matching carla wheel installed) over the
  # system python (3.7 which has 0.9.14 and causes a binary mismatch crash).
  $pythonExe = $null
  if (Get-Command py -ErrorAction SilentlyContinue) {
    $test312 = & py -3.12 -c "import carla" 2>$null; if ($LASTEXITCODE -eq 0) { $pythonExe = "py -3.12" }
    if (-not $pythonExe) {
      $test310 = & py -3.10 -c "import carla" 2>$null; if ($LASTEXITCODE -eq 0) { $pythonExe = "py -3.10" }
    }
  }
  if (-not $pythonExe -and (Get-Command python -ErrorAction SilentlyContinue)) {
    $pythonExe = "python"
  }
  if (-not $pythonExe) {
    Write-Warning "python not installed; skipping keyboard driver"
    return
  }

  $pidFile = Join-Path $PidDir "keyboard-driver.pid"
  if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile
    if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
      return
    }
  }

  $driverScript = Join-Path $RootDir "python\carla-client\scarline_carla\pygame_driver.py"
  if (-not (Test-Path $driverScript)) {
    Write-Warning "pygame_driver.py not found at $driverScript; skipping keyboard driver"
    return
  }

  $logOut = Join-Path $LogDir "keyboard-driver.log"
  $logErr = Join-Path $LogDir "keyboard-driver.err.log"

  # Launch in a new window so the PyGame window gets its own process group
  # and receives keyboard focus independently of the terminal.
  # $pythonExe may be "py -3.12", "py -3.10", or "python" — split accordingly.
  $pyParts = $pythonExe -split " "
  $pyBin   = $pyParts[0]
  $pyArgs  = if ($pyParts.Count -gt 1) { @($pyParts[1], "-u", $driverScript) } else { @("-u", $driverScript) }

  $process = Start-Process -FilePath $pyBin `
    -ArgumentList $pyArgs `
    -RedirectStandardOutput $logOut `
    -RedirectStandardError  $logErr `
    -PassThru

  Set-Content -Path $pidFile -Value $process.Id
  Write-Host "SCARline keyboard driver started (pid $($process.Id)) using $pythonExe"
}

function Stop-KeyboardDriver {
  $pidFile = Join-Path $PidDir "keyboard-driver.pid"
  if (Test-Path $pidFile) {
    $targetPid = Get-Content $pidFile
    Stop-Process -Id $targetPid -ErrorAction SilentlyContinue
    Remove-Item $pidFile -Force
  }
}

function Start-OverlayDesktop {
  if ($NoOverlay) {
    return
  }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue) -and -not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Warning "npm or pnpm not installed; skipping transparent overlay launch"
    return
  }

  Ensure-OverlayDependencies

  $pidFile = Join-Path $PidDir "overlay.pid"
  if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile
    if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
      return
    }
  }

  $env:OVERLAY_URL = if ($env:OVERLAY_URL) { $env:OVERLAY_URL } else { "http://localhost:$env:SCARLINE_PORT/overlay/?chrome=transparent" }
  $env:OVERLAY_CONTROL_PORT = $OverlayControlPort
  $pkgRunner = if (Get-Command npm -ErrorAction SilentlyContinue) { "npm.cmd" } else { "pnpm.cmd" }
  $pkgArgs = if ($pkgRunner -eq "npm.cmd") { @("start", "-w", "@scarline/desktop-overlay") } else { @("--dir", (Join-Path $RootDir "apps/desktop-overlay"), "start") }
  $process = Start-Process -FilePath $pkgRunner -ArgumentList $pkgArgs -RedirectStandardOutput (Join-Path $LogDir "overlay-desktop.log") -RedirectStandardError (Join-Path $LogDir "overlay-desktop.err.log") -PassThru
  Set-Content -Path $pidFile -Value $process.Id
  Start-Sleep -Seconds 2
  if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
    Write-Error "Desktop overlay process exited during startup."
    if (Test-Path (Join-Path $LogDir "overlay-desktop.log")) {
      Get-Content (Join-Path $LogDir "overlay-desktop.log") -Tail 40 | Write-Host
    }
    throw "Overlay startup failed"
  }
}

function Stop-OverlayDesktop {
  $pidFile = Join-Path $PidDir "overlay.pid"
  if (Test-Path $pidFile) {
    $targetPid = Get-Content $pidFile
    Stop-Process -Id $targetPid -ErrorAction SilentlyContinue
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
  $env:CARLA_SERVER_PATH = Get-ConfigValue "carla.server_path" ""
  $env:CARLA_SERVER_PORT = if ($env:CARLA_SERVER_PORT) { $env:CARLA_SERVER_PORT } else { "2000" }
  $env:SCARLINE_CARLA_QUALITY = Get-ConfigValue "carla.quality" "Epic"
  $process = Start-Process -FilePath "python" -ArgumentList @((Join-Path $RootDir "infra/process-manager/ipc_server.py"), $socketPath, $RuntimeDir) -RedirectStandardOutput (Join-Path $LogDir "process-manager-ipc.log") -RedirectStandardError (Join-Path $LogDir "process-manager-ipc.err.log") -PassThru
  Set-Content -Path $pidFile -Value $process.Id
}

function Stop-IpcServer {
  $pidFile = Join-Path $PidDir "ipc.pid"
  if (Test-Path $pidFile) {
    $targetPid = Get-Content $pidFile
    Stop-Process -Id $targetPid -ErrorAction SilentlyContinue
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

function Start-Supervisor {
  $pidFile = Join-Path $PidDir "supervisor.pid"
  if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile
    if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
      return
    }
  }

  $composeFiles = @("-f", (Join-Path $RootDir "docker-compose.yml"))
  if ($Dev) { $composeFiles += @("-f", (Join-Path $RootDir "docker-compose.dev.yml")) }
  if ($WidgetTest) { $composeFiles += @("-f", (Join-Path $RootDir "docker-compose.widget-test.yml")) }

  $services = @("postgres","rabbitmq","core-api","sim-bridge","admin-panel","overlay-web","io-client","nginx","mock-simulator")
  if (-not $NoCarla) { $services += "carla-client" }

  $cmd = @"
`$ErrorActionPreference = 'SilentlyContinue'
`$restartCounts = @{}
`$nextRetryAt = @{}
`$maxRestarts = 5
`$backoffBase = 5
function Can-Restart([string]`$name) {
  if (-not `$nextRetryAt.ContainsKey(`$name)) { return `$true }
  return (Get-Date) -ge `$nextRetryAt[`$name]
}
function Mark-Failed([string]`$name) {
  `$count = if (`$restartCounts.ContainsKey(`$name)) { [int]`$restartCounts[`$name] + 1 } else { 1 }
  `$restartCounts[`$name] = `$count
  if (`$count -gt `$maxRestarts) {
    `$nextRetryAt[`$name] = (Get-Date).AddSeconds(300)
    return
  }
  `$delay = [Math]::Min(120, `$backoffBase * [Math]::Pow(2, `$count - 1))
  `$nextRetryAt[`$name] = (Get-Date).AddSeconds([int]`$delay)
}
function Mark-Healthy([string]`$name) {
  `$restartCounts[`$name] = 0
  `$nextRetryAt[`$name] = Get-Date
}
while (`$true) {
  try {
    if (-not (Test-Path '$PidDir\ipc.pid') -or -not (Get-Process -Id (Get-Content '$PidDir\ipc.pid') -ErrorAction SilentlyContinue)) {
      if (Can-Restart 'process-manager-ipc') {
        & python '$RootDir/infra/process-manager/ipc_server.py' 'tcp://127.0.0.1:4098' '$RuntimeDir' >> '$LogDir/process-manager-ipc.log' 2>> '$LogDir/process-manager-ipc.err.log' &
        Mark-Failed 'process-manager-ipc'
      }
    } else {
      Mark-Healthy 'process-manager-ipc'
    }

    if (-not '$NoOverlay' -and (Test-Path '$PidDir\overlay.pid')) {
      `$overlayPid = Get-Content '$PidDir\overlay.pid'
      `$overlayProc = Get-Process -Id `$overlayPid -ErrorAction SilentlyContinue
      `$overlayHealthy = `$false
      try {
        `$resp = Invoke-WebRequest -Uri 'http://127.0.0.1:$OverlayControlPort/health' -Method Get -TimeoutSec 2 -UseBasicParsing
        `$overlayHealthy = `$resp.StatusCode -ge 200 -and `$resp.StatusCode -lt 300
      } catch {}
      if (-not `$overlayProc -or -not `$overlayHealthy) {
        if (Can-Restart 'overlay-desktop') {
          if (Get-Command npm -ErrorAction SilentlyContinue) {
            & npm.cmd start -w @scarline/desktop-overlay >> '$LogDir/overlay-desktop.log' 2>> '$LogDir/overlay-desktop.err.log' &
          } else {
            & pnpm.cmd --dir '$RootDir/apps/desktop-overlay' start >> '$LogDir/overlay-desktop.log' 2>> '$LogDir/overlay-desktop.err.log' &
          }
          Mark-Failed 'overlay-desktop'
        }
      } else {
        Mark-Healthy 'overlay-desktop'
      }
    }

    foreach (`$svc in @($($services -join "','"))) {
      `$json = & docker compose $($composeFiles -join ' ') ps --format json `$svc 2>`$null
      if (-not `$json -or `$json -match '"State"\s*:\s*"exited"' -or `$json -match '"Health"\s*:\s*"unhealthy"') {
        if (Can-Restart "docker-`$svc") {
          & docker compose $($composeFiles -join ' ') up -d `$svc >> '$LogDir/supervisor.log' 2>&1
          Mark-Failed "docker-`$svc"
        }
      } else {
        Mark-Healthy "docker-`$svc"
      }
    }
  } catch {}
  Start-Sleep -Seconds 15
}
"@

  $process = Start-Process -FilePath "powershell" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $cmd) -PassThru
  Set-Content -Path $pidFile -Value $process.Id
}

function Stop-Supervisor {
  $pidFile = Join-Path $PidDir "supervisor.pid"
  if (Test-Path $pidFile) {
    $targetPid = Get-Content $pidFile
    Stop-Process -Id $targetPid -ErrorAction SilentlyContinue
    Remove-Item $pidFile -Force
  }
}

function Wait-ForHttp {
  param([string]$Url, [string]$Label, [int]$Attempts = 24)
  for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 2 -UseBasicParsing
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        return
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  throw "Timed out waiting for $Label"
}

function Wait-ForOverlayHealth {
  if ($NoOverlay) {
    return
  }

  $pidFile = Join-Path $PidDir "overlay.pid"
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (-not (Test-Path $pidFile)) {
      break
    }
    $overlayPid = Get-Content $pidFile
    if (-not (Get-Process -Id $overlayPid -ErrorAction SilentlyContinue)) {
      break
    }
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$OverlayControlPort/health" -Method Get -TimeoutSec 2 -UseBasicParsing
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
        return
      }
    } catch {}
    Start-Sleep -Seconds 2
  }

  Write-Error "Timed out waiting for Overlay desktop health."
  if (Test-Path (Join-Path $LogDir "overlay-desktop.log")) {
    Get-Content (Join-Path $LogDir "overlay-desktop.log") -Tail 60 | Write-Host
  }
  throw "Overlay desktop health check failed"
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
    Test-RuntimeRequirements
    Invoke-Compose @("up", "--build", "-d", "postgres", "rabbitmq", "schema-bootstrap")
    Wait-ForComposeHealth @("postgres", "rabbitmq")
    Wait-ForComposeExit "schema-bootstrap"
    Invoke-Compose @("up", "--build", "-d", "core-api", "sim-bridge", "admin-panel", "overlay-web", "docs", "io-client", "nginx")
    Wait-ForComposeHealth @("core-api", "sim-bridge", "admin-panel", "overlay-web", "io-client", "nginx")
    if ($NoCarla) {
      Invoke-Compose @("up", "--build", "-d", "mock-simulator")
      Wait-ForComposeHealth @("mock-simulator")
    } else {
      Invoke-Compose @("up", "--build", "-d", "mock-simulator", "carla-client")
      Wait-ForComposeHealth @("mock-simulator", "carla-client")
    }
    Start-OverlayDesktop
    Start-IpcServer
    Start-Supervisor
    Wait-ForHttp "http://127.0.0.1:$env:SCARLINE_PORT/api/health" "CoreAPI health"
    if (-not $NoOverlay) {
      Wait-ForOverlayHealth
    }
    Wait-ForHttp "http://127.0.0.1:4098/status" "Process manager IPC"
    Open-Admin
    Write-Host "SCARline started on http://localhost:$env:SCARLINE_PORT"
  }
  "stop" {
    Stop-Supervisor
    Stop-IpcServer
    Stop-OverlayDesktop
    Stop-KeyboardDriver
    Invoke-Compose @("down")
  }
  "restart" {
    Stop-Supervisor
    Stop-IpcServer
    Stop-OverlayDesktop
    Stop-KeyboardDriver
    Invoke-Compose @("down")
    Invoke-Compose @("up", "--build", "-d", "postgres", "rabbitmq", "schema-bootstrap")
    Wait-ForComposeHealth @("postgres", "rabbitmq")
    Wait-ForComposeExit "schema-bootstrap"
    Invoke-Compose @("up", "--build", "-d", "core-api", "sim-bridge", "admin-panel", "overlay-web", "docs", "io-client", "nginx", "mock-simulator")
    if (-not $NoCarla) {
      Invoke-Compose @("up", "--build", "-d", "carla-client")
    }
    Start-OverlayDesktop
    Start-IpcServer
    Start-Supervisor
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
    if (Test-Path (Join-Path $PidDir "supervisor.pid")) {
      Write-Host "supervisor: host pid $(Get-Content (Join-Path $PidDir "supervisor.pid"))"
    }
    if (Test-Path (Join-Path $PidDir "keyboard-driver.pid")) {
      Write-Host "keyboard-driver: host pid $(Get-Content (Join-Path $PidDir "keyboard-driver.pid"))"
    }
  }
  "logs" {
    Invoke-Compose @(@("logs", "-f") + $Rest)
  }
  "reset-db" {
    Invoke-Compose @("run", "--rm", "-e", "POSTGRES_HOST=postgres", "-e", "POSTGRES_PORT=5432", "-e", "POSTGRES_DB=$env:POSTGRES_DB", "-e", "POSTGRES_USER=$env:POSTGRES_USER", "-e", "POSTGRES_PASSWORD=$env:POSTGRES_PASSWORD", "schema-bootstrap", "/bin/sh", "/workspace/infra/database/scripts/reset_dev.sh")
  }
}
