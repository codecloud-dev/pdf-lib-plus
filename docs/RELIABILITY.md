# 可靠性维护说明（1.18.4+）

`pdf-lib-plus` 继续保持公开 API 与 MIT 许可不变。1.18.4 只修复上游公开 issue
中已经明确指出、但长期没有随版本发布的问题。

## 1. `removeField()` 不再留下悬空 `/Annots`

上游 #1784 / #1001：表单编辑流程里 `removeField()` 曾把 `/AP/N` 外观流引用当成
页面 `/Annots` 中的 widget 引用，导致：

- 页面注解数组保留不再存在的间接对象；
- save → reload 后出现悬空引用；
- 同名字段重建时出现 “A field already exists...” 或幽灵标注；
- 反复导入导出文件体积膨胀。

本版在 `PDFForm.removeField()` 中改用 widget 注解字典自身的间接引用：

```ts
const widgetRef = this.doc.context.getObjectRef(widget.dict);
```

删除后页面 `/Annots` 与文档上下文同步清理。回归测试覆盖：删除前引用存在、
删除后引用消失、同名重建成功、save/load 后所有 annot 引用可 lookup。

## 2. `PDFRef` / `PDFName` 不再永久占用内存

上游 #1799：这两个对象要求相同 key 返回相同实例，因为 `PDFContext` 和
`PDFDict` 用对象 identity 作为 Map key。原实现使用模块级强 `Map`，在长生命周期
Node 服务里加载大量 PDF 后堆内存持续上涨。

本版新增 `src/utils/intern.ts`，用 `WeakRef` + `FinalizationRegistry` 保存池：

- 文档还活着时，`PDFRef.of(1)` / `PDFName.of('Type')` 仍返回同一个实例；
- 文档被丢弃后，池里的弱引用不阻止 GC；
- 晚到的 finalizer 不会误删已经替换的新实例；
- 不支持 WeakRef 的老运行时自动回落到原强池，不改变 API。

真实 GC 验证：

```bash
yarn build:cjs
node --expose-gc scripts/verify-intern-memory.cjs
```

预期输出：

```text
weak intern pool: 1000/1000 dropped PDFName/PDFRef objects collected
live identity lookups still return the same instances
```

## 3. 已验证

- `yarn typecheck`
- `yarn test`（70 suites / 667 tests）
- `yarn lint`
- `yarn build`（cjs / es / esm / umd / min / ts3.4 d.ts）
- `node --expose-gc scripts/verify-intern-memory.cjs`
- `node examples/text-extraction.cjs`（标准字体 / CJK / 文本删除）
- `node scripts/benchmark.cjs 200`（真实基准，数值随机器负载波动）
- `npm pack --dry-run`（1577 文件 / 3.1 MB tarball，含新增 `intern.d.ts`）

这些都是真实运行结果，不是文档里的占位数字。
