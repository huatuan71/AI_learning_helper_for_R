@echo off
cd /d "%~dp0"
if not exist ".tmp" mkdir ".tmp"
set "TEMP=%~dp0.tmp"
set "TMP=%~dp0.tmp"
py -3.12 -m venv .venv
if errorlevel 1 goto failed
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto failed
echo Ready. Run start.cmd next.
pause
exit /b 0
:failed
echo Setup failed. Check Python 3.12 and your network connection.
pause
exit /b 1
