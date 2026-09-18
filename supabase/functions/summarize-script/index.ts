// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

// gemini-3.5-flash + responseSchema 조합이 실측상 안정적이었다(20초, hallucination 없음).
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

// TTS 켜고 끄는 스위치. Typecast 계정이 UNUSUAL_ACTIVITY_DETECTED(403)로 막혀서
// Google Cloud TTS로 갈아탔다 — GOOGLE_TTS_SERVICE_ACCOUNT_JSON만 있으면 바로 동작한다.
const TTS_ENABLED = true;

// Google Cloud Text-to-Speech. 프로젝트에서 API 키 발급이 막혀 있어(조직 정책) 서비스 계정으로
// 인증한다 — 서비스 계정 JSON 키 전체를 GOOGLE_TTS_SERVICE_ACCOUNT_JSON에 통째로 넣는다.
// 서버 간 호출이라 오히려 API 키보다 이 방식이 정석이다.
const GOOGLE_TTS_SERVICE_ACCOUNT_JSON = Deno.env.get("GOOGLE_TTS_SERVICE_ACCOUNT_JSON");
const GOOGLE_TTS_VOICE = "ko-KR-Neural2-C";
// Google 쪽은 Typecast처럼 빡빡한 동시성 제한은 없지만, 그래도 버스트로 때리지는 않는다.
const GOOGLE_TTS_MAX_CONCURRENCY = 4;

// --- 아래는 Typecast 연동 코드. 지금은 안 쓰지만(TTS_ENABLED 스위치가 Google 쪽을 탄다)
// 구조는 그대로 남겨뒀다 — Typecast 계정이 복구되거나 다시 필요해지면 그대로 되살릴 수 있게. ---
const TYPECAST_API_KEY = Deno.env.get("TYPECAST_API_KEY");
const TYPECAST_MODEL = "ssfm-v30";
const TYPECAST_VOICE_ID = "tc_68257f68bc6e3c161ab5078d";
// Typecast 동시 요청 한도가 2라서, 씬이 몇 개든 이 값을 넘겨 동시에 때리지 않는다.
const TYPECAST_MAX_CONCURRENCY = 2;

// 합성된 나레이션 오디오를 올려두는 공개 버킷. Player가 브라우저에서 바로 재생하므로 public으로 둔다.
const NARRATION_BUCKET = "narration-audio";

// 씬이 끝난 뒤 다음 씬으로 넘어가기 전 숨 돌릴 틈. 트리밍으로 앞뒤를 깎는 대신 여유를 더 준다.
const NARRATION_GAP_SECONDS = 0.1;

// 헤더/바이트 계산을 실제 길이에 맞게 고쳤는데도 재생 끝부분이 잘리는 문제가 있어서 추가한 매직
// 넘버. 근본 원인(Typecast 자체 합성 문제인지, 브라우저 오디오 버퍼링 지연인지) 확정 전 임시 버퍼.
// 필요하면 이 값만 조절하면 된다.
const NARRATION_SAFETY_PADDING_SECONDS = 0.5;

// 클라이언트가 20MB 원본 업로드를 막고 있어(base64로 약 27MB), 여유를 두고 40MB로 방어.
const MAX_BASE64_LENGTH = 40 * 1024 * 1024;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SummarizeRequestBody {
  pdfBase64: string;
}

// 아래 Block/Scene/ShortScript는 src/schema.ts의 zod 스키마(cutBlockSchema 등)와 형태를 맞춰야 한다.
// Deno 런타임이 분리되어 있어 import는 공유하지 않고 손으로 동기화한다 — 필드를 바꾸면 두 파일 다 고칠 것.
// effect 블록은 아직 렌더링되지 않으므로(ShortsVideo.tsx) Gemini에게 생성을 요청하지 않는다.
interface CutBlock {
  type: "cut";
  page: number;
  startOffset: number;
  duration: number;
}

interface AttachmentBlock {
  type: "attachment";
  text: string;
  startOffset: number;
  duration: number;
}

interface MemeBlock {
  type: "meme";
  image: string;
  startOffset: number;
  duration: number;
}

interface SoundBlock {
  type: "sound";
  name: string;
  startOffset: number;
  duration: number;
}

type Block = CutBlock | AttachmentBlock | MemeBlock | SoundBlock;

interface Scene {
  text: string;
  duration: number;
  blocks: Block[];
  // TTS 합성 후 채워진다. Gemini에게 요청하지 않는다.
  audioUrl?: string;
}

interface SummarizeResult {
  title: string;
  scenes: Scene[];
}

// public/assets 에 실제로 있는 파일과 반드시 일치해야 한다 (src/schema.ts의 SOUND_NAMES/MEME_IMAGE_NAMES 참고).
const SOUND_NAMES = ["adrian", "brain", "discord", "faaah", "fbi", "pew", "siu", "wow"];
const MEME_IMAGE_NAMES = [
  "cryingpepe.jpg",
  "dancingpepe1.gif",
  "dancingpepe2.gif",
  "sadpepe.jpg",
  "smilepepe.webp",
];

const timedProps = {
  startOffset: { type: "number" },
  duration: { type: "number" },
};

const CUT_BLOCK_SCHEMA = {
  type: "object",
  properties: { type: { type: "string", enum: ["cut"] }, page: { type: "integer" }, ...timedProps },
  required: ["type", "page", "startOffset", "duration"],
};

const ATTACHMENT_BLOCK_SCHEMA = {
  type: "object",
  properties: { type: { type: "string", enum: ["attachment"] }, text: { type: "string" }, ...timedProps },
  required: ["type", "text", "startOffset", "duration"],
};

const MEME_BLOCK_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["meme"] },
    image: { type: "string", enum: MEME_IMAGE_NAMES },
    ...timedProps,
  },
  required: ["type", "image", "startOffset", "duration"],
};

// volume은 일부러 스키마에 넣지 않는다 — 모델에게 맡기지 않고 항상 앱 쪽 기본값(0.35, schema.ts 참고)을 쓴다.
const SOUND_BLOCK_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["sound"] },
    name: { type: "string", enum: SOUND_NAMES },
    ...timedProps,
  },
  required: ["type", "name", "startOffset", "duration"],
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          duration: { type: "number" },
          blocks: {
            type: "array",
            items: {
              anyOf: [CUT_BLOCK_SCHEMA, ATTACHMENT_BLOCK_SCHEMA, MEME_BLOCK_SCHEMA, SOUND_BLOCK_SCHEMA],
            },
          },
        },
        required: ["text", "duration", "blocks"],
      },
    },
  },
  required: ["title", "scenes"],
};

const PROMPT = `너는 대학 강의자료와 학술 논문을 재미있는 세로형 쇼츠로 각색하는
스크립트 작가이자 영상 편집 설계자다.

입력 자료의 내용을 정확히 이해한 뒤, 대학생이 짧은 시간 안에
핵심 개념을 이해할 수 있도록 TTS 대본과 편집 요소를 JSON으로 작성한다.

[화법]
- 빠르고 직관적인 구어체
- 어미는 "~ㅂ니다", "~구요", "~고 하네요" 위주로 사용
- 짧은 문장과 빠른 전개
- 약간 건조하고 무심한 유머
- 어려운 개념은 일상적인 표현이나 직관적인 비유로 설명
- 결론이나 흥미로운 사실을 먼저 보여주고 이유를 설명
- 억지로 모든 문장을 웃기게 만들지 말고 정보와 유머의 리듬을 만든다
- 특정 실제 인물의 말투나 문체를 그대로 모방하지 않는다

[구성]
가능하면 다음 흐름을 사용한다.

Hook → 의문/문제 → 핵심 개념 → 설명 → 결과/의외의 사실 → 결론

첫 scene은 3초 안에 가장 흥미로운 사실, 질문, 결과 중 하나로 시작한다.
논문 제목 소개, 인사말, 배경 설명으로 시작하지 않는다.
한 scene에는 하나의 핵심 메시지만 담는다.
불필요한 배경 설명과 반복을 제거한다.

title은 영상 상단에 고정으로 표시되는 짧고 강렬한 제목이다.

[분량]
- scene의 text(나레이션)를 소리 내어 읽는 데 걸리는 시간을 초 단위로 추정해 duration에 반영한다.
  duration은 1.5~15초 사이여야 한다.
- 모든 scene의 duration 합이 대략 60초 안팎이 되도록 분량을 조절한다.
- scene은 최대 15개를 넘기지 않는다.
- 참고: 여기서 적는 duration은 block 배치를 위한 추정치일 뿐이다. 실제 값은 TTS로 text를
  합성한 뒤 그 음성 길이로 서버가 자동으로 덮어쓴다. 그러니 text 문장 길이와 리듬을
  최대한 자연스럽게, 실제로 소리 내어 읽었을 때의 호흡에 맞게 써라.

[정확성]
입력 자료에 없는 사실, 숫자, 결과, 인용, 수식 등을 만들지 않는다.
자료의 내용을 재미있게 표현할 수는 있지만 의미를 왜곡하지 않는다.
재미는 사실의 왜곡이 아니라 정보의 선택, 순서, 표현, 타이밍에서 만든다.

[편집]
scene.blocks는 다음 네 가지 type만 사용할 수 있다: cut, attachment, meme, sound.
- cut: 해당 내용을 설명하는 PDF 페이지를 보여줄 때. page는 실제 입력 PDF에 존재하는 페이지 번호여야 한다.
- attachment: 핵심 수식, 숫자, 용어, 비교, 한 줄 결론 등을 크게 보여줄 때.
- meme: 놀라움, 당황, 성공, 실패, 반전 등의 반응을 강조할 때만 사용한다.
- sound: 핵심 정보나 반전, 밈 등의 순간을 강조할 때만 사용한다. volume 필드는 채우지 않는다(앱이 알아서 정한다).
편집 요소를 억지로 많이 넣지 않는다. 한 scene에 여러 block을 겹쳐 써도 된다.

각 block의 startOffset과 duration은 scene 내부 시간이다.
반드시 startOffset >= 0이고,
startOffset + duration <= scene.duration을 만족해야 한다. 이 범위를 벗어나면 출력 전체가 거부된다.
여러 block은 서로 겹칠 수 있다.

[출력]
반드시 제공된 responseSchema에 맞는 유효한 JSON만 출력한다.
Markdown이나 설명문을 JSON 앞뒤에 붙이지 않는다.

사용 가능한 sound: ${SOUND_NAMES.join(", ")}
사용 가능한 meme: ${MEME_IMAGE_NAMES.join(", ")}

출력 전 다음을 확인한다.
- title과 모든 scene의 text/duration/blocks가 채워졌는가
- 모든 block의 type이 cut/attachment/meme/sound 중 하나인가
- 실제 자료에 존재하는 페이지를 cut.page로 사용했는가
- 허용된 sound/meme 이름만 사용했는가
- 모든 block에서 startOffset + duration <= scene.duration을 만족하는가
- scene.duration 합이 60초 안팎이고 scene이 15개를 넘지 않는가
- scene.text를 읽는 시간과 scene.duration이 서로 맞는가
- 자료에 없는 내용을 만들지 않았는가
- 첫 scene이 3초 안에 충분히 흥미로운가
- 전체 영상이 단순 요약이 아니라 하나의 이야기처럼 이어지는가`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// 호출한 쪽(Gemini/TTS/Storage) 이 뭔지 클라이언트가 구분할 수 있도록 매번 source를 붙여서 던진다.
type UpstreamSource = "gemini" | "tts" | "typecast" | "storage";

function upstreamError(source: UpstreamSource, message: string, status = 502): Response {
  return new Response(JSON.stringify({ error: message, source }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Files API로 PDF를 업로드하고 파일 URI를 받는다(resumable upload 프로토콜). */
async function uploadPdf(pdfBytes: Uint8Array): Promise<string> {
  const startRes = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "x-goog-api-key": GEMINI_API_KEY!,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(pdfBytes.length),
      "X-Goog-Upload-Header-Content-Type": "application/pdf",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "paper.pdf" } }),
    // 응답이 안 와도 함수가 무한정 매달리지 않도록 방어. 정상 동작 시간엔 절대 안 걸리는 여유값.
    signal: AbortSignal.timeout(30_000),
  });

  if (!startRes.ok) {
    throw upstreamError("gemini", `파일 업로드 시작 실패: ${await startRes.text()}`);
  }

  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw upstreamError("gemini", "업로드 URL을 받지 못했습니다.");

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(pdfBytes.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: pdfBytes,
    signal: AbortSignal.timeout(60_000),
  });

  if (!uploadRes.ok) {
    throw upstreamError("gemini", `파일 업로드 실패: ${await uploadRes.text()}`);
  }

  const uploadJson = await uploadRes.json();
  const uri = uploadJson.file?.uri;
  if (typeof uri !== "string") throw upstreamError("gemini", "업로드 응답에 파일 URI가 없습니다.");
  return uri;
}

async function callGemini(fileUri: string): Promise<SummarizeResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              { fileData: { mimeType: "application/pdf", fileUri } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
      // 평소 20초 안팎(코드 상단 주석 참고)이니 90초면 정상 동작엔 전혀 안 걸리고, 멈춰버린
      // 요청만 잘라낸다.
      signal: AbortSignal.timeout(90_000),
    },
  );

  if (!res.ok) {
    const detail = await res.text();
    throw upstreamError("gemini", `Gemini API 호출 실패: ${detail}`, res.status === 429 ? 429 : 502);
  }

  const geminiJson = await res.json();
  const resultText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof resultText !== "string") {
    throw upstreamError("gemini", "Gemini 응답에 텍스트가 없습니다.");
  }

  return JSON.parse(resultText);
}

/** 동시 실행 개수를 concurrency로 제한하는 최소한의 큐. Typecast 동시 요청 한도(2) 방어용. */
function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            const next = queue.shift();
            if (next) next();
          });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

/** WAV(RIFF) 헤더를 직접 파싱해서 길이를 구한다 — TTS 응답에 duration 필드가 없다.
 * Typecast/Google TTS 둘 다 WAV로 받기 때문에 provider 상관없이 공용으로 쓴다. */
function getWavDurationSeconds(bytes: Uint8Array): number {
  if (bytes.length < 12) {
    throw upstreamError("tts", "받은 오디오가 올바른 WAV 파일이 아닙니다.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12; // "RIFF"(4) + size(4) + "WAVE"(4) 다음부터 청크 스캔
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataSize = 0;

  while (offset + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const chunkSize = view.getUint32(offset + 4, true);
    const bodyStart = offset + 8;

    if (chunkId === "fmt ") {
      channels = view.getUint16(bodyStart + 2, true);
      sampleRate = view.getUint32(bodyStart + 4, true);
      bitsPerSample = view.getUint16(bodyStart + 14, true);
      offset = bodyStart + chunkSize + (chunkSize % 2); // 청크는 짝수 바이트로 정렬된다
    } else if (chunkId === "data") {
      // 헤더에 적힌 chunkSize를 믿지 않는다 — 스트리밍으로 합성하는 TTS 엔진은 완료 전 추정치로
      // 헤더를 먼저 써두고 끝난 뒤 재기록하지 않는 경우가 있어서, 실제보다 작게 적힐 수 있다.
      // data는 보통 파일의 마지막 청크이므로 남은 바이트 전부를 오디오로 취급해 실제 길이를 구한다.
      const actualRemaining = bytes.length - bodyStart;
      if (chunkSize !== actualRemaining) {
        // 헤더 거짓말이 여전히 있는지, 아니면 Typecast가 보내는 바이트 자체가 짧은 건지 다음
        // 테스트에서 로그로 구분하기 위한 기록(추가 API 호출 없이 확인하려는 용도).
        console.warn(
          `[typecast] WAV data 청크 헤더 크기(${chunkSize}B)와 실제 수신 바이트(${actualRemaining}B)가 다릅니다.`,
        );
      }
      dataSize = actualRemaining;
      break;
    } else {
      offset = bodyStart + chunkSize + (chunkSize % 2);
    }
  }

  if (!sampleRate || !channels || !bitsPerSample || !dataSize) {
    throw upstreamError("tts", "WAV 헤더에서 길이 정보를 읽지 못했습니다.");
  }

  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  return dataSize / byteRate;
}

interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemPrivateKeyToBytes(pem: string): ArrayBuffer {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  return base64ToBytes(base64).buffer;
}

// 엣지 함수 인스턴스가 warm하게 재사용되는 동안은 토큰/키를 다시 만들지 않는다 — 씬마다,
// 요청마다 서명/토큰교환을 반복하면 느려지고 Google 쪽 토큰 엔드포인트도 불필요하게 때리게 된다.
let cachedGoogleKey: CryptoKey | null = null;
let cachedGoogleAccount: GoogleServiceAccount | null = null;
let cachedGoogleToken: { accessToken: string; expiresAt: number } | null = null;

/** 서비스 계정 JSON으로 직접 JWT를 서명해 Google OAuth 액세스 토큰을 받아온다(2-legged OAuth,
 * 별도 라이브러리 없이 Web Crypto만으로). 토큰은 만료 1분 전까지 캐시해서 재사용한다. */
async function getGoogleAccessToken(): Promise<string> {
  if (!GOOGLE_TTS_SERVICE_ACCOUNT_JSON) {
    throw upstreamError("tts", "GOOGLE_TTS_SERVICE_ACCOUNT_JSON이 설정되지 않았습니다.", 500);
  }

  const now = Math.floor(Date.now() / 1000);
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > now + 60) {
    return cachedGoogleToken.accessToken;
  }

  cachedGoogleAccount ??= JSON.parse(GOOGLE_TTS_SERVICE_ACCOUNT_JSON) as GoogleServiceAccount;
  const account = cachedGoogleAccount;

  cachedGoogleKey ??= await crypto.subtle.importKey(
    "pkcs8",
    pemPrivateKeyToBytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: account.token_uri,
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cachedGoogleKey,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;

  const tokenRes = await fetch(account.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    throw upstreamError("tts", `Google 액세스 토큰 발급 실패(${tokenRes.status}): ${detail}`, 502);
  }

  const tokenData = await tokenRes.json();
  cachedGoogleToken = {
    accessToken: tokenData.access_token,
    expiresAt: now + (tokenData.expires_in ?? 3600),
  };
  return cachedGoogleToken.accessToken;
}

// Google Cloud TTS의 text:synthesize 엔드포인트는 요청 하나에 5000byte까지 받는다.
const GOOGLE_TTS_TEXT_MAX_LENGTH = 5000;

/** 씬 나레이션 하나를 Google Cloud TTS로 합성한다. LINEAR16으로 요청하면 응답이 WAV
 * 컨테이너(RIFF 헤더 포함)로 오기 때문에 getWavDurationSeconds를 그대로 재사용할 수 있다. */
async function synthesizeSceneAudioGoogle(text: string): Promise<Uint8Array> {
  if (text.length === 0 || text.length > GOOGLE_TTS_TEXT_MAX_LENGTH) {
    throw upstreamError(
      "tts",
      `나레이션 길이가 Google TTS 제한(1~${GOOGLE_TTS_TEXT_MAX_LENGTH}자)을 벗어났습니다: ${text.length}자`,
      400,
    );
  }

  const accessToken = await getGoogleAccessToken();

  const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "ko-KR", name: GOOGLE_TTS_VOICE },
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000 },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw upstreamError("tts", `Google TTS 호출 실패(${res.status}): ${detail}`, res.status === 429 ? 429 : 502);
  }

  const { audioContent } = await res.json();
  if (typeof audioContent !== "string") {
    throw upstreamError("tts", "Google TTS 응답에 audioContent가 없습니다.");
  }
  return base64ToBytes(audioContent);
}

// --- 아래는 Typecast 연동 코드(현재 미사용, TTS_ENABLED는 위 Google 함수를 탄다). 구조만 보존. ---

// Typecast 문서상 text는 1~2000자. 넘기면 Typecast가 400을 주긴 하지만, 원인이 뭔지 바로
// 드러나도록 우리 쪽에서 먼저 걸러서 명확한 에러로 실패시킨다.
const TYPECAST_TEXT_MAX_LENGTH = 2000;

/** 씬 나레이션 하나를 Typecast로 합성한다. 429(동시성/rate limit)는 한 번만 재시도한다. */
async function synthesizeSceneAudio(text: string, attempt = 0): Promise<Uint8Array> {
  if (text.length === 0 || text.length > TYPECAST_TEXT_MAX_LENGTH) {
    throw upstreamError(
      "typecast",
      `나레이션 길이가 Typecast 제한(1~${TYPECAST_TEXT_MAX_LENGTH}자)을 벗어났습니다: ${text.length}자`,
      400,
    );
  }

  const res = await fetch("https://api.typecast.ai/v1/text-to-speech", {
    method: "POST",
    headers: { "X-API-KEY": TYPECAST_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TYPECAST_MODEL,
      voice_id: TYPECAST_VOICE_ID,
      text,
      language: "kor",
      // remove_silence_ms를 걸면 무음 감지가 과하게 잡혀서 발화 앞뒤가 잘리는 문제가 있었다.
      // 트리밍 대신 attachNarration에서 NARRATION_GAP_SECONDS만큼 뒤에 여유를 붙이는 쪽으로 바꿨다.
      output: { audio_format: "wav", remove_silence_ms: 0 },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status === 429 && attempt === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return synthesizeSceneAudio(text, attempt + 1);
  }

  if (!res.ok) {
    const detail = await res.text();
    throw upstreamError(
      "typecast",
      `Typecast TTS 호출 실패(${res.status}): ${detail}`,
      res.status === 429 ? 429 : 502,
    );
  }

  return new Uint8Array(await res.arrayBuffer());
}

// 엣지 함수 인스턴스는 요청 간에 warm하게 재사용되는 경우가 많다 — 한 번 만든 걸 확인했으면
// 매 요청마다 getBucket을 또 부를 필요 없다(순수 지연시간 절약, 동작은 그대로).
let narrationBucketReady = false;

// deno-lint-ignore no-explicit-any
async function ensureNarrationBucket(supabaseAdmin: any) {
  if (narrationBucketReady) return;

  const { data } = await supabaseAdmin.storage.getBucket(NARRATION_BUCKET);
  if (!data) {
    const { error } = await supabaseAdmin.storage.createBucket(NARRATION_BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message ?? "")) {
      throw upstreamError("storage", `오디오 저장용 버킷 생성 실패: ${error.message}`);
    }
  }

  narrationBucketReady = true;
}

async function uploadNarrationAudio(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  path: string,
  bytes: Uint8Array,
): Promise<string> {
  const { error } = await supabaseAdmin.storage.from(NARRATION_BUCKET).upload(path, bytes, {
    contentType: "audio/wav",
    upsert: true,
    // 경로가 요청마다 유니크(requestId/씬 인덱스)해서 내용이 바뀔 일이 없다 — 오래 캐시해도 안전.
    cacheControl: "31536000",
  });
  if (error) throw upstreamError("storage", `오디오 업로드 실패: ${error.message}`);

  const { data } = supabaseAdmin.storage.from(NARRATION_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// sound 블록은 스키마상 duration 최소 0.5초, 나머지 블록은 0.1초가 최소다(src/schema.ts 참고).
function minBlockDuration(block: Block): number {
  return block.type === "sound" ? 0.5 : 0.1;
}

// Gemini가 원래 준 duration 끝(또는 그 근처)까지 닿아 있던 block은 "씬 끝까지 채우려는 의도"로
// 보고, 늘어난 sceneDuration만큼 같이 늘린다. 부동소수점 오차를 감안해 살짝 여유를 둔다.
const SCENE_END_EPSILON_SECONDS = 0.05;

/** scene.duration이 TTS 실측값(+갭+안전 버퍼)으로 바뀌면서 block 길이를 다시 맞춘다.
 * - 원래 씬 끝까지 이어지던 block(주로 배경 cut)은 새 sceneDuration 끝까지 늘린다.
 * - 그 외(중간에 잠깐 등장하는 block)는 넘치는 만큼만 잘라내거나, 아예 못 들어가면 버린다. */
function reconcileBlocks(blocks: Block[], originalDuration: number, sceneDuration: number): Block[] {
  const kept: Block[] = [];
  for (const block of blocks) {
    const available = sceneDuration - block.startOffset;
    if (available < minBlockDuration(block)) continue;

    const reachedOriginalEnd = block.startOffset + block.duration >= originalDuration - SCENE_END_EPSILON_SECONDS;
    const duration = reachedOriginalEnd ? available : Math.min(block.duration, available);

    kept.push({ ...block, duration });
  }
  return kept;
}

/** Gemini가 만든 scene들에 실제 TTS 오디오를 입히고, duration/blocks를 그 길이에 맞게 고정한다.
 * TTS_ENABLED가 꺼져 있으면(현재 Typecast 계정 막힘) 아무것도 하지 않고 Gemini의 추정 duration을
 * 그대로 쓴다 — scene.audioUrl 없이도 ShortsVideo/CutView는 정상 렌더링된다(나레이션만 없음). */
// deno-lint-ignore no-explicit-any
async function attachNarration(scenes: Scene[], supabaseAdmin: any): Promise<Scene[]> {
  if (!TTS_ENABLED) return scenes;

  await ensureNarrationBucket(supabaseAdmin);

  const requestId = crypto.randomUUID();
  const limit = createLimiter(GOOGLE_TTS_MAX_CONCURRENCY);

  return Promise.all(
    scenes.map((scene, i) =>
      limit(async () => {
        const audioBytes = await synthesizeSceneAudioGoogle(scene.text);
        // 오디오 자체는 트리밍하지 않은 실제 길이. scene.duration에는 다음 씬으로 넘어가기 전
        // 숨 돌릴 틈(NARRATION_GAP_SECONDS) + 끝부분 잘림 방지용 안전 버퍼를 더한다.
        const audioDurationSeconds = getWavDurationSeconds(audioBytes);
        const sceneDuration = audioDurationSeconds + NARRATION_GAP_SECONDS + NARRATION_SAFETY_PADDING_SECONDS;
        const audioUrl = await uploadNarrationAudio(supabaseAdmin, `${requestId}/${i}.wav`, audioBytes);

        return {
          ...scene,
          duration: sceneDuration,
          blocks: reconcileBlocks(scene.blocks, scene.duration, sceneDuration),
          audioUrl,
        };
      })
    ),
  );
}

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req, ctx) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "POST만 지원합니다." }, 405);
    }

    if (!GEMINI_API_KEY) {
      return jsonResponse({ error: "GEMINI_API_KEY가 설정되지 않았습니다." }, 500);
    }
    if (TTS_ENABLED && !GOOGLE_TTS_SERVICE_ACCOUNT_JSON) {
      return jsonResponse({ error: "GOOGLE_TTS_SERVICE_ACCOUNT_JSON이 설정되지 않았습니다." }, 500);
    }

    let body: SummarizeRequestBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "잘못된 JSON 요청입니다." }, 400);
    }

    const pdfBase64 = body?.pdfBase64;
    if (typeof pdfBase64 !== "string" || pdfBase64.length === 0) {
      return jsonResponse({ error: "pdfBase64: string 형식이 필요합니다." }, 400);
    }
    if (pdfBase64.length > MAX_BASE64_LENGTH) {
      return jsonResponse({ error: "PDF 용량이 너무 큽니다." }, 400);
    }

    try {
      const pdfBytes = base64ToBytes(pdfBase64);
      const fileUri = await uploadPdf(pdfBytes);
      // 업로드된 파일은 48시간 뒤 자동 만료되므로 별도 삭제는 하지 않는다.
      const script = await callGemini(fileUri);
      const scenesWithAudio = await attachNarration(script.scenes, ctx.supabaseAdmin);
      return jsonResponse({ title: script.title, scenes: scenesWithAudio });
    } catch (err) {
      if (err instanceof Response) return err;
      return jsonResponse(
        { error: "대본 생성 중 오류가 발생했습니다.", detail: String(err) },
        500,
      );
    }
  }),
};

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Set the GEMINI_API_KEY / GOOGLE_TTS_SERVICE_ACCOUNT_JSON secrets (see: https://supabase.com/docs/guides/functions/secrets)
  3. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/summarize-script' \
    --header 'apiKey: <anon key>' \
    --header 'Content-Type: application/json' \
    --data '{"pdfBase64":"..."}'

*/
