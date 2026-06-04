/**
 * play-audio.js — WAV(Buffer) を OS の標準機能で再生する。
 *   win32  -> PowerShell System.Media.SoundPlayer.PlaySync() (依存ゼロ・同期再生)
 *   darwin -> afplay
 *   linux  -> aplay (無ければ paplay)
 *
 * playWav() は { promise, kill } を返す:
 *   - promise : 再生完了 / 失敗 / kill のいずれかで解決(reject しない)
 *   - kill()  : 再生中プロセスを停止(割り込み読み上げ用)
 *
 * WAV は一時ファイルに書き出して再生し、終了後に削除する。
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let counter = 0;
function tmpWavPath() {
  counter += 1;
  return path.join(os.tmpdir(), `lrac-tts-${process.pid}-${counter}.wav`);
}

/**
 * 一部のエンジン(OpenAI のストリーミング WAV 等)は RIFF/data のサイズ欄を
 * プレースホルダ(0xFFFFFFFF)のまま返す。System.Media.SoundPlayer はこれを
 * 「無効な WAV」として拒否するため、実バイト数へ書き直してから再生する。
 * 正常な WAV は変更せずそのまま返す(元 Buffer は破壊しない)。
 */
function fixWavHeader(buffer) {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return buffer;
  }
  // data チャンクを探す
  let i = 12;
  let dataSizeOff = -1;
  let dataStart = -1;
  while (i + 8 <= buffer.length) {
    const id = buffer.toString("ascii", i, i + 4);
    const sz = buffer.readUInt32LE(i + 4);
    if (id === "data") {
      dataSizeOff = i + 4;
      dataStart = i + 8;
      break;
    }
    if (sz >= 0xfffffff0 || i + 8 + sz > buffer.length) break; // 異常サイズで前進不能
    i += 8 + sz + (sz % 2);
  }
  const out = Buffer.from(buffer); // 元を破壊しないようコピー
  out.writeUInt32LE((buffer.length - 8) >>> 0, 4); // RIFF サイズは常に正しい値へ
  if (dataSizeOff >= 0) {
    const declared = buffer.readUInt32LE(dataSizeOff);
    const remaining = buffer.length - dataStart;
    if (declared === 0 || declared > remaining) {
      out.writeUInt32LE(remaining >>> 0, dataSizeOff); // プレースホルダ/過大値→実値
    }
  }
  return out;
}

function spawnPlayer(file) {
  const platform = process.platform;
  if (platform === "win32") {
    // SoundPlayer.PlaySync() は PCM WAV を同期再生。プロセス kill で停止できる。
    const safe = file.replace(/'/g, "''"); // 単一引用符のエスケープ(PowerShell)
    return spawn(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$p = New-Object System.Media.SoundPlayer -ArgumentList '${safe}'; $p.PlaySync(); $p.Dispose()`,
      ],
      { stdio: "ignore" }
    );
  }
  if (platform === "darwin") {
    return spawn("afplay", [file], { stdio: "ignore" });
  }
  return spawn("aplay", ["-q", file], { stdio: "ignore" });
}

/**
 * WAV バッファを再生する。
 * @param {Buffer} buffer WAV データ
 * @returns {{ promise: Promise<"done"|"error">, kill: () => void }}
 */
function playWav(buffer) {
  const file = tmpWavPath();
  try {
    fs.writeFileSync(file, fixWavHeader(buffer));
  } catch (e) {
    return { promise: Promise.resolve("error"), kill() {} };
  }

  let child = spawnPlayer(file);
  let killed = false;
  let settle;
  const promise = new Promise((resolve) => (settle = resolve));
  const cleanup = () => {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ベストエフォート */
    }
  };

  const attach = (c, allowFallback) => {
    c.on("error", () => {
      // linux で aplay が無ければ paplay にフォールバック
      if (allowFallback && process.platform !== "win32" && process.platform !== "darwin") {
        const alt = spawn("paplay", [file], { stdio: "ignore" });
        child = alt;
        attach(alt, false);
        return;
      }
      cleanup();
      settle("error");
    });
    c.on("exit", () => {
      cleanup();
      settle(killed ? "error" : "done");
    });
  };
  attach(child, true);

  return {
    promise,
    kill() {
      killed = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    },
  };
}

module.exports = { playWav, fixWavHeader };
