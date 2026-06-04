# start-speak-aivis.ps1
# Watch the clipboard and read new text aloud with AivisSpeech (local TTS).
# Usage:  powershell -ExecutionPolicy Bypass -File start-speak-aivis.ps1
#
# Requires the AivisSpeech app (engine) running at http://127.0.0.1:10101 .
# Optional settings (set before running):
#   $env:LRAC_AIVIS_SPEAKER = "888753760"  # voice/style id (see: node speak-clipboard.js --speakers)
#   $env:LRAC_AIVIS_SPEED   = "1.0"        # speaking rate
#   $env:LRAC_TTS_CUT       = "1"          # cut current playback on a new copy
#   $env:LRAC_POLL_MS       = "300"        # clipboard poll interval (ms)

Set-Location $PSScriptRoot
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host "Clipboard -> AivisSpeech (read aloud). Stop with Ctrl+C." -ForegroundColor Cyan
node speak-clipboard.js
