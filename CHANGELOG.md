# Changelog

All notable changes to `pdf-lib-plus` are documented here.

`pdf-lib-plus` is a community-maintained fork of
[`pdf-lib`](https://github.com/Hopding/pdf-lib). It keeps the original public
API and the original MIT license. The upstream project has not published a
release since 2022, so this fork begins by closing the security issues that
were reported upstream but never fixed in a release.

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
