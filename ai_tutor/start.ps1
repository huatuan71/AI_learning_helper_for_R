param(
    [ValidateRange(1,65535)][int]$Port = 8000,
    [string]$PythonExe = (Join-Path $PSScriptRoot '.venv\Scripts\python.exe')
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$serverScript = Join-Path $projectRoot 'scripts\serve.py'
$runtimeDir = Join-Path $projectRoot '.runtime'
if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Run setup.cmd first to install the project environment.' }
$probe = New-Object System.Net.Sockets.TcpClient
try {
    $connected = $probe.ConnectAsync('127.0.0.1',$Port).Wait(700)
    if ($connected -and $probe.Connected) { throw "Port $Port is already in use. Check the existing service or choose -Port." }
} catch [System.AggregateException] {
    # Connection refused means this local port is available.
} finally { $probe.Dispose() }
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$server = Start-Process -FilePath $pythonExe -ArgumentList @(('"' + $serverScript + '"'), '--port', $Port) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'server.out.log') -RedirectStandardError (Join-Path $runtimeDir 'server.err.log')
@{ pid=$server.Id; started=$server.StartTime.ToUniversalTime().ToString('o'); script=$serverScript; port=$Port } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'server.json') -Encoding UTF8
for ($attempt=0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($server.HasExited) { throw 'Service exited. Check .runtime/server.err.log.' }
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        if ($health.version) {
            Write-Output "Ready: http://127.0.0.1:$Port"
            Write-Output "API docs: http://127.0.0.1:$Port/docs"
            Write-Output 'Use stop.cmd to stop this project service.'
            exit 0
        }
    } catch { }
}
throw 'Startup timed out. Check .runtime/server.err.log and use stop.cmd before retrying.'
