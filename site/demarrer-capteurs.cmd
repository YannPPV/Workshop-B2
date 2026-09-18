@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Lance d'abord installer.cmd.
    pause
    exit /b 1
)
".venv\Scripts\python.exe" arduino\main.py %*
if errorlevel 1 pause
