# llmresponse_auto_clipboard

Claude Code の応答が**完了した瞬間**に、その応答本文を**まとめてクリップボードへ自動コピー**する。
読み上げツールへの流し込みなどを想定。

## 現在の構成（推奨・設定済み）

`~/.claude/settings.json` の **Stop フック**で `copy-last-response-claudecode.js` を実行。
Claude Code が応答を終えるたびに、そのターンの応答本文を全文コピーします。

- ✅ そのターンの**アシスタント本文（複数ブロックを連結）**をコピー。
- ✅ 既定で「読み上げに向かない部分」=**コードブロック / ツール入出力 / ファイルパス・差分行**を除外。
- ✅ `LRAC_RAW=1` を設定すると**除外せず完全な全文**をコピー。
- ❌ **思考(考え中)テキストは対象外**（Claude Code がディスクに保存しないため取得不可）。

設定済みのフック:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command",
        "command": "node \"C:\\Users\\princ\\Documents\\Github\\llmresponse_auto_clipboard\\copy-last-response-claudecode.js\"" } ] }
    ]
  }
}
```

**Claude Code を再起動**すれば有効になります。以降、応答完了ごとに自動でクリップボードへ。

## かんたん起動（ダブルクリック）

監視版はコマンド入力なしで起動できる **.bat** を用意しています。エクスプローラーで
ダブルクリックするだけで黒いウィンドウが開き、監視が始まります（閉じるか Ctrl+C で終了）。

| ファイル | 用途 |
|----------|------|
| `start-watcher-codex.bat` | **Codex** 用の監視を起動 |
| `start-watcher-claudecode.bat` | **Claude Code** 用の一行ずつ監視を起動（※下記オプション機能） |

> オプション設定（コードも含める／正規化を切る等）は、各 .bat をメモ帳で開き、
> 該当する `REM set ...` 行の先頭 `REM ` を消すと有効になります。

### 完全な全文（コードも含める）にしたい場合

フックのコマンドに環境変数を付けます:

```json
"command": "cmd /c set LRAC_RAW=1 && node \"C:\\...\\copy-last-response-claudecode.js\""
```

## オプション: 一行ずつのストリーミング監視

「出現順に一行ずつ」送りたい場合は別プロセスの監視版も用意してあります。
ただし transcript はブロック単位で書かれるため、**思考が終わってからまとめて1ブロック**の粒度で、
真のリアルタイムなトークン単位ストリーミングではありません。

```powershell
powershell -ExecutionPolicy Bypass -File start-watcher-claudecode.ps1
# または  node watch-claudecode.js
```

> Stop フックと監視版を**同時に使うと最後に全文で上書き**されます。どちらか一方にしてください。

### 適応ウェイト（中抜け防止）

一行ずつコピーすると、TTS が1行を読み終える前に次の行で上書きされ「中抜け」します。
そのため**各行を「長さに応じた読み上げ時間」ぶん保持**してから次へ進みます
（長い行ほど長く待つ）。読み上げが速い/遅い場合は `LRAC_MS_PER_CHAR` で調整します。

### 監視版の環境変数

| 変数 | 既定 | 説明 |
|------|------|------|
| `LRAC_MS_PER_CHAR` | `120` | 1文字あたりの保持時間(ms)。速いTTSなら小さく、中抜けするなら大きく |
| `LRAC_MIN_WAIT` | `900` | 1行の最小保持時間(ms) |
| `LRAC_MAX_WAIT` | `15000` | 1行の最大保持時間(ms) |
| `LRAC_POLL_MS` | `300` | transcript 監視ポーリング間隔(ms) |
| `LRAC_PROJECTS` | `~/.claude/projects` | transcript 探索ルート |
| `LRAC_QUIET` | – | `1` でログ抑制 |

## 除外フィルタ（既定）

| 種類 | 判定 |
|------|------|
| コードブロック | ` ``` ` / `~~~` で囲まれた範囲（フェンス行含む） |
| 差分行 | `+x` / `-x`（記号直後が非空白）、`@@`, `diff `, `--- `, `+++ ` など |
| ファイルパスのみの行 | スラッシュ等を含むパス単体の行（例 `src/app/main.js`） |
| 空行 | 送らない |

> Markdown の箇条書き `- 項目` は「記号の直後が空白」なので**残ります**。
> インラインコード（`` `foo` ``）は行全体ではないので**残ります**。

## 読み上げ正規化（既定）

フィルタの後、読み上げ(TTS)を乱す要素を `normalize.js` で整えます。
`LRAC_NO_NORMALIZE=1` で無効化、`LRAC_RAW=1`（コード保全）時は自動でスキップ。

| 対象 | 処理 |
|------|------|
| ハイフン/ダッシュ | 箇条書き `- `・単独 `—–―`・残る `-` を削除。語中 `a-b`→`a b`。**長音符 `ー` は保持** |
| 半角スペース | 日本語に隣接する分は削除（`日本語 です`→`日本語です`）、英単語間（`Claude Code`）は1つ残す |
| 全角スペース | 削除 |
| 括弧書き | `（…）` `(…)` を中身ごと削除（`「」`『』【】は保持） |
| Markdown 装飾 | `**` `*` `` ` `` 見出し`#` 引用`>` 番号リスト を除去 |
| リンク | `[表示](url)` → `表示`、残る半角 `[]` も除去 |
| 表 | 区切り行 `|---|` を削除、セル区切り `|` を読点 `、` に |
| 矢印 | `→ ← ⇒ -> =>` 等を読点 `、` に（`A→B`→`A、B`） |
| スラッシュ | 区切りの ` / ` は読点 `、` に、その他の `/` は削除 |

## ファイル構成

- `copy-last-response-claudecode.js` … Claude Code の Stop フック本体。ターン全文を抽出→フィルタ→正規化→コピー。
- `watch-claudecode.js` … Claude Code 用、オプションの一行ずつ監視版。
- `watch-codex.js` … **Codex 用**の監視版（メッセージ完了ごとに全文コピー）。
- `filter.js` … 除外フィルタ（全スクリプトで共用）。
- `normalize.js` … 読み上げ正規化（全スクリプトで共用）。
- `clipboard.js` … OS別クリップボード書き込み（Windows は Base64 経由で UTF-8 を正しく処理）。
- `start-watcher-claudecode.bat` … Claude Code 監視版を**ダブルクリック起動**。
- `start-watcher-codex.bat` … Codex 監視版を**ダブルクリック起動**。
- `start-watcher-claudecode.ps1` … Claude Code 監視版の起動用（PowerShell, UTF-8 BOM付き）。
- `start-watcher-codex.ps1` … Codex 監視版の起動用（PowerShell, UTF-8 BOM付き）。

## Codex で使う場合

Codex は形式が違うため**専用の監視版** `watch-codex.js` を使います。

```powershell
powershell -ExecutionPolicy Bypass -File start-watcher-codex.ps1
# または  node watch-codex.js
```

`~/.codex/sessions/**/rollout-*.jsonl` の最新セッションを監視し、アシスタントの
メッセージ（`output_text`）が完了するたびに全文をコピーします。フィルタも適用、
`LRAC_RAW=1` で完全な全文。`function_call`(ツール入出力)と暗号化された `reasoning`(思考)は
自然に除外されます。

> **なぜ notify を使わないか**: Codex の `notify` は **1プログラムだけ**しか指定できず、
> 多くの環境で computer-use 等のプラグインが既に専有しています。そこを書き換えると
> プラグインが壊れるため、衝突しないセッションファイル監視方式を採用しています。

### Codex の主な環境変数

| 変数 | 既定 | 説明 |
|------|------|------|
| `LRAC_RAW` | – | `1` でフィルタ無効（コード等も含める） |
| `LRAC_POLL_MS` | `300` | 監視ポーリング間隔(ms) |
| `LRAC_CODEX_SESSIONS` | `~/.codex/sessions` | セッション探索ルート |
| `LRAC_QUIET` | – | `1` でログ抑制 |

> 思考(reasoning)は Codex でも暗号化されており平文では取得できません（Claude Code と同様）。

## クリップボード保護（重複排除）

監視やフックが**同じ本文を二度コピーしない**よう、直近にコピーした本文のハッシュを
共有ステートファイル（既定 `%TEMP%/llm-clip-state.json`）に記録します。Stop フック・
Claude監視・Codex監視が同じファイルを共有するため、横断で効きます。

これにより次の不具合を防ぎます:

- 監視のポーリング/ドレイン遅延で「**1個前の応答**」が後から再着弾し、
  ユーザーが別アプリでコピーした内容を上書きしてしまう
- Stop フックと監視が同じ内容を二重に書く
- Codex のセッションファイル再読込で過去メッセージを再コピーする

| 変数 | 既定 | 説明 |
|------|------|------|
| `LRAC_NO_DEDUP` | – | `1` で重複排除を無効化 |
| `LRAC_STATE_FILE` | `%TEMP%/llm-clip-state.json` | 重複排除の状態ファイル |

> 同じ本文を意図的に再コピーしたい場合は、状態ファイルを削除すればリセットされます。

## コピー後リセット（Aqua Voice 等の再読み上げ対策）

一部の読み上げ/音声ツール（例: **Aqua Voice**）は、処理後に「**直前のクリップボードを
復元**」する挙動があり、その復元で**前の内容がもう一度読み上げられて**しまいます。

対策として、コピー後に短い猶予（`LRAC_RESET_MS`）を置いてから**クリップボードを空に戻す**
モードを用意しています。読み上げツールは変更時に内容を取得済みなので読み上げには影響せず、
クリップボードに値が残らないため復元による再読み上げを防げます。
（`.bat` では既定で有効。テキストを貼り付けたい場合は `set LRAC_RESET_MODE=off` に。）

| 変数 | 既定 | 説明 |
|------|------|------|
| `LRAC_RESET_MODE` | `off`（.bat では `blank`） | `blank` でコピー後にクリップボードを空へ戻す |
| `LRAC_RESET_MS` | `150` | コピーから空に戻すまでの猶予(ms)。読み取りが間に合わないなら大きく |

## 制限・注意

- 思考テキストは取得不可（前述）。
- transcript はブロック単位で書かれるため、ストリーミングはトークン単位ではない。
- `.ps1` を編集する場合は **UTF-8 (BOM付き)** で保存（BOMなしだと PowerShell 5.1 で文字化け）。
- Claude Code は **Stop フック**、Codex は **watch-codex** が応答全文を担当します。
  Claude 側で `watch-claudecode`(一行ずつ) も同時に動かすと、ストリーム + 全文の
  二重読み上げになるため、用途に応じてどちらか一方にしてください。

## ライセンス

[MIT License](LICENSE)
