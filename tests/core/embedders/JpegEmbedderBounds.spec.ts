import { JpegEmbedder } from 'src/core';

// A minimal but structurally valid JPEG. `JpegEmbedder.for` only reads up to
// the SOF marker's frame header, so the entropy-coded data is not needed.
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

describe(`JpegEmbedder bounds checks`, () => {
  it(`rejects a zero-length segment instead of looping forever`, async () => {
    // SOI, then an APP0 marker with a segment length of 0. Before the fix this
    // advanced `pos` by 0 and spun the parser forever. See issue #1778.
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]);
    await expect(JpegEmbedder.for(bytes)).rejects.toThrow(
      'Invalid JPEG segment length',
    );
  });

  it(`rejects a segment length of 1 (below the minimum of 2)`, async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]);
    await expect(JpegEmbedder.for(bytes)).rejects.toThrow(
      'Invalid JPEG segment length',
    );
  });

  it(`rejects truncated data without reading out of bounds`, async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    await expect(JpegEmbedder.for(bytes)).rejects.toThrow();
  });

  it(`rejects data too short to hold an SOI marker`, async () => {
    await expect(JpegEmbedder.for(new Uint8Array([0xff]))).rejects.toThrow();
    await expect(JpegEmbedder.for(new Uint8Array([]))).rejects.toThrow();
  });

  it(`does not treat an empty stream as an infinite loop`, async () => {
    // SOI followed by padding that never contains a SOF marker.
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x02]);
    await expect(JpegEmbedder.for(bytes)).rejects.toThrow();
  });

  it(`reads from a subarray's own byte offset`, async () => {
    // Prefix the JPEG with unrelated bytes so that the view starts at a
    // non-zero `byteOffset` on a larger, shared ArrayBuffer.
    const padded = new Uint8Array(3 + minimalJpeg.length);
    padded.set(minimalJpeg, 3);
    const view = padded.subarray(3);

    expect(view.byteOffset).toBe(3);

    const embedder = await JpegEmbedder.for(view);
    expect(embedder.width).toBe(64);
    expect(embedder.height).toBe(42);
    expect(embedder.bitsPerComponent).toBe(8);
    expect(embedder.colorSpace).toBe('DeviceRGB');
  });

  it(`still parses an ordinary (unshifted) JPEG`, async () => {
    const embedder = await JpegEmbedder.for(minimalJpeg);
    expect(embedder.width).toBe(64);
    expect(embedder.height).toBe(42);
  });
});
