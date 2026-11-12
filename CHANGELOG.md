# Changelog

All notable changes to `pdf-lib-plus` are documented here.

`pdf-lib-plus` is a community-maintained fork of
[`pdf-lib`](https://github.com/Hopding/pdf-lib). It keeps the original public
API and the original MIT license. The upstream project has not published a
release since 2022, so this fork begins by closing the security issues that
were reported upstream but never fixed in a release.

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
