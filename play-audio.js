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
    fs.writeFileSync(file, buffer);
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

module.exports = { playWav };
