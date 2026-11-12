export const toCharCode = (character: string) => character.charCodeAt(0);

export const toCodePoint = (character: string) => character.codePointAt(0);

export const toHexStringOfMinLength = (num: number, minLength: number) =>
  padStart(num.toString(16), minLength, '0').toUpperCase();

export const toHexString = (num: number) => toHexStringOfMinLength(num, 2);

export const charFromCode = (code: number) => String.fromCharCode(code);

export const charFromHexCode = (hex: string) => charFromCode(parseInt(hex, 16));

export const padStart = (value: string, length: number, padChar: string) => {
  let padding = '';
  for (let idx = 0, len = length - value.length; idx < len; idx++) {
    padding += padChar;
  }
  return padding + value;
};

export const copyStringIntoBuffer = (
  str: string,
  buffer: Uint8Array,
  offset: number,
): number => {
  const length = str.length;
  for (let idx = 0; idx < length; idx++) {
    buffer[offset++] = str.charCodeAt(idx);
  }
  return length;
};

export const addRandomSuffix = (prefix: string, suffixLength = 4) =>
  `${prefix}-${Math.floor(Math.random() * 10 ** suffixLength)}`;

export const escapeRegExp = (str: string) =>
  str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const cleanText = (text: string) =>
  text.replace(/\t|\u0085|\u2028|\u2029/g, '    ').replace(/[\b\v]/g, '');

export const escapedNewlineChars = ['\\n', '\\f', '\\r', '\\u000B'];

export const newlineChars = ['\n', '\f', '\r', '\u000B'];

export const isNewlineChar = (text: string) => /^[\n\f\r\u000B]$/.test(text);

export const lineSplit = (text: string) => text.split(/[\n\f\r\u000B]/);

export const mergeLines = (text: string) =>
  text.replace(/[\n\f\r\u000B]/g, ' ');

// JavaScript's String.charAt() method doesn work on strings containing UTF-16
// characters (with high and low surrogate pairs), such as 💩 (poo emoji). This
// `charAtIndex()` function does.
//
// Credit: https://github.com/mathiasbynens/String.prototype.at/blob/master/at.js#L14-L48
export const charAtIndex = (text: string, index: number): [string, number] => {
  // Get the first code unit and code unit value
  const cuFirst = text.charCodeAt(index);
  let cuSecond: number;
  const nextIndex = index + 1;
  let length = 1;
  if (
    // Check if it's the start of a surrogate pair.
    cuFirst >= 0xd800 &&
    cuFirst <= 0xdbff && // high surrogate
    text.length > nextIndex // there is a next code unit
  ) {
    cuSecond = text.charCodeAt(nextIndex);
    if (cuSecond >= 0xdc00 && cuSecond <= 0xdfff) length = 2; // low surrogate
  }
  return [text.slice(index, index + length), length];
};

export const charSplit = (text: string) => {
  const chars: string[] = [];

  for (let idx = 0, len = text.length; idx < len; ) {
    const [c, cLen] = charAtIndex(text, idx);
    chars.push(c);
    idx += cLen;
  }

  return chars;
};

const buildWordBreakRegex = (wordBreaks: string[]) => {
  const newlineCharUnion = escapedNewlineChars.join('|');

  const escapedRules: string[] = ['$'];
  for (let idx = 0, len = wordBreaks.length; idx < len; idx++) {
    const wordBreak = wordBreaks[idx];
    if (isNewlineChar(wordBreak)) {
      throw new TypeError(`\`wordBreak\` must not include ${newlineCharUnion}`);
    }
    escapedRules.push(wordBreak === '' ? '.' : escapeRegExp(wordBreak));
  }

  const breakRules = escapedRules.join('|');
  return new RegExp(`(${newlineCharUnion})|((.*?)(${breakRules}))`, 'gm');
};

export const breakTextIntoLines = (
  text: string,
  wordBreaks: string[],
  maxWidth: number,
  computeWidthOfText: (t: string) => number,
): string[] => {
  const regex = buildWordBreakRegex(wordBreaks);

  const words = cleanText(text).match(regex)!;

  let currLine = '';
  let currWidth = 0;
  const lines: string[] = [];

  const pushCurrLine = () => {
    if (currLine !== '') lines.push(currLine);
    currLine = '';
    currWidth = 0;
  };

  for (let idx = 0, len = words.length; idx < len; idx++) {
    const word = words[idx];
    if (isNewlineChar(word)) {
      pushCurrLine();
    } else {
      const width = computeWidthOfText(word);
      if (currWidth + width > maxWidth) pushCurrLine();
      currLine += word;
      currWidth += width;
    }
  }
  pushCurrLine();

  return lines;
};

// See section "7.9.4 Dates" of the PDF specification
//
// NOTE: This used to be implemented with a regular expression containing a long
// run of nested optional groups (`(\d\d)?(\d\d)?(\d\d)?(\d\d)?(\d\d)?`). When
// the input did not match, the engine tried every possible way of distributing
// the digits across those groups, which is catastrophic backtracking (ReDoS).
// Because the value being parsed comes from document metadata (for example the
// `CreationDate` or `ModDate` entries), an attacker could embed a crafted
// string in a PDF and stall any application that reads it. See:
//   https://github.com/Hopding/pdf-lib/issues/1773
//
// The date is now parsed by hand so that the running time is strictly linear in
// the length of the input.
const DATE_STRING_MAX_LENGTH = 32;

const CODE_DIGIT_0 = 0x30;
const CODE_DIGIT_9 = 0x39;
const CODE_UPPER_D = 0x44; // 'D'
const CODE_COLON = 0x3a; // ':'
const CODE_QUOTE = 0x27; // "'"
const CODE_PLUS = 0x2b; // '+'
const CODE_MINUS = 0x2d; // '-'
const CODE_UPPER_Z = 0x5a; // 'Z'

export const parseDate = (dateStr: string): Date | undefined => {
  if (typeof dateStr !== 'string') return undefined;

  // The longest well-formed PDF date is `D:YYYYMMDDHHmmSSOHH'mm'` (23
  // characters). Reject anything longer so that a malicious metadata value
  // cannot force the parser to do a disproportionate amount of work.
  if (dateStr.length < 6 || dateStr.length > DATE_STRING_MAX_LENGTH) {
    return undefined;
  }

  if (
    dateStr.charCodeAt(0) !== CODE_UPPER_D ||
    dateStr.charCodeAt(1) !== CODE_COLON
  ) {
    return undefined;
  }

  let idx = 2;

  // Reads exactly `count` ASCII digits at the current position. Returns
  // `undefined` (without consuming any input) if that is not possible.
  const readDigits = (count: number): string | undefined => {
    if (idx + count > dateStr.length) return undefined;

    let value = '';
    for (let offset = 0; offset < count; offset++) {
      const code = dateStr.charCodeAt(idx + offset);
      if (code < CODE_DIGIT_0 || code > CODE_DIGIT_9) return undefined;
      value += dateStr[idx + offset];
    }

    idx += count;
    return value;
  };

  const orDefault = (value: string | undefined, fallback: string) =>
    value === undefined ? fallback : value;

  const year = readDigits(4);
  if (year === undefined) return undefined;

  const month = orDefault(readDigits(2), '01');
  const day = orDefault(readDigits(2), '01');
  const hours = orDefault(readDigits(2), '00');
  const mins = orDefault(readDigits(2), '00');
  const secs = orDefault(readDigits(2), '00');

  let offsetSign = 'Z';
  const signCode = idx < dateStr.length ? dateStr.charCodeAt(idx) : -1;
  if (signCode === CODE_PLUS) {
    offsetSign = '+';
    idx += 1;
  } else if (signCode === CODE_MINUS) {
    offsetSign = '-';
    idx += 1;
  } else if (signCode === CODE_UPPER_Z) {
    offsetSign = 'Z';
    idx += 1;
  }

  const offsetHours = orDefault(readDigits(2), '00');
  if (idx < dateStr.length && dateStr.charCodeAt(idx) === CODE_QUOTE) idx += 1;
  const offsetMins = orDefault(readDigits(2), '00');
  if (idx < dateStr.length && dateStr.charCodeAt(idx) === CODE_QUOTE) idx += 1;

  // The original regular expression was anchored at both ends, so any leftover
  // input means the string is not a valid PDF date.
  if (idx !== dateStr.length) return undefined;

  // http://www.ecma-international.org/ecma-262/5.1/#sec-15.9.1.15
  const tzOffset =
    offsetSign === 'Z' ? 'Z' : `${offsetSign}${offsetHours}:${offsetMins}`;

  return new Date(
    `${year}-${month}-${day}T${hours}:${mins}:${secs}${tzOffset}`,
  );
};

export const findLastMatch = (value: string, regex: RegExp) => {
  let position = 0;
  let lastMatch: RegExpMatchArray | undefined;
  while (position < value.length) {
    const match = value.substring(position).match(regex);
    if (!match) return { match: lastMatch, pos: position };
    lastMatch = match;
    position += (match.index ?? 0) + match[0].length;
  }
  return { match: lastMatch, pos: position };
};
