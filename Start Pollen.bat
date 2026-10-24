@echo off
title Pollen
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies - first run only...
  call npm install || goto :error
)
echo Building the app...
call npx vite build || goto :error
start "" http://127.0.0.1:4317
call npx tsx server/index.ts
goto :eof

:error
echo.
echo Something went wrong. Make sure Node.js 22+ is installed: https://nodejs.org
pause
