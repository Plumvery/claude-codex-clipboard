/**
 * load-env.js — このスクリプト群と同じフォルダの .env を process.env へ読み込む(zero-dep)。
 * require するだけで副作用的に1回読み込む。既存の環境変数(setx 等)が優先。
 *
 * 読み上げ側(speak-clipboard.js)とコピー側(Stop フック/監視版)の両方から使う。
 * これで .env の LRAC_SKIP_ENGLISH 等がコピー側にも効く。.env は .gitignore 済み。
 * Windows の環境変数伝播(既存窓やダブルクリックに反映されない)も気にせず設定を渡せる。
 */
const fs = require("fs");
const path = require("path");

(function loadDotEnv() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1); // 周囲のクォートを除去
      }
      if (!process.env[key]) process.env[key] = val; // 既存値があれば上書きしない
    }
  } catch {
    /* .env が無ければ無視 */
  }
})();
