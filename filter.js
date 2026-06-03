/**
 * filter.js — アシスタント応答本文から「読み上げに向かない部分」を除外する共通ロジック。
 *   除外: コードフェンス内 / 差分行 / ファイルパスのみの行 / 空行。
 *   Markdown 箇条書き "- 項目" は残す(記号直後が空白のため差分 "-x" と区別)。
 */

const RE_FILE_PATH = /^\s*[\w.@~-]*[\/\\][\w./\\@~-]+(:\d+)?\s*$/; // パスだけの行
const RE_DIFF_HUNK = /^(@@|diff |index |---\s|\+\+\+\s)/;          // diff ヘッダ
const RE_DIFF_LINE = /^[+-](?!\s|$)/;                              // 記号直後が非空白= コード差分

/** text を、送るべき行配列に変換(除外済み)。 */
function filterTextBlock(text) {
  const out = [];
  let inFence = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (trimmed.length === 0) continue;
    if (RE_DIFF_HUNK.test(line)) continue;
    if (RE_DIFF_LINE.test(line)) continue;
    if (RE_FILE_PATH.test(line)) continue;
    out.push(trimmed);
  }
  return out;
}

module.exports = { filterTextBlock };
