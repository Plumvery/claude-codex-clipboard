/**
 * tts-aivis.js — AivisSpeech Engine(ローカル) でテキスト→音声(WAV) を合成する。
 *
 * AivisSpeech は VOICEVOX 互換の HTTP API を持つローカル音声合成エンジン。
 * 中身は Style-Bert-VITS2 系なので、VOICEVOX の声質とは異なり自然な読み上げになる。
 * 既定ポートは 10101。合成は 2 段階:
 *   1) POST /audio_query?speaker=<styleId>&text=<text>   -> AudioQuery(JSON)
 *   2) POST /synthesis?speaker=<styleId>  (body: AudioQuery) -> WAV(audio/wav)
 *
 * 依存ゼロ(Node 標準 http のみ)。
 *
 * 環境変数:
 *   LRAC_AIVIS_URL     既定 http://127.0.0.1:10101  エンジンのベースURL
 *   LRAC_AIVIS_SPEAKER 既定 888753760               スタイルID(Anneli ノーマル)
 *   LRAC_AIVIS_SPEED   既定 1.0                      speedScale(話速)
 *   LRAC_AIVIS_PITCH   任意                          pitchScale(音高)
 *   LRAC_AIVIS_VOLUME  任意                          volumeScale(音量)
 *   LRAC_AIVIS_INTONATION 任意                       intonationScale(抑揚/感情の強さ)
 *
 * スタイルIDが分からない時は listSpeakers() で一覧を取得できる
 * (speak-clipboard.js --speakers でも表示可)。
 */

const http = require("http");
const { URL } = require("url");

const BASE = process.env.LRAC_AIVIS_URL || "http://127.0.0.1:10101";
const SPEAKER = process.env.LRAC_AIVIS_SPEAKER || "888753760"; // Anneli / ノーマル
const SPEED = parseFloat(process.env.LRAC_AIVIS_SPEED || "1.0");

function envFloat(name) {
  const v = process.env[name];
  if (v === undefined || v === "") return undefined;
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : undefined;
}

/** 単発の HTTP リクエスト。2xx 以外は reject。 */
function request(method, pathWithQuery, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(pathWithQuery, BASE);
    const req = http.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || 80,
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
            reject(
              new Error(
                `HTTP ${res.statusCode} ${method} ${u.pathname}: ` +
                  buf.toString("utf8").slice(0, 200)
              )
            );
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
 * @param {string} text  合成するテキスト(1チャンク想定)
 * @param {object} [opts] { speaker, speed }
 * @returns {Promise<Buffer>} WAV データ
 */
async function synthesize(text, opts) {
  opts = opts || {};
  const speaker = String(opts.speaker || SPEAKER);

  // 1) audio_query: text と speaker はクエリ文字列。body は空。
  const q =
    "/audio_query?speaker=" +
    encodeURIComponent(speaker) +
    "&text=" +
    encodeURIComponent(text);
  const queryBuf = await request("POST", q);
  const query = JSON.parse(queryBuf.toString("utf8"));

  // 合成パラメータの上書き(任意)
  const speed = opts.speed != null ? opts.speed : SPEED;
  if (Number.isFinite(speed)) query.speedScale = speed;
  const pitch = envFloat("LRAC_AIVIS_PITCH");
  if (pitch !== undefined) query.pitchScale = pitch;
  const volume = envFloat("LRAC_AIVIS_VOLUME");
  if (volume !== undefined) query.volumeScale = volume;
  const intonation = envFloat("LRAC_AIVIS_INTONATION");
  if (intonation !== undefined) query.intonationScale = intonation;

  // 2) synthesis: AudioQuery を body に渡して WAV を得る
  const body = Buffer.from(JSON.stringify(query), "utf8");
  const wav = await request(
    "POST",
    "/synthesis?speaker=" + encodeURIComponent(speaker),
    {
      body,
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/wav",
        "Content-Length": body.length,
      },
    }
  );
  return wav;
}

/** 利用可能な話者とスタイル(ID)の一覧を取得する。 */
async function listSpeakers() {
  const buf = await request("GET", "/speakers");
  return JSON.parse(buf.toString("utf8"));
}

/** エンジンが起動しているかの簡易チェック。失敗時は reject。 */
async function health() {
  const buf = await request("GET", "/version");
  return buf.toString("utf8").trim();
}

/** 選択可能なボイス一覧({id,label})。/speakers を話者×スタイルに展開する。 */
async function listVoices() {
  const speakers = await listSpeakers();
  const out = [];
  for (const sp of speakers) {
    for (const st of sp.styles || []) {
      out.push({ id: st.id, label: `${sp.name} / ${st.name}` });
    }
  }
  return out;
}

function describe() {
  return `AivisSpeech ${BASE} speaker=${SPEAKER}`;
}

module.exports = {
  name: "AivisSpeech",
  describe,
  hint: "AivisSpeech アプリ(エンジン)を起動してください。",
  synthesize,
  health,
  listVoices,
  listSpeakers,
  BASE,
  SPEAKER,
};
