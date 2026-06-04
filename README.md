# llmresponse_auto_clipboard

Claude Code の応答が**完了した瞬間**に、その応答本文を**まとめてクリップボードへ自動コピー**する。
読み上げツールへの流し込みなどを想定。

さらに、コピーされたテキストを**そのまま読み上げる**ローカル TTS 連携（AivisSpeech）も同梱しています
→ [クリップボードを読み上げる（ローカルTTS: AivisSpeech）](#クリップボードを読み上げるローカルtts-aivisspeech)。

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
| 英語主体の行（`LRAC_SKIP_ENGLISH=1` 時のみ） | 日本語がほぼ無く英字が `LRAC_SKIP_ENGLISH_MINLATIN`(既定12)文字以上の行を除外。**英文はクリップボードに載せない**（読み上げ側は載ったものを素直に全部読む方針） |

> Markdown の箇条書き `- 項目` は「記号の直後が空白」なので**残ります**。
> インラインコード（`` `foo` ``）は行全体ではないので**残ります**。
> 英語スキップは**行単位**判定。日本語に英単語が混じる行（例「Claude Code は便利」）は残ります。全文が英語なら何もコピーされません。コピー側（Stop フック/監視）が `.env` を読むので、`.env` に `LRAC_SKIP_ENGLISH=1` を入れれば効きます。

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
| 句読点 | 句点（丸）`。` を読点（点）`、` に置換（TTS の長い間を短い間に） |

## ファイル構成

- `copy-last-response-claudecode.js` … Claude Code の Stop フック本体。ターン全文を抽出→フィルタ→正規化→コピー。
- `watch-claudecode.js` … Claude Code 用、オプションの一行ずつ監視版。
- `watch-codex.js` … **Codex 用**の監視版（メッセージ完了ごとに全文コピー）。
- `filter.js` … 除外フィルタ（全スクリプトで共用）。
- `normalize.js` … 読み上げ正規化（全スクリプトで共用）。
- `clipboard.js` … OS別クリップボード書き込み（Windows は Base64 経由で UTF-8 を正しく処理）。
- `speak-clipboard.js` … **クリップボード読み上げ**の常駐本体（監視→チャンク分割→直列で合成・再生）。
- `tts-aivis.js` … AivisSpeech(ローカル)でテキスト→WAV を合成（VOICEVOX互換 API、依存ゼロ）。
- `tts-openai.js` … OpenAI(クラウド)でテキスト→WAV を合成（`gpt-4o-mini-tts`、依存ゼロ）。
- `play-audio.js` … WAV 再生（Windows は `SoundPlayer`、mac/linux もベストエフォート対応）。
- `start-speak-aivis.bat` … クリップボード読み上げを**ダブルクリック起動**。
- `start-speak-aivis.ps1` … クリップボード読み上げの起動用（PowerShell）。
- `start-speak-openai.bat` … OpenAI 版を**ダブルクリック起動**（`LRAC_TTS_ENGINE=openai`）。
- `start-speak-openai.ps1` … OpenAI 版の起動用（PowerShell）。
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

## クリップボードを読み上げる（ローカルTTS: AivisSpeech）

コピーされたテキストを**完全ローカル・無料**で読み上げる常駐プロセス `speak-clipboard.js` を用意しています。
合成エンジンは **AivisSpeech**（中身は Style-Bert-VITS2 系）。VOICEVOX 互換 API を使いますが、
音声合成は VOICEVOX とは別方式で、より自然な読み上げになります。

クリップボードの変化を検知 → 改行優先でチャンク分割 → 1つずつ合成して順に再生します
（再生は直列なので「中抜け」しません）。コピー元は問わないので、手動でコピーした文章も読み上げます。

### 事前準備

1. **AivisSpeech アプリ（エンジン）をインストールして起動**しておく（既定で `http://127.0.0.1:10101` で待受）。
2. 声（スタイルID）を確認したいときは:

```powershell
node speak-clipboard.js --speakers   # 利用可能な「スタイルID  話者/スタイル名」を一覧表示
```

既定の声は `888753760`（Anneli / ノーマル）。別の声にしたいときは一覧の ID を `LRAC_AIVIS_SPEAKER` に設定します。

### 起動

```powershell
# ダブルクリック起動（推奨）
start-speak-aivis.bat

# または
powershell -ExecutionPolicy Bypass -File start-speak-aivis.ps1
#   node speak-clipboard.js
```

動作確認だけしたいとき:

```powershell
node speak-clipboard.js --say "テスト読み上げです"   # 1回だけ合成・再生して終了
```

> 起動時点でクリップボードにある内容は**読みません**（新しいコピーから読み上げ）。
> 起動直後にも読みたい場合は `LRAC_TTS_SPEAK_ON_START=1`。

### コピー側との組み合わせ

- **Stop フック（全文ブロブ）** + 本リーダーが最もシンプル。受け取った全文をチャンク分割して順に読み上げます。
- `watch-claudecode.js`（一行ずつ）と併用も可。各行が別コピーとして届き、リーダーが順に読みます。
  この場合、コピー側の「適応ウェイト」や「コピー後ブランク化（`LRAC_RESET_MODE=blank`）」は
  **本リーダーには不要**です（リーダー自身がキューで直列再生し、空クリップボードは自動スキップするため）。
- 同じ本文の再来（クリップボード復元など）は読み上げ側でも**重複スキップ**します。

### 環境変数

| 変数 | 既定 | 説明 |
|------|------|------|
| `LRAC_AIVIS_URL` | `http://127.0.0.1:10101` | AivisSpeech エンジンのベースURL |
| `LRAC_AIVIS_SPEAKER` | `888753760` | スタイルID（`--speakers` で一覧）。Anneli/ノーマルが既定 |
| `LRAC_AIVIS_SPEED` | `1.0` | 話速（`speedScale`）。大きいほど速い |
| `LRAC_AIVIS_PITCH` | – | 音高（`pitchScale`） |
| `LRAC_AIVIS_VOLUME` | – | 音量（`volumeScale`） |
| `LRAC_AIVIS_INTONATION` | – | 抑揚/感情の強さ（`intonationScale`） |
| `LRAC_POLL_MS` | `300` | クリップボード監視間隔(ms) |
| `LRAC_TTS_MAX_CHARS` | `140` | 1チャンクの目安文字数。超える行は読点で分割 |
| `LRAC_TTS_INTERRUPT` | 有効 | `0` で割り込み無効（全部キューに積む） |
| `LRAC_TTS_CUT` | – | `1` で新コピー時に再生中チャンクも即停止（既定は鳴らし切ってから切替） |
| `LRAC_TTS_SPEAK_ON_START` | – | `1` で起動時点のクリップボードも読み上げ |
| `LRAC_QUIET` | – | `1` でログ抑制 |

> Windows では追加依存なしで動きます（再生は `System.Media.SoundPlayer`、クリップボード読取は PowerShell 経由）。
> 読み上げ側はクリップボードの内容を**そのまま全部読みます**（英語除外はコピー側の役割。「除外フィルタ」節を参照）。

### エンジンを OpenAI に切り替える（クラウド）

`LRAC_TTS_ENGINE=openai` にすると、合成先を **OpenAI の音声生成 API**（既定 `gpt-4o-mini-tts`）へ変更できます。
ローカル不要・高品質で、`instructions` により喋り方も指示可能。クリップボード監視・チャンク分割・割り込みの
仕組みは AivisSpeech 版と完全に共通です（同じ `speak-clipboard.js`、合成部だけ差し替え）。

事前に APIキー `OPENAI_API_KEY` を設定してください。方法は2通り:

- **`.env`（推奨・確実）**: リポジトリ直下に `.env` を作り、`OPENAI_API_KEY=sk-...`（必要なら `LRAC_TTS_ENGINE=openai` も）を書く（`.env.example` をコピー）。`.env` は gitignore 済みでコミットされず、`setx` の**環境変数伝播の罠（既存の窓やダブルクリック起動に反映されない）**を回避できます。
- **環境変数**: `setx OPENAI_API_KEY "sk-..."` 後、**新しく開いたターミナル**から起動（既存の窓・ダブルクリックには `setx` 前の古い環境が残り反映されません）。

```powershell
$env:OPENAI_API_KEY = "sk-..."
$env:LRAC_TTS_ENGINE = "openai"
node speak-clipboard.js --voices                  # 声の一覧
node speak-clipboard.js --say "OpenAIの声で読み上げます"  # 単発テスト
node speak-clipboard.js                            # 常駐（start-speak-openai.bat でも可）
```

| 変数 | 既定 | 説明 |
|------|------|------|
| `LRAC_TTS_ENGINE` | `aivis` | `openai` で OpenAI に切替 |
| `OPENAI_API_KEY` | – | **必須**。OpenAI APIキー |
| `LRAC_OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | TTSモデル（他に `tts-1` / `tts-1-hd`） |
| `LRAC_OPENAI_VOICE` | `alloy` | 声（`--voices` で一覧。alloy/ash/ballad/coral/echo/fable/onyx/nova/sage/shimmer/verse） |
| `LRAC_OPENAI_INSTRUCTIONS` | – | 喋り方の指示（`gpt-4o-mini-tts` のみ）。例「落ち着いた低めの声で、句読点でしっかり間を取って」 |
| `LRAC_OPENAI_FORMAT` | `wav` | 音声フォーマット（再生互換のため `wav` 推奨） |
| `LRAC_OPENAI_SPEED` | – | 話速 0.25–4.0（`gpt-4o-mini-tts` でも有効） |

> 料金の目安: `gpt-4o-mini-tts` は概ね **$0.015/分** 程度。応答読み上げ程度の文字量なら1回あたり数円以内。
> 長文は「1チャンク = 1 API 呼び出し」なので、呼び出し数やレイテンシが気になる場合は `LRAC_TTS_MAX_CHARS` を大きめに。

## 会話スレッドごとに声を変える

出力が**どの会話由来か**に応じて、テキスト先頭にマーカー `⟦vk:…⟧` を埋め込み、読み上げ側がそれを見て**別の声**で読みます（別の話者が喋っているように聞き分けられる）。マーカーは読み上げ前に除去。マーカーが無いテキスト（手動コピー等）は**既定の声**で読みます。

声を分ける単位は `LRAC_THREAD_KEY` で選べます:

- **`project`（既定）**: 作業フォルダ（プロジェクト）単位。**`--resume` や再起動・複数セッションでも、同じプロジェクトなら同じ声**で安定。別プロジェクト/worktree は別の声。マーカーは `⟦vk:ccp-…⟧`。
- **`session`**: Claude Code / Codex のセッション単位（`⟦vk:cc-…⟧` / `⟦vk:cx-…⟧`）。会話ごとに細かく分かれるが、`--resume` で session_id が変わると声も変わる。

- **既定で有効。** コピー側で `LRAC_THREAD_VOICE=0` にするとマーカーを付けません（従来動作）。
- 声は用意したプールから、キーのハッシュで自動割当。

| 変数 | 既定 | 説明 |
|------|------|------|
| `LRAC_THREAD_KEY` | `project` | 声を分ける単位。`project`(作業フォルダ単位・安定) / `session`(セッション単位) |
| `LRAC_THREAD_VOICE` | 有効 | `0` でマーカー付与を無効（コピー側） |
| `LRAC_OPENAI_VOICE_POOL` | `ash,ballad,coral,sage,verse,onyx` | 割り当てる OpenAI 声プール（手動コピーは `LRAC_OPENAI_VOICE`＝既定 `alloy`） |
| `LRAC_AIVIS_SPEAKER_POOL` | （未設定） | 割り当てる AivisSpeech スタイルIDのプール（カンマ区切り。未設定なら全て既定話者） |

> マーカーはクリップボード本文の先頭に入るため、**読み上げ以外で貼り付ける用途がある場合**は `⟦vk:…⟧` が見えます。気になる場合は `LRAC_THREAD_VOICE=0` で無効化してください。

## 制限・注意

- 思考テキストは取得不可（前述）。
- transcript はブロック単位で書かれるため、ストリーミングはトークン単位ではない。
- `.ps1` を編集する場合は **UTF-8 (BOM付き)** で保存（BOMなしだと PowerShell 5.1 で文字化け）。
- Claude Code は **Stop フック**、Codex は **watch-codex** が応答全文を担当します。
  Claude 側で `watch-claudecode`(一行ずつ) も同時に動かすと、ストリーム + 全文の
  二重読み上げになるため、用途に応じてどちらか一方にしてください。

## ライセンス

[MIT License](LICENSE)
