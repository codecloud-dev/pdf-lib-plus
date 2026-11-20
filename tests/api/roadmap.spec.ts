import fs from 'fs';

import {
  extractText,
  PDFDocument,
  readJpegExifOrientation,
  StandardFonts,
} from 'src/index';

const buildExifJpeg = (orientation: number): Uint8Array => {
  const exif = [
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00, // Exif\0\0
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08, // TIFF big endian
    0x00,
    0x01, // 1 IFD entry
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00, // Orientation
    0x00,
    0x00,
    0x00,
    0x00, // next IFD
  ];
  const segmentLength = exif.length + 2;
  const app1 = [
    0xff,
    0xe1,
    (segmentLength >> 8) & 0xff,
    segmentLength & 0xff,
    ...exif,
  ];
  const sof0 = [
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0x11,
    0x00,
  ];
  return new Uint8Array([0xff, 0xd8, ...app1, ...sof0, 0xff, 0xd9]);
};

describe('1.19.0 roadmap features', () => {
  it('读取 JPEG EXIF Orientation，并自动纠正图片显示尺寸', async () => {
    const jpeg = buildExifJpeg(6);
    expect(readJpegExifOrientation(jpeg)).toBe(6);

    const doc = await PDFDocument.create();
    const image = await doc.embedJpg(jpeg);
    expect(image.exifOrientation).toBe(6);
    expect(image.size()).toEqual({ width: 2, height: 3 });

    const raw = await doc.embedJpg(jpeg, { autoCorrectExif: false });
    expect(raw.exifOrientation).toBe(1);
    expect(raw.size()).toEqual({ width: 3, height: 2 });
  });

  it('相同图片字节复用同一 XObject，避免重复嵌入', async () => {
    const jpeg = buildExifJpeg(1);
    const doc = await PDFDocument.create();
    const a = await doc.embedJpg(jpeg);
    const b = await doc.embedJpg(jpeg);
    expect(a.ref).toBe(b.ref);
  });

  it('lenient 加载收集警告并返回 { doc, warnings }', async () => {
    const original = fs.readFileSync('tests/utils/data/simple.pdf');
    const text = original.toString('latin1');
    expect(text).toMatch(/1 0 obj\s*<</);
    const broken = Buffer.from(
      text.replace(/1 0 obj(\s*)<</, '1 0 obj$1(('),
      'latin1',
    );

    const result = await PDFDocument.load(broken, { lenient: true });
    expect(result.doc).toBeInstanceOf(PDFDocument);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.doc.getPageCount()).toBeGreaterThan(0);
  });

  it('extractTextRuns / searchText 给出坐标矩形', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('REMOVE SECRET NOW', { x: 50, y: 700, size: 12, font });

    const runs = page.extractTextRuns();
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].text).toContain('REMOVE SECRET NOW');
    expect(runs[0].x).toBeCloseTo(50, 0);

    const hits = page.searchText('SECRET');
    expect(hits.length).toBe(1);
    expect(hits[0].text).toBe('SECRET');
    expect(hits[0].width).toBeGreaterThan(0);
  });

  it('redactText 删除文本字形并画覆盖框', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('PUBLIC', { x: 50, y: 720, size: 12, font });
    page.drawText('SECRET', { x: 50, y: 700, size: 12, font });

    expect(page.redactText('SECRET')).toBeGreaterThan(0);
    expect(extractText(page)).not.toContain('SECRET');
    expect(extractText(page)).toContain('PUBLIC');
  });

  it('replaceText 原位替换文本', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Amount: 100', { x: 50, y: 700, size: 12, font });

    expect(await page.replaceText('100', '200')).toBe(1);
    const text = extractText(page);
    expect(text).not.toContain('Amount: 100');
    expect(text).toContain('200');
  });

  it('增量保存保留原文件字节并能再次加载', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('original', { x: 20, y: 250, size: 12, font });
    const first = await doc.save();

    const reloaded = await PDFDocument.load(first);
    reloaded.addPage([300, 300]);
    reloaded.getPage(1).drawText('appended', { x: 20, y: 250, size: 12, font });
    const second = await reloaded.save({ incremental: true });

    expect(second.length).toBeGreaterThan(first.length);
    expect(second.subarray(0, first.length)).toEqual(first);
    const finalDoc = await PDFDocument.load(second);
    expect(finalDoc.getPageCount()).toBe(2);
    expect(extractText(finalDoc.getPage(0))).toContain('original');
    expect(extractText(finalDoc.getPage(1))).toContain('appended');
  });
});
