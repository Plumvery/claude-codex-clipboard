@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Clipboard to OpenAI TTS (read aloud)
echo ============================================================
echo  Read clipboard aloud with OpenAI TTS (gpt-4o-mini-tts)
echo  starting...
echo  Press Ctrl+C or close this window to stop.
echo ============================================================
echo.

set LRAC_TTS_ENGINE=openai

REM Required: your OpenAI API key. Set it in your environment, or here:
REM set OPENAI_API_KEY=sk-...

REM Model (default gpt-4o-mini-tts; cheap and steerable):
REM set LRAC_OPENAI_TTS_MODEL=gpt-4o-mini-tts

REM Voice: alloy/ash/ballad/coral/echo/fable/onyx/nova/sage/shimmer/verse
REM set LRAC_OPENAI_VOICE=alloy

REM Steer the delivery (gpt-4o-mini-tts only). For Japanese instructions,
REM prefer setting this in PowerShell/env (UTF-8). Example:
REM set LRAC_OPENAI_INSTRUCTIONS=Speak in a calm, low voice with clear pauses.

if "%OPENAI_API_KEY%"=="" echo [!] OPENAI_API_KEY is not set. Set it before use.

node speak-clipboard.js

echo.
echo (reader stopped)
pause
