@echo off
title TVTK 110kV NPSC Dashboard Server
cd /d "%~dp0"

echo ==================================================
echo   DANG KHOI DONG HE THONG QUAN LY TVTK 110kV NPSC
echo ==================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_server.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [THONG BAO] Khong the khoi dong qua PowerShell.
    echo Dang mo truc tiep index.html qua trinh duyet...
    start "" "%~dp0index.html"
)

pause
