@echo off
rem Double-click to start the dev server and open the browser.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 8080 -Open "?dev=1"
pause
