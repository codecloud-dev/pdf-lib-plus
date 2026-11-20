/**
 * 读取 JPEG 的 EXIF Orientation（用于「手机照片躺倒」自动纠正）。
 *
 * 只解析 APP1/Exif 里的 IFD0 Orientation 标签（0x0112），不改动源字节，
 * 也不依赖浏览器 Image/canvas——Node 与浏览器行为一致。
 */
export const readJpegExifOrientation = (
  imageData: Uint8Array,
): number | undefined => {
  const view = new DataView(
    imageData.buffer,
    imageData.byteOffset,
    imageData.byteLength,
  );
  const length = view.byteLength;
  if (length < 4 || view.getUint16(0) !== 0xffd8) return undefined;

  let pos = 2;
  while (pos + 4 <= length) {
    const marker = view.getUint16(pos);
    if (marker === 0xffda || marker === 0xffd9) break;
    if ((marker & 0xff00) !== 0xff00) {
      pos += 1;
      continue;
    }
    if (marker === 0xff01 || (marker >= 0xffd0 && marker <= 0xffd7)) {
      pos += 2;
      continue;
    }
    pos += 2;
    if (pos + 2 > length) break;
    const segmentLength = view.getUint16(pos);
    if (segmentLength < 2 || pos + segmentLength > length) break;
    const segmentStart = pos + 2;
    const segmentEnd = pos + segmentLength;

    if (
      marker === 0xffe1 &&
      segmentStart + 8 <= segmentEnd &&
      view.getUint32(segmentStart) === 0x45786966 && // "Exif"
      view.getUint16(segmentStart + 4) === 0x0000
    ) {
      const tiffStart = segmentStart + 6;
      if (tiffStart + 8 > segmentEnd) return undefined;
      const byteOrder = view.getUint16(tiffStart);
      const littleEndian = byteOrder === 0x4949;
      if (!littleEndian && byteOrder !== 0x4d4d) return undefined;
      if (view.getUint16(tiffStart + 2, littleEndian) !== 42) return undefined;

      const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
      const ifdStart = tiffStart + ifdOffset;
      if (ifdStart + 2 > segmentEnd) return undefined;
      const entryCount = view.getUint16(ifdStart, littleEndian);
      for (let idx = 0; idx < entryCount; idx++) {
        const entry = ifdStart + 2 + idx * 12;
        if (entry + 12 > segmentEnd) break;
        if (view.getUint16(entry, littleEndian) !== 0x0112) continue;
        if (view.getUint16(entry + 2, littleEndian) !== 3) return undefined; // SHORT
        const count = view.getUint32(entry + 4, littleEndian);
        if (count !== 1) return undefined;
        const orientation = view.getUint16(entry + 8, littleEndian);
        return orientation >= 1 && orientation <= 8 ? orientation : undefined;
      }
      return undefined;
    }
    pos += segmentLength;
  }
  return undefined;
};

export interface ExifDrawTransform {
  rotateDegrees: number;
  flipX: boolean;
  flipY: boolean;
}

/** EXIF Orientation → PDF 绘制变换（不含平移，调用方按包围盒归位）。 */
export const exifDrawTransform = (
  orientation: number | undefined,
): ExifDrawTransform => {
  switch (orientation) {
    case 2:
      return { rotateDegrees: 0, flipX: true, flipY: false };
    case 3:
      return { rotateDegrees: 180, flipX: false, flipY: false };
    case 4:
      return { rotateDegrees: 0, flipX: false, flipY: true };
    case 5:
      return { rotateDegrees: 90, flipX: true, flipY: false };
    case 6:
      return { rotateDegrees: 270, flipX: false, flipY: false };
    case 7:
      return { rotateDegrees: 270, flipX: true, flipY: false };
    case 8:
      return { rotateDegrees: 90, flipX: false, flipY: false };
    case 1:
    default:
      return { rotateDegrees: 0, flipX: false, flipY: false };
  }
};
