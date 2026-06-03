# One command to run the game (Windows PowerShell)
# Default: Vite dev server (UI hot reload) + backend API
# Use -Prod for a production build served only from Python (no hot reload)
param(
    [int]$Port = 0,
    [switch]$Reload,
    [switch]$Prod,
    [switch]$Dev
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Test-PortFree([int]$p) {
    return -not (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

function Find-FreePort([int]$preferred) {
    if ($preferred -gt 0 -and (Test-PortFree $preferred)) { return $preferred }
    foreach ($p in 8000, 8001, 8002, 8003, 8080, 3000) {
        if (Test-PortFree $p) { return $p }
    }
    return 0
}

Write-Host "Installing Python packages..." -ForegroundColor Cyan
python -m pip install -r requirements.txt -q

Push-Location frontend
if (-not (Test-Path node_modules)) {
    Write-Host "Installing npm packages..." -ForegroundColor Cyan
    npm install
}
Pop-Location

$listenPort = Find-FreePort $Port
if ($listenPort -eq 0) {
    throw 'No free port found (tried 8000-8003, 8080, 3000). Stop other servers and retry.'
}

if ($Port -eq 8000 -and $listenPort -ne 8000) {
    $blocker = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty OwningProcess
    Write-Warning "Port 8000 is in use (PID $blocker). Using port $listenPort instead."
    Write-Host "  To free 8000: Stop-Process -Id $blocker -Force" -ForegroundColor DarkGray
}

if (-not $Prod -or $Dev) {
    $backendArgs = @("-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "$listenPort")
    if ($Reload) { $backendArgs += "--reload" }

    Write-Host ""
    Write-Host "  Dev mode - UI hot reload at http://127.0.0.1:5173" -ForegroundColor Green
    Write-Host "  Backend API at http://127.0.0.1:$listenPort" -ForegroundColor DarkGray
    Write-Host "  Press Ctrl+C to stop both servers." -ForegroundColor DarkGray
    Write-Host ""

    $backend = Start-Process -FilePath "python" -ArgumentList $backendArgs -PassThru -WorkingDirectory $PSScriptRoot
    Push-Location frontend
    $env:VITE_BACKEND_URL = "http://127.0.0.1:$listenPort"
    try {
        npm run dev
    } finally {
        Pop-Location
        if ($backend -and -not $backend.HasExited) {
            Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
        }
    }
    exit
}

Write-Host "Building React UI..." -ForegroundColor Cyan
Push-Location frontend
npm run build
Pop-Location

$indexHtml = Join-Path $PSScriptRoot "frontend\dist\index.html"
if (-not (Test-Path $indexHtml)) {
    throw 'Build failed: frontend\dist\index.html missing'
}

$reloadFlag = if ($Reload) { "--reload" } else { "" }

Write-Host ""
Write-Host ('  M&M Game -> http://127.0.0.1:' + $listenPort) -ForegroundColor Green
Write-Host '  Press Ctrl+C to stop.' -ForegroundColor DarkGray
Write-Host ""

if ($reloadFlag) {
    python -m uvicorn backend.main:app --host 127.0.0.1 --port $listenPort --reload
} else {
    python -m uvicorn backend.main:app --host 127.0.0.1 --port $listenPort
}