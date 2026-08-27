@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb runAs"
    exit /b
)

sc.exe stop atvi-randgrid_sr >nul 2>&1
sc.exe delete atvi-randgrid_sr >nul 2>&1
sc.exe create atvi-randgrid_sr type= kernel binPath= "%~dp0CoD\Randgrid.sys"
sc.exe sdset atvi-randgrid_sr D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWRPWPLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)S:(AU;FA;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;WD)