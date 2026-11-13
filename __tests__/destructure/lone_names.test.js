import { compileSource, expectBehavior } from '../helpers.js';
import { tokenize } from '../../src/lexer.js';
import { parse } from '../../src/parser.js';

// ═══════════════════════════════════════════════════════════════════════════════
// A type name in scope is reserved, so a lone name after a destructure key's
// colon (`key: X = f()`) is the type X when one is in scope, and otherwise the
// local the field binds to. Capitalization plays no part.
// ═══════════════════════════════════════════════════════════════════════════════

const patternOf = (source) => {
  const ast = parse(tokenize(source));
  const go = ast.actors[0].functions.find(f => f.name === '@go');
  return go.body.find(s => s.type === 'DestructureAssign').pattern;
};

describe('destructure — key: X resolves by scope', () => {
  const f = 'f = (n Integer) { return value: n }\n';

  it('a name with no type in scope is the local', () => {
    expect(patternOf(`${f}@go = { value: v = f(7); return result: v }\n`))
      .toEqual([{ key: 'value', name: 'v', type: null }]);
  });

  it('a type in scope is the field type', () => {
    expect(patternOf(`${f}@go = { value: Integer = f(7); return :value }\n`))
      .toEqual([{ named: true, name: 'value', type: 'Integer' }]);
  });

  it('a capitalized name with no type in scope is a local', () => {
    expect(patternOf(`${f}@go = { value: Total = f(7); return result: Total }\n`))
      .toEqual([{ key: 'value', name: 'Total', type: null }]);
  });

  it('a lowercase type in scope is the field type', () => {
    expect(patternOf(`type pt (x Integer)\ng = (n Integer) { return value: pt(n) }\n@go = { value: pt = g(7); return :value }\n`))
      .toEqual([{ named: true, name: 'value', type: 'pt' }]);
  });

  it('a class declared later in the file is in scope', () => {
    expect(patternOf(`g = (n Integer) { return value: Box(n) }\n@go = { value: Box = g(7); return :value }\nBox = (v Integer) *{ @get = -> r: v }\n`))
      .toEqual([{ named: true, name: 'value', type: 'Box' }]);
  });

  it('a local may not take the name of a type in scope', () => {
    expect(() => compileSource(`type Pt (x Integer)\n${f}@go = { value: Pt Integer = f(7); return result: Pt }\n`))
      .toThrow(/type name is reserved/);
  });

  it('key: v binds the local at runtime', async () => {
    await expectBehavior(`${f}@go = { value: v Integer = f(7); return result: v }\n`,
      { input: { id: '1', op: [{}, 'go'], from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });
});

describe('public constant — @x = Name(…) needs a type in scope', () => {
  it('a lowercase type constructs a constant', () => {
    expect(() => compileSource('type pt (x Integer)\n@origin = pt(0)\n')).not.toThrow();
  });

  it('a function call is not a constant', () => {
    expect(() => compileSource('f = (n Integer) { n + 1 }\n@x = f(1)\n'))
      .toThrow(/'@x' is public — only functions can be public/);
  });
});
