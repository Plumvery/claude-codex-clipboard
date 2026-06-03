#!/usr/bin/env node
/**
 * watch-claudecode.js
 *
 * Claude Code の transcript(JSONL) をリアルタイム監視し、アシスタントの
 * 「表示される応答本文」を **一行ずつ** クリップボードへ順次コピーする常駐プロセス。
 *
 * - 思考(thinking)テキストは Claude Code がディスクに保存しないため対象外。
 * - 「出力を読み上げているような部分」= コードブロック / ツール入出力 /
 *   ファイルパス・差分行 は除外する。
 * - 新規行が出たら即時にキューへ入れ、ごく短い間隔で1行ずつ送出する
 *   (クリップボード監視側が各変更を検知できるように、1行ごとに別の write にする)。
 *
 * 使い方:
 *   node watch-claudecode.js                 # 最新セッションを自動追従
 *   node watch-claudecode.js <transcript.jsonl>   # 特定ファイルを監視
 *
 * 環境変数で調整:
 *   LRAC_MS_PER_CHAR  1文字あたりの待ち時間(ms)。既定 120。読み上げが速いTTSなら小さく、
 *                     中抜けするなら大きく。各行はこの値×文字数だけ保持される。
 *   LRAC_MIN_WAIT     1行の最小保持時間(ms)。既定 900。
 *   LRAC_MAX_WAIT     1行の最大保持時間(ms)。既定 15000。
 *   LRAC_POLL_MS      ファイル監視ポーリング間隔(ms)。既定 300。
 *   LRAC_PROJECTS     transcript 探索ルート。既定 ~/.claude/projects
 *   LRAC_QUIET        "1" でログ抑制。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { copyToClipboard, setClipboardRaw } = require("./clipboard");
const { filterTextBlock } = require("./filter");
const { normalizeForSpeech } = require("./normalize");
const NO_NORM = process.env.LRAC_NO_NORMALIZE === "1";

// コピー後リセット: Aqua Voice 等が「前のクリップボードを復元」して直前の値を
// 再読み上げするのを防ぐため、読み取り猶予(RESET_MS)の後にクリップボードを空へ戻す。
//   LRAC_RESET_MODE = off(既定) | blank
//   LRAC_RESET_MS   = 空に戻すまでの猶予(ms)。既定 150。
const RESET_MODE = process.env.LRAC_RESET_MODE || "off";
const RESET_MS = parseInt(process.env.LRAC_RESET_MS || "150", 10);

const POLL_MS = parseInt(process.env.LRAC_POLL_MS || "300", 10);
const PROJECTS =
  process.env.LRAC_PROJECTS || path.join(os.homedir(), ".claude", "projects");
const QUIET = process.env.LRAC_QUIET === "1";

// 適応ウェイト: 各行をコピーした後、その行の長さ(=読み上げ所要時間の推定)ぶん待つ。
// これで TTS が1行を読み終える前に次の行で上書きされ「中抜け」するのを防ぐ。
const MS_PER_CHAR = parseInt(process.env.LRAC_MS_PER_CHAR || "120", 10); // 1文字あたりの待ち
const MIN_WAIT = parseInt(process.env.LRAC_MIN_WAIT || process.env.LRAC_DRAIN_MS || "900", 10); // 下限
const MAX_WAIT = parseInt(process.env.LRAC_MAX_WAIT || "15000", 10); // 上限

/** その行の読み上げにかかる推定時間(ms) */
function readingDelay(text) {
  const d = Math.ceil(text.length * MS_PER_CHAR);
  return Math.min(MAX_WAIT, Math.max(MIN_WAIT, d));
}

function log(...a) {
  if (!QUIET) process.stderr.write("[watch] " + a.join(" ") + "\n");
}

// ---- 送出キュー ------------------------------------------------------------

const queue = [];
let draining = false;

function enqueue(lines) {
  for (const l of lines) queue.push(l);
  drain();
}

function drain() {
  if (draining) return;
  draining = true;
  const step = () => {
    const line = queue.shift();
    if (line === undefined) {
      draining = false;
      return;
    }
    const res = copyToClipboard(line);
    log(res === "skipped" ? "skip:" : res ? "copy:" : "FAIL:", line.length > 60 ? line.slice(0, 60) + "…" : line);
    if (res === "skipped" || !res) {
      // 重複/失敗の行は読み上げ対象外なので待たない。
      setTimeout(step, 0);
      return;
    }
    const hold = readingDelay(line); // この行の読了までの猶予
    if (RESET_MODE === "blank") {
      // RESET_MS 後にクリップボードを空へ戻し(再読み上げ防止)、残り時間だけ待ってから次行。
      const capture = Math.min(RESET_MS, hold);
      setTimeout(() => {
        setClipboardRaw(""); // dedup を通さず確実に空へ
        setTimeout(step, Math.max(0, hold - capture));
      }, capture);
    } else {
      setTimeout(step, hold);
    }
  };
  step();
}

// ---- transcript 監視 -------------------------------------------------------

const seenUuids = new Set(); // 処理済み assistant エントリ
const offsets = new Map();   // file -> 読み込み済みバイト数
let current = null;          // 現在監視中のファイル

function listTranscripts(dir) {
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) found.push(...listTranscripts(p));
    else if (e.name.endsWith(".jsonl")) found.push(p);
  }
  return found;
}

function newestTranscript() {
  let best = null,
    bestM = -1;
  for (const f of listTranscripts(PROJECTS)) {
    let st;
    try {
      st = fs.statSync(f);
    } catch {
      continue;
    }
    if (st.mtimeMs > bestM) {
      bestM = st.mtimeMs;
      best = f;
    }
  }
  return best;
}

function processNewLines(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return;
  }
  let from = offsets.has(file) ? offsets.get(file) : st.size; // 初回は末尾から
  if (st.size < from) from = 0; // ローテーション/切り詰め対策
  if (st.size === from) {
    offsets.set(file, st.size);
    return;
  }
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(st.size - from);
  fs.readSync(fd, buf, 0, buf.length, from);
  fs.closeSync(fd);

  const chunk = buf.toString("utf8");
  const lastNl = chunk.lastIndexOf("\n");
  if (lastNl === -1) return; // 完全な行がまだ無い(書き込み途中)。次回に持ち越し。
  const complete = chunk.slice(0, lastNl);
  offsets.set(file, from + Buffer.byteLength(complete + "\n", "utf8"));

  for (const line of complete.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type !== "assistant" || !e.message || !Array.isArray(e.message.content))
      continue;
    if (e.uuid && seenUuids.has(e.uuid)) continue;
    if (e.uuid) seenUuids.add(e.uuid);

    for (const b of e.message.content) {
      // text ブロックのみ。tool_use / thinking は対象外(=出力やツール入出力を除外)。
      if (b && b.type === "text" && typeof b.text === "string") {
        let lines = filterTextBlock(b.text);
        if (!NO_NORM) lines = lines.map(normalizeForSpeech).filter((l) => l.trim());
        enqueue(lines);
      }
    }
  }
}

function tick() {
  // 監視対象を必要なら最新セッションへ切り替える
  if (!process.argv[2]) {
    const newest = newestTranscript();
    if (newest && newest !== current) {
      current = newest;
      if (!offsets.has(current)) {
        // 既存内容はスキップ(末尾から)。これ以降の追記だけ拾う。
        try {
          offsets.set(current, fs.statSync(current).size);
        } catch {
          offsets.set(current, 0);
        }
        log("watching:", current);
      }
    }
  }
  if (current) processNewLines(current);
}

function main() {
  if (process.argv[2]) {
    current = path.resolve(process.argv[2]);
    offsets.set(current, fs.statSync(current).size); // 末尾から
    log("watching (fixed):", current);
  } else {
    log("projects root:", PROJECTS);
  }
  log(`poll=${POLL_MS}ms wait=${MS_PER_CHAR}ms/char [${MIN_WAIT}-${MAX_WAIT}ms]`);
  setInterval(tick, POLL_MS);
  tick();
}

main();
