import { compileSource, expectBehavior } from '../helpers.js';

// A destructure names no more positional slots than the value has. Where the
// callee's returns are known it's a compile error; otherwise the destructure fails
// at runtime, never binding a silent null.
describe('too many positional names — compile errors', () => {
  it('more names than the callee returns', () => {
    expect(() => compileSource(`
      two = () { return 1, 2, extra: 3 }
      @go = {
        a, b, c = two()
        return result: c
      }
    `)).toThrow("'two()' returns 2 positional values; this destructure names 3");
  });
});

describe('positional names — runtime', () => {
  const script = `
    two = () { return 1, 2, extra: 3 }
    exact = (g Function) {
      a, b = g()
      return b
    }
    beyond = (g Function) {
      a, b, c = g()
      return c
    }
    @known = {
      a, b = two()
      return result: b
    }
    @mixed = {
      a, b, :extra = two()
      return result: extra
    }
    @exact = {
      x = exact(&two)
      return result: x
    }
    @beyond = {
      x = beyond(&two)
      return result: x
    }
  `;

  it('the count the value has, and named keys besides', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'known', from: 'c' } },
      { output: { id: '1', re: [{ result: 2 }], to: 'c' } },
      { input: { id: '2', op: 'mixed', from: 'c' } },
      { output: { id: '2', re: [{ result: 3 }], to: 'c' } },
      { input: { id: '3', op: 'exact', from: 'c' } },
      { output: { id: '3', re: [{ result: 2 }], to: 'c' } },
    );
  });

  it('more names than the value has, where the shape is not known: an error', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'beyond', from: 'c' } },
      { output: { id: '1', ex: { beyond: 'error' }, to: 'c' } },
    );
  });
});
