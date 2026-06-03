#!/usr/bin/env node
/**
 * watch-codex.js
 *
 * Codex CLI のセッション記録(rollout-*.jsonl)をリアルタイム監視し、
 * アシスタントの応答本文(1メッセージ完了ごとに全文)をクリップボードへコピーする。
 *
 * Codex は notify が computer-use プラグイン等に専有されがちで1枠しかないため、
 * Claude Code の Stop フック相当としてセッションファイル監視方式を用いる。
 *
 * Codex 記録形式:
 *   {"type":"response_item","payload":{"type":"message","role":"assistant",
 *     "content":[{"type":"output_text","text":"..."}]}}
 *   - reasoning(思考)は encrypted_content で平文なし → 取得不可。
 *   - function_call / function_call_output(ツール入出力)は読まない=除外。
 *
 * 使い方:
 *   node watch-codex.js                  # 最新セッションを自動追従
 *   node watch-codex.js <rollout.jsonl>  # 特定ファイルを監視
 *
 * 環境変数:
 *   LRAC_RAW           "1" でフィルタ無効(コード等も含める)。
 *   LRAC_POLL_MS       監視ポーリング間隔(ms)。既定 300。
 *   LRAC_CODEX_SESSIONS  セッション探索ルート。既定 ~/.codex/sessions
 *   LRAC_FROM_START    "1" でファイル先頭から処理(テスト/一括用)。
 *   LRAC_QUIET         "1" でログ抑制。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { copyToClipboard } = require("./clipboard");
const { filterTextBlock } = require("./filter");
const { normalizeForSpeech } = require("./normalize");

const POLL_MS = parseInt(process.env.LRAC_POLL_MS || "300", 10);
const RAW = process.env.LRAC_RAW === "1";
const NO_NORM = process.env.LRAC_NO_NORMALIZE === "1";
const FROM_START = process.env.LRAC_FROM_START === "1";
const QUIET = process.env.LRAC_QUIET === "1";
const SESSIONS =
  process.env.LRAC_CODEX_SESSIONS ||
  path.join(os.homedir(), ".codex", "sessions");

function log(...a) {
  if (!QUIET) process.stderr.write("[codex] " + a.join(" ") + "\n");
}

/** response_item(assistant message) から表示テキストを取り出す */
function assistantTextFromPayload(p) {
  if (!p || p.type !== "message" || p.role !== "assistant") return "";
  if (!Array.isArray(p.content)) return "";
  return p.content
    .filter(
      (b) =>
        b &&
        (b.type === "output_text" || b.type === "text") &&
        typeof b.text === "string"
    )
    .map((b) => b.text)
    .join("\n");
}

/** 1行(JSON)を処理し、assistant 本文があればコピー */
function handleLine(line) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  if (!e || e.type !== "response_item" || !e.payload) return;
  let text = assistantTextFromPayload(e.payload);
  if (!text.trim()) return;
  if (!RAW) {
    text = filterTextBlock(text).join("\n");
    if (!NO_NORM) text = normalizeForSpeech(text);
  }
  if (!text.trim()) return;
  const res = copyToClipboard(text);
  log(
    res === "skipped" ? "skip:" : res ? "copy:" : "FAIL:",
    `${text.length}字`,
    text.replace(/\n/g, " ").slice(0, 50) + (text.length > 50 ? "…" : "")
  );
}

// ---- ファイル監視 ----------------------------------------------------------

const offsets = new Map();
let current = null;

function listRollouts(dir) {
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) found.push(...listRollouts(p));
    else if (/^rollout-.*\.jsonl$/.test(e.name)) found.push(p);
  }
  return found;
}

function newestRollout() {
  let best = null,
    bestM = -1;
  for (const f of listRollouts(SESSIONS)) {
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
  let from = offsets.has(file) ? offsets.get(file) : FROM_START ? 0 : st.size;
  if (st.size < from) from = 0;
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
  if (lastNl === -1) return; // 完全な行待ち
  const complete = chunk.slice(0, lastNl);
  offsets.set(file, from + Buffer.byteLength(complete + "\n", "utf8"));
  for (const line of complete.split(/\r?\n/)) {
    if (line.trim()) handleLine(line);
  }
}

function tick() {
  if (!process.argv[2]) {
    const newest = newestRollout();
    if (newest && newest !== current) {
      current = newest;
      if (!offsets.has(current)) {
        try {
          offsets.set(current, FROM_START ? 0 : fs.statSync(current).size);
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
    offsets.set(current, FROM_START ? 0 : fs.statSync(current).size);
    log("watching (fixed):", current);
  } else {
    log("sessions root:", SESSIONS);
  }
  log(`poll=${POLL_MS}ms raw=${RAW} fromStart=${FROM_START}`);
  setInterval(tick, POLL_MS);
  tick();
}

main();
