import { parseDate } from 'src/utils/strings';

describe(`parseDate`, () => {
  it(`parses a date that contains only a year`, () => {
    const date = parseDate('D:2026');
    expect(date).toBeInstanceOf(Date);
    expect(date!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it(`parses a date with year, month and day`, () => {
    const date = parseDate('D:20260530');
    expect(date!.toISOString()).toBe('2026-05-30T00:00:00.000Z');
  });

  it(`parses a full date with a 'Z' offset`, () => {
    const date = parseDate('D:20260530120000Z');
    expect(date!.toISOString()).toBe('2026-05-30T12:00:00.000Z');
  });

  it(`parses a full date with a numeric offset`, () => {
    const date = parseDate("D:20260530120000+08'00'");
    expect(date!.toISOString()).toBe('2026-05-30T04:00:00.000Z');
  });

  it(`parses a full date with a negative numeric offset`, () => {
    const date = parseDate("D:20260530120000-05'30'");
    expect(date!.toISOString()).toBe('2026-05-30T17:30:00.000Z');
  });

  it(`returns undefined for strings that are not PDF dates`, () => {
    expect(parseDate('20260530')).toBeUndefined();
    expect(parseDate('D:abcd')).toBeUndefined();
    expect(parseDate('D:2026X')).toBeUndefined();
    expect(parseDate('D:2026 ')).toBeUndefined();
    expect(parseDate('')).toBeUndefined();
  });

  it(`does not exhibit catastrophic backtracking on hostile input`, () => {
    // A malicious `CreationDate` / `ModDate` value. Before the fix this pattern
    // was handled with a backtracking regular expression and blew up on inputs
    // just a few hundred characters long. See issue #1773.
    const hostile = `D:2026${'1'.repeat(100000)}x`;

    const start = Date.now();
    const result = parseDate(hostile);
    const elapsed = Date.now() - start;

    expect(result).toBeUndefined();
    expect(elapsed).toBeLessThan(50);
  });

  it(`does not take superlinear time as hostile input grows`, () => {
    const timeFor = (n: number) => {
      const input = `D:${'9'.repeat(n)}`;
      const start = Date.now();
      parseDate(input);
      return Date.now() - start;
    };

    // Warm up, then compare two sizes an order of magnitude apart.
    timeFor(1000);
    const small = timeFor(2000) + 1;
    const large = timeFor(20000) + 1;

    // Linear (or better) behaviour keeps the ratio close to the size ratio
    // (10x). Allow generous slack for timer noise.
    expect(large / small).toBeLessThan(50);
  });
});
