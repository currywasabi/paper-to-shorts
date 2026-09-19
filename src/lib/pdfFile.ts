export const MAX_FILE_SIZE = 20 * 1024 * 1024;

const PDF_MAGIC_BYTES = '%PDF-';

/**
 * 확장자는 클라이언트에서 위조 가능하므로, 실제 파일 시그니처(%PDF-)까지 확인해
 * 최소한의 위장 파일을 거른다. file.type(브라우저/OS가 추정한 MIME)은 일부러 안 본다 —
 * iOS Safari나 클라우드 저장소에서 받은 진짜 PDF도 종종 다른 값을 보고해서 오탐이 난다.
 */
export async function validatePdfFile(file: File): Promise<string | null> {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return 'PDF 파일(.pdf)만 업로드할 수 있습니다.';
  }
  if (file.size === 0) {
    return '빈 파일은 업로드할 수 없습니다.';
  }
  if (file.size > MAX_FILE_SIZE) {
    return `파일 크기는 ${MAX_FILE_SIZE / 1024 / 1024}MB를 초과할 수 없습니다.`;
  }

  const header = await file.slice(0, 5).arrayBuffer();
  const signature = new TextDecoder().decode(header);
  if (signature !== PDF_MAGIC_BYTES) {
    return '올바른 PDF 파일이 아닙니다.';
  }

  return null;
}
