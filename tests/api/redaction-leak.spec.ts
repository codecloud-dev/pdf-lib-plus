import {
  PDFDocument,
  PDFName,
  PDFStream,
  StandardFonts,
  extractText,
} from 'src/index';
import PDFContentStream from 'src/core/structures/PDFContentStream';
import PDFContentStreamParser from 'src/core/parser/PDFContentStreamParser';
import { decodePDFRawStream } from 'src/core/streams/decode';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const buildFormXObjectPage = async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const context = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const xobjDict = context.obj({
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, 612, 792],
    Resources: { Font: { F1: font.ref } },
  });
  const xobjOps = PDFContentStreamParser.forBytes(
    encoder.encode('BT /F1 12 Tf 50 200 Td (XOBJECT-SECRET) Tj ET'),
    context,
  ).parseOperators();
  const xobjStream = PDFContentStream.of(xobjDict, xobjOps);
  const xobjRef = context.register(xobjStream);

  page.node.set(
    PDFName.of('Resources'),
    context.obj({
      Font: { F1: font.ref },
      XObject: { Fm0: xobjRef },
    }),
  );

  const pageOps = PDFContentStreamParser.forBytes(
    encoder.encode('q /Fm0 Do Q'),
    context,
  ).parseOperators();
  const pageRef = context.register(
    PDFContentStream.of(context.obj({}), pageOps),
  );
  page.node.setContentStream(pageRef);

  return { doc, page, context, xobjRef };
};

const savedStreamText = async (doc: PDFDocument): Promise<string> => {
  const bytes = await doc.save();
  const reloaded = await PDFDocument.load(bytes);
  const chunks: string[] = [];
  for (const obj of (reloaded.context as any).indirectObjects.values()) {
    if (!(obj instanceof PDFStream)) continue;
    try {
      chunks.push(decoder.decode(decodePDFRawStream(obj as any).decode()));
    } catch {
      /* 非原始流（例如内容流对象）跳过 */
    }
  }
  return chunks.join('\n');
};

describe('redaction byte-level safety', () => {
  it('redactText 物理删除旧 /Contents，保存后不再残留字节', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('CONFIDENTIAL-TOKEN-42', {
      x: 40,
      y: 700,
      size: 12,
      font,
    });
    const oldRef = page.node.Contents() as any;

    expect(page.redactText('CONFIDENTIAL-TOKEN-42')).toBeGreaterThan(0);
    expect((doc.context as any).indirectObjects.has(oldRef)).toBe(false);
    expect(await savedStreamText(doc)).not.toContain('CONFIDENTIAL-TOKEN-42');
  });

  it('Form XObject 中的文字可提取、可搜索、可脱敏且旧流对象被删除', async () => {
    const { doc, page, context, xobjRef } = await buildFormXObjectPage();

    expect(extractText(page)).toContain('XOBJECT-SECRET');
    expect(page.searchText('XOBJECT-SECRET').length).toBeGreaterThan(0);
    expect(page.redactText('XOBJECT-SECRET')).toBeGreaterThan(0);
    expect(extractText(page)).not.toContain('XOBJECT-SECRET');
    expect((context as any).indirectObjects.has(xobjRef)).toBe(false);
    expect(await savedStreamText(doc)).not.toContain('XOBJECT-SECRET');
  });
});
