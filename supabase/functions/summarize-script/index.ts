// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

// gemini-3.5-flash + responseSchema 조합이 실측상 안정적이었다(20초, hallucination 없음).
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

// 클라이언트가 20MB 원본 업로드를 막고 있어(base64로 약 27MB), 여유를 두고 40MB로 방어.
const MAX_BASE64_LENGTH = 40 * 1024 * 1024;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
}

interface SummarizeResult {
  title: string;
  scenes: Scene[];
}

// public/assets 에 실제로 있는 파일과 반드시 일치해야 한다 (src/schema.ts의 SOUND_NAMES/MEME_IMAGE_NAMES 참고).
const SOUND_NAMES = [
  "adrian",
  "brain",
  "discord",
  "faaah",
  "fbi",
  "pew",
  "siu",
  "wow",
];
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
  properties: {
    type: { type: "string", enum: ["cut"] },
    page: { type: "integer" },
    ...timedProps,
  },
  required: ["type", "page", "startOffset", "duration"],
};

const ATTACHMENT_BLOCK_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["attachment"] },
    text: { type: "string" },
    ...timedProps,
  },
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
              anyOf: [
                CUT_BLOCK_SCHEMA,
                ATTACHMENT_BLOCK_SCHEMA,
                MEME_BLOCK_SCHEMA,
                SOUND_BLOCK_SCHEMA,
              ],
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

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Files API로 PDF를 업로드하고 파일 URI를 받는다(resumable upload 프로토콜). */
async function uploadPdf(pdfBytes: Uint8Array): Promise<string> {
  const startRes = await fetch(
    "https://generativelanguage.googleapis.com/upload/v1beta/files",
    {
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
    },
  );

  if (!startRes.ok) {
    throw new Error(`파일 업로드 시작 실패: ${await startRes.text()}`);
  }

  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("업로드 URL을 받지 못했습니다.");

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(pdfBytes.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: pdfBytes,
  });

  if (!uploadRes.ok) {
    throw new Error(`파일 업로드 실패: ${await uploadRes.text()}`);
  }

  const uploadJson = await uploadRes.json();
  const uri = uploadJson.file?.uri;
  if (typeof uri !== "string")
    throw new Error("업로드 응답에 파일 URI가 없습니다.");
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
    },
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Response(
      JSON.stringify({ error: "Gemini API 호출 실패", detail }),
      {
        status: res.status === 429 ? 429 : 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  }

  const geminiJson = await res.json();
  const resultText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof resultText !== "string") {
    throw new Response(
      JSON.stringify({ error: "Gemini 응답에 텍스트가 없습니다." }),
      {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  }

  return JSON.parse(resultText);
}

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "POST만 지원합니다." }, 405);
    }

    if (!GEMINI_API_KEY) {
      return jsonResponse(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
        500,
      );
    }

    let body: SummarizeRequestBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "잘못된 JSON 요청입니다." }, 400);
    }

    const pdfBase64 = body?.pdfBase64;
    if (typeof pdfBase64 !== "string" || pdfBase64.length === 0) {
      return jsonResponse(
        { error: "pdfBase64: string 형식이 필요합니다." },
        400,
      );
    }
    if (pdfBase64.length > MAX_BASE64_LENGTH) {
      return jsonResponse({ error: "PDF 용량이 너무 큽니다." }, 400);
    }

    try {
      const pdfBytes = base64ToBytes(pdfBase64);
      const fileUri = await uploadPdf(pdfBytes);
      // 업로드된 파일은 48시간 뒤 자동 만료되므로 별도 삭제는 하지 않는다.
      const result = await callGemini(fileUri);
      return jsonResponse(result);
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
  2. Set the GEMINI_API_KEY secret (see: https://supabase.com/docs/guides/functions/secrets)
  3. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/summarize-script' \
    --header 'apiKey: <anon key>' \
    --header 'Content-Type: application/json' \
    --data '{"pdfBase64":"..."}'

*/
