@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Clipboard to AivisSpeech (read aloud)
echo ============================================================
echo  Read clipboard aloud with AivisSpeech (local TTS)
echo  starting...
echo  Press Ctrl+C or close this window to stop.
echo ============================================================
echo.

REM Requires the AivisSpeech app (engine) to be running. Default URL is
REM http://127.0.0.1:10101 . Change the engine URL if needed:
REM set LRAC_AIVIS_URL=http://127.0.0.1:10101

REM Voice (style ID). Default 888753760 = Anneli / normal.
REM List available IDs with:  node speak-clipboard.js --speakers
REM set LRAC_AIVIS_SPEAKER=888753760

REM Speaking rate (1.0 = normal, bigger = faster):
REM set LRAC_AIVIS_SPEED=1.0

REM When a new copy arrives: by default the current chunk finishes, then it
REM switches to the new text. Cut immediately instead:
REM set LRAC_TTS_CUT=1
REM Or queue everything without interrupting:
REM set LRAC_TTS_INTERRUPT=0

REM Also read whatever is already on the clipboard at startup:
REM set LRAC_TTS_SPEAK_ON_START=1

node speak-clipboard.js

echo.
echo (reader stopped)
pause
