@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Claude Code - Clipboard Watcher (line by line)
echo ============================================================
echo  Claude Code response  to clipboard (line by line)
echo  watcher starting...
echo  Press Ctrl+C or close this window to stop.
echo ============================================================
echo.

REM To change per-line interval (ms), uncomment and edit:
REM set LRAC_DRAIN_MS=250
REM To disable speech normalization, uncomment the next line:
REM set LRAC_NO_NORMALIZE=1

node watch-claudecode.js

echo.
echo (watcher stopped)
pause
