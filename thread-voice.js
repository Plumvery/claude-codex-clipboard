/**
 * thread-voice.js — 会話スレッドごとに声を変えるための共通ロジック。
 *
 * コピー側が出力テキストの先頭に「どのスレッド由来か」を示すマーカーを埋め込み、
 * 読み上げ側がそれを解析してセッションごとに声を割り当てる。マーカーが無いテキスト
 * (手動コピー等)は既定の声で読む。
 *
 * マーカー形式:  ⟦vk:<key>⟧<本文>
 *   <key> 例: "cc-a1b2c3d4"(Claude Code セッション) / "cx-..."(Codex セッション)
 *   ⟦(U+27E6) ⟧(U+27E7) は通常のテキストにまず現れないため誤検出しにくい。
 *
 * 既定で有効。コピー側で LRAC_THREAD_VOICE=0 にするとマーカーを付けない(従来動作)。
 */

const crypto = require("crypto");
const path = require("path");

const MARKER_RE = /^⟦vk:([^⟧]*)⟧\s*/;

/** key を安定した uint32 ハッシュへ。声プールのインデックスに使う。 */
function hashKey(key) {
  const d = crypto.createHash("sha1").update(String(key)).digest();
  return d.readUInt32BE(0);
}

/** source とセッションIDから短く安定したキーを作る(例 "cc-a1b2c3d4")。 */
function deriveKey(source, sessionId) {
  const s = sessionId == null ? "" : String(sessionId);
  const cleaned = s.replace(/[^0-9a-zA-Z]/g, "");
  const short =
    cleaned.length >= 6 ? cleaned.slice(0, 8) : hashKey(s).toString(36).slice(0, 8);
  return `${source}-${short}`;
}

/** ファイルパス(transcript/rollout)から source 付きキーを作る。 */
function keyFromFile(source, filePath) {
  const base = path.basename(String(filePath)).replace(/\.[^.]+$/, "");
  return deriveKey(source, base);
}

/** テキスト先頭にマーカーを付ける。LRAC_THREAD_VOICE=0 または key 無しなら素通し。 */
function addMarker(text, key) {
  if (!key || process.env.LRAC_THREAD_VOICE === "0") return text;
  return `⟦vk:${key}⟧` + text;
}

/** 先頭マーカーを解析。{ key, text(除去後) } を返す。マーカー無しなら key=null。 */
function parseMarker(text) {
  const m = String(text).match(MARKER_RE);
  if (!m) return { key: null, text };
  return { key: m[1] || null, text: text.slice(m[0].length) };
}

/** "a, b ,c" → ["a","b","c"]。空なら []。 */
function parsePool(str) {
  if (!str) return [];
  return String(str)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** プールと key から声を1つ選ぶ。key 無し/プール空なら fallback。 */
function pickFromPool(pool, key, fallback) {
  if (!key || !pool || pool.length === 0) return fallback;
  return pool[hashKey(key) % pool.length];
}

module.exports = {
  MARKER_RE,
  hashKey,
  deriveKey,
  keyFromFile,
  addMarker,
  parseMarker,
  parsePool,
  pickFromPool,
};
