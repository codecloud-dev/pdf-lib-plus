import { JpegEmbedder, PDFContext, PDFRawStream } from 'src/core';

// A minimal but structurally valid JPEG. `JpegEmbedder.for` only reads up to
// the SOF marker's frame header, so no entropy-coded data is needed.
const minimalJpeg = new Uint8Array([
  0xff,
  0xd8, // SOI
  0xff,
  0xc0,
  0x00,
  0x11, // SOF0, segment length 17
  0x08, // sample precision
  0x00,
  0x2a, // height: 42
  0x00,
  0x40, // width: 64
  0x03, // number of components (3 => DeviceRGB)
  0xff,
  0xd9, // EOI
]);

// Build a Node `Buffer` whose JPEG payload sits in the middle of a larger,
// shared backing buffer. `Buffer` slices are views: `byteOffset` is non-zero
// and the memory is shared with the original buffer. `Buffer.allocUnsafe`
// pooling produces exactly this layout in practice (upstream PR #1273).
const offsetBufferView = () => {
  const prefix = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
  const suffix = Buffer.from([0xee, 0xff, 0x11, 0x22]);
  const backing = Buffer.concat([prefix, Buffer.from(minimalJpeg), suffix]);
  const view = backing.subarray(prefix.length, prefix.length + minimalJpeg.length);

  expect(view.byteOffset).toBeGreaterThan(0);
  expect(view.byteLength).toBe(minimalJpeg.length);
  expect(view.buffer).toBe(backing.buffer);

  return { backing, view };
};

describe(`JpegEmbedder with an offset Buffer view`, () => {
  it(`reads metadata from the view, not from the start of its backing buffer`, async () => {
    const { view } = offsetBufferView();
    const embedder = await JpegEmbedder.for(view);

    expect(embedder.width).toBe(64);
    expect(embedder.height).toBe(42);
    expect(embedder.bitsPerComponent).toBe(8);
    expect(embedder.colorSpace).toBe('DeviceRGB');
  });

  it(`embeds exactly the JPEG bytes, without the surrounding padding`, async () => {
    const { view } = offsetBufferView();
    const context = PDFContext.create();
    const embedder = await JpegEmbedder.for(view);
    const ref = await embedder.embedIntoContext(context);
    const raw = context.lookup(ref) as PDFRawStream;

    expect(Array.from(raw.contents)).toEqual(Array.from(minimalJpeg));
  });

  it(`does not keep a live view onto the caller's shared buffer`, async () => {
    const { backing, view } = offsetBufferView();
    const context = PDFContext.create();
    const embedder = await JpegEmbedder.for(view);
    const ref = await embedder.embedIntoContext(context);
    const raw = context.lookup(ref) as PDFRawStream;

    // A Buffer view aliases its backing buffer. If the embedder stored that
    // view, reusing/overwriting the shared memory after embedding (which is
    // what pooled Buffers do) would silently corrupt the JPEG bytes before
    // the PDF is serialized.
    backing.fill(0x00);
    expect(Array.from(raw.contents)).toEqual(Array.from(minimalJpeg));
  });
});
