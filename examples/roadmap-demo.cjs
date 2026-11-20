/*
 * 1.19.0 路标能力一条命令复现。
 *
 * 先执行：yarn build
 * 再执行：node examples/roadmap-demo.cjs
 */
const fs = require('fs');
const path = require('path');
const {
  PDFDocument,
  StandardFonts,
  extractText,
  readJpegExifOrientation,
} = require('../cjs');

const buildExifJpeg = (orientation) => {
  const exif = [
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ];
  const segmentLength = exif.length + 2;
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, (segmentLength >> 8) & 0xff, segmentLength & 0xff, ...exif,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
};

(async () => {
  // 1) EXIF 自动纠正
  const jpeg = buildExifJpeg(6);
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpeg);
  console.log('EXIF Orientation:', readJpegExifOrientation(jpeg));
  console.log('纠正后图片尺寸:', image.size());

  // 2) 图片字节去重：同一 XObject
  const same = await doc.embedJpg(jpeg);
  console.log('图片去重 ref 相同:', image.ref === same.ref);

  // 3) 带坐标文本 / 搜索 / 脱敏 / 替换
  const textDoc = await PDFDocument.create();
  const page = textDoc.addPage([612, 792]);
  const font = await textDoc.embedFont(StandardFonts.Helvetica);
  page.drawText('PUBLIC RECORD', { x: 50, y: 720, size: 14, font });
  page.drawText('SECRET-123', { x: 50, y: 700, size: 14, font });
  page.drawText('END', { x: 50, y: 680, size: 14, font });
  const runs = page.extractTextRuns();
  console.log('文本片段:', runs.length, '首段坐标:', runs[0] && [runs[0].x, runs[0].y]);
  console.log('搜索 SECRET 命中:', page.searchText('SECRET').length);
  page.redactText('SECRET-123');
  console.log('脱敏后文本:', JSON.stringify(extractText(page)));
  await page.replaceText('END', 'DONE');
  console.log('替换后文本:', JSON.stringify(extractText(page)));

  // 4) 宽容加载：损坏对象不直接 throw，给报告
  const original = fs
    .readFileSync(path.join(__dirname, '..', 'tests', 'utils', 'data', 'simple.pdf'))
    .toString('latin1');
  const broken = Buffer.from(
    original.replace(/1 0 obj(\s*)<</, '1 0 obj$1(('),
    'latin1',
  );
  const loaded = await PDFDocument.load(broken, { lenient: true });
  console.log('宽容加载页数:', loaded.doc.getPageCount());
  console.log('诊断警告数:', loaded.warnings.length);

  // 5) 增量保存：原文件字节必须原样保留
  const base = await textDoc.save();
  const reloaded = await PDFDocument.load(base);
  reloaded.addPage([300, 300]);
  const font2 = await reloaded.embedFont(StandardFonts.Helvetica);
  reloaded.getPage(1).drawText('APPENDED', { x: 20, y: 250, size: 12, font: font2 });
  const increment = await reloaded.save({ incremental: true });
  const final = await PDFDocument.load(increment);
  console.log('增量保存字节:', base.length, '→', increment.length);
  console.log('增量后页数:', final.getPageCount());
  console.log('ROADMAP_DEMO_OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
