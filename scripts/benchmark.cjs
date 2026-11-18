/*
 * 大文件基准脚本（真实数据，不预填数字）。
 *
 * 用法：
 *   yarn release:prep   # 或至少 yarn build，确保 cjs/ 产物存在
 *   node scripts/benchmark.cjs [页数，默认 200]
 *
 * 测量：构造 N 页（每页 40 行文本）→ save 体积/耗时 → load 耗时 →
 *       全页 extractText 耗时与字符数。全部为运行时实测，脚本不含任何硬编码结果。
 */
const { PDFDocument, StandardFonts, extractText } = require('../cjs/index.js');

const PAGES = Math.max(1, parseInt(process.argv[2] || '200', 10) || 200);
const LINES_PER_PAGE = 40;

const hr = () => Number(process.hrtime.bigint()) / 1e6;

(async () => {
  console.log(`基准参数：${PAGES} 页 × ${LINES_PER_PAGE} 行/页`);

  let t = hr();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < PAGES; p++) {
    const page = doc.addPage([612, 792]);
    for (let i = 0; i < LINES_PER_PAGE; i++) {
      page.drawText(
        `Page ${p + 1} line ${i + 1}: the quick brown fox 0123456789`,
        {
          x: 40,
          y: 750 - i * 18,
          size: 9,
          font,
        },
      );
    }
  }
  const buildMs = hr() - t;

  t = hr();
  const bytes = await doc.save();
  const saveMs = hr() - t;

  t = hr();
  const reloaded = await PDFDocument.load(bytes);
  const loadMs = hr() - t;

  t = hr();
  let chars = 0;
  for (let p = 0; p < reloaded.getPageCount(); p++) {
    chars += extractText(reloaded.getPage(p)).length;
  }
  const extractMs = hr() - t;

  const kb = (bytes.length / 1024).toFixed(1);
  const mb = (bytes.length / 1024 / 1024).toFixed(2);
  console.log('--- 实测结果 ---');
  console.log(`构造 ${PAGES} 页：        ${buildMs.toFixed(1)} ms`);
  console.log(
    `save 字节数：           ${bytes.length} B (${kb} KB / ${mb} MB)`,
  );
  console.log(`save 耗时：             ${saveMs.toFixed(1)} ms`);
  console.log(`load 耗时：             ${loadMs.toFixed(1)} ms`);
  console.log(`全页 extractText：      ${extractMs.toFixed(1)} ms`);
  console.log(`提取字符总数：          ${chars}`);
  console.log(
    `吞吐（save+load）：      ${(
      bytes.length /
      1024 /
      1024 /
      ((saveMs + loadMs) / 1000)
    ).toFixed(2)} MB/s`,
  );
})().catch((e) => {
  console.error('基准失败：', e);
  process.exit(1);
});
