import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compileSource } from '../helpers.js';
import { tokenize } from '../../src/lexer.js';

// Every token is used: the parser accounts for each one (src/parser.js,
// checkTokensAccounted), and no parse helper's result is dropped (scanned below).

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const PARSER = readFileSync(join(SRC, 'parser.js'), 'utf8');

// A parse helper called as a statement, its result unused.
// These return nothing: they add what they parse to the array they're given,
// or to the file's state.
const VOID_HELPERS = new Set(['parseTypedAssign', 'consumeOverloadOp', 'parseUse', 'parseUseStatement',
  'parseUseShorthands', 'parseFileHeaderBody', 'parseFileHeaderEntries']);
const droppedResults = (source) => source.split('\n').flatMap((line, i) => {
  const m = line.match(/(?:^\s*|\belse\s+|\)\s+|\{\s*)((?:parse|consume)[A-Z]\w*)\([^;]*\);/);
  if (!m || VOID_HELPERS.has(m[1]) || /=\s*(parse|consume)[A-Z]|return\s|push\(|\(\s*(parse|consume)[A-Z]/.test(line)) return [];
  return [`${i + 1}: ${line.trim()}`];
});

// The parser with `edit` applied, as a module next to the real one.
let n = 0;
async function parserWith(from, to) {
  if (!PARSER.includes(from)) throw new Error(`not in src/parser.js: ${from}`);
  const at = PARSER.lastIndexOf(from);
  const file = join(SRC, `.parser_revert_${process.pid}_${n++}.js`);
  writeFileSync(file, PARSER.slice(0, at) + to + PARSER.slice(at + from.length));
  try {
    return (await import(file)).parse;
  } finally {
    unlinkSync(file);
  }
}

describe('every token is used', () => {
  it('no parse helper result is dropped', () => {
    expect(droppedResults(PARSER)).toEqual([]);
  });

  it('a token read and dropped at the file level is a parser bug', async () => {
    const parse = await parserWith(
      "      throw new Error(`Unexpected token at top level: ${peek().type} '${peek().value || ''}'`);",
      '      consume();');
    expect(() => parse(tokenize('**\n@get = () -> 1\n'))).toThrow("Parser bug: STARSTAR '**' (token 0, line 1) was read and dropped in the file");
  });

  it('a `} : Type` parsed and dropped is a parser bug', async () => {
    const parse = await parserWith(
      "      expect('RBRACE');\n      return AST.functionDecl('@' + op, params, body, { overloadMode });",
      "      expect('RBRACE');\n      if (peek().type === 'COLON') { consume(); parseType(); }\n      return AST.functionDecl('@' + op, params, body, { overloadMode });");
    expect(() => parse(tokenize('@f = (a Integer) { return a } : Integer\n'))).toThrow(/Parser bug: COLON \(token \d+, line 1\) was read and dropped in '@f'/);
  });

  it('a `} as Type` parsed and dropped is a dropped result', () => {
    const edited = PARSER.replace(
      "      expect('RBRACE');\n      return AST.functionDecl('@' + op, params, body, { overloadMode });",
      "      expect('RBRACE');\n      if (isTypeAttestation()) consumeTypeAttestation();\n      return AST.functionDecl('@' + op, params, body, { overloadMode });");
    expect(droppedResults(edited)).toEqual([expect.stringContaining('consumeTypeAttestation();')]);
  });
});

const box = (label) => `
  Box =
    *
      seed Integer
    *
    value *Integer = seed

    @get
      =
      return value: value

    .
  end#${label}

  @go = () -> 1
`;

describe('input the parser dropped is an error', () => {
  it('`} : Type` after a public function body', () => {
    expect(() => compileSource('@f = (a Integer) { return a } : Integer\n')).toThrow("Expected a line break or ';' after a statement, got COLON ''");
  });

  it('`} as Type` after a public function body', () => {
    expect(() => compileSource('@f = (a Integer) { return a } as Integer\n')).toThrow("Expected a line break or ';' after a statement, got KEYWORD 'as'");
  });

  it('`as Type` on an `if` condition', () => {
    expect(() => compileSource('@f = (b Boolean) {\n  x = if b as Boolean { 1 } else { 2 }\n  return x\n}\n')).toThrow("An 'if' condition ends at a ')' closing a group that opens it, at a '{', or at the end of the line: 'if (cond) value'");
  });

  it('a stray token in `Object(…)`', () => {
    expect(() => compileSource('@f = {\n  s Object = Object(1, +, 2)\n  return 1\n}\n')).toThrow("Unexpected token in an Object: PLUS '+'");
  });

  it('`end#Name` that names another class', () => {
    expect(() => compileSource(box('Bxo'))).toThrow("end#Bxo does not match 'Box'");
  });

  it('`end#Name` that names its class', () => {
    expect(() => compileSource(box('Box'))).not.toThrow();
  });

  it('a cell\'s `as Type` that conflicts with its type', () => {
    expect(() => compileSource('C = *{\n  k *Integer = 1 as Text\n  @get = () -> k\n}\n@go = () -> 1\n')).toThrow("Conflicting type declarations for 'k': 'Integer' vs 'Text'");
  });
});
