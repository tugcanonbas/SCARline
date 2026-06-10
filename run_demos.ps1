Write-Host "Iniciando Demos de Sensores de SCARline..." -ForegroundColor Cyan

# Definir la URL de RabbitMQ para los simuladores
$env:AMQP_URL = "amqp://scarline:scarline@localhost:5672/"

# Iniciar Cámara (demo_camera_server.py)
Write-Host "Levantando MediaPipe Blink Detection..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd python\io-client; python demo_camera_server.py"

# Iniciar ECG (demo_ecg.py) — Live mode, connects to SiFi Bridge BLE
Write-Host "Levantando ECG via SiFi Bridge BLE..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd python\io-client; python demo_ecg.py"

# Iniciar Volante (demo_g29.py)
Write-Host "Levantando Simulador de Volante G29..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd python\io-client; python demo_g29.py --dry-run"

Write-Host "Scripts de Python iniciados en ventanas separadas." -ForegroundColor Green
Write-Host "Levantando Servidor Web para los Dashboards..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd tools\dashboards; python -m http.server 8000"

Write-Host "Abriendo los Dashboards en el navegador..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
Start-Process "http://localhost:8000/camera.html"
Start-Process "http://localhost:8000/ecg.html"
Start-Process "http://localhost:8000/g29.html"
Start-Process "http://localhost:8000/combined.html"

Write-Host "¡Listo! Los dashboards están disponibles en el navegador." -ForegroundColor Green
