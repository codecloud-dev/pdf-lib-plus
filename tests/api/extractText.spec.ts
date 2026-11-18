import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';

import {
  PDFDocument,
  StandardFonts,
  extractText,
  extractTextFromPage,
  PDFContentStreamParser,
  removeTextContaining,
} from 'src/index';

/**
 * 文本提取回归测试（pdf-lib-plus 1.18.3 新增能力）。
 * 覆盖两条真实路径：
 *   1) 库内刚绘制的页面（内容流是内存 PDFOperator 序列）
 *   2) save → load 之后的页面（内容流是 Flate 压缩字节，需内容流解析器）
 * 两条路径都必须还原出原文，否则文本提取就是假绿。
 */
describe('extractText', () => {
  const buildDoc = async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Hello pdf-lib-plus', { x: 50, y: 700, size: 24, font });
    page.drawText('Second line here', { x: 50, y: 660, size: 18, font });
    return { doc, page };
  };

  it('从刚绘制的内存页面提取文本', async () => {
    const { page } = await buildDoc();
    const text = extractText(page);
    expect(text).toContain('Hello pdf-lib-plus');
    expect(text).toContain('Second line here');
  });

  it('extractTextLines 返回按行的数组', async () => {
    const { page } = await buildDoc();
    const lines = extractTextFromPage(page);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.join('\n')).toContain('Hello pdf-lib-plus');
  });

  it('save → load 后仍能从压缩内容流提取（外部加载路径）', async () => {
    const { doc } = await buildDoc();
    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    const text = extractText(reloaded.getPage(0));
    expect(text).toContain('Hello pdf-lib-plus');
    expect(text).toContain('Second line here');
  });

  it('多行 write 后重载，行顺序保持', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    ['Alpha', 'Bravo', 'Charlie'].forEach((line, i) =>
      page.drawText(line, { x: 72, y: 720 - i * 30, size: 12, font }),
    );
    const reloaded = await PDFDocument.load(await doc.save());
    const text = extractText(reloaded.getPage(0));
    expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('Bravo'));
    expect(text.indexOf('Bravo')).toBeLessThan(text.indexOf('Charlie'));
  });

  it('空页提取返回空字符串', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    expect(extractText(page)).toBe('');
    expect(extractTextFromPage(page)).toEqual([]);
  });

  it('removeTextContaining 删除匹配文本，保留其它文本', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Public content', { x: 50, y: 720, size: 12, font });
    page.drawText('SECRET token ABC', { x: 50, y: 700, size: 12, font });
    page.drawText('Tail content', { x: 50, y: 680, size: 12, font });
    const removed = removeTextContaining(page, 'SECRET');
    expect(removed).toBe(1);
    const text = extractText(page);
    expect(text).not.toContain('SECRET');
    expect(text).toContain('Public content');
    expect(text).toContain('Tail content');
  });

  it('removeTextContaining 在无匹配时不改动页面', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Keep me', { x: 10, y: 100, size: 12, font });
    expect(removeTextContaining(page, 'NOT_THERE')).toBe(0);
    expect(extractText(page)).toContain('Keep me');
  });

  it('CJK 嵌入字体：Flate ToUnicode CMap 按多字节码正确提取中文', async () => {
    const fontBytes = fs.readFileSync(
      'assets/fonts/source_hans_jp/SourceHanSerifJP-Regular.otf',
    );
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontBytes);
    const page = doc.addPage([400, 200]);
    page.drawText('中文 Hello 世界', { x: 20, y: 100, size: 20, font });

    const reloaded = await PDFDocument.load(await doc.save());
    const text = extractText(reloaded.getPage(0));
    expect(text).toBe('中文 Hello 世界');
    expect(text).toContain('中文');
    expect(text).toContain('世界');
  });

  it('CJK 文本同样可被 removeTextContaining 删除', async () => {
    const fontBytes = fs.readFileSync(
      'assets/fonts/source_hans_jp/SourceHanSerifJP-Regular.otf',
    );
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontBytes);
    const page = doc.addPage([400, 200]);
    page.drawText('中文 Hello', { x: 20, y: 120, size: 20, font });
    page.drawText('世界', { x: 20, y: 90, size: 20, font });

    expect(removeTextContaining(page, '世界')).toBe(1);
    const reloaded = await PDFDocument.load(await doc.save());
    const text = extractText(reloaded.getPage(0));
    expect(text).toContain('中文');
    expect(text).not.toContain('世界');
  });

  it('PDFContentStreamParser 可解析 load 后压缩流里的 Tf/Tj 算子', async () => {
    const { doc } = await buildDoc();
    const reloaded = await PDFDocument.load(await doc.save());
    const page = reloaded.getPage(0);
    const contents: any = page.node.Contents();
    // load 后 Contents 是 PDFArray，元素是 PDFRef → 取到 PDFRawStream（Flate 压缩）
    const streamRef = contents.get ? contents.get(0) : contents;
    const stream = reloaded.context.lookup(streamRef);
    expect(stream).toBeDefined();
    const ops = PDFContentStreamParser.fromPDFRawStream(
      stream as any,
      reloaded.context,
    ).parseOperators();
    const names = ops.map((o) => o.getName());
    expect(names).toContain('Tf');
    expect(names).toContain('Tj');
  });
});
