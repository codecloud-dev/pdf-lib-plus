import {
  CombedTextLayoutError,
  EncryptedPDFError,
  ExceededMaxLengthError,
  FieldAlreadyExistsError,
  FieldExistsAsNonTerminalError,
  FontkitNotRegisteredError,
  ForeignPageError,
  InvalidFieldNamePartError,
  InvalidMaxLengthError,
  MissingOnValueCheckError,
  NoSuchFieldError,
  RemovePageFromEmptyDocumentError,
  RichTextFieldReadError,
  UnexpectedFieldTypeError,
} from 'src/api/errors';

// TypeScript's ES5 downlevel of `class X extends Error` calls the built-in
// `Error` constructor, which returns a fresh object whose prototype is
// `Error.prototype`. The subclass prototype is lost, so `instanceof X` is
// always false unless the constructor repairs it. The library targets ES5, so
// this is a real runtime failure, not a theoretical one (upstream PR #1439).
describe(`custom Error subclasses`, () => {
  const cases: [string, Error, new (...args: any[]) => Error][] = [
    ['EncryptedPDFError', new EncryptedPDFError(), EncryptedPDFError],
    [
      'FontkitNotRegisteredError',
      new FontkitNotRegisteredError(),
      FontkitNotRegisteredError,
    ],
    ['ForeignPageError', new ForeignPageError(), ForeignPageError],
    [
      'RemovePageFromEmptyDocumentError',
      new RemovePageFromEmptyDocumentError(),
      RemovePageFromEmptyDocumentError,
    ],
    ['NoSuchFieldError', new NoSuchFieldError('foo'), NoSuchFieldError],
    [
      'UnexpectedFieldTypeError',
      new UnexpectedFieldTypeError('foo', String, 1),
      UnexpectedFieldTypeError,
    ],
    [
      'MissingOnValueCheckError',
      new MissingOnValueCheckError('foo'),
      MissingOnValueCheckError,
    ],
    [
      'FieldAlreadyExistsError',
      new FieldAlreadyExistsError('foo'),
      FieldAlreadyExistsError,
    ],
    [
      'InvalidFieldNamePartError',
      new InvalidFieldNamePartError('foo'),
      InvalidFieldNamePartError,
    ],
    [
      'FieldExistsAsNonTerminalError',
      new FieldExistsAsNonTerminalError('foo'),
      FieldExistsAsNonTerminalError,
    ],
    [
      'RichTextFieldReadError',
      new RichTextFieldReadError('foo'),
      RichTextFieldReadError,
    ],
    [
      'CombedTextLayoutError',
      new CombedTextLayoutError(10, 2),
      CombedTextLayoutError,
    ],
    [
      'ExceededMaxLengthError',
      new ExceededMaxLengthError(10, 2, 'foo'),
      ExceededMaxLengthError,
    ],
    [
      'InvalidMaxLengthError',
      new InvalidMaxLengthError(10, 2, 'foo'),
      InvalidMaxLengthError,
    ],
  ];

  for (const [name, error, ctor] of cases) {
    it(`\`${name}\` is instanceof its own class and of \`Error\``, () => {
      expect(error).toBeInstanceOf(ctor);
      expect(error).toBeInstanceOf(Error);
      expect(error.message.length).toBeGreaterThan(0);
    });
  }
});
