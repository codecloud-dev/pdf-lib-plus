# pdf-lib-plus 功能路标

> 来源：2026-11-20 用户提供的豆包讨论《为产品规划联网功能与新体验》。
> 原则：**不追着别人已有的加密 / PDF-A / 数字签名打消耗战**，把我们已经独有的
> 文本提取 / 内容流解析能力变成别人没有的体验。每个能力都配 `examples/` 下
> 可直接 `node` 运行的复现用例，禁止只改 README 冒充完成。

## 竞争格局（核实结论）

| 能力 | cantoo | libpdf (Documenso) | pdf-lib-plus 1.18.4 |
| --- | --- | --- | --- |
| 增量保存 | ✅ | ✅ | ❌（本轮补上） |
| 加密 / PDF-A | ✅ | ✅ | ❌ |
| 数字签名 | ❌ | ✅ PAdES B-LTA | ❌ |
| 文本提取 / 内容流解析 | ❌ | ✅（带坐标） | ✅ |

加密、PDF-A、签名已经被两家吃透；**文本提取和本地处理**才是缝。

## 本轮已落地（1.19.0）

| 优先级 | 能力 | 状态 | 入口 |
| --- | --- | --- | --- |
| 口碑 | EXIF 自动纠正 | ✅ | `PDFDocument.embedJpg(bytes, { autoCorrectExif: true })`；`PDFImage.exifOrientation`；`PDFPage.drawImage` 自动按 Orientation 旋转/镜像 |
| 口碑 | 宽容加载 + 诊断报告 | ✅ | `PDFDocument.load(bytes, { lenient: true })` → `{ doc, warnings }` |
| 护城河 | 带坐标文本层 | ✅ | `page.extractTextRuns()` → `{ text, x, y, width, height, font, fontSize }` |
| 护城河 | 文本搜索 | ✅ | `page.searchText(query)` → 可画框矩形 |
| 护城河 | 真脱敏 | ✅ | `page.redactText(query)`：删字形 + 黑色覆盖框 + 物理删除旧流；覆盖 Form XObject（调用方仍应自行清元数据） |
| 护城河 | 原位文本替换 | ✅ | `await page.replaceText(query, replacement)` |
| 信任 | 体积治理 | ✅（图片层） | 相同图片字节复用同一 XObject ref，避免重复嵌入 |
| 信任 | 增量保存 | ✅ | `doc.save({ incremental: true })`：保留原文件字节，只追加改动对象 + xref |
| 体验 | 浏览器 playground | ✅ | `apps/web/playground.html`，本地处理不上传 |

## 后续（未宣称完成）

- 资源按内容 hash 全局去重（跨字典/流，不只是图片 API 层）。
- 旋转文本 / CID 无 ToUnicode 字体的精确坐标还原。
- 增量保存对多次连续增量与签名更新链的互操作测试。
- 加密 / PDF-A / 数字签名：竞争格局已饱和，暂不投入。

## 运行复现

```bash
yarn build
node examples/roadmap-demo.cjs
```

示例覆盖：文本坐标/搜索、脱敏、替换、图片去重、宽容加载、增量保存、EXIF 读取。

## 纪律

每个新功能必须先有 `examples/` 里一条能真跑的命令，再写 README。
宣称「支持」之前必须有测试；测试必须覆盖 save → load 的真实路径，不靠内存态假绿。
