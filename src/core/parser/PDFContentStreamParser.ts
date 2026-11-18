import PDFObject from 'src/core/objects/PDFObject';
import PDFRawStream from 'src/core/objects/PDFRawStream';
import PDFOperator from 'src/core/operators/PDFOperator';
import PDFOperatorNames from 'src/core/operators/PDFOperatorNames';
import BaseParser from 'src/core/parser/BaseParser';
import ByteStream from 'src/core/parser/ByteStream';
import PDFContext from 'src/core/PDFContext';
import PDFObjectParser from 'src/core/parser/PDFObjectParser';
import CharCodes from 'src/core/syntax/CharCodes';
import { IsDelimiter } from 'src/core/syntax/Delimiters';
import { IsNumeric } from 'src/core/syntax/Numeric';
import { IsWhitespace } from 'src/core/syntax/Whitespace';
import { charFromCode } from 'src/utils';

/**
 * PDF 内容流（Content Stream）解析器。
 *
 * 上游 pdf-lib 1.x 只能解析「本库自己在内存里 push 的 PDFOperator」，
 * 对从外部 PDF 加载进来的内容流（PDFRawStream 里的 Flate 压缩字节）没有
 * 公开解析入口——这正是它无法实现文本提取的根因。本解析器补上这一能力：
 * 把解码后的内容流字节还原成 PDFOperator[]，供文本提取/内容分析复用。
 *
 * 内容流语法 = 若干「操作数 + 关键字」，关键字即算子名（Tj/TJ/BT/...）。
 * 操作数对象（数字/字符串/十六进制串/名字/数组/字典）复用 PDFObjectParser
 * 的对象解析，保证与本库其它解析器行为一致。
 */
class PDFContentStreamParser extends BaseParser {
  static forBytes = (bytes: Uint8Array, context: PDFContext) =>
    new PDFContentStreamParser(ByteStream.of(bytes), context);

  static fromPDFRawStream = (stream: PDFRawStream, context: PDFContext) =>
    new PDFContentStreamParser(ByteStream.fromPDFRawStream(stream), context);

  private readonly objectParser: PDFObjectParser;

  constructor(byteStream: ByteStream, context: PDFContext) {
    super(byteStream);
    this.objectParser = PDFObjectParser.forByteStream(byteStream, context);
  }

  /** 解析整个内容流为算子序列。遇到无法识别的 token 跳过而非抛错（容错：真实世界 PDF 很脏）。 */
  parseOperators(): PDFOperator[] {
    const operators: PDFOperator[] = [];
    const args: PDFObject[] = [];

    while (!this.bytes.done()) {
      this.skipWhitespaceAndComments();
      if (this.bytes.done()) break;

      const byte = this.bytes.peek();

      // 对象型操作数：数字、字符串、十六进制串、名字、数组。
      if (
        IsNumeric[byte] ||
        byte === CharCodes.LeftParen ||
        byte === CharCodes.LessThan ||
        byte === CharCodes.ForwardSlash ||
        byte === CharCodes.LeftSquareBracket
      ) {
        try {
          const obj = this.objectParser.parseObject();
          args.push(obj);
          continue;
        } catch {
          // 解析失败的坏 token：吞掉一个字节继续，避免死循环。
          this.bytes.next();
          continue;
        }
      }

      // 其余按关键字（算子名）处理：读到分隔符/空白为止。
      const keyword = this.parseKeyword();
      if (!keyword) {
        this.bytes.next();
        continue;
      }
      // 布尔/空值在内容流里极少作为操作数出现，但 PDFObjectParser 能解析，
      // 这里若遇到也当操作数（提升兼容性）。
      if (keyword === 'true' || keyword === 'false' || keyword === 'null') {
        // 回退到关键字起点不可行，这里直接丢弃（内容流里几乎不用布尔作算子）。
        continue;
      }
      // 必须传副本：下面 args.length = 0 会清空同一数组引用，
      // 若直接传引用，所有算子的操作数都会被抹成空（真跑单测抓到）。
      operators.push(
        PDFOperator.of(keyword as PDFOperatorNames, args.slice() as any),
      );
      args.length = 0;
    }

    return operators;
  }

  /** 读取一个关键字 token（字母/符号组成，非空白非分隔符）。 */
  private parseKeyword(): string {
    let value = '';
    while (!this.bytes.done()) {
      const byte = this.bytes.peek();
      if (IsWhitespace[byte] || IsDelimiter[byte]) break;
      value += charFromCode(this.bytes.next());
    }
    return value;
  }
}

export default PDFContentStreamParser;
