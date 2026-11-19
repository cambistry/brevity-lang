import { compileSource } from '../helpers.js';

// What doesn't lex or parse is reported where it fails: a character the lexer
// has no token for, a token the file level can't start anything with, a `.` a
// named function's body can't hold.

describe('unexpected input', () => {
  it('a character with no token', () => {
    expect(() => compileSource('@f = -> $x\n')).toThrow("Unexpected character '$' (line 1)");
  });

  it('a character with no token, on a later line', () => {
    expect(() => compileSource('@f = -> 1\n@g = -> 2 ` 3\n')).toThrow("Unexpected character '`' (line 2)");
  });

  it('a carriage return is whitespace', () => {
    expect(() => compileSource('@f = -> 1\r\n@g = -> 2\r\n')).not.toThrow();
  });

  it('a token nothing at the file level starts with', () => {
    expect(() => compileSource('**\n@get = -> 1\n')).toThrow("Unexpected token at top level: STARSTAR '**'");
  });

  it('a leading `=`', () => {
    expect(() => compileSource('=\n@get = -> 1\n')).toThrow("Unexpected token at top level: EQUALS ''");
  });

  it('two statements on one line', () => {
    expect(() => compileSource('@go = {\n  x = 1 y = 2\n  return x\n}\n')).toThrow("Expected a line break or ';' after a statement, got IDENT 'y'");
  });

  it('two statements on one line, at the file level', () => {
    expect(() => compileSource('x = 1 y = 2\n@go = -> 1\n')).toThrow("Expected a line break or ';' after a statement, got IDENT 'y'");
  });

  it('a statement after a one-line function, on its line', () => {
    expect(() => compileSource('@go = -> 1 2\n')).toThrow("Expected a line break or ';' after a statement, got NUMBER '2'");
  });

  it('a `;` separates statements on one line', () => {
    expect(() => compileSource('@go = {\n  x = 1; y = 2\n  return x + y\n}\n')).not.toThrow();
  });

  it('a trailing `.` in a named function body', () => {
    expect(() => compileSource('@go = (n Integer) {\n  x = n\n  .\n}\n')).toThrow("Unexpected '.'");
  });
});
