/**
 * filter.js — アシスタント応答本文から「読み上げに向かない部分」を除外する共通ロジック。
 *   除外: コードフェンス内 / 差分行 / ファイルパスのみの行 / 空行。
 *   LRAC_SKIP_ENGLISH=1 のとき「英語主体の行(日本語がほぼ無く英字が一定数以上)」も除外。
 *   → 英語の文章はクリップボードにそもそも載らない(読み上げ側は全部読む方針)。
 *   Markdown 箇条書き "- 項目" は残す(記号直後が空白のため差分 "-x" と区別)。
 */

const RE_FILE_PATH = /^\s*[\w.@~-]*[\/\\][\w./\\@~-]+(:\d+)?\s*$/; // パスだけの行
const RE_DIFF_HUNK = /^(@@|diff |index |---\s|\+\+\+\s)/;          // diff ヘッダ
const RE_DIFF_LINE = /^[+-](?!\s|$)/;                              // 記号直後が非空白= コード差分

/** 行が「英語主体(日本語がほぼ無く英字が minLatin 文字以上)」か。 */
function isMostlyEnglish(line, minLatin) {
  // ひらがな/カタカナ/漢字
  const jp = (line.match(/[぀-ヿ㐀-䶿一-鿿]/g) || []).length;
  const latin = (line.match(/[A-Za-z]/g) || []).length;
  return jp === 0 && latin >= minLatin;
}

/** text を、送るべき行配列に変換(除外済み)。 */
function filterTextBlock(text) {
  const skipEnglish = process.env.LRAC_SKIP_ENGLISH === "1";
  const minLatin = parseInt(process.env.LRAC_SKIP_ENGLISH_MINLATIN || "12", 10);
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
    if (skipEnglish && isMostlyEnglish(trimmed, minLatin)) continue; // 英語主体の行は除外
    out.push(trimmed);
  }
  return out;
}

module.exports = { filterTextBlock };
