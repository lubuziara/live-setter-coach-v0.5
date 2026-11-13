@echo off
cd /d "%~dp0"

if not exist ".env" (
  echo.
  echo Brakuje pliku .env.
  echo Zmien nazwe pliku .env.example na .env i wklej do niego klucz OpenAI API.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Nie znaleziono programu Node.js.
  echo Zainstaluj Node.js albo popros o przygotowanie wersji bez instalacji.
  echo.
  pause
  exit /b 1
)

start "" "http://localhost:4173"
node server.mjs
pause
