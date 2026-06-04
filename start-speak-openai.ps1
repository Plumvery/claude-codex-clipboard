# start-speak-openai.ps1
# Read the clipboard aloud with OpenAI TTS (gpt-4o-mini-tts).
# Usage:  powershell -ExecutionPolicy Bypass -File start-speak-openai.ps1
#
# Requires $env:OPENAI_API_KEY. Optional settings (set before running):
#   $env:LRAC_OPENAI_VOICE        = "alloy"   # alloy/ash/ballad/coral/echo/fable/onyx/nova/sage/shimmer/verse
#   $env:LRAC_OPENAI_INSTRUCTIONS = "..."     # steer delivery (gpt-4o-mini-tts only)
#   $env:LRAC_OPENAI_TTS_MODEL    = "gpt-4o-mini-tts"

Set-Location $PSScriptRoot
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:LRAC_TTS_ENGINE = "openai"
if (-not $env:OPENAI_API_KEY) {
    Write-Host 'OPENAI_API_KEY is not set. Set it first, e.g.  $env:OPENAI_API_KEY = "sk-..."' -ForegroundColor Yellow
}
Write-Host "Clipboard -> OpenAI TTS (read aloud). Stop with Ctrl+C." -ForegroundColor Cyan
node speak-clipboard.js
