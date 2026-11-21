import { Encodings } from '@pdf-lib/standard-fonts';
import { rgb } from 'src/api/colors';
import PDFPage from 'src/api/PDFPage';
import { StandardFonts } from 'src/api/StandardFonts';
import PDFArray from 'src/core/objects/PDFArray';
import PDFDict from 'src/core/objects/PDFDict';
import PDFHexString from 'src/core/objects/PDFHexString';
import PDFName from 'src/core/objects/PDFName';
import PDFNumber from 'src/core/objects/PDFNumber';
import PDFRef from 'src/core/objects/PDFRef';
import PDFStream from 'src/core/objects/PDFStream';
import PDFString from 'src/core/objects/PDFString';
import PDFOperator from 'src/core/operators/PDFOperator';
import PDFContentStream from 'src/core/structures/PDFContentStream';
import PDFContentStreamParser from 'src/core/parser/PDFContentStreamParser';
import { decodePDFRawStream } from 'src/core/streams/decode';
import { pdfDocEncodingDecode } from 'src/utils/pdfDocEncoding';

/**
 * 从 PDF 页面提取可搜索文本（文本提取 / text extraction）。
 *
 * 上游 pdf-lib 明确不支持此能力（内容流是绘制指令，不是文本模型）。本实现
 * 是「尽力而为」的还原器：解释内容流里的文本显示算子（Tj/TJ/'/"），按字体
 * 编码把字节还原成 Unicode，并按文本定位算子（Td、TD、T-star、Tm）插入换行。
 *
 * 能力边界（诚实说明，不夸大）：
 *   · 标准 14 字体（Helvetica/Times/Courier/Symbol/ZapfDingbats）：按 WinAnsi/
 *     Symbol/ZapfDingbats 编码精确还原；
 *   · 嵌入字体：优先用其 ToUnicode CMap 还原；无 ToUnicode 时回退 PDFDocEncoding；
 *   · 不处理旋转文本、CID 无 ToUnicode 字体、字形替换等极复杂情况——这些会
 *     尽力返回可读内容，但不保证与原文逐字一致。
 *
 * 返回的文本按内容流绘制顺序拼接，用换行分隔不同的文本行；调用方可按需
 * 进一步做布局分析。
 */

type Decoder = (bytes: Uint8Array) => string;

/** 为某一种标准字体编码建立 byte → 字符 的反查表。 */
const buildStandardDecoder = (encoding: typeof Encodings.WinAnsi): Decoder => {
  const table: string[] = new Array(256).fill('');
  for (const cp of encoding.supportedCodePoints) {
    try {
      const { code } = encoding.encodeUnicodeCodePoint(cp);
      if (code >= 0 && code < 256 && !table[code]) {
        table[code] = String.fromCodePoint(cp);
      }
    } catch {
      /* 不可编码的码点跳过 */
    }
  }
  return (bytes: Uint8Array) => {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += table[bytes[i]] ?? '';
    return out;
  };
};

const winAnsiDecoder = buildStandardDecoder(Encodings.WinAnsi);
const symbolDecoder = buildStandardDecoder(Encodings.Symbol);
const zapfDecoder = buildStandardDecoder(Encodings.ZapfDingbats);

/** 根据字体字典的 BaseFont 名选择一个解码器。 */
const decoderForBaseFont = (baseFont: string): Decoder => {
  const name = baseFont.replace(/^.*[+]/, ''); // 去掉 subset 前缀 "ABCDEF+"
  if (name === 'Symbol') return symbolDecoder;
  if (name === 'ZapfDingbats') return zapfDecoder;
  if (
    name.includes('Courier') ||
    name.includes('Helvetica') ||
    name.includes('Times')
  ) {
    return winAnsiDecoder;
  }
  // 其它（嵌入字体且无 ToUnicode）：回退 PDFDocEncoding
  return (bytes: Uint8Array) => pdfDocEncodingDecode(bytes);
};

/** 解析 ToUnicode CMap 的 codespace/bfchar/bfrange，构建 code → string 映射。 */
const decodeToUnicode = (cmapBytes: Uint8Array): Decoder => {
  const text = new TextDecoder('latin1').decode(cmapBytes);
  const map = new Map<string, string>();
  const spaces: { bytes: number; lo: number; hi: number }[] = [];
  let maxCodeBytes = 1;

  /** 去掉尖括号与空白，保留原始 hex 位数（用于判断 1/2/4 字节 code）。 */
  const parseHex = (s: string): string =>
    s.trim().replace(/^<|>$/g, '').replace(/\s+/g, '');
  const hexToCode = (h: string): number => parseInt(h, 16);
  const codeKey = (hex: string, code: number): string =>
    `${Math.ceil(hex.length / 2)}:${code}`;
  const hexToUnicode = (h: string): string => {
    const clean = h.replace(/\s+/g, '');
    if (clean.length <= 4) return String.fromCodePoint(parseInt(clean, 16));
    // ToUnicode 目标通常是 UTF-16BE 单元序列（4 位一组）；超过 BMP 时按码点处理。
    if (clean.length % 4 === 0) {
      let out = '';
      for (let i = 0; i + 4 <= clean.length; i += 4) {
        out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
      }
      return out;
    }
    return String.fromCodePoint(parseInt(clean, 16));
  };
  const addCodeSpace = (loHex: string, hiHex: string) => {
    const bytes = Math.ceil(loHex.length / 2);
    const entry = { bytes, lo: hexToCode(loHex), hi: hexToCode(hiHex) };
    spaces.push(entry);
    if (bytes > maxCodeBytes) maxCodeBytes = bytes;
  };

  // codespace 决定一个 code 占几个字节。CJK 嵌入字体常见 <0000><ffff>，
  // 必须按 2 字节读，逐字节解会把每个汉字拆成两个错误字符（实测踩到）。
  const spaceRe = /begincodespacerange([\s\S]*?)endcodespacerange/g;
  let m: RegExpExecArray | null;
  m = spaceRe.exec(text);
  while (m) {
    for (const line of m[1].trim().split(/\r?\n/)) {
      // fontkit 生成的是 `<0000><ffff>`（中间无空格），必须按尖括号取 token，
      // 不能用 whitespace split，否则会把两个 hex 粘成一个无效值。
      const tokens = line.match(/<[^>]*>/g);
      if (tokens && tokens.length >= 2) {
        addCodeSpace(parseHex(tokens[0]), parseHex(tokens[1]));
      }
    }
    m = spaceRe.exec(text);
  }

  // beginbfchar ... endbfchar
  const bfcharRe = /beginbfchar([\s\S]*?)endbfchar/g;
  m = bfcharRe.exec(text);
  while (m) {
    for (const line of m[1].trim().split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const srcHex = parseHex(parts[0]);
      map.set(
        codeKey(srcHex, hexToCode(srcHex)),
        hexToUnicode(parseHex(parts[1])),
      );
    }
    m = bfcharRe.exec(text);
  }

  // beginbfrange ... endbfrange
  const bfrangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  m = bfrangeRe.exec(text);
  while (m) {
    for (const line of m[1].trim().split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const loHex = parseHex(parts[0]);
      const hiHex = parseHex(parts[1]);
      const lo = hexToCode(loHex);
      const hi = hexToCode(hiHex);
      const bytes = Math.ceil(loHex.length / 2);
      const targetTokens = parts
        .slice(2)
        .join(' ')
        .match(/<[^>]*>/g);
      if (targetTokens && targetTokens.length === hi - lo + 1) {
        for (let c = lo; c <= hi; c++) {
          map.set(
            `${bytes}:${c}`,
            hexToUnicode(parseHex(targetTokens[c - lo])),
          );
        }
      } else {
        const dstHex = parseHex(parts[2]);
        const base = hexToCode(dstHex);
        for (let c = lo; c <= hi; c++) {
          const target = (base + (c - lo))
            .toString(16)
            .padStart(dstHex.length, '0');
          map.set(`${bytes}:${c}`, hexToUnicode(target));
        }
      }
    }
    m = bfrangeRe.exec(text);
  }

  return (bytes: Uint8Array) => {
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      let matched = false;
      // 优先最长的合法 codespace（2 字节域不会误吞 1 字节域）。
      for (let len = maxCodeBytes; len >= 1; len--) {
        if (i + len > bytes.length) continue;
        let code = 0;
        for (let j = 0; j < len; j++) code = (code << 8) | bytes[i + j];
        const inSpace = spaces.some(
          (s) => s.bytes === len && code >= s.lo && code <= s.hi,
        );
        if (!inSpace) continue;
        out += map.get(`${len}:${code}`) ?? '';
        i += len;
        matched = true;
        break;
      }
      if (!matched) {
        // codespace 缺失或写错时，退化为单字节，至少不吞掉后续内容。
        out += map.get(`1:${bytes[i]}`) ?? '';
        i += 1;
      }
    }
    return out;
  };
};

interface ExtractionState {
  line: string;
  lines: string[];
  decoder: Decoder;
}

/** 把显示文本的参数（PDFString/PDFHexString/PDFArray）解码成字符串。 */
const decodeShowArg = (arg: any, state: { decoder: Decoder }): string => {
  if (arg instanceof PDFHexString || arg instanceof PDFString) {
    return state.decoder((arg as any).asBytes());
  }
  if (arg instanceof PDFArray) {
    // TJ：数组中字符串显示、数字调整字距（负数表示拉开，正数收紧）。
    let out = '';
    for (let i = 0; i < arg.size(); i++) {
      const el = arg.get(i);
      if (el instanceof PDFHexString || el instanceof PDFString) {
        out += state.decoder((el as any).asBytes());
      } else if (el instanceof PDFNumber) {
        // 只在字距调整很大时插入空格，模拟词间停顿（启发式，不精确）。
        if (el.asNumber() < -180) out += ' ';
      }
    }
    return out;
  }
  return '';
};

/**
 * 内存文档里字体字典是懒嵌入的：embedFont 只分配 ref，真正 context.assign 发生在 save。
 * 所以 save 前 context.lookup(ref) 为空；此时直接从 PDFFont 内部的 embedder/fontkit 对象
 * 重建 glyphId → Unicode 映射，避免把 CJK 子集 CID 当 WinAnsi 解成乱码。
 */
const decoderFromEmbeddedFont = (pdfFont: any): Decoder | undefined => {
  const embedder = pdfFont && pdfFont.embedder;
  if (!embedder) return undefined;
  const font = embedder.font;
  if (!font || !font.characterSet || !font.glyphForCodePoint) return undefined;

  const glyphToUnicode = new Map<number, string>();
  for (const cp of font.characterSet) {
    const glyph = font.glyphForCodePoint(cp);
    if (!glyph) continue;
    const id =
      typeof embedder.glyphId === 'function'
        ? embedder.glyphId(glyph)
        : glyph.id;
    if (typeof id === 'number' && id >= 0 && !glyphToUnicode.has(id)) {
      glyphToUnicode.set(id, String.fromCodePoint(cp));
    }
  }
  if (glyphToUnicode.size === 0) return undefined;

  return (bytes: Uint8Array) => {
    let out = '';
    // Identity-H 编码：每个 glyph id 固定 2 字节。
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1];
      out += glyphToUnicode.get(code) ?? '';
    }
    return out;
  };
};

/** 从任意 Resources 字典构建 fontName → Decoder 映射。 */
const buildFontDecodersFromResources = (
  context: any,
  resources: PDFDict | undefined,
  doc: PDFDocumentLike,
): Map<string, Decoder> => {
  const map = new Map<string, Decoder>();
  if (!resources) return map;
  const fontsDict = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fontsDict) return map;

  for (const [nameObj, refObj] of fontsDict.entries()) {
    const fontName = nameObj.asString();
    let fontDict: PDFDict | undefined;
    if (refObj instanceof PDFDict) {
      fontDict = refObj;
    } else if (refObj instanceof PDFRef) {
      fontDict = context.lookupMaybe(refObj, PDFDict);
    }
    if (!fontDict) {
      // save 前的内存字体：从 PDFFont 内部的 fontkit 对象重建解码表。
      if (refObj instanceof PDFRef) {
        const internalFonts: any[] = (doc as any).fonts || [];
        const pdfFont = internalFonts.find((f) => f && f.ref === refObj);
        const decoder = decoderFromEmbeddedFont(pdfFont);
        if (decoder) {
          map.set(fontName, decoder);
          continue;
        }
      }
      continue;
    }

    // ToUnicode CMap 优先。同 context 里该值可能是 PDFRawStream 本体而非 PDFRef。
    const toUnicodeRaw = fontDict.get(PDFName.of('ToUnicode'));
    let cmapStream: PDFStream | undefined;
    if (toUnicodeRaw instanceof PDFStream) cmapStream = toUnicodeRaw;
    else if (toUnicodeRaw instanceof PDFRef) {
      cmapStream = context.lookupMaybe(toUnicodeRaw, PDFStream) as
        | PDFStream
        | undefined;
    }
    if (cmapStream) {
      try {
        const cmapBytes = decodePDFRawStream(cmapStream as any).decode();
        map.set(fontName, decodeToUnicode(cmapBytes));
        continue;
      } catch {
        /* CMap 解析失败，回退到编码推断 */
      }
    }
    const baseFont = fontDict.lookupMaybe(PDFName.of('BaseFont'), PDFName);
    map.set(fontName, decoderForBaseFont(baseFont ? baseFont.asString() : ''));
  }
  return map;
};

type Matrix = [number, number, number, number, number, number];

const numbersOf = (args: any[], count: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(args[i] instanceof PDFNumber ? args[i].asNumber() : 0);
  }
  return out;
};

const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

/** CTM × M；用于在父变换坐标系里应用子流/cm 的局部变换。 */
const mulMatrix = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];

const applyMatrix = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

const matrixFromArray = (value: unknown): Matrix => {
  if (!(value instanceof PDFArray) || value.size() < 6) return IDENTITY_MATRIX;
  const out = [] as unknown as Matrix;
  for (let i = 0; i < 6; i++) {
    const n = value.lookup(i);
    out[i] = n instanceof PDFNumber ? n.asNumber() : IDENTITY_MATRIX[i];
  }
  return out;
};

/** 一段可写回的内容流（页面 Contents 或 Form XObject）。 */
interface ContentSource {
  /** 原始算子，写回时原样保留未删部分。 */
  ops: PDFOperator[];
  fonts: Map<string, Decoder>;
  kind: 'page' | 'xobject';
  /** 该流在 context 中的 ref；直接嵌入的流没有 ref。 */
  streamRef?: PDFRef;
  /** xobject 场景下用于写回 Resources/XObject 字典。 */
  xobjectsDict?: PDFDict;
  xobjectName?: string;
  /** 父坐标系到该流坐标系的累计变换。 */
  baseMatrix: Matrix;
  /** 原始流字典，写回 XObject 时保留 Subtype/BBox/Resources。 */
  originalDict?: PDFDict;
}

/** 带解码器与坐标系的算子，避免 XObject 资源名冲突。 */
interface LocatedOp {
  op: PDFOperator;
  decoder: Decoder;
  source: ContentSource;
  ctm: Matrix;
}

const parseStreamOperators = (
  stream: PDFStream,
  context: any,
): PDFOperator[] => {
  if (stream instanceof PDFContentStream) return stream.getOperators();
  try {
    return PDFContentStreamParser.fromPDFRawStream(
      stream as any,
      context as any,
    ).parseOperators();
  } catch {
    return [];
  }
};

const resolveStream = (
  value: unknown,
  context: any,
): { stream?: PDFStream; ref?: PDFRef } => {
  if (value instanceof PDFRef) {
    const stream = context.lookupMaybe(value, PDFStream) as
      | PDFStream
      | undefined;
    return stream ? { stream, ref: value } : {};
  }
  return value instanceof PDFStream ? { stream: value } : {};
};

/**
 * 收集页内容与 Form XObject 内容。
 *
 * 真实世界 PDF（Word / 打印驱动 / 排版软件）常把正文放进 Form XObject，
 * 只递归读取 page.Contents 会静默漏掉全文。这里做有界递归：
 * · 深度上限 8，visited 防循环引用；
 * · 保留每个 XObject 自己的 Resources/Font，避免资源名冲突；
 * · 累计 cm 与 /Matrix，给搜索/脱敏返回可用的页面坐标；
 * · 记录 ref 以便脱敏后写回并删除旧流，杜绝字节级泄漏。
 */
const collectSources = (page: PDFPage): ContentSource[] => {
  const context = page.doc.context;
  const pageResources = page.node.Resources();
  const sources: ContentSource[] = [];
  const visited = new Set<unknown>();
  const contents = page.node.Contents();
  const streams: unknown[] =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => contents.get(i))
      : contents
      ? [contents]
      : [];

  const enqueue = (
    value: unknown,
    inheritedResources: PDFDict | undefined,
    baseMatrix: Matrix,
    depth: number,
    xobjectInfo?: {
      xobjectsDict: PDFDict;
      xobjectName: string;
    },
  ) => {
    if (depth > 8) return;
    const { stream, ref } = resolveStream(value, context);
    if (!stream) return;
    const key = ref ?? stream;
    if (visited.has(key)) return;
    visited.add(key);

    const dictResources = stream.dict.lookupMaybe(
      PDFName.of('Resources'),
      PDFDict,
    );
    const resources = dictResources ?? inheritedResources;
    const source: ContentSource = {
      ops: parseStreamOperators(stream, context),
      fonts: buildFontDecodersFromResources(
        context,
        resources,
        page.doc as any,
      ),
      kind: depth === 0 ? 'page' : 'xobject',
      streamRef: ref,
      baseMatrix,
      originalDict: stream.dict,
      ...(xobjectInfo ?? {}),
    };
    sources.push(source);

    // 再扫一遍 Do：只有 Form XObject 递归，Image 等保持原样。
    const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xobjects) return;
    let ctm = baseMatrix;
    const stack: Matrix[] = [];
    for (const op of source.ops) {
      const name = op.getName();
      const args = op.getArgs();
      if (name === 'q') {
        stack.push(ctm.slice() as Matrix);
        continue;
      }
      if (name === 'Q') {
        ctm = stack.pop() ?? IDENTITY_MATRIX;
        continue;
      }
      if (name === 'cm') {
        const nums = numbersOf(args, 6);
        if (nums.length === 6) ctm = mulMatrix(ctm, nums as Matrix);
        continue;
      }
      if (name !== 'Do') continue;
      const rawName = args[0] instanceof PDFName ? args[0].asString() : '';
      const xname = rawName.replace(/^\//, '');
      if (!xname) continue;
      const entry = xobjects.get(PDFName.of(xname));
      const child = resolveStream(entry, context);
      if (!child.stream) continue;
      const subtype = child.stream.dict.lookupMaybe(
        PDFName.of('Subtype'),
        PDFName,
      );
      const subtypeName = subtype ? subtype.asString().replace(/^\//, '') : '';
      if (subtypeName !== 'Form') continue;
      const childMatrix = mulMatrix(
        ctm,
        matrixFromArray(child.stream.dict.lookup(PDFName.of('Matrix'))),
      );
      enqueue(entry, resources, childMatrix, depth + 1, {
        xobjectsDict: xobjects,
        xobjectName: xname,
      });
    }
  };

  for (const s of streams) enqueue(s, pageResources, IDENTITY_MATRIX, 0);
  return sources;
};

const collectLocatedOps = (
  page: PDFPage,
  sources: ContentSource[] = collectSources(page),
): LocatedOp[] => {
  const out: LocatedOp[] = [];
  for (const source of sources) {
    let ctm = source.baseMatrix;
    const stack: Matrix[] = [];
    for (const op of source.ops) {
      const name = op.getName();
      const args = op.getArgs();
      if (name === 'q') {
        stack.push(ctm.slice() as Matrix);
      } else if (name === 'Q') {
        ctm = stack.pop() ?? IDENTITY_MATRIX;
      } else if (name === 'cm') {
        const nums = numbersOf(args, 6);
        if (nums.length === 6) ctm = mulMatrix(ctm, nums as Matrix);
      }
      // 字体状态在 interpret / redact 里随 Tf 跟踪，这里只按当前 Tf 名取解码器。
      const fontName =
        name === 'Tf' && args[0] instanceof PDFName ? args[0].asString() : '';
      out.push({
        op,
        decoder: fontName
          ? source.fonts.get(fontName) ?? winAnsiDecoder
          : winAnsiDecoder,
        source,
        ctm,
      });
    }
  }
  return out;
};

/** 把页 Contents（含 Form XObject 递归）解析为带坐标系的算子。 */
const pageOperators = (page: PDFPage): LocatedOp[] => collectLocatedOps(page);

interface InterpretState {
  line: string;
  lines: string[];
  decoder: Decoder;
  fontName: string;
}

/** 解释算子为文本行。 */
const interpret = (located: LocatedOp[]): string[] => {
  const state: InterpretState = {
    line: '',
    lines: [],
    decoder: winAnsiDecoder,
    fontName: 'Helvetica',
  };
  for (const item of located) {
    const name = item.op.getName();
    const args = item.op.getArgs();
    switch (name) {
      case 'BT':
        if (state.line) state.lines.push(state.line);
        state.line = '';
        break;
      case 'ET':
        if (state.line) state.lines.push(state.line);
        state.line = '';
        break;
      case 'Tf':
        state.fontName =
          args[0] instanceof PDFName ? args[0].asString() : state.fontName;
        state.decoder = item.source.fonts.get(state.fontName) ?? winAnsiDecoder;
        break;
      case 'Td':
      case 'TD':
      case 'T*':
      case 'Tm':
        if (state.line) state.lines.push(state.line);
        state.line = '';
        break;
      case 'Tj':
      case 'TJ':
      case '\'':
      case '"': {
        const arg =
          name === 'Tj' || name === 'TJ' ? args[0] : args[args.length - 1];
        const temp: ExtractionState = {
          line: '',
          lines: [],
          decoder: state.decoder,
        };
        state.line += decodeShowArg(arg, temp);
        break;
      }
      default:
        break;
    }
  }
  if (state.line) state.lines.push(state.line);
  return state.lines;
};

/** 提取页面文本，按行返回（含 Form XObject 中的文本）。 */
export const extractTextFromPage = (page: PDFPage): string[] =>
  interpret(pageOperators(page));

/** 提取页面文本，合并为单个字符串（行间以 \n 连接）。 */
export const extractText = (page: PDFPage): string =>
  extractTextFromPage(page).join('\n');

type PDFDocumentLike = {
  context: any;
  fonts?: any[];
  embedFont: (font: unknown) => Promise<unknown>;
};

/** 把删除后的算子写回来源流，并物理删除被替换的旧流对象。 */
const writeBackSource = (
  page: PDFPage,
  source: ContentSource,
  kept: PDFOperator[],
): void => {
  const context = page.doc.context;
  const newStream = PDFContentStream.of(
    source.originalDict ? source.originalDict.clone(context) : context.obj({}),
    kept,
  );
  const newRef = context.register(newStream);

  if (source.kind === 'page') {
    const before = page.node.Contents();
    page.node.setContentStream(newRef);
    if ((page as any).contentStreamRef !== newRef) {
      const oldRefs: PDFRef[] = [];
      if (before instanceof PDFRef) oldRefs.push(before);
      else if (before instanceof PDFArray) {
        for (let i = 0; i < before.size(); i++) {
          const item = before.get(i);
          if (item instanceof PDFRef) oldRefs.push(item);
        }
      }
      for (const ref of oldRefs) {
        if (ref !== newRef) context.delete(ref);
      }
    }
    (page as any).contentStream = newStream;
    (page as any).contentStreamRef = newRef;
    return;
  }

  if (source.xobjectsDict && source.xobjectName) {
    source.xobjectsDict.set(PDFName.of(source.xobjectName), newRef);
    if (source.streamRef && source.streamRef !== newRef) {
      context.delete(source.streamRef);
    }
  }
};

/**
 * 删除「解码文本包含给定子串」的文本显示算子。
 *
 * 行为：递归解析页面与 Form XObject 内容流，逐来源删除命中的 Tj/TJ/'/" 算子，
 * 其余绘图算子原样写回，并 `context.delete()` 旧流对象——否则旧字节仍留在
 * 保存后的 PDF 里，`strings` 一捞就能还原被脱敏内容。
 *
 * 边界（诚实说明）：删除的是「整段显示算子」，不是逐字删除；旋转/极复杂
 * 文本矩阵不保证像素级覆盖。
 *
 * @returns 被删除的显示算子数量（0 表示没有匹配，文件未改动）。
 */
export const removeTextContaining = (
  page: PDFPage,
  substring: string,
): number => {
  if (!substring) return 0;
  const sources = collectSources(page);
  const located = collectLocatedOps(page, sources);
  const removeIdx = new Map<ContentSource, Set<number>>();
  let activeDecoder: Decoder = winAnsiDecoder;

  // 第一遍：按来源标记要删除的算子索引。
  for (const item of located) {
    const name = item.op.getName();
    const args = item.op.getArgs();
    if (name === 'Tf') {
      const fn = args[0] instanceof PDFName ? args[0].asString() : '';
      activeDecoder = item.source.fonts.get(fn) ?? winAnsiDecoder;
      continue;
    }
    if (name === 'Tj' || name === 'TJ' || name === '\'' || name === '"') {
      const arg =
        name === 'Tj' || name === 'TJ' ? args[0] : args[args.length - 1];
      if (!arg) continue;
      const st: ExtractionState = {
        line: '',
        lines: [],
        decoder: activeDecoder,
      };
      if (decodeShowArg(arg, st).includes(substring)) {
        const set = removeIdx.get(item.source) ?? new Set<number>();
        const idx = item.source.ops.indexOf(item.op);
        if (idx >= 0) set.add(idx);
        removeIdx.set(item.source, set);
      }
    }
  }

  let removed = 0;
  for (const source of sources) {
    const set = removeIdx.get(source);
    if (!set || set.size === 0) continue;
    const kept = source.ops.filter((_, i) => !set.has(i));
    writeBackSource(page, source, kept);
    removed += set.size;
  }
  return removed;
};

/** 带坐标的文本片段；坐标来自内容流文本矩阵，宽度为按字数的保守估计。 */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font: string;
  fontSize: number;
}

/** 搜索命中的矩形，可直接用于 drawRectangle 画框或脱敏。 */
export interface TextSearchRect {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  runIndex: number;
}

interface RunState {
  runs: TextRun[];
  decoder: Decoder;
  fontName: string;
  fontSize: number;
  leading: number;
  tm: number[];
  tlm: number[];
}

const pushRun = (
  state: RunState,
  text: string,
  ctm: Matrix,
  fontSize: number,
): void => {
  if (!text) return;
  const perChar = fontSize * 0.6;
  const width = text.length * perChar;
  const [x, y] = applyMatrix(ctm, state.tm[4], state.tm[5]);
  const sx = Math.hypot(ctm[0], ctm[1]) || 1;
  const sy = Math.hypot(ctm[2], ctm[3]) || 1;
  state.runs.push({
    text,
    x,
    y,
    width: width * sx,
    height: fontSize * sy,
    font: state.fontName,
    fontSize: fontSize * sy,
  });
  state.tm[4] += width;
};

/** 提取带坐标的文本片段（含 Form XObject；尽力而为，不保证像素级精确）。 */
export const extractTextRunsFromPage = (page: PDFPage): TextRun[] => {
  const state: RunState = {
    runs: [],
    decoder: winAnsiDecoder,
    fontName: 'Helvetica',
    fontSize: 24,
    leading: 0,
    tm: [1, 0, 0, 1, 0, 0],
    tlm: [1, 0, 0, 1, 0, 0],
  };

  for (const item of pageOperators(page)) {
    const name = item.op.getName();
    const args = item.op.getArgs();
    switch (name) {
      case 'Tf':
        state.fontName =
          args[0] instanceof PDFName ? args[0].asString() : state.fontName;
        state.fontSize =
          args[1] instanceof PDFNumber ? args[1].asNumber() : state.fontSize;
        state.decoder = item.source.fonts.get(state.fontName) ?? winAnsiDecoder;
        break;
      case 'TL':
        state.leading = args[0] instanceof PDFNumber ? args[0].asNumber() : 0;
        break;
      case 'Tm': {
        state.tm = numbersOf(args, 6);
        state.tlm = state.tm.slice();
        break;
      }
      case 'Td':
      case 'TD': {
        const [tx, ty] = numbersOf(args, 2);
        if (name === 'TD') state.leading = -ty;
        state.tlm = [
          state.tlm[0],
          state.tlm[1],
          state.tlm[2],
          state.tlm[3],
          state.tlm[4] + tx,
          state.tlm[5] + ty,
        ];
        state.tm = state.tlm.slice();
        break;
      }
      case 'T*':
        state.tlm[5] -= state.leading;
        state.tm = state.tlm.slice();
        break;
      case 'Tj':
      case 'TJ':
        pushRun(state, decodeShowArg(args[0], state), item.ctm, state.fontSize);
        break;
      case '\'':
        state.tlm[5] -= state.leading;
        state.tm = state.tlm.slice();
        pushRun(state, decodeShowArg(args[0], state), item.ctm, state.fontSize);
        break;
      case '"':
        state.tlm[5] -= state.leading;
        state.tm = state.tlm.slice();
        pushRun(state, decodeShowArg(args[2], state), item.ctm, state.fontSize);
        break;
      default:
        break;
    }
  }
  return state.runs;
};

/** 在页面中搜索文本，返回可画框的矩形（含 Form XObject）。 */
export const searchTextInPage = (
  page: PDFPage,
  query: string,
): TextSearchRect[] => {
  if (!query) return [];
  const results: TextSearchRect[] = [];
  const runs = extractTextRunsFromPage(page);
  for (let idx = 0; idx < runs.length; idx++) {
    const run = runs[idx];
    const from = run.text.indexOf(query);
    if (from < 0) continue;
    const charWidth = run.width / Math.max(run.text.length, 1);
    results.push({
      x: run.x + from * charWidth,
      y: run.y,
      width: query.length * charWidth,
      height: run.height,
      text: query,
      runIndex: idx,
    });
  }
  return results;
};

/** 真删字形 + 黑色覆盖框：返回处理掉的匹配数量。 */
export const redactTextInPage = (page: PDFPage, query: string): number => {
  const rects = searchTextInPage(page, query);
  if (rects.length === 0) return 0;
  const removed = removeTextContaining(page, query);
  for (const rect of rects) {
    page.drawRectangle({
      x: rect.x - 1,
      y: rect.y - 2,
      width: rect.width + 2,
      height: rect.height + 4,
      color: rgb(0, 0, 0),
    });
  }
  return removed || rects.length;
};

/**
 * 删除包含 query 的显示算子，并在原位置画上替换文本。
 *
 * 为了不再“中文直接抛 WinAnsi cannot encode”，字体由调用方显式传入；
 * 未传时退回标准 Helvetica 并保留原字号语义（不再强行取 rect.height）。
 */
export const replaceTextInPage = async (
  page: PDFPage,
  query: string,
  replacement: string,
  options: { font?: unknown; size?: number } = {},
): Promise<number> => {
  const rects = searchTextInPage(page, query);
  if (rects.length === 0) return 0;
  removeTextContaining(page, query);
  const font =
    options.font ?? (await page.doc.embedFont(StandardFonts.Helvetica));
  const size = options.size ?? Math.max(rects[0].height, 8);
  for (const rect of rects) {
    page.drawText(replacement, {
      x: rect.x,
      y: rect.y,
      size,
      font: font as never,
      color: rgb(0, 0, 0),
    });
  }
  return rects.length;
};
