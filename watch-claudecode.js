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
 *   LRAC_DRAIN_MS   1行送出の最小間隔(ms)。既定 250。
 *   LRAC_POLL_MS    ファイル監視ポーリング間隔(ms)。既定 300。
 *   LRAC_PROJECTS   transcript 探索ルート。既定 ~/.claude/projects
 *   LRAC_QUIET      "1" でログ抑制。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { copyToClipboard } = require("./clipboard");
const { filterTextBlock } = require("./filter");
const { normalizeForSpeech } = require("./normalize");
const NO_NORM = process.env.LRAC_NO_NORMALIZE === "1";

const DRAIN_MS = parseInt(process.env.LRAC_DRAIN_MS || "250", 10);
const POLL_MS = parseInt(process.env.LRAC_POLL_MS || "300", 10);
const PROJECTS =
  process.env.LRAC_PROJECTS || path.join(os.homedir(), ".claude", "projects");
const QUIET = process.env.LRAC_QUIET === "1";

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
    setTimeout(step, DRAIN_MS);
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
  log(`drain=${DRAIN_MS}ms poll=${POLL_MS}ms`);
  setInterval(tick, POLL_MS);
  tick();
}

main();
