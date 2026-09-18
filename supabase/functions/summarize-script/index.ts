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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SummarizeRequestBody {
  pdfBase64: string;
}

interface Scene {
  caption: string;
  narration: string;
  durationHint: number;
  // 편집 효과(줌, 강조 등) 메타데이터를 나중에 붙이기 위한 자리. 지금은 Gemini에게 채우라고
  // 요청하지 않고, 스키마에도 넣지 않는다 — 이후 우리 쪽 코드나 다음 단계에서 채울 예정.
  effect?: string;
}

interface SummarizeResult {
  scenes: Scene[];
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          caption: { type: "string" },
          narration: { type: "string" },
          durationHint: { type: "number" },
        },
        required: ["caption", "narration", "durationHint"],
      },
    },
  },
  required: ["scenes"],
};

const PROMPT = `다음 PDF(학술 논문 또는 강의자료)를 완전히 읽고, 쇼츠 영상(전체 1분 내외) 대본으로 각색하라.

반드시 지켜야 할 규칙:
1. 원문에 없는 수치나 주장을 절대 지어내지 마라. Hallucination 금지.
2. 첫 장면은 3초 안에 결론이나 반전을 바로 던져라. 논문 제목 소개, 인사말, 배경 설명으로 시작하지 마라.
3. caption(화면 자막)은 반드시 13자 이내로 짧고 강렬하게 써라. narration(TTS로 소리 내어 읽을 대사)은 caption보다 자연스럽게 길어도 되지만 장황해지지 않게 짧게 유지하라.
4. 말투는 친구한테 설명하듯 자연스럽고 편하게 써라. 지루한 논문 말투 그대로 옮기지 마라.
5. 각 장면마다 narration을 소리 내어 읽는 데 걸리는 시간을 초 단위로 추정해 durationHint에 넣어라.
6. 모든 장면의 durationHint 합이 대략 60초 안팎이 되도록 분량을 조절하라.
7. 장면은 최대 15개를 넘기지 마라.`;

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
  });

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
  if (typeof uri !== "string") throw new Error("업로드 응답에 파일 URI가 없습니다.");
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
    throw new Response(JSON.stringify({ error: "Gemini API 호출 실패", detail }), {
      status: res.status === 429 ? 429 : 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const geminiJson = await res.json();
  const resultText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof resultText !== "string") {
    throw new Response(JSON.stringify({ error: "Gemini 응답에 텍스트가 없습니다." }), {
      status: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
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
      return jsonResponse({ error: "GEMINI_API_KEY가 설정되지 않았습니다." }, 500);
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
      const result = await callGemini(fileUri);
      return jsonResponse(result);
    } catch (err) {
      if (err instanceof Response) return err;
      return jsonResponse({ error: "대본 생성 중 오류가 발생했습니다.", detail: String(err) }, 500);
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
