@echo off
cd /d "%~dp0"
python -m venv .venv
if errorlevel 1 goto erreur
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto erreur
echo Installation terminee. Lance demarrer-site.cmd puis demarrer-capteurs.cmd.
exit /b 0
:erreur
echo Installation impossible. Verifie Python et la connexion Internet.
pause
exit /b 1
