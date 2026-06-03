@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Codex - Clipboard Watcher
echo ============================================================
echo  Codex response  to clipboard : watcher starting...
echo  Press Ctrl+C or close this window to stop.
echo ============================================================
echo.

REM To copy full text including code, uncomment the next line:
REM set LRAC_RAW=1
REM To disable speech normalization, uncomment the next line:
REM set LRAC_NO_NORMALIZE=1

node watch-codex.js

echo.
echo (watcher stopped)
pause
