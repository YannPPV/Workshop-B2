@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Lance d'abord installer.cmd.
    pause
    exit /b 1
)
echo Ouvre http://127.0.0.1:8000 dans ton navigateur.
".venv\Scripts\python.exe" -m uvicorn server.main:app --host 127.0.0.1 --port 8000
if errorlevel 1 pause
