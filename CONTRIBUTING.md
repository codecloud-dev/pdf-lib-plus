# 贡献指南 · pdf-lib-plus

> `pdf-lib-plus` 是 `pdf-lib` 的社区维护分支，**公开 API 不变**。本仓库存在的
> 首要目的是修复上游停止发布后遗留的安全问题，安全类贡献优先级最高。
> 中文导读见 [README.zh.md](./README.zh.md)，完整 API 文档见
> [README.md](./README.md)。

规则分 **【必须】** 与 **【建议】**。**必须** 只有 5 条，其余不劝退贡献者。

## 【必须】遵守的 5 条

1. **【必须】** 安全漏洞不要写进公开 Issue / PR，走
   [SECURITY.md](SECURITY.md) 的私密渠道，切勿公开 PoC。
2. **【必须】** 不改动公开 API。本分支对上游的承诺是「行为与签名完全兼容」，
   破坏性改动一律不收；确需演进请先在 Issue 讨论。
3. **【必须】** PR 描述写清 **改了什么 / 为什么改 / 怎么验证** 三件事。
4. **【必须】** 跑过下方「本地验证」里与改动对应的命令并贴结果；跑不了写明原因。
5. **【必须】** 不提交密钥、token、账号数据、真实用户 PDF 样本。CI 有密钥扫描。

## 本地验证

工具链固定 **TypeScript 3.9**，Node 建议 20（与 CI 一致）。

```bash
yarn install --frozen-lockfile --ignore-scripts
yarn typecheck                 # tsc --noEmit
yarn test                      # jest，全量回归
yarn build                     # cjs / es / esm / umd / downlevel-dts
```

- 改了解析/解码路径：**必须**补一个能复现问题的恶意输入回归用例
  （参考 `tests/utils/parseDate.spec.ts`、
  `tests/core/embedders/JpegEmbedderBounds.spec.ts`）。
- 改了公开行为：先确认没有破坏 API 兼容，再改文档（英文主 README 为主）。
- `yarn lint` 会用 prettier/tslint 自动改写文件，提交前记得看一眼 diff。

## 依赖与升级约束（重要）

`package.json` 的 `resolutions` 与 `.github/dependabot.yml` 共同固定了一批包，
**不要单独升级**：

- `@types/node` / `@types/babel__traverse` / `@types/prettier`：
  TypeScript 3.9 无法解析新版类型声明，升级会让 `yarn typecheck` 崩在
  `node_modules` 里。要升必须**连同整条构建链一起升**并全量验证。
- `typescript` / `downlevel-dts`：major（含 0.x 的 minor）被明确挡掉。
  `downlevel-dts@0.11` 依赖 TS nightly 7.x，与本仓不兼容（PR #4 真实 CI 失败）。
- `yarn.lock` 必须与 `package.json` 一致：CI 用 `--frozen-lockfile`，
  只改 `package.json` 不改锁文件会直接红。

Dependabot 按月分组只收 minor/patch，major 人工评估。devDependency 的漏洞
（jest/rollup/tslint 等构建链传递依赖）**不进发布产物**（`files` 只含构建输出
与源码），修复以不破坏 TS 3.9 工具链为前提，宁可保留评估结论也不做破坏性强升。

## 提交与 PR

- 用中文或英文写 commit message 都行，但请说清动机；安全修复注明影响面。
- 一个 PR 聚焦一件事：安全修复、回归用例、文档各自独立更好审。
- CHANGELOG.md 由维护者在发版时统一整理，PR 一般不需要改它。

## 行为准则

参与本项目即表示同意 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
