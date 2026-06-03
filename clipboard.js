/**
 * clipboard.js — OS 別クリップボード書き込み + プロセス横断の重複排除。
 *   win32  -> PowerShell Set-Clipboard (Unicode/日本語OK)
 *   darwin -> pbcopy
 *   linux  -> wl-copy / xclip
 *
 * 重複排除(dedup):
 *   直近にコピーした本文のハッシュを共有ステートファイルに保持し、
 *   同じ本文を二度コピーしない。これにより
 *     - 監視のポーリング/ドレイン遅延で「直前の応答」が後から再着弾してユーザーの
 *       外部コピーを上書きする
 *     - Stop フックと監視が同じ内容を二重に書く
 *     - Codex のファイル再読込で過去メッセージを再コピーする
 *   を防ぐ。Stop フック・Claude監視・Codex監視が同じファイルを共有するので横断で効く。
 *
 *   無効化: LRAC_NO_DEDUP=1
 *   ステートファイル: 既定 %TEMP%/llm-clip-state.json (LRAC_STATE_FILE で変更可)
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const DEDUP = process.env.LRAC_NO_DEDUP !== "1";
const STATE_FILE =
  process.env.LRAC_STATE_FILE ||
  path.join(os.tmpdir(), "llm-clip-state.json");
const HISTORY_MAX = 100;

function hashStr(s) {
  return crypto.createHash("sha1").update(s, "utf8").digest("base64").slice(0, 16);
}

function readState() {
  try {
    const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!Array.isArray(st.history)) st.history = [];
    return st;
  } catch {
    return { history: [] };
  }
}

function writeState(st) {
  try {
    const tmp = STATE_FILE + ".tmp" + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(st));
    fs.renameSync(tmp, STATE_FILE); // 原子的置換(同一ボリューム)
  } catch {
    /* ベストエフォート。失敗しても致命的ではない */
  }
}

/** OS へ実際に書き込む(重複排除なし) */
function setClipboardRaw(text) {
  const platform = process.platform;
  if (platform === "win32") {
    // PowerShell の stdin は UTF-8 として解釈されない(CP932 化け)ため、
    // UTF-8 を Base64 にして渡し、PowerShell 側でデコードする。
    const b64 = Buffer.from(text, "utf8").toString("base64");
    if (b64.length < 30000) {
      return (
        spawnSync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`,
          ],
          { encoding: "utf8" }
        ).status === 0
      );
    }
    return (
      spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd())))",
        ],
        { input: b64, encoding: "utf8" }
      ).status === 0
    );
  }
  if (platform === "darwin") {
    return spawnSync("pbcopy", [], { input: text }).status === 0;
  }
  let r = spawnSync("wl-copy", [], { input: text });
  if (r.error) r = spawnSync("xclip", ["-selection", "clipboard"], { input: text });
  return r.status === 0;
}

/**
 * クリップボードへコピー。既定で重複排除あり。
 * @returns {boolean|"skipped"} 書き込み成功 true / 失敗 false / 重複でスキップ "skipped"
 */
function copyToClipboard(text, opts) {
  opts = opts || {};
  const dedup = opts.dedup !== undefined ? opts.dedup : DEDUP;

  if (!dedup) return setClipboardRaw(text);

  const h = hashStr(text);
  const st = readState();
  if (st.history.includes(h)) {
    return "skipped"; // 直近にコピー済み → 二度書きしない
  }
  const ok = setClipboardRaw(text);
  if (ok) {
    st.history.push(h);
    while (st.history.length > HISTORY_MAX) st.history.shift();
    st.last = h;
    writeState(st);
  }
  return ok;
}

module.exports = { copyToClipboard, hashStr, STATE_FILE };
