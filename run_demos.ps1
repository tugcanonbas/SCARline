Write-Host "Iniciando Demos de Sensores de SCARline..." -ForegroundColor Cyan

# Definir la URL de RabbitMQ para los simuladores
$env:AMQP_URL = "amqp://scarline:scarline@localhost:5672/"

$processes = @()

Write-Host "Levantando MediaPipe Blink Detection..."
$processes += Start-Process python -ArgumentList "python\io-client\demo_camera_server.py" -NoNewWindow -PassThru

Write-Host "Levantando ECG via SiFi Bridge BLE..."
$processes += Start-Process python -ArgumentList "python\io-client\demo_ecg.py" -NoNewWindow -PassThru

Write-Host "Levantando Simulador de Volante G29..."
$processes += Start-Process python -ArgumentList "python\io-client\demo_g29.py --dry-run" -NoNewWindow -PassThru

Write-Host "Levantando Servidor Web para los Dashboards..." -ForegroundColor Cyan
$processes += Start-Process python -ArgumentList "-m http.server 8000 --directory tools\dashboards" -NoNewWindow -PassThru

Write-Host "Abriendo los Dashboards en el navegador..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
Start-Process "http://localhost:8000/camera.html"
Start-Process "http://localhost:8000/ecg.html"
Start-Process "http://localhost:8000/g29.html"
Start-Process "http://localhost:8000/combined.html"

Write-Host ""
Write-Host "¡Todo está corriendo en esta terminal!" -ForegroundColor Green
Write-Host "⚠️  PRESIONA 'Ctrl + C' AQUÍ PARA DETENER TODOS LOS SENSORES DE FORMA SEGURA ⚠️" -ForegroundColor Red
Write-Host ""

try {
    # Esperar infinitamente hasta que el usuario presione Ctrl+C
    Wait-Process -Id $processes.Id
}
finally {
    Write-Host "`nDeteniendo todos los procesos..." -ForegroundColor Yellow
    foreach ($p in $processes) {
        if (-not $p.HasExited) {
            # El Ctrl+C ya debió llegarles porque comparten la consola, pero por si acaso
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host "Procesos finalizados." -ForegroundColor Green
}
