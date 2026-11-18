# 迁移指南（1.18.2 → 1.18.3）

## 结论先说

**没有破坏性改动。** 1.18.3 只新增导出与只读访问器，原有
`PDFDocument` / `PDFPage` / 表单 / 图片 / 嵌入字体 API 的签名和行为不变。
无需改业务代码即可升级。

## 安装

```bash
npm install @codecloud-dev/pdf-lib-plus@1.18.3
# 或
yarn add @codecloud-dev/pdf-lib-plus@1.18.3
```

如果还在用未发布的 `pdf-lib-plus`（无 scope）或上游 `pdf-lib` 的旧安装命令，
请先改成 scoped 包：

```diff
- import { PDFDocument } from 'pdf-lib';
+ import { PDFDocument } from '@codecloud-dev/pdf-lib-plus';
```

> `1.18.0` / `1.18.1` 从未发布到 npm。真正可从 registry 安装的版本从
> `1.18.2` 开始。

## 可选：使用新增能力

```ts
import {
  PDFDocument,
  extractText,
  extractTextFromPage,
  removeTextContaining,
  PDFContentStreamParser,
} from '@codecloud-dev/pdf-lib-plus';

const lines = extractTextFromPage(page);
const text = extractText(page);
const removed = removeTextContaining(page, 'SECRET');
```

`PDFPage` 也提供实例方法：

```ts
page.extractText();
page.extractTextLines();
```

详细说明见 [TEXT_EXTRACTION.md](TEXT_EXTRACTION.md)。

## 行为变化清单

| 变化 | 影响 |
| --- | --- |
| 新增 `PDFOperator#getName()` / `#getArgs()` | 无，纯新增只读访问器 |
| 新增 `PDFContentStream#getOperators()` | 无，返回副本，不改内部数组 |
| 新增 `PDFPageLeaf#setContentStream(ref)` | 无，供文本删除重建内容流使用 |
| `extractText*` / `removeTextContaining` | 无，旧代码不调用就不受影响 |
| 版本 1.18.3 | npm registry 正式发布 |

## 升级后验证

```bash
yarn typecheck
yarn test        # 70 suites / 664 tests
yarn build
```

中文提取回归需要 `@pdf-lib/fontkit` 与仓库内
`assets/fonts/source_hans_jp/SourceHanSerifJP-Regular.otf`，测试已覆盖
`save → load` 后的 Flate ToUnicode CMap 路径。

## 已知边界

文本提取是内容流解释，不是完整版面还原。若你的业务依赖精确换行、旋转文本、
无 ToUnicode 的 CID 字体或逐字脱敏，请先按
[TEXT_EXTRACTION.md](TEXT_EXTRACTION.md) 的边界做验证，不要把整段算子删除误当
成安全脱敏。
