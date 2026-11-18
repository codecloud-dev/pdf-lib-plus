# 文本提取与内容流解析（1.18.3+）

`pdf-lib` 1.x 只能创建和写入 PDF 内容流，长期没有公开的文本提取 API。
`@codecloud-dev/pdf-lib-plus@1.18.3` 在**不改任何原有 API** 的前提下新增了一组
「尽力而为」的读取能力。

## API

| API | 说明 |
| --- | --- |
| `extractText(page: PDFPage): string` | 提取页面文本，按行以 `\n` 连接 |
| `extractTextFromPage(page: PDFPage): string[]` | 提取页面文本，返回行数组 |
| `page.extractText(): string` | 页面实例方法，等价于 `extractText(page)` |
| `page.extractTextLines(): string[]` | 页面实例方法，等价于 `extractTextFromPage(page)` |
| `removeTextContaining(page, substring): number` | 删除显示文本中包含子串的算子，返回删除数量 |
| `PDFContentStreamParser.fromPDFRawStream(stream, context).parseOperators()` | 把 `load()` 后的压缩内容流解析成 `PDFOperator[]` |
| `PDFOperator#getName()` / `#getArgs()` | 只读访问算子名称和参数 |
| `PDFContentStream#getOperators()` | 只读访问内存内容流算子 |

## 标准字体示例

```js
import { PDFDocument, StandardFonts, extractText } from '@codecloud-dev/pdf-lib-plus';

const doc = await PDFDocument.create();
const page = doc.addPage([612, 792]);
const font = await doc.embedFont(StandardFonts.Helvetica);
page.drawText('Hello pdf-lib-plus', { x: 50, y: 700, size: 24, font });

// 真实外部加载路径：内容流是 Flate 压缩字节
const reloaded = await PDFDocument.load(await doc.save());
console.log(extractText(reloaded.getPage(0))); // Hello pdf-lib-plus
```

## CJK 嵌入字体示例

标准 14 字体不含中文字形，必须先嵌入支持 CJK 的字体。仓库里的可运行脚本见
[`examples/text-extraction.cjs`](../examples/text-extraction.cjs)，核心代码如下：

```js
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const { PDFDocument, extractText } = require('@codecloud-dev/pdf-lib-plus');

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const font = await doc.embedFont(
  fs.readFileSync('assets/fonts/source_hans_jp/SourceHanSerifJP-Regular.otf'),
);
const page = doc.addPage([400, 200]);
page.drawText('中文 Hello 世界', { x: 20, y: 100, size: 20, font });

const reloaded = await PDFDocument.load(await doc.save());
console.log(extractText(reloaded.getPage(0))); // 中文 Hello 世界
```

1.18.3 修复了三个真实 bug：ToUnicode CMap 未做 Flate 解压、`<0000><ffff>`
多字节码被逐字节误读、内存文档 `save()` 前字体字典尚未注册导致解码失败。

## 文本删除

```js
const removed = removeTextContaining(page, 'SECRET');
```

- 删除的是**整段显示算子**（Tj / TJ / ' / "），不是逐字删除；
- 返回被删除的算子数量，无匹配时返回 `0` 且不改动页面；
- 页面中其它绘图指令原样保留；
- 如果一整段文本里只有部分匹配，整段都会被移除。

这是 PDF 内容流模型的固有限制：PDF 存的是绘制指令，不是可编辑的文本对象。

## 解码规则

1. 标准 14 字体：Helvetica / Times / Courier 按 WinAnsi，Symbol / ZapfDingbats
   按各自编码还原。
2. 嵌入字体：优先读取 ToUnicode CMap，支持 `bfchar` / `bfrange`、Flate 压缩流、
   1/2/4 字节 codespace 与 UTF-16BE 目标。
3. 无 ToUnicode 的嵌入字体：回退 PDFDocEncoding；此时 CJK 结果不保证正确。

## 已知边界（不夸大）

- 不是版面分析器：不处理旋转文本、字形替换、复杂 RTL；
- 行分隔依据文本定位算子（Td / TD / T* / Tm），不等同于视觉排版换行；
- TJ 数字只在较大负值时插入空格，是启发式，不保证与原文空白完全一致；
- 加密 PDF 需先由调用方解密，本模块不处理加密。

## 真实基准

`node scripts/benchmark.cjs`（200 页 × 40 行/页）：

| 指标 | 实测 |
| --- | --- |
| 构造 | 189.5 ms |
| save 字节数 | 207247 B（202.4 KB / 0.20 MB） |
| save | 89.0 ms |
| load | 29.6 ms |
| 全页 extractText | 85.1 ms |
| 提取字符数 | 385680 |
| save+load 吞吐 | 1.67 MB/s |

数字来自本机真跑，换机器会有波动；测试套件用确定性断言，不依赖耗时阈值。
