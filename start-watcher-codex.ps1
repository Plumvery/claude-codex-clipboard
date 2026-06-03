# start-watcher-codex.ps1
# Codex の応答本文を、メッセージ完了ごとにクリップボードへ送る監視を起動する。
# 使い方:  powershell -ExecutionPolicy Bypass -File start-watcher-codex.ps1
#
# 完全な全文(コード等も含む)にしたい場合:
#   $env:LRAC_RAW = "1"

Set-Location $PSScriptRoot
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host "Codex応答 → クリップボード 監視を開始します。終了は Ctrl+C。" -ForegroundColor Cyan
node watch-codex.js