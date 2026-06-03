# start-watcher-claudecode.ps1
# Claude Code の応答本文を一行ずつクリップボードへ送る常駐監視を起動する。
# 使い方:  powershell -ExecutionPolicy Bypass -File start-watcher-claudecode.ps1
#
# 調整したい場合は実行前に環境変数を設定:
#   $env:LRAC_DRAIN_MS = "250"   # 1行送出の最小間隔(ms)
#   $env:LRAC_POLL_MS  = "300"   # 監視ポーリング間隔(ms)

Set-Location $PSScriptRoot
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host "Claude Code応答 → クリップボード(一行ずつ) 監視を開始します。終了は Ctrl+C。" -ForegroundColor Cyan
node watch-claudecode.js