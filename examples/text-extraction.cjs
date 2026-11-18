/*
 * 可运行的文本提取 / 中文 ToUnicode / 文本删除示例。
 *
 * 先执行：yarn build
 * 再执行：node examples/text-extraction.cjs
 */
const fs = require('fs');
const path = require('path');
const fontkit = require('@pdf-lib/fontkit');
const {
  PDFDocument,
  StandardFonts,
  extractText,
  extractTextFromPage,
  removeTextContaining,
} = require('../cjs');

const cjkFontPath = path.join(
  __dirname,
  '..',
  'assets',
  'fonts',
  'source_hans_jp',
  'SourceHanSerifJP-Regular.otf',
);

(async () => {
  // 1) 标准字体：save → load 后仍能提取压缩内容流里的文本
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Hello pdf-lib-plus', {
    x: 50,
    y: 720,
    size: 24,
    font: helvetica,
  });
  page.drawText('SECRET token ABC', {
    x: 50,
    y: 690,
    size: 18,
    font: helvetica,
  });

  const reloaded = await PDFDocument.load(await doc.save());
  console.log(
    '标准字体提取:',
    JSON.stringify(extractText(reloaded.getPage(0))),
  );

  // 2) CJK 嵌入字体：ToUnicode CMap 是 Flate 压缩 + 2 字节 codespace
  const cjkDoc = await PDFDocument.create();
  cjkDoc.registerFontkit(fontkit);
  const cjkFont = await cjkDoc.embedFont(fs.readFileSync(cjkFontPath));
  const cjkPage = cjkDoc.addPage([400, 200]);
  cjkPage.drawText('中文 Hello 世界', {
    x: 20,
    y: 100,
    size: 20,
    font: cjkFont,
  });
  const cjkReloaded = await PDFDocument.load(await cjkDoc.save());
  console.log('CJK 提取:', JSON.stringify(extractText(cjkReloaded.getPage(0))));

  // 3) 文本删除：整段显示算子级删除，返回删除数量
  const removed = removeTextContaining(reloaded.getPage(0), 'SECRET');
  console.log('删除算子数:', removed);
  console.log(
    '删除后:',
    JSON.stringify(extractTextFromPage(reloaded.getPage(0))),
  );

  if (!extractText(cjkReloaded.getPage(0)).includes('中文')) {
    throw new Error('CJK 文本提取失败');
  }
  console.log('示例验证通过');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
