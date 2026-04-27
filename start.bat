@echo off
REM ============================================================================
REM Rogue Hero 3 - one-click launcher (Windows)
REM
REM Builds the production bundle and launches the game in a standalone
REM Electron window. No browser, no separate preview server, no URL bar.
REM Close the game window to exit.
REM ============================================================================

setlocal
cd /d "%~dp0game"

REM --- Install deps if Electron isn't already in node_modules ----------------
REM Checks the specific electron folder (not just node_modules) so users with
REM a pre-Electron checkout still get the new dep installed automatically.
if not exist "node_modules\electron" (
  echo [start.bat] First-time setup: installing dependencies.
  echo [start.bat] Note: Electron is ~200MB and may take a couple minutes on
  echo [start.bat] the first run. Subsequent launches will skip this step.
  call npm install
  if errorlevel 1 (
    echo.
    echo [start.bat] npm install failed. Make sure Node.js is installed:
    echo [start.bat]   https://nodejs.org/  (LTS recommended)
    pause
    exit /b 1
  )
)

REM --- Build the production bundle ------------------------------------------
echo [start.bat] Building production bundle...
call npm run build
if errorlevel 1 (
  echo.
  echo [start.bat] Build failed. See errors above.
  pause
  exit /b 1
)

REM --- Launch the standalone Electron window --------------------------------
echo.
echo [start.bat] Launching Rogue Hero 3 (close the game window to exit)
echo.
call npm run electron
