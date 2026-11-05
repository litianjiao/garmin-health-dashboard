@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   MORU Health Dashboard
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js 20 or newer.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo [Setup] Building frontend for first run...
  call npm run build
  if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
  )
)

if not exist "node_modules" (
  echo [Setup] Installing dependencies for first run...
  call npm install
)

set NODE_ENV=production
if not defined PORT set PORT=8787

echo Starting server... browser will open automatically.
echo Close this window to stop the server.
echo.

start "" http://127.0.0.1:%PORT%

call npx tsx server/index.ts

echo.
echo Server stopped.
pause
