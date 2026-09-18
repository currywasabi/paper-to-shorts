import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface EmbeddedImage {
  page: number;
  blob: Blob;
  width: number;
  height: number;
}

interface RawImageObject {
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
  width: number;
  height: number;
}

function rawToImageData(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): ImageData {
  const pixelCount = width * height;

  if (data.length === pixelCount * 4) {
    return new ImageData(new Uint8ClampedArray(data), width, height);
  }

  // pdfjs는 알파가 없는 RGB 이미지를 3바이트/px로 반환하기도 한다.
  if (data.length === pixelCount * 3) {
    const rgba = new Uint8ClampedArray(pixelCount * 4);
    for (let i = 0; i < pixelCount; i++) {
      rgba[i * 4] = data[i * 3];
      rgba[i * 4 + 1] = data[i * 3 + 1];
      rgba[i * 4 + 2] = data[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
    return new ImageData(rgba, width, height);
  }

  throw new Error('지원하지 않는 이미지 픽셀 포맷입니다.');
}

async function imageObjectToBlob(obj: RawImageObject): Promise<Blob | null> {
  if (!obj || !obj.width || !obj.height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = obj.width;
  canvas.height = obj.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  if (obj.bitmap) {
    ctx.drawImage(obj.bitmap, 0, 0);
  } else if (obj.data) {
    ctx.putImageData(rawToImageData(obj.data, obj.width, obj.height), 0, 0);
  } else {
    return null;
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * PDF 페이지 안에 임베드된 개별 래스터 이미지(그림/사진)를 추출한다.
 * pdfjs 내부 객체 형태가 버전에 따라 조금씩 달라질 수 있어, 개별 이미지 디코딩 실패는
 * 전체를 중단시키지 않고 건너뛴다.
 */
export async function extractEmbeddedImages(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<EmbeddedImage[]> {
  const page = await pdf.getPage(pageNumber);
  const operatorList = await page.getOperatorList();
  const { OPS } = pdfjsLib;

  const objIds = new Set<string>();
  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const fn = operatorList.fnArray[i];
    if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
      const objId = operatorList.argsArray[i]?.[0];
      if (typeof objId === 'string') objIds.add(objId);
    }
  }

  const images: EmbeddedImage[] = [];
  for (const objId of objIds) {
    // 여러 페이지에서 재사용되는 이미지는 page.objs가 아니라 page.commonObjs에 들어간다.
    let obj: RawImageObject | null = null;
    if (page.objs.has(objId)) obj = page.objs.get(objId) as RawImageObject;
    else if (page.commonObjs.has(objId)) obj = page.commonObjs.get(objId) as RawImageObject;
    if (!obj) continue;

    try {
      const blob = await imageObjectToBlob(obj);
      if (blob) images.push({ page: pageNumber, blob, width: obj.width, height: obj.height });
    } catch (err) {
      console.warn(`[pdfEmbeddedImages] 페이지 ${pageNumber}의 이미지(${objId}) 디코딩 실패`, err);
    }
  }

  return images;
}

export async function extractAllEmbeddedImages(pdf: PDFDocumentProxy): Promise<EmbeddedImage[]> {
  const all: EmbeddedImage[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    all.push(...(await extractEmbeddedImages(pdf, pageNumber)));
  }
  return all;
}
