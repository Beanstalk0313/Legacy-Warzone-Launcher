@echo off

tasklist /FI "IMAGENAME eq bootstrapper.exe" | find /I "bootstrapper.exe" >nul
if %ERRORLEVEL%==0 (
    taskkill /F /IM bootstrapper.exe
)
cd /d "%~dp0CoD"
start "" bootstrapper.exe cod.exe

exit