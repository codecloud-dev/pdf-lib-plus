# Changelog

All notable changes to `pdf-lib-plus` are documented here.

`pdf-lib-plus` is a community-maintained fork of
[`pdf-lib`](https://github.com/Hopding/pdf-lib). It keeps the original public
API and the original MIT license. The upstream project has not published a
release since 2022, so this fork begins by closing the security issues that
were reported upstream but never fixed in a release.

## 1.18.4 - 2026-11-18

本版继续只做**不改公开 API** 的可靠性维护，直接修复 pdf-lib 公开仓库里两个
真实 open issue，并把修复做成可重复运行的回归验证。

### 修复

- **`removeField()` 留下悬空 widget 引用（上游 #1784 / #1001）**：旧实现把
  `/AP/N` 外观流引用当成页面 `/Annots` 中的 widget 引用传给
  `PDFPageLeaf.removeAnnot()`，字典对象删除后页面仍指向不存在的对象。
  现改为用 `context.getObjectRef(widget.dict)` 取 widget 注解自身的间接引用；
  删除后 `/Annots` 不再残留死引用，同名字段可重新创建，save → load 后每个
  annot 引用都能正常 `context.lookup()`。
- **`PDFRef` / `PDFName` 强引用池导致长生命周期进程内存泄漏（上游 #1799）**：
  两个 identity-sensitive 对象原本被模块级 `Map` 永久强引用，批量加载/丢弃
  文档后堆内存只增不减。现改为 `WeakRef` + `FinalizationRegistry` 弱引用池：
  活文档仍拿到完全相同的实例（Map key 的 identity 语义不变），文档被丢弃后
  条目可回收；finalizer 只删除“当前仍指向同一个 dead WeakRef”的键，避免晚到
  的 finalizer 误删已替换的新实例。无 WeakRef 的老运行时自动回落到原行为。
- **回归测试**：新增表单字段删除后 `/Annots` 清理、同名重建、save/load 无
  悬空引用测试；新增活对象在大量新 key 入池后仍 identity 稳定的测试。
- **真实 GC 验证脚本**：`scripts/verify-intern-memory.cjs` 用
  `node --expose-gc` 真实创建 1000 个唯一 `PDFName` / `PDFRef` 并丢弃，验证
  1000/1000 被回收，同时常驻 key 仍返回同一实例。

### 验证

`yarn typecheck`、`yarn test`（70 suites / 667 tests）、`yarn lint`、全格式
`yarn build`、`node --expose-gc scripts/verify-intern-memory.cjs` 均真跑通过，
示例 `examples/text-extraction.cjs` 与 `npm pack --dry-run` 亦真跑通过。

**真实基准**（`node scripts/benchmark.cjs 200`，200 页 × 40 行/页，本机实测，
数值随机器负载波动，不代表性能回退）：save 207247 B（202.4 KB）、save 126.3 ms、
load 42.0 ms、全页 extractText 125.7 ms、提取字符 385680、save+load 吞吐 1.17 MB/s。

## 1.18.3 - 2026-11-18

本版在**不改变任何原有公开 API** 的前提下，补上 pdf-lib 1.x 一直缺失的
内容流读取、文本提取与文本删除能力，并修复中文嵌入字体的 ToUnicode 解码。

### 新增

- **内容流解析**：新增 `PDFContentStreamParser`，可把 `load()` 后的
  `PDFRawStream`（Flate 压缩内容流）解析成 `PDFOperator[]`；同时给
  `PDFOperator` / `PDFContentStream` 增加只读访问器，不改动原有写入 API。
- **文本提取**：新增 `extractText(page)` / `extractTextFromPage(page)`，以及
  `PDFPage#extractText()` / `PDFPage#extractTextLines()`。标准 14 字体按
  WinAnsi / Symbol / ZapfDingbats 解码，嵌入字体优先使用 ToUnicode CMap。
- **文本删除**：新增 `removeTextContaining(page, substring)`，按显示算子删除
  包含子串的整段文本，返回删除数量；无匹配时不改动页面。
- **真实基准**：新增 `scripts/benchmark.cjs`。最近一次实测 200 页 × 40 行/页，
  save 207247 B（202.4 KB），save 89.0 ms，load 29.6 ms，全页提取 85.1 ms，
  提取字符 385680，save+load 吞吐 1.67 MB/s。

### 修复

- **ToUnicode CMap 被当成未压缩文本**：`context.flateStream(cmap)` 写入的 CMap
  必须先经 `decodePDFRawStream()` 解压；此前直接读取 `getContents()` 会得到 zlib
  字节，中文提取恒为空。
- **多字节码被逐字节误读**：CJK 嵌入字体常见 codespace `<0000><ffff>`，
  一个字符占 2 字节。现在按 codespace 长度优先匹配，不再把汉字拆成两个错误字符。
- **内存文档懒嵌入字体**：`save()` 前字体字典尚未 `context.assign`，`context.lookup`
  为空。现在直接从 `PDFFont` 内部的 fontkit embedder 重建 glyphId → Unicode 映射，
  避免内存页提取出乱码、删除匹配失效。
- **算子参数共享数组引用**：解析器曾把同一个 `args` 数组交给所有算子后清空，
  导致所有算子参数丢失；已改为 `args.slice()`。

### 能力边界（如实说明）

文本提取是「尽力而为」的内容流解释，不是完整的版面/字体模型：不处理旋转文本、
字形替换；无 ToUnicode 的 CID 字体只能回退；删除是整段显示算子级，不是逐字删除。

### Verification

`yarn typecheck`、`yarn test`（70 suites / 664 tests）、`yarn build`（cjs / es /
esm / umd / downlevel-dts）全部通过。CJK 回归使用
`assets/fonts/source_hans_jp/SourceHanSerifJP-Regular.otf` 真嵌入字体，覆盖
save → load 后的 Flate ToUnicode CMap 中文提取，以及内存页中文删除。

## 1.18.2 - 2026-11-15

**发布状态更正 / Release status correction**：`1.18.0` 与 `1.18.1` 此前只是仓库内的
版本标记与文档更新，**从未推送到 npm registry**；旧文档里的
`npm install pdf-lib-plus` 是一条装不上的死命令。自本版起正式以
[`@codecloud-dev/pdf-lib-plus`](https://www.npmjs.com/package/@codecloud-dev/pdf-lib-plus)
发布，请用 scoped 包名安装。此处如实写明，不把没发布过的版本说成已发布。


本分支基于本地源码独立修复了上游若干长期未合并 PR 报告的真实缺陷，并补充了确定性
回归测试。所有补丁与测试均自行编写，未照抄上游 diff。

### 修复

- **SVG path 的 `T` 命令二次反射控制点**（上游
  [PR #1444](https://github.com/Hopding/pdf-lib/pull/1444) /
  [issue #1443](https://github.com/Hopding/pdf-lib/issues/1443)）。
  `src/api/svgPath.ts` 的 `T` 在生成二次贝塞尔曲线后，又把 `px`/`py` 反射了一次，
  导致连续 `T` 命令从第二条起用错反射控制点（渲染出折线而非平滑曲线）。现删除多余
  反射，使 `px`/`py` 保持为本条曲线实际使用的控制点，供下一条 `T`/`t` 反射，行为与
  小写 `t` 对齐。回归测试：`tests/api/svgPath.spec.ts`（issue 中的连续 `T` 路径，
  以及以 `T` 起始、无前置二次曲线的连续 `T` 两组用例）。

- **JPEG 嵌入持有带 offset 的 Buffer 视图**（上游
  [PR #1273](https://github.com/Hopding/pdf-lib/pull/1273)）。1.18.0 已让
  `src/core/embedders/JpegEmbedder.ts` 的标记扫描通过 `DataView` 尊重
  `byteOffset`/`byteLength`（读侧）。本分支补完写入侧：`embedIntoContext` 不再把调用方
  的共享 backing buffer 视图直接交给 `PDFRawStream`，而是存一份从 0 开始、长度等于
  `byteLength` 的自有副本，避免 Node `Buffer` 池化内存被复用后污染 PDF 中的 JPEG 字节；
  非视图的普通输入保持零拷贝。回归测试：
  `tests/core/embedders/JpegEmbedderBufferView.spec.ts`（带非零 offset 的真实 `Buffer`
  视图，覆盖元数据读取、嵌入字节范围、以及共享内存被覆盖后嵌入内容不受影响三组用例）。

- **ES5 下自定义 Error 子类 `instanceof` 失效**（上游
  [PR #1439](https://github.com/Hopding/pdf-lib/pull/1439)）。本库 `target` 为 ES5，
  `src/api/errors.ts` 中 `class X extends Error` 编译后 `super(msg)` 返回的实例原型为
  `Error.prototype`，`instanceof X` 恒为 false。现于每个构造函数中显式恢复子类原型
  （`Object.setPrototypeOf`，因 ES5 lib 未声明该方法而使用类型断言）。回归测试：
  `tests/api/errors.spec.ts`（覆盖全部 14 个错误类，验证 `instanceof` 子类与 `Error`）。

- **声明包无副作用**（上游
  [PR #1199](https://github.com/Hopding/pdf-lib/pull/1199)）。`package.json` 增加
  `"sideEffects": false`，使打包器能对 ESM 构建做 tree-shaking，避免只用到 `/core`
  底层原语时打包整个库。已检查 `src` 下无顶层全局修改、无副作用式导入，故用布尔值
  而非数组形式。

### Verification

`yarn install --frozen-lockfile --ignore-scripts`, `yarn typecheck`, `yarn test`
(69 suites / 654 tests) and `yarn build` (cjs / es / esm / umd / downlevel-dts)
all pass. New deterministic regression tests cover the SVG `T` control-point,
offset Buffer views in `JpegEmbedder`, and all 14 custom Error subclasses.

## 1.18.1 - 2026-11-14

Repository tag and documentation update (never published to npm).
**No public API and no runtime code changed** — the library code is
byte-for-byte the same as 1.18.0.

### Documentation & governance

- Added `README.zh.md` (Chinese guide), `CONTRIBUTING.md` and
  `CODE_OF_CONDUCT.md`, closing the project-governance docs gap. The English
  `README.md` now links to all of them; `README.zh.md` is included in the
  published `files` list.
- `CONTRIBUTING.md` documents the TypeScript 3.9 toolchain constraints
  (`resolutions`, `downlevel-dts`, frozen lockfile) and the local verification
  commands, so contributors do not break `yarn typecheck` by bumping type
  packages on their own.

### Dependency posture (no breaking upgrades)

A routine audit of the devDependency tree (jest 26 / rollup 2 / tslint 6 era)
reports advisories in transitive build-only packages (`braces`, `micromatch`,
`serialize-javascript`, `decode-uri-component`, `uuid`, `deepmerge`). These are
**not shipped**: `files` contains only build output and source, no dev tooling.
Their patched versions require multi-major jumps that break the pinned
TypeScript 3.9 build chain (see `SECURITY.md` §供应链 and `.github/dependabot.yml`),
so per the project's policy they are left pinned rather than force-upgraded.
No dependency version was changed in this release.

### Verification

`yarn install --frozen-lockfile`, `yarn typecheck`, `yarn test` (67 suites /
635 tests, at that time) and `yarn build` (cjs / es / esm / umd / downlevel-dts)
all pass.

## 1.18.0

Repository tag (never published to npm). Focused on security fixes only: no
public API was changed, and all existing behaviour is preserved.

### Security

- **ReDoS in PDF date parsing** (`src/utils/strings.ts`). `parseDate` fed
  attacker-controlled date strings to a backtracking-prone regular expression,
  so an input such as `D:2026` followed by tens of thousands of digits could
  pin the CPU for a long time. Replaced with a linear, hand-written parser and a
  `DATE_STRING_MAX_LENGTH` guard. (upstream issue
  [#1773](https://github.com/Hopding/pdf-lib/issues/1773))

- **Out-of-bounds read and infinite loop in the JPEG marker scan**
  (`src/core/embedders/JpegEmbedder.ts`). Malformed JPEG data could read past
  the end of the buffer, and a JPEG segment declaring length `0` made the scan
  loop forever on the same offset. Every read is now bounds checked, segments
  shorter than 2 bytes are rejected, and the scan honours the `byteOffset` /
  `byteLength` of `subarray` and `Buffer` inputs instead of assuming offset 0.
  (upstream issue
  [#1778](https://github.com/Hopding/pdf-lib/issues/1778))

- **Unvalidated xref stream field widths**
  (`src/core/parser/PDFXRefStreamParser.ts`). The `/W` array of an xref stream
  was used without validation, so a malformed document could drive bogus
  allocations. Field widths are now validated before use.

- **Unbounded decode buffer growth** (`src/core/streams/DecodeStream.ts`).
  Added a `maxBufferLength` ceiling so a crafted stream cannot expand without
  limit (decompression bomb).

### Tests

- Added regression tests covering the hardened code paths:
  `tests/utils/parseDate.spec.ts` and
  `tests/core/embedders/JpegEmbedderBounds.spec.ts`.

### Credits

The original library, its design and the overwhelming majority of this
codebase are the work of Andrew Dillon (`Hopding`) and the pdf-lib
contributors. This fork only adds maintenance on top.
