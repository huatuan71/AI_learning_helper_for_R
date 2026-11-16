$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $PSScriptRoot '.runtime\server.json'
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Output 'No project service record.'; exit 0 }
$state = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
$server = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
if (-not $server) { Write-Output 'Project service is already stopped.'; exit 0 }
$actual = $server.StartTime.ToUniversalTime().Ticks
# PowerShell 7 may deserialize ISO timestamps to DateTime; Windows PowerShell keeps strings.
$recorded = ([datetime]$state.started).ToUniversalTime().Ticks
$command = (Get-CimInstance Win32_Process -Filter "ProcessId = $($state.pid)").CommandLine
$expectedScript = Join-Path $PSScriptRoot 'scripts\serve.py'
if ($actual -ne $recorded -or -not $command -or -not $command.Contains($expectedScript)) {
    throw 'Process identity does not match this project. Nothing was stopped.'
}
# Windows venv python.exe may launch a base-interpreter child. Stop only children
# that belong to the verified parent and execute this exact project script.
$workers = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($state.pid)" |
    Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -and $_.CommandLine.Contains('"' + $expectedScript + '"') }
foreach ($worker in $workers) {
    $liveWorker = Get-Process -Id $worker.ProcessId -ErrorAction SilentlyContinue
    if ($liveWorker -and $liveWorker.StartTime.ToUniversalTime().Ticks -ge $actual) {
        Stop-Process -Id $worker.ProcessId -ErrorAction SilentlyContinue
    }
}
Stop-Process -Id $state.pid -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $stateFile
Write-Output 'Project service stopped.'
