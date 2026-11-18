// Real GC check for the weak intern pool (Hopding/pdf-lib#1799).
// Run after `yarn build:cjs`:
//   node --expose-gc scripts/verify-intern-memory.cjs
//
// The old strong Map retained every distinct PDFName/PDFRef forever. This
// script interns unique keys inside a scope, drops them, forces GC, and checks
// that WeakRefs to those objects are dead while identity lookups still work.

const assert = require('assert');

if (typeof global.gc !== 'function') {
  console.error('Please run with: node --expose-gc scripts/verify-intern-memory.cjs');
  process.exit(1);
}

const PDFName = require('../cjs/core/objects/PDFName').default;
const PDFRef = require('../cjs/core/objects/PDFRef').default;

const stableName = PDFName.of('StableNameAfterGC');
const stableRef = PDFRef.of(123456789, 0);

function createProbes() {
  const probes = [];
  for (let i = 0; i < 1000; i++) {
    const name = PDFName.of(`LeakProbe_Name_${Date.now()}_${i}`);
    const ref = PDFRef.of(900000000 + i, 0);
    probes.push([new WeakRef(name), new WeakRef(ref)]);
  }
  return probes;
}

const weakRefs = createProbes();

(async () => {
  // V8 keeps freshly allocated objects alive until the current job ends, so
  // let one macrotask pass before forcing collection.
  await new Promise((resolve) => setTimeout(resolve, 50));
  for (let i = 0; i < 10; i++) global.gc();
  await new Promise((resolve) => setTimeout(resolve, 50));

  const alive = weakRefs.filter(
    ([nameRef, refRef]) =>
      nameRef.deref() !== undefined || refRef.deref() !== undefined,
  ).length;

  assert.strictEqual(PDFName.of('StableNameAfterGC'), stableName);
  assert.strictEqual(PDFRef.of(123456789, 0), stableRef);
  assert.ok(
    alive === 0,
    `weak intern pool still retains ${alive}/1000 dropped objects`,
  );

  console.log(
    'weak intern pool: 1000/1000 dropped PDFName/PDFRef objects collected',
  );
  console.log('live identity lookups still return the same instances');
})();
