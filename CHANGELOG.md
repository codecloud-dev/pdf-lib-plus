# Changelog

All notable changes to `pdf-lib-plus` are documented here.

`pdf-lib-plus` is a community-maintained fork of
[`pdf-lib`](https://github.com/Hopding/pdf-lib). It keeps the original public
API and the original MIT license. The upstream project has not published a
release since 2022, so this fork begins by closing the security issues that
were reported upstream but never fixed in a release.

## 1.18.1 - 2026-11-14

Maintenance release. **No public API and no runtime code changed** — the
published artifacts are byte-for-byte the same library as 1.18.0.

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
635 tests) and `yarn build` (cjs / es / esm / umd / downlevel-dts) all pass.

## 1.18.0

First release of the community fork. Focused on security fixes only: no public
API was changed, and all existing behaviour is preserved.

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
