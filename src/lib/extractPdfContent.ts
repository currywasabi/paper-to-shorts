import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface Section {
  page: number;
  heading: string;
  content: string;
}

export interface ExtractResult {
  sections: Section[];
}

async function extractPageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  return textContent.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * AI 없이 pdfjs 텍스트 레이어만으로 뽑는 가벼운 추출기.
 * 편집·영상 제작·다운로드·DB 파이프라인을 먼저 검증하기 위한 임시 버전이며,
 * 추후 Gemini 기반 맥락 요약(supabase/functions/extract-pdf-text)으로 교체될 예정이다.
 *
 * 이미지 추출(pdfEmbeddedImages.ts)은 안정화 전까지 잠시 빼둔 상태 — 모듈 자체는
 * 남겨뒀으니 필요해지면 다시 연결하면 된다.
 */
export async function extractPdfContent(pdf: PDFDocumentProxy): Promise<ExtractResult> {
  const sections: Section[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const content = await extractPageText(pdf, pageNumber);
    sections.push({ page: pageNumber, heading: `페이지 ${pageNumber}`, content });
  }

  return { sections };
}
