#!/usr/bin/env node
/**
 * copy-last-response-claudecode.js
 *
 * LLM(Claude Code / Codex 等) の応答完了時に、その「ターンの応答本文を全文」
 * クリップボードへ一括コピーするスクリプト(Stop フック用)。
 *
 * 対応モード:
 *   1) Claude Code の Stop フック
 *        stdin に {"transcript_path": "...", ...} が渡される。
 *        直近のユーザー発話以降の assistant テキストブロックを全て連結して取り出す。
 *   2) Codex の notify
 *        argv[2] に JSON 文字列が渡される (agent-turn-complete イベント)。
 *        その中の "last-assistant-message" を使う。
 *   3) 手動 / パイプ
 *        引数なしで stdin がただのテキストなら、それをそのままコピー。
 *
 * 既定では読み上げに向かない部分(コード/ツール出力/パス/差分)を除外する。
 * 環境変数 LRAC_RAW=1 で除外せずに完全な全文をコピーする。
 */

const fs = require("fs");
const { copyToClipboard } = require("./clipboard");
const { filterTextBlock } = require("./filter");
const { normalizeForSpeech } = require("./normalize");

function readStdin() {
  try {
    // 先頭の BOM (U+FEFF) を除去。PowerShell パイプ等が付与することがある。
    return fs.readFileSync(0, "utf8").replace(/^﻿/, "");
  } catch {
    return "";
  }
}

/** 本物のユーザー発話か(ツール結果の user エントリは除外) */
function isRealUserPrompt(e) {
  if (!e || e.type !== "user" || !e.message) return false;
  const c = e.message.content;
  if (typeof c === "string") return c.trim().length > 0;
  if (Array.isArray(c)) {
    if (c.some((b) => b && b.type === "tool_result")) return false; // ツール結果
    return c.some((b) => b && b.type === "text");
  }
  return false;
}

/** assistant エントリからテキストブロックを取り出して連結 */
function assistantText(e) {
  if (!e || e.type !== "assistant" || !e.message) return "";
  const c = e.message.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

/** transcript から「直近ターンの応答本文(全 text ブロック連結)」を抽出 */
function extractFromTranscript(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const entries = fs
    .readFileSync(transcriptPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    });

  // 直近の「本物のユーザー発話」の位置を探す = 今回のターンの起点
  let start = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isRealUserPrompt(entries[i])) {
      start = i + 1;
      break;
    }
  }

  if (start >= 0) {
    const parts = [];
    for (let i = start; i < entries.length; i++) {
      const t = assistantText(entries[i]);
      if (t.trim()) parts.push(t);
    }
    const joined = parts.join("\n").trim();
    if (joined.length > 0) return joined;
  }

  // フォールバック: ユーザー発話が見つからない/空 → 最後の assistant テキストのみ
  for (let i = entries.length - 1; i >= 0; i--) {
    const t = assistantText(entries[i]).trim();
    if (t.length > 0) return t;
  }
  return null;
}

/** 渡されたデータがどのモードか判定して応答テキストを返す */
function resolveText() {
  const stdin = readStdin();

  // モード1/3: stdin が JSON (Claude Code Stop フック) かどうか
  if (stdin.trim().startsWith("{")) {
    try {
      const obj = JSON.parse(stdin);
      if (obj.transcript_path) {
        const t = extractFromTranscript(obj.transcript_path);
        if (t) return t;
      }
      // Codex 風 JSON が stdin から来た場合も拾う
      if (obj["last-assistant-message"]) return obj["last-assistant-message"];
    } catch {
      /* JSON ではなかった -> 素のテキストとして扱う */
    }
  }

  // モード2: Codex notify は argv[2] に JSON 文字列
  const arg = process.argv[2];
  if (arg && arg.trim().startsWith("{")) {
    try {
      const obj = JSON.parse(arg);
      if (obj["last-assistant-message"]) return obj["last-assistant-message"];
    } catch {
      /* ignore */
    }
  }

  // モード3: 素のテキスト stdin
  if (stdin.trim().length > 0 && !stdin.trim().startsWith("{")) {
    return stdin;
  }

  return null;
}

function main() {
  let text = resolveText();
  // 既定はフィルタ適用(読み上げに向かない部分を除外)。LRAC_RAW=1 で完全な全文。
  if (text && process.env.LRAC_RAW !== "1") {
    text = filterTextBlock(text).join("\n");
    // 読み上げ最適化の正規化。LRAC_NO_NORMALIZE=1 で無効化。
    if (process.env.LRAC_NO_NORMALIZE !== "1") text = normalizeForSpeech(text);
  }
  if (!text || !text.trim()) {
    process.stderr.write("[copy-last-response] コピー対象のテキストが見つかりませんでした\n");
    process.exit(0); // フックは失敗させずに静かに終了
  }
  const ok = copyToClipboard(text);
  process.stderr.write(
    ok
      ? `[copy-last-response] ${text.length} 文字をクリップボードにコピーしました\n`
      : "[copy-last-response] クリップボードへの書き込みに失敗しました\n"
  );
  process.exit(0);
}

main();
