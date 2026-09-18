// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

// 직접 curl로 확인한 결과: gemini-3.8-flash/3.7-flash/3.6-flash는 현재 무료 티어에서
// 503(고수요)이 발생하고, gemini-2.5-flash는 이 키에서 404(단종)로 막혀 있다.
// gemini-3.5-flash만 실제로 200 OK를 반환해 기본값으로 고정. 필요하면 GEMINI_MODEL
// 시크릿으로 다른 모델을 지정할 수 있다.
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

// 클라이언트가 20MB 원본 업로드를 막고 있어(base64로 약 27MB), 여유를 두고 40MB로 방어.
const MAX_BASE64_LENGTH = 40 * 1024 * 1024;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ExtractRequestBody {
  pdfBase64: string;
}

interface Section {
  page: number;
  heading: string;
  content: string;
}

interface ImportantFigure {
  page: number;
  reason: string;
}

interface ExtractResult {
  sections: Section[];
  importantFigures: ImportantFigure[];
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page: { type: "integer" },
          heading: { type: "string" },
          content: { type: "string" },
        },
        required: ["page", "heading", "content"],
      },
    },
    importantFigures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["page", "reason"],
      },
    },
  },
  required: ["sections", "importantFigures"],
};

const PROMPT = `다음 PDF(학술 논문 또는 강의자료)를 완전히 읽고, 이후 요약 영상 대본 제작에 쓸 수 있도록 정리하라.

반드시 지켜야 할 규칙:
1. 원문에 없는 내용을 추가하거나 추측하지 마라. 확실하지 않은 부분은 생략하거나 "[불확실]"로 표시하라. Hallucination은 절대 금지다.
2. 페이지 레이아웃(단 구성 등)은 무시하고, 논리적 순서(서론/방법/결과/결론 등)에 따라 섹션으로 나눠라.
3. 각 섹션은 핵심 주장·수치·근거를 빠짐없이 담되, 원문을 그대로 베끼지 말고 정리된 문장으로 써라.
4. 수식이 등장하면 반드시 LaTeX로 정확하게 표기하라 (인라인 $...$, 별도 줄 $$...$$). PDF에 내장된 텍스트 레이어가 깨진 문자로 보이면 그 텍스트를 그대로 베끼지 말고, 페이지를 직접 보고 수식을 다시 읽어서 복원하라.
5. 그림/표/차트 중 내용 이해에 실제로 중요한 것만 골라 어느 페이지에 있는지와 왜 중요한지 적어라. 로고, 장식, 반복되는 머리말/꼬리말 이미지는 제외하라.`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function callGemini(pdfBase64: string): Promise<ExtractResult> {
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
              { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
            ],
          },
        ],
        generationConfig: {
          // 창작/추측 여지를 최소화해 hallucination을 줄이기 위해 0으로 고정
          temperature: 0,
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
  const text = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new Response(JSON.stringify({ error: "Gemini 응답에 텍스트가 없습니다." }), {
      status: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return JSON.parse(text);
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

    let body: ExtractRequestBody;
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
      const result = await callGemini(pdfBase64);
      return jsonResponse(result);
    } catch (err) {
      if (err instanceof Response) return err;
      return jsonResponse({ error: "텍스트 추출 중 오류가 발생했습니다.", detail: String(err) }, 500);
    }
  }),
};

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Set the GEMINI_API_KEY secret (see: https://supabase.com/docs/guides/functions/secrets)
  3. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/extract-pdf-text' \
    --header 'apiKey: <anon key>' \
    --header 'Content-Type: application/json' \
    --data '{"pdfBase64":"..."}'

*/
