import { Encodings } from '@pdf-lib/standard-fonts';
import { rgb } from 'src/api/colors';
import PDFPage from 'src/api/PDFPage';
import { StandardFonts } from 'src/api/StandardFonts';
import PDFArray from 'src/core/objects/PDFArray';
import PDFDict from 'src/core/objects/PDFDict';
import PDFHexString from 'src/core/objects/PDFHexString';
import PDFName from 'src/core/objects/PDFName';
import PDFNumber from 'src/core/objects/PDFNumber';
import PDFObject from 'src/core/objects/PDFObject';
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

const flushLine = (state: ExtractionState) => {
  if (state.line.length) {
    state.lines.push(state.line.replace(/\s+$/, ''));
    state.line = '';
  }
};

/** 解释一组算子，做文本提取。 */
const interpret = (
  operators: PDFOperator[],
  fonts: Map<string, Decoder>,
): string[] => {
  const state: ExtractionState = {
    line: '',
    lines: [],
    decoder: winAnsiDecoder,
  };
  for (const op of operators) {
    const name = op.getName();
    const args = op.getArgs();
    switch (name) {
      case 'Tf': {
        const fontName = args[0] instanceof PDFName ? args[0].asString() : '';
        state.decoder = fonts.get(fontName) ?? winAnsiDecoder;
        break;
      }
      case 'Tj':
        state.line += decodeShowArg(args[0], state);
        break;
      case 'TJ':
        state.line += decodeShowArg(args[0], state);
        break;
      case '\'': // 换行并显示
        flushLine(state);
        if (args[0]) state.line += decodeShowArg(args[0], state);
        break;
      case '"': // 设置字距/词距 + 换行 + 显示
        flushLine(state);
        if (args[2]) state.line += decodeShowArg(args[2], state);
        break;
      case 'Td':
      case 'TD': {
        // 只有纵向移动（第二个操作数非 0）才换行；同一行内的横向移动不换行。
        const y = args[1] instanceof PDFNumber ? args[1].asNumber() : 0;
        if (y !== 0) flushLine(state);
        break;
      }
      case 'T*':
        flushLine(state);
        break;
      case 'Tm': {
        // 文本矩阵：y 分量（索引 5）变化视为换行。
        const y = args[5] instanceof PDFNumber ? args[5].asNumber() : 0;
        if (
          state.line &&
          (state as any)._lastTmY !== undefined &&
          (state as any)._lastTmY !== y
        ) {
          flushLine(state);
        }
        (state as any)._lastTmY = y;
        break;
      }
      case 'ET':
        flushLine(state);
        break;
      default:
        break;
    }
  }
  flushLine(state);
  return state.lines;
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

/** 从页面 Resources.Font 构建 fontName → Decoder 映射。 */
const buildFontDecoders = (page: PDFPage): Map<string, Decoder> => {
  const map = new Map<string, Decoder>();
  const context = page.doc.context;
  const resources = page.node.Resources();
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
        const internalFonts: any[] = (page.doc as any).fonts || [];
        const pdfFont = internalFonts.find((f) => f && f.ref === refObj);
        const decoder = decoderFromEmbeddedFont(pdfFont);
        if (decoder) {
          map.set(fontName, decoder);
          continue;
        }
      }
      continue;
    }

    // ToUnicode CMap 优先。
    // 注意：同 context 里该值可能是 PDFRawStream 本体而非 PDFRef；
    // 用 lookupMaybe(PDFRef) 会对非 ref 抛 UnexpectedObjectTypeError（CJK 嵌入字体实测抓到）。
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
        // ToUnicode 由 context.flateStream(cmap) 写入，Filter=FlateDecode。
        // 必须先按 PDF 流解码，否则拿到的只是 zlib 压缩字节，CMap 解析必为空。
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

/** 把页 Contents（单流或流数组）解析为算子。 */
const pageOperators = (page: PDFPage): PDFOperator[] => {
  const contents = page.node.Contents();
  if (!contents) return [];
  const context = page.doc.context;
  const streams: PDFObject[] =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => contents.get(i))
      : [contents];

  const ops: PDFOperator[] = [];
  for (const s of streams) {
    const stream =
      s instanceof PDFRef
        ? context.lookupMaybe(s, PDFStream)
        : (s as PDFStream);
    if (!stream) continue;
    if (stream instanceof PDFContentStream) {
      ops.push(...stream.getOperators());
    } else {
      try {
        ops.push(
          ...PDFContentStreamParser.fromPDFRawStream(
            stream as any,
            context,
          ).parseOperators(),
        );
      } catch {
        /* 单个流解析失败跳过，尽量提取其它流 */
      }
    }
  }
  return ops;
};

/** 提取页面文本，按行返回。 */
export const extractTextFromPage = (page: PDFPage): string[] =>
  interpret(pageOperators(page), buildFontDecoders(page));

/** 提取页面文本，合并为单个字符串（行间以 \n 连接）。 */
export const extractText = (page: PDFPage): string =>
  extractTextFromPage(page).join('\n');

/**
 * 删除页面中「解码文本包含给定子串」的文本显示算子（文本删除 / redaction 基础）。
 *
 * 行为：解析页面内容流，找到 Tj / TJ / ' / " 算子中解码后含 `substring` 的，
 * 连同其紧邻的换行算子（T* / ' / " 自带的换行语义）一并移除，其余绘图算子
 * 原样保留，然后用一个新内容流整体替换本页内容。
 *
 * 边界（诚实说明）：删除的是「整段显示算子」，不是逐字删除——若一段 Tj 里
 * 只有部分文字匹配，整段都会被移除。这是内容流模型的固有限制，符合
 * pdf-lib 一贯的「绘制指令而非文本模型」语义。
 *
 * @returns 被删除的显示算子数量（0 表示没有匹配，页面未改动）。
 */
export const removeTextContaining = (
  page: PDFPage,
  substring: string,
): number => {
  if (!substring) return 0;
  const fonts = buildFontDecoders(page);
  const ops = pageOperators(page);
  const context = page.doc.context;

  // 第一遍：标记要删除的算子索引，同时跟踪 Tf 以正确解码后续文本。
  const removeIdx = new Set<number>();
  let activeDecoder: Decoder = winAnsiDecoder;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const name = op.getName();
    const args = op.getArgs();
    if (name === 'Tf') {
      const fn = args[0] instanceof PDFName ? args[0].asString() : '';
      activeDecoder = fonts.get(fn) ?? winAnsiDecoder;
      continue;
    }
    if (name === 'Tj' || name === 'TJ' || name === '\'' || name === '"') {
      let arg: any;
      if (name === 'Tj' || name === 'TJ') arg = args[0];
      else arg = args[args.length - 1];
      if (arg) {
        const st: ExtractionState = {
          line: '',
          lines: [],
          decoder: activeDecoder,
        };
        const text = decodeShowArg(arg, st);
        if (text.includes(substring)) removeIdx.add(i);
      }
    }
  }
  if (removeIdx.size === 0) return 0;

  // 第二遍：保留未删除算子，重建内容流。
  const kept = ops.filter((_, i) => !removeIdx.has(i));
  const dict = context.obj({});
  const newStream = PDFContentStream.of(dict, kept);
  const ref = context.register(newStream);
  page.node.setContentStream(ref);
  // 让页面缓存指向新建的内容流，后续 drawText/drawRectangle 必须追加到同一流；
  // 置 undefined 会再建第二个流，导致 Contents 里出现多段内容且顺序错乱。
  (page as any).contentStream = newStream;
  (page as any).contentStreamRef = ref;
  return removeIdx.size;
};

/** 带坐标的文本片段；坐标来自内容流的文本矩阵，宽度为按字数的保守估计。 */
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

const numbersOf = (args: any[], count: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(args[i] instanceof PDFNumber ? args[i].asNumber() : 0);
  }
  return out;
};

const pushRun = (state: RunState, text: string): void => {
  if (!text) return;
  // 标准字体近似 0.5em/字；CJK 通常 1em/字，取两者折中偏保守。
  const perChar = state.fontSize * 0.6;
  const width = text.length * perChar;
  state.runs.push({
    text,
    x: state.tm[4],
    y: state.tm[5],
    width,
    height: state.fontSize,
    font: state.fontName,
    fontSize: state.fontSize,
  });
  state.tm[4] += width;
};

/** 提取带坐标的文本片段（尽力而为；旋转/复杂排版不保证像素级精确）。 */
export const extractTextRunsFromPage = (page: PDFPage): TextRun[] => {
  const fonts = buildFontDecoders(page);
  const state: RunState = {
    runs: [],
    decoder: winAnsiDecoder,
    fontName: 'Helvetica',
    fontSize: 24,
    leading: 0,
    tm: [1, 0, 0, 1, 0, 0],
    tlm: [1, 0, 0, 1, 0, 0],
  };

  for (const op of pageOperators(page)) {
    const name = op.getName();
    const args = op.getArgs();
    switch (name) {
      case 'Tf':
        state.fontName =
          args[0] instanceof PDFName ? args[0].asString() : state.fontName;
        state.fontSize =
          args[1] instanceof PDFNumber ? args[1].asNumber() : state.fontSize;
        state.decoder = fonts.get(state.fontName) ?? winAnsiDecoder;
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
        pushRun(state, decodeShowArg(args[0], state));
        break;
      case 'TJ':
        pushRun(state, decodeShowArg(args[0], state));
        break;
      case '\'':
        state.tlm[5] -= state.leading;
        state.tm = state.tlm.slice();
        pushRun(state, decodeShowArg(args[0], state));
        break;
      case '"':
        state.tlm[5] -= state.leading;
        state.tm = state.tlm.slice();
        pushRun(state, decodeShowArg(args[2], state));
        break;
      default:
        break;
    }
  }
  return state.runs;
};

/** 在页面中搜索文本，返回可画框的矩形。 */
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

/** 删除包含 query 的显示算子，并在原位置用 Helvetica 画上替换文本。 */
export const replaceTextInPage = async (
  page: PDFPage,
  query: string,
  replacement: string,
): Promise<number> => {
  const rects = searchTextInPage(page, query);
  if (rects.length === 0) return 0;
  removeTextContaining(page, query);
  const font = await page.doc.embedFont(StandardFonts.Helvetica);
  for (const rect of rects) {
    page.drawText(replacement, {
      x: rect.x,
      y: rect.y,
      size: rect.height,
      font,
      color: rgb(0, 0, 0),
    });
  }
  return rects.length;
};
