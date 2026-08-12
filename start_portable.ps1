# start_portable.ps1 – Lanza el agente IA de WhatsApp usando Node.js portable

$projDir = "C:/Users/prada/Desktop/kalsita 2/whatsapp_ai_agent"
Set-Location $projDir

$nodeVersion = 'v20.12.0'
$nodeDir = Join-Path $env:TEMP "node-$nodeVersion-win-x64"
$nodeExe = Join-Path $nodeDir "node.exe"
$npmCmd  = Join-Path $nodeDir "npm.cmd"

# 1️⃣ Descargar Node.js (portable) si no existe
if (-not (Test-Path $nodeExe)) {
    $zipUrl  = "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-win-x64.zip"
    $zipPath = "$env:TEMP\node.zip"
    Write-Host "Downloading Node.js $nodeVersion ..."
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    Write-Host "Extracting Node.js ..."
    Expand-Archive -Path $zipPath -DestinationPath $env:TEMP -Force
}

$env:PATH = "$nodeDir;$env:PATH"
Write-Host "Node version: & '$nodeExe' -v"

# 2️⃣ Instalar dependencias del proyecto
Write-Host "Installing npm dependencies..."
& $npmCmd install

# 3️⃣ Lanzar el servidor Express
Write-Host "Launching server on http://localhost:3000 ..."
$serverProc = Start-Process -FilePath $nodeExe -ArgumentList "server.js" -WorkingDirectory $projDir -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 2

# 4️⃣ Abrir navegador
Start-Process "http://localhost:3000"

Write-Host "Server is running on http://localhost:3000"
Write-Host "Press ENTER to stop the server."
Read-Host "Press ENTER to stop the server"
if ($serverProc -and -not $serverProc.HasExited) {
    Stop-Process -Id $serverProc.Id -Force
}
Write-Host "Server stopped."
