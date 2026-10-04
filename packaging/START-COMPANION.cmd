@echo off
setlocal
cd /d "%~dp0"
echo DriveKey companion - keep this folder on your Windows disk, not the USB.
"%~dp0node.exe" "%~dp0drivekey-companion.cjs"
pause
