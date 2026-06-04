#!/usr/bin/env node
/**
 * speak-clipboard.js
 *
 * クリップボードを監視し、内容が変わるたびに TTS で読み上げる常駐プロセス。
 * エンジンは AivisSpeech(ローカル) と OpenAI(クラウド) を LRAC_TTS_ENGINE で切替可能。
 * このリポジトリの copy 系(Stop フック / watch-*.js)が整形済みテキストをコピーするので、
 * それを受けて音声化する「クリップボード → TTS」の消費側。コピー元は問わない
 * (手動コピーした文章もそのまま読み上げる)。
 *
 * 設計:
 *   - クリップボードの変化は常駐 PowerShell が検知し、本文を Base64 で1行ずつ送る
 *     (日本語を確実に UTF-8 で受け渡すため。ポーリングごとに powershell を起動しない)。
 *   - 受け取った本文は改行優先でチャンク分割し、直列キューで1つずつ合成→再生する
 *     (再生は同期。次のチャンクは前の再生が終わってから = 中抜けしない)。
 *   - 新しいコピーが来たら、未再生の残りチャンクを破棄して新内容に切り替える(既定)。
 *     LRAC_TTS_CUT=1 で再生中チャンクも即座に止める。LRAC_TTS_INTERRUPT=0 で割り込まず追記。
 *
 * 使い方:
 *   node speak-clipboard.js                 # クリップボード監視を開始
 *   node speak-clipboard.js --say "テスト"   # 1回だけ合成・再生して終了(動作確認)
 *   node speak-clipboard.js --speakers      # 利用可能なボイス一覧を表示(--voices も可)
 *
 * エンジン選択:
 *   LRAC_TTS_ENGINE        "aivis"(既定・ローカル) | "openai"(クラウド)
 * 環境変数(抜粋。合成系は tts-aivis.js / tts-openai.js を参照):
 *   AivisSpeech: LRAC_AIVIS_URL / LRAC_AIVIS_SPEAKER / LRAC_AIVIS_SPEED ...
 *   OpenAI:      OPENAI_API_KEY / LRAC_OPENAI_VOICE / LRAC_OPENAI_INSTRUCTIONS ...
 *   LRAC_POLL_MS            クリップボード監視間隔(ms)。既定 300。
 *   LRAC_TTS_MAX_CHARS      1チャンクの目安文字数。既定 140。超える行は読点で分割。
 *   LRAC_TTS_INTERRUPT      "0" で割り込み無効(全部キューに積む)。既定 有効。
 *   LRAC_TTS_CUT            "1" で新コピー時に再生中も即停止。既定 無効(現在のチャンクは鳴らし切る)。
 *   LRAC_TTS_SPEAK_ON_START "1" で起動時点のクリップボードも読み上げる。既定 無効(起動時は読まない)。
 *   LRAC_QUIET             "1" でログ抑制。
 * (英語スキップ LRAC_SKIP_ENGLISH はコピー側 filter.js で行う。リーダーはクリップボードを素直に全部読む)
 */

const { spawn } = require("child_process");
const readline = require("readline");
require("./load-env"); // 同フォルダの .env を process.env へ(コピー側と共通)

// エンジン差し替え: LRAC_TTS_ENGINE=openai でクラウド、既定はローカルの AivisSpeech。
// 両モジュールは共通インターフェース(synthesize/health/listVoices/describe/name/hint)を実装。
const ENGINE = (process.env.LRAC_TTS_ENGINE || "aivis").toLowerCase();
const engine = ENGINE === "openai" ? require("./tts-openai") : require("./tts-aivis");
const { synthesize, health } = engine;
const { playWav } = require("./play-audio");
const { parseMarker } = require("./thread-voice");

const POLL_MS = parseInt(process.env.LRAC_POLL_MS || "300", 10);
const MAX_CHARS = parseInt(process.env.LRAC_TTS_MAX_CHARS || "140", 10);
const INTERRUPT = process.env.LRAC_TTS_INTERRUPT !== "0";
const CUT = process.env.LRAC_TTS_CUT === "1";
const SPEAK_ON_START = process.env.LRAC_TTS_SPEAK_ON_START === "1";
const QUIET = process.env.LRAC_QUIET === "1";

function log(...a) {
  if (!QUIET) process.stderr.write("[speak] " + a.join(" ") + "\n");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- テキストのチャンク分割 -------------------------------------------------
// クリップボード本文は改行(\n)区切りの整形済みテキスト(。は既に、に変換済み)。
// 改行を第一の区切りにし、長すぎる行だけ読点(、)でさらに分割する。
// これで「最初の音が出るまで」が短くなり、割り込みも効きやすい。
function chunkText(text) {
  const target = MAX_CHARS > 0 ? MAX_CHARS : 140;
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.length <= target) {
      out.push(line);
      continue;
    }
    // 長い行: 読点(、，,)の直後で区切り、target を目安に束ねる
    let buf = "";
    for (const seg of line.split(/(?<=[、，,])/)) {
      if (buf && buf.length + seg.length > target) {
        out.push(buf);
        buf = "";
      }
      buf += seg;
    }
    if (buf.trim()) out.push(buf);
  }
  return out;
}

// ---- 直列の合成→再生キュー --------------------------------------------------

let queue = [];
let working = false;
let current = null; // 再生中の { kill }
let generation = 0; // 割り込み世代。新しいコピーで増やし、合成中だった古い音声を破棄する

// 1チャンク先読み(パイプライン): 現チャンクの再生中に次チャンクを合成しておく。
// これで2チャンク目以降は合成待ちの無音が入らず連続再生になる。
// 各 job は { gen, promise } で、promise は { wav } か { err } に解決。
function startSynthJob() {
  if (!queue.length) return null;
  const item = queue.shift();
  const gen = generation; // この合成を始めた時点の世代
  return {
    gen,
    promise: synthesize(item.text, item.voice ? { voice: item.voice } : undefined)
      .then((wav) => ({ wav }))
      .catch((err) => ({ err })),
  };
}

async function pump() {
  if (working) return;
  working = true;
  let job = startSynthJob();
  while (job) {
    const res = await job.promise; // 現チャンクの合成完了を待つ(無音は最初のチャンクのみ)
    const next = startSynthJob();  // 再生開始前に次チャンクの合成を先行開始
    if (res.err) {
      // エンジン未起動/接続失敗など。少し待って次へ(本文は捨てる)。
      log("合成失敗:", res.err.message);
      await sleep(800);
    } else if (generation === job.gen) {
      // 合成中に新しいコピーが来ていなければ再生(この再生中に next が合成される)
      const pb = playWav(res.wav);
      current = pb;
      await pb.promise;
      current = null;
    }
    // generation が進んでいた場合は古い音声なので破棄(再生しない)
    job = next;
  }
  working = false;
}

/** クリップボードから受け取った本文を、指定の声で読み上げ対象として投入する。 */
function speak(text, voice) {
  const chunks = chunkText(text).map((c) => ({ text: c, voice }));
  if (!chunks.length) return;
  if (INTERRUPT) {
    generation++; // 新しい発話。合成中の古いチャンクと未再生の残りを無効化する
    queue = chunks; // 未再生の残りを捨てて新内容へ
    if (CUT && current) current.kill(); // 再生中も止める場合
  } else {
    queue.push(...chunks);
  }
  pump();
}

// ---- クリップボード監視(常駐 PowerShell) ------------------------------------
// 変化を検知したら本文を UTF-8→Base64 で1行出力する。Base64 は ASCII なので
// stdout のコードページ問題を回避できる。空(画像など非テキスト)は空行を出す。
function clipboardWatcherScript(pollMs) {
  return (
    "$last=[char]1; while($true){ " +
    "$t=Get-Clipboard -Raw; if($null -eq $t){$t=''}; " +
    "if($t -ne $last){ $last=$t; " +
    "[Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t))) }; " +
    "Start-Sleep -Milliseconds " + pollMs + " }"
  );
}

let primed = SPEAK_ON_START; // 起動時の既存クリップボードを読むか
let lastText = ""; // 直近に処理した本文(復元による再読み上げを防ぐ)

function onClipboard(text) {
  const t = (text || "").trim();
  if (!t) return; // 空(ブランク化/非テキスト)はスキップ
  if (!primed) {
    // 起動直後の1回目 = 既存クリップボード。既定では読まずに基準化のみ。
    primed = true;
    lastText = t;
    return;
  }
  if (t === lastText) return; // 同一内容の再来(クリップボード復元など)はスキップ
  lastText = t;
  // スレッドマーカーを解析 → セッションごとの声を決定 → マーカーを除去して読み上げ。
  const { key, text: body } = parseMarker(t);
  const clean = body.trim();
  if (!clean) return;
  const voice = engine.pickVoice ? engine.pickVoice(key) : undefined;
  log(
    "読み上げ:",
    `[${voice || "default"}${key ? " " + key : ""}]`,
    clean.length > 40 ? clean.slice(0, 40) + "…" : clean
  );
  speak(clean, voice);
}

function startWatcher() {
  const child = spawn(
    "powershell",
    ["-NoProfile", "-Command", clipboardWatcherScript(POLL_MS)],
    { stdio: ["ignore", "pipe", "ignore"] }
  );
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const b64 = line.trim();
    let text = "";
    if (b64) {
      try {
        text = Buffer.from(b64, "base64").toString("utf8");
      } catch {
        return;
      }
    }
    onClipboard(text);
  });
  child.on("exit", () => {
    log("クリップボード監視プロセスが終了。1秒後に再起動します。");
    setTimeout(startWatcher, 1000);
  });
}

// ---- サブコマンド -----------------------------------------------------------

async function cmdSpeakOnce(text) {
  try {
    await health();
  } catch (e) {
    log(`${engine.name} に接続できません: ${e.message}`);
    log(engine.hint);
  }
  try {
    const wav = await synthesize(text);
    await playWav(wav).promise;
  } catch (e) {
    log("失敗:", e.message);
    process.exitCode = 1;
  }
}

async function cmdListVoices() {
  try {
    const voices = await engine.listVoices();
    for (const v of voices) {
      process.stdout.write(`${v.id}\t${v.label}\n`);
    }
  } catch (e) {
    log(`ボイス一覧の取得に失敗: ${e.message}`);
    log(engine.hint);
    process.exitCode = 1;
  }
}

// ---- エントリ ---------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);

  if (argv[0] === "--speakers" || argv[0] === "--voices" || argv[0] === "--list") {
    await cmdListVoices();
    return;
  }
  if (argv[0] === "--say") {
    const text = argv.slice(1).join(" ").trim();
    if (!text) {
      log('使い方: node speak-clipboard.js --say "読み上げたい文章"');
      process.exitCode = 1;
      return;
    }
    await cmdSpeakOnce(text);
    return;
  }

  // 常駐モード
  log(`engine=${engine.name}  ${engine.describe()}`);
  log(`poll=${POLL_MS}ms  chunk<=${MAX_CHARS}  interrupt=${INTERRUPT ? (CUT ? "cut" : "on") : "off"}`);
  try {
    const v = await health();
    log(`${engine.name} 接続OK (${v})`);
  } catch (e) {
    log(`注意: 今は ${engine.name} に接続できません(${e.message})。`);
    log(engine.hint);
  }
  log(SPEAK_ON_START ? "起動時のクリップボードも読み上げます。" : "起動時のクリップボードは読みません(新しいコピーから)。");
  log("監視を開始しました。終了は Ctrl+C。");
  startWatcher();
}

// 直接実行された時だけ起動する(require でのテスト/再利用時はデーモン化しない)。
if (require.main === module) {
  main();
}

module.exports = { chunkText };
