@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if errorlevel 1 goto :fail

where git >nul 2>&1
if errorlevel 1 (
    echo ERROR: Git is not available on PATH. Nothing was updated or launched.
    goto :fail
)

for /f "delims=" %%B in ('git branch --show-current') do set "CURRENT_BRANCH=%%B"
if /I not "%CURRENT_BRANCH%"=="main" (
    echo ERROR: Expected Asset Forge main, found "%CURRENT_BRANCH%".
    echo No pull, build, or launch was attempted.
    goto :fail
)

echo [1/3] Pulling latest Asset Forge main...
git pull --ff-only origin main
if errorlevel 1 (
    echo ERROR: Git pull failed. Build and launch were skipped.
    echo Resolve local changes or branch divergence, then retry.
    goto :fail
)

echo [2/3] Building release and [3/3] launching Asset Forge...
call "%~dp0launch-asset-forge.cmd" -Release
if errorlevel 1 (
    echo ERROR: Release build or launch failed. Review the output above.
    goto :fail
)

echo Asset Forge launch requested successfully.
exit /b 0

:fail
echo.
pause
exit /b 1
