@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Codex - Clipboard Watcher
echo ============================================================
echo  Codex response  to clipboard : watcher starting...
echo  Press Ctrl+C or close this window to stop.
echo ============================================================
echo.

REM Clear the clipboard shortly after each copy so a TTS that "restores the
REM previous clipboard" (e.g. Aqua Voice) does not re-read the previous item.
REM Set to off if you want the text to stay on the clipboard (e.g. to paste it).
set LRAC_RESET_MODE=blank
REM set LRAC_RESET_MS=150

REM To copy full text including code, uncomment the next line:
REM set LRAC_RAW=1
REM To disable speech normalization, uncomment the next line:
REM set LRAC_NO_NORMALIZE=1

node watch-codex.js

echo.
echo (watcher stopped)
pause
