/**
 * tts-openai.js — OpenAI の音声生成 API でテキスト→音声(WAV) を作る。
 *
 * エンドポイント: POST https://api.openai.com/v1/audio/speech
 * 既定モデルは gpt-4o-mini-tts(最新・安価・instructions で喋り方を指示できる)。
 * response_format=wav で受け取り、play-audio.js(SoundPlayer) でそのまま再生できる。
 *
 * tts-aivis.js と同じインターフェース(synthesize / health / listVoices / describe / name / hint)
 * を実装しているので、speak-clipboard.js から差し替えて使える。
 * 依存ゼロ(Node 標準 https のみ)。APIキーは環境変数 OPENAI_API_KEY。
 *
 * 環境変数:
 *   OPENAI_API_KEY            必須。APIキー。
 *   LRAC_OPENAI_TTS_MODEL     既定 gpt-4o-mini-tts
 *   LRAC_OPENAI_VOICE         既定 alloy
 *                             (alloy/ash/ballad/coral/echo/fable/onyx/nova/sage/shimmer/verse)
 *   LRAC_OPENAI_INSTRUCTIONS  任意。喋り方の指示(例「落ち着いた低めの声でゆっくり」)。
 *                             gpt-4o-mini-tts でのみ有効。
 *   LRAC_OPENAI_FORMAT        既定 wav。再生互換のため wav 推奨(他: mp3/opus/aac/flac/pcm)。
 *   LRAC_OPENAI_SPEED         任意。0.25–4.0。主に tts-1 / tts-1-hd 向け。
 *   LRAC_OPENAI_BASE_URL      既定 https://api.openai.com (互換プロキシ用)。
 */

const https = require("https");
const { URL } = require("url");

const BASE_URL = process.env.LRAC_OPENAI_BASE_URL || "https://api.openai.com";
const MODEL = process.env.LRAC_OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const VOICE = process.env.LRAC_OPENAI_VOICE || "alloy";
const FORMAT = process.env.LRAC_OPENAI_FORMAT || "wav";
const INSTRUCTIONS = process.env.LRAC_OPENAI_INSTRUCTIONS || "";
const VOICES = [
  "alloy", "ash", "ballad", "coral", "echo",
  "fable", "onyx", "nova", "sage", "shimmer", "verse",
];

function apiKey() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("OPENAI_API_KEY が未設定です");
  return k;
}

/** 単発の HTTPS リクエスト。2xx 以外は reject(エラーメッセージは可能なら JSON から抽出)。 */
function request(method, path, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE_URL);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: opts.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(buf);
          } else {
            let msg = buf.toString("utf8").slice(0, 300);
            try {
              const j = JSON.parse(buf.toString("utf8"));
              if (j && j.error && j.error.message) msg = j.error.message;
            } catch {
              /* JSON でなければそのまま */
            }
            reject(new Error(`HTTP ${res.statusCode} ${method} ${u.pathname}: ${msg}`));
          }
        });
      }
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/**
 * テキストを WAV(Buffer) に合成する。
 * @param {string} text
 * @param {object} [opts] { model, voice, format, instructions, speed }
 * @returns {Promise<Buffer>}
 */
async function synthesize(text, opts) {
  opts = opts || {};
  const payload = {
    model: opts.model || MODEL,
    voice: opts.voice || VOICE,
    input: text,
    response_format: opts.format || FORMAT,
  };
  const instructions = opts.instructions != null ? opts.instructions : INSTRUCTIONS;
  if (instructions) payload.instructions = instructions;
  let speed = opts.speed;
  if (speed == null && process.env.LRAC_OPENAI_SPEED) {
    speed = parseFloat(process.env.LRAC_OPENAI_SPEED);
  }
  if (Number.isFinite(speed)) payload.speed = speed;

  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return request("POST", "/v1/audio/speech", {
    body,
    headers: {
      Authorization: "Bearer " + apiKey(),
      "Content-Type": "application/json",
      "Content-Length": body.length,
    },
  });
}

/** APIキーの有無 + 認証チェック(無料の GET /v1/models)。失敗時は reject。 */
async function health() {
  apiKey(); // 未設定なら throw
  await request("GET", "/v1/models", {
    headers: { Authorization: "Bearer " + apiKey() },
  });
  return `${MODEL}/${VOICE}`;
}

/** 選択可能なボイス一覧({id,label})。OpenAI は固定リスト。 */
async function listVoices() {
  return VOICES.map((v) => ({ id: v, label: v === VOICE ? v + " (既定)" : v }));
}

function describe() {
  return `OpenAI ${MODEL} voice=${VOICE} format=${FORMAT}`;
}

module.exports = {
  name: "OpenAI",
  describe,
  hint: "環境変数 OPENAI_API_KEY を設定してください(ネットワーク接続も必要)。",
  synthesize,
  health,
  listVoices,
  VOICES,
  MODEL,
  VOICE,
};
