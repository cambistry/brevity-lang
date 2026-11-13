import { expectBehavior } from '../helpers.js';

describe('trailing block', () => {
  const script = `
    --- helpers ---

    double
      =
      n Integer
      f (Integer) -> (Integer)
      =
      -> f(n)

    test
      =
      x Integer
      label: Text
      c (Integer) -> (Integer)
      =
      -> c(x)

    both
      =
      f (Integer) -> (Integer)
      g (Integer) -> (Integer)
      =
      -> f(g(1))

    both2
      =
      f (Integer) -> (Integer)
      g (Integer) -> (Integer)
      =
      -> f(g(2))

    --- public functions ---

    @singleBlock
      =
      result Integer = double(5) (x Integer) { x * 2 }
      return :result

    @argsAndBlock
      =
      result Integer = test(3, label: "hi") (n Integer) { n + 1 }
      return :result

    @inlineLocal
      =
      apply = (n Integer, f (Integer) -> (Integer)) { r Integer = f(n) }
      result Integer = apply(7) (x Integer) { x * 3 }
      return :result

    @twoInline
      =
      result Integer = both() (x Integer) { x + 1 } (x Integer) { x * 10 }
      return :result

    @twoMultiLine
      =
      result Integer = both2()
        (x Integer) { x + 5 }
        (x Integer) { x * 3 }
      return :result

    --- lineal trailing blocks ---

    @spaciousSingle
      =
      result Integer = double(5)
        =
        x Integer
        =
        -> x * 2
      return :result

    @spaciousArgs
      =
      result Integer = test(3, label: "hi")
        =
        n Integer
        =
        -> n + 1
      return :result

    @spaciousTwo
      =
      result Integer = both2()
        =
        x Integer
        =
        -> x + 5
        =
        x Integer
        =
        -> x * 3
      return :result
  `;

  it('single trailing block appended as positional function arg', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'singleBlock', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('regular args + named arg + trailing block', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'argsAndBlock', from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Integer' }, re: { result: 4 }, to: 'c' } },
    );
  });

  it('inline trailing block on a local function', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'inlineLocal', from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 21 }, to: 'c' } },
    );
  });

  it('two trailing blocks appended in order', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'twoInline', from: 'c' } },
      { output: { id: '4', 'ty': { result: 'Integer' }, re: { result: 11 }, to: 'c' } },
    );
  });

  it('two trailing blocks on subsequent lines', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: 'twoMultiLine', from: 'c' } },
      { output: { id: '5', 'ty': { result: 'Integer' }, re: { result: 11 }, to: 'c' } },
    );
  });

  it('lineal trailing block — single', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: 'spaciousSingle', from: 'c' } },
      { output: { id: '6', 'ty': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('lineal trailing block — with regular args', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: 'spaciousArgs', from: 'c' } },
      { output: { id: '7', 'ty': { result: 'Integer' }, re: { result: 4 }, to: 'c' } },
    );
  });

  it('lineal trailing block — two blocks', async () => {
    await expectBehavior(script,
      { input: { id: '8', op: 'spaciousTwo', from: 'c' } },
      { output: { id: '8', 'ty': { result: 'Integer' }, re: { result: 11 }, to: 'c' } },
    );
  });
});
