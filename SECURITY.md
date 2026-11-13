# 安全政策

`pdf-lib-plus` 是 [pdf-lib](https://github.com/Hopding/pdf-lib) 的社区维护分支，
保留 MIT 许可，重点修复上游停止发布后遗留的解析与解码边界问题。安全是本仓库
存在的理由，因此漏洞报告优先级高于功能请求。

## 支持版本

| 版本 | 支持 |
| --- | --- |
| `1.18.x` | 是 |
| 更旧的 `1.x` | 否，请升级后再复现 |

## 报告渠道

按隐私需求自行选择，三条通道都进同一个待处理队列：

- **完全匿名**：<https://mox-site.pages.dev/security> —— 不需要账号，提交后返回
  一次性进度票据，可凭票据查询处理状态。请不要在公开 Issue 里贴 PoC。
- **GitHub 私密漏洞报告**：本仓库 *Security → Report a vulnerability*，适合希望
  直接关联 CVE / GHSA 的报告者（需要 GitHub 账号）。
- **行为准则投诉**：<https://mox-site.pages.dev/report> —— 与漏洞通道分开处理。

报告请尽量包含：受影响版本、最小可复现的 PDF 或输入、期望行为与实际行为、
以及你判断的影响面。无法提供样本时，描述触发路径也可以，我们会自行构造。

## 处理流程

1. 确认收件并登记，必要时向你追问复现细节。
2. 在隔离环境复现、定位到具体解析/解码路径，评估影响面。
3. 修复并补回归用例（含恶意输入样本），跑通 `yarn typecheck && yarn test && yarn build`。
4. 发布修复版本，在 CHANGELOG 记录，并按你的意愿致谢。

高危问题会优先排期，但本文件不承诺固定小时数的响应时限 —— 虚假的时限比
没有时限更糟。进度一律以票据或 PVR 里的真实状态为准。

## 供应链

- 依赖升级由 Dependabot 按月分组提 minor/patch PR，合并前必须过 CI；major 人工评估。
- `package.json` 的 `resolutions` 固定了三个 `@types/*` 包，因为工具链使用
  TypeScript 3.9，新版类型声明无法解析。升级它们必须同步升级构建链并全量验证。
- CI 有密钥扫描（`.github/workflows/secret-scan.yml`，规则自带自测）。
- 密钥、token 一律走 CI Secrets，不进仓库；不要往 Issue 里贴真实凭据。

完整政策与协调披露说明见 <https://mox-site.pages.dev/security>。
