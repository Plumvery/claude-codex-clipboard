@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Claude Code stream to clipboard (block by block)
echo ============================================================
echo  Streaming Claude Code response to clipboard (block by block)
echo  Pair this with the reader (start-speak-openai.bat).
echo  Press Ctrl+C or close this window to stop.
echo ============================================================
echo.

REM Pacing and options are read from .env
REM   LRAC_TTS_INTERRUPT=0   reader queues every copy (does not drop)
REM   LRAC_MS_PER_CHAR=80    how long each line is held (smaller = copy faster)
REM   LRAC_MIN_WAIT=600      minimum hold per line (ms); must stay above the
REM                          reader poll (LRAC_POLL_MS, default 300) so nothing is missed
REM Do NOT set LRAC_RESET_MODE=blank here: the reader needs the text to stay on
REM the clipboard long enough to be picked up.

REM Use this INSTEAD of the Stop hook (disable the Stop hook to avoid double reading).

node watch-claudecode.js

echo.
echo (stream watcher stopped)
pause
