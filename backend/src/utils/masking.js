const sharp = require('sharp');

/**
 * 상하단 8% 라벨 영역 블랙 마스킹 (병원명·환자명 라벨 제거)
 */
async function applyLabelMask(imageBuffer, width, height) {
  const topH    = Math.floor(height * 0.08);
  const bottomY = height - Math.floor(height * 0.08);
  const bottomH = height - bottomY;

  return sharp(imageBuffer)
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${topH}"><rect x="0" y="0" width="${width}" height="${topH}" fill="black"/></svg>`
        ),
        top: 0, left: 0
      },
      {
        input: Buffer.from(
          `<svg width="${width}" height="${bottomH}"><rect x="0" y="0" width="${width}" height="${bottomH}" fill="black"/></svg>`
        ),
        top: bottomY, left: 0
      }
    ])
    .png()
    .toBuffer();
}

/**
 * 바운딩박스 기반 병변 마스킹
 * - 전체를 블랙으로 채운 뒤 병변 좌표 영역만 원본으로 복원
 * - coords: [{ x, y, w, h }, ...]
 */
async function applyBBoxLesionMask(imageBuffer, coords, width, height) {
  const blackBase = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).png().toBuffer();

  const composites = [];
  for (const { x, y, w, h } of coords) {
    const safeX = Math.max(0, Math.round(x));
    const safeY = Math.max(0, Math.round(y));
    const safeW = Math.min(width  - safeX, Math.round(w));
    const safeH = Math.min(height - safeY, Math.round(h));
    if (safeW <= 0 || safeH <= 0) continue;

    const crop = await sharp(imageBuffer)
      .extract({ left: safeX, top: safeY, width: safeW, height: safeH })
      .png()
      .toBuffer();

    composites.push({ input: crop, left: safeX, top: safeY });
  }

  if (composites.length === 0) return imageBuffer;

  return sharp(blackBase)
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * 폴리곤/마스크 좌표 기반 병변 마스킹
 * - SVG clip path로 병변 영역만 남기고 나머지 블랙
 * - points: [{ x, y }, ...] (폴리곤 꼭짓점)
 */
async function applyPolygonLesionMask(imageBuffer, points, width, height) {
  const pathD = points
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`)
    .join(' ') + ' Z';

  // 병변 영역만 흰색인 마스크 SVG 생성
  const maskSvg = Buffer.from(
    `<svg width="${width}" height="${height}">
      <rect width="${width}" height="${height}" fill="black"/>
      <path d="${pathD}" fill="white"/>
    </svg>`
  );

  // 마스크를 알파채널로 변환 후 원본에 적용
  const mask = await sharp(maskSvg).ensureAlpha().extractChannel('red').toBuffer();

  return sharp(imageBuffer)
    .joinChannel(mask)
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .png()
    .toBuffer();
}

/**
 * 전체 마스킹 파이프라인
 *
 * options:
 *   width        {number}   - 이미지 너비
 *   height       {number}   - 이미지 높이
 *   lesionCoords {Array}    - AI API 바운딩박스 [{ x, y, w, h }] (없으면 원본 유지)
 *   lesionMask   {Array}    - AI API 폴리곤 [{ x, y }] (없으면 스킵)
 *
 * 처리 순서:
 *   1. AI API 병변 마스킹 (좌표 있을 때만)
 *   2. 상하단 8% 라벨 영역 블랙 마스킹 (항상 적용)
 */
async function applyMaskingPipeline(imageBuffer, { width, height, lesionCoords = null, lesionMask = null }) {
  let result = imageBuffer;

  if (lesionMask && lesionMask.length > 0) {
    // 폴리곤 좌표 우선 적용
    result = await applyPolygonLesionMask(result, lesionMask, width, height);
  } else if (lesionCoords && lesionCoords.length > 0) {
    // 바운딩박스 적용
    result = await applyBBoxLesionMask(result, lesionCoords, width, height);
  }
  // AI API 미연동 시: 원본 그대로 유지

  // 상하단 8% 라벨 마스킹은 항상 적용
  result = await applyLabelMask(result, width, height);

  return result;
}

module.exports = { applyMaskingPipeline };
