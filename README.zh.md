# pdf-lib-plus · 中文说明

> 本文件是 [README.md](./README.md)（英文主文档）的中文导读。
> `pdf-lib-plus` 是 [pdf-lib](https://github.com/Hopding/pdf-lib) 的**社区维护分支**：
> 上游自 2022 年起未再发布版本，本分支保持公开 API 与原 MIT 许可完全不变，
> 先从修复上游遗留的解析/解码安全问题起步。完整 API 文档、示例与贡献者名单
> 以英文主 README 为准。

- **主文档（英文）**：[README.md](./README.md)
- **更新日志**：[CHANGELOG.md](./CHANGELOG.md)
- **安全政策与漏洞报告**：[SECURITY.md](./SECURITY.md)
- **贡献指南**：[CONTRIBUTING.md](./CONTRIBUTING.md)
- **行为准则**：[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- **许可证**：[LICENSE.md](./LICENSE.md)（MIT，保留原作者版权声明）

## 这是什么

一个用 JavaScript 在任何运行时创建与修改 PDF 文档的库，可在 Node、浏览器、
Deno、React Native 中工作。本分支**不改公开 API**——原来怎么写，现在还怎么写；
本分支增加的是维护：修复上游报告过、但没有随版本发布的安全问题。

首个版本 `1.18.0` 修复了以下问题（详见 CHANGELOG）：

- PDF 日期解析的正则回溯（ReDoS），改为线性手写解析器并加长度上限；
- JPEG marker 扫描的越界读与死循环，补齐边界检查、尊重 `byteOffset/byteLength`；
- xref 流 `/W` 字段宽度未校验，可能触发异常内存分配，现已先校验再使用；
- 解码流缓冲区无上限增长（解压炸弹），已加 `maxBufferLength` 上限。

每项修复都配了对应的回归测试。

## 安装与使用

```bash
npm install pdf-lib-plus
# 或
yarn add pdf-lib-plus
```

```js
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib-plus';

const pdfDoc = await PDFDocument.create();
const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
const page = pdfDoc.addPage([550, 750]);

page.drawText('你好，PDF', {
  x: 50, y: 700, size: 30, font: timesRomanFont, color: rgb(0, 0.15, 0.35),
});

const pdfBytes = await pdfDoc.save();
```

> 更完整的示例（表单、图片嵌入、合并/拆分、加密文档等）见英文主 README。
> 中文字符需嵌入支持 CJK 的字体（`@pdf-lib/fontkit` + 自定义字体），标准 14 字体
> 不含中文字形——这是 pdf-lib 原有的行为，本分支未改。

## 与上游 pdf-lib 的关系

| 维度 | 上游 `pdf-lib` | 本分支 `pdf-lib-plus` |
| --- | --- | --- |
| 公开 API | 原版 | **完全兼容，未改** |
| 许可证 | MIT | MIT（保留原版权声明） |
| 最近发布 | 2022 年后无 | 持续维护安全修复 |
| 目标 | 功能库 | 在保持 API 不变的前提下做安全维护 |

绝大多数代码来自 Andrew Dillon（`Hopding`）与 pdf-lib 的贡献者，本分支只在
其上做维护。若上游恢复维护，本分支乐于把修复回馈上游。

## 本地开发

工具链锁定 **TypeScript 3.9**，CI 以 `yarn install --frozen-lockfile` 安装，
依次跑 `yarn typecheck`、`yarn test`、`yarn build`（cjs/es/esm/umd/downlevel-dts）。
`package.json` 的 `resolutions` 固定了三个 `@types/*` 包与 `downlevel-dts`，
新版类型声明会让 TS 3.9 解析失败——**不要单独升它们**，详见
[CONTRIBUTING.md](./CONTRIBUTING.md) 与 `.github/dependabot.yml` 的注释。

```bash
yarn install --frozen-lockfile --ignore-scripts
yarn typecheck && yarn test && yarn build
```

## 报告安全问题

请勿在公开 Issue 里贴 PoC。走 [SECURITY.md](./SECURITY.md) 列出的私密渠道
（匿名票据 / GitHub 私密漏洞报告），高危问题优先排期。
