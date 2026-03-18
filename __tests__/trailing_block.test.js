import { expectReply } from './helpers.js';

describe('trailing block — proc call, single block', () => {
  it('single trailing block appended as positional callable arg', async () => {
    const source = `
      double
        =
        n : Integer
        f : (Integer) -> (Integer)
        =
        -> f(n) : Integer

      @go()
        result : Integer = double(5) |x : Integer| { x * 2 }
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'caller' },
    });
  });

  it('regular args + named arg + trailing block', async () => {
    const source = `
      test
        =
        x : Integer
        :label : Text
        c : (Integer) -> (Integer)
        =
        -> c(x) : Integer

      @go()
        result : Integer = test(3, label: "hi") |n : Integer| { n + 1 }
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 4 }, to: 'caller' },
    });
  });
});

describe('trailing block — function call', () => {
  it('inline trailing block on a local function', async () => {
    const source = `
      @go()
        apply = |n : Integer, f : (Integer) -> (Integer)| { r : Integer = f(n) }
        result : Integer = apply(7) |x : Integer| { x * 3 }
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 21 }, to: 'caller' },
    });
  });
});

describe('trailing block — multiple inline', () => {
  it('two trailing blocks appended in order', async () => {
    const source = `
      both
        =
        f : (Integer) -> (Integer)
        g : (Integer) -> (Integer)
        =
        -> f(g(1)) : Integer

      @go()
        result : Integer = both() |x : Integer| { x + 1 } |x : Integer| { x * 10 }
        -> :result
    `;
    // g(1) = 1*10 = 10, f(10) = 10+1 = 11
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'caller' },
    });
  });
});

describe('trailing block — open form (multi-line)', () => {
  it('two trailing blocks @subsequent lines', async () => {
    const source = `
      both
        =
        f : (Integer) -> (Integer)
        g : (Integer) -> (Integer)
        =
        -> f(g(2)) : Integer

      @go()
        result : Integer = both()
          |x : Integer| { x + 5 }
          |x : Integer| { x * 3 }
        -> :result
    `;
    // g(2) = 2*3 = 6, f(6) = 6+5 = 11
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'caller' },
    });
  });
});
