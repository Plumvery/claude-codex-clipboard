/**
 * clipboard.js — OS 別クリップボード書き込みの共通モジュール。
 *   win32  -> PowerShell Set-Clipboard (Unicode/日本語OK)
 *   darwin -> pbcopy
 *   linux  -> wl-copy / xclip
 */
const { spawnSync } = require("child_process");

function copyToClipboard(text) {
  const platform = process.platform;
  if (platform === "win32") {
    // PowerShell の stdin は UTF-8 として解釈されない(CP932 化け)ため、
    // UTF-8 を Base64 にして引数で渡し、PowerShell 側でデコードする。
    const b64 = Buffer.from(text, "utf8").toString("base64");
    let args;
    if (b64.length < 30000) {
      // コマンドライン長の上限(約32KB)内なら引数渡し(最も確実)。
      args = [
        "-NoProfile",
        "-Command",
        `Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`,
      ];
      return spawnSync("powershell", args, { encoding: "utf8" }).status === 0;
    }
    // 長文は stdin から Base64 を流し込んでデコード。
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd())))",
      ],
      { input: b64, encoding: "utf8" }
    );
    return r.status === 0;
  }
  if (platform === "darwin") {
    return spawnSync("pbcopy", [], { input: text }).status === 0;
  }
  let r = spawnSync("wl-copy", [], { input: text });
  if (r.error) r = spawnSync("xclip", ["-selection", "clipboard"], { input: text });
  return r.status === 0;
}

module.exports = { copyToClipboard };
