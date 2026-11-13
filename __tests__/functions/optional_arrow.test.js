import { compileSource, expectBehavior } from '../helpers.js';
import { extract } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Optional `->` before a delimited body. In any delimited function or class
// definition, `(params) -> { body }` is the same as `(params) { body }` (and
// `-> { body }` the same as `{ body }`); for classes, `(params) -> *{ body }`
// is the same as `(params) *{ body }`.
// ═══════════════════════════════════════════════════════════════════════════════

const ast = (src) => JSON.stringify(extract(src).ast);

describe('optional arrow — same AST as the arrowless form', () => {
  it('private function with params', () => {
    expect(ast('f = (a Integer) -> { a + 1 }\n')).toBe(ast('f = (a Integer) { a + 1 }\n'));
  });

  it('private function without params', () => {
    expect(ast('f = -> { 5 }\n')).toBe(ast('f = { 5 }\n'));
  });

  it('explicitly private (#) function', () => {
    expect(ast('#f = (a Integer) -> { a * 2 }\n')).toBe(ast('#f = (a Integer) { a * 2 }\n'));
  });

  it('public handler with params', () => {
    expect(ast('@g = (a: Integer) -> { return a + 1 }\n')).toBe(ast('@g = (a: Integer) { return a + 1 }\n'));
  });

  it('public handler without params', () => {
    expect(ast('@g = -> { return 1 }\n')).toBe(ast('@g = { return 1 }\n'));
  });

  it('set handler', () => {
    expect(ast('v *Integer = 0\nset = (n Integer) -> { v <- n }\n'))
      .toBe(ast('v *Integer = 0\nset = (n Integer) { v <- n }\n'));
  });

  it('class with params', () => {
    expect(ast('C = (a Integer) -> *{ @get = -> a }\n')).toBe(ast('C = (a Integer) *{ @get = -> a }\n'));
  });

  it('class without params', () => {
    expect(ast('C = -> *{ @get = -> 1 }\n')).toBe(ast('C = *{ @get = -> 1 }\n'));
  });

  it('public class', () => {
    expect(ast('@C = (a Integer) -> *{ @get = -> a }\n')).toBe(ast('@C = (a Integer) *{ @get = -> a }\n'));
  });
});

describe('optional arrow — compiles and runs', () => {
  it('local function with arrow-brace body is callable', async () => {
    await expectBehavior(`
      @test
        =
        fn = (a) -> { a + 1 }
        result Integer = fn(5)
        return :result
    `,
      { input: { id: '1', op: 'test', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });

  it('public handler with arrow-brace body replies', async () => {
    await expectBehavior(`
      @add = (a: Integer, b: Integer) -> { return sum: a + b }
    `,
      { input: { id: '1', op: [{ a: 3, b: 4 }, 'add'], 'ty': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '1', 'ty': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' } },
    );
  });

  it('class with arrow-brace body constructs', async () => {
    await expectBehavior(`
      Box = (value Integer) -> *{
        @get = -> result: value
      }
      @test = { b = Box(7); :result = b.get(); return :result as Integer }
    `,
      { input: { id: '1', op: 'test', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('lambda arrow-brace body still works', () => {
    expect(() => compileSource(`
      @test = { f = (x) -> { x + 1 }; :result Integer = f(1); return :result }
    `)).not.toThrow();
  });
});
