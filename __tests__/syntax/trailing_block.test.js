import { expectReply } from '../helpers.js';

describe('trailing block', () => {
  const script = `
    --- helpers ---

    double
      =
      n : Integer
      f : (Integer) -> (Integer)
      =
      -> f(n) : Integer

    test
      =
      x : Integer
      :label : Text
      c : (Integer) -> (Integer)
      =
      -> c(x) : Integer

    both
      =
      f : (Integer) -> (Integer)
      g : (Integer) -> (Integer)
      =
      -> f(g(1)) : Integer

    both2
      =
      f : (Integer) -> (Integer)
      g : (Integer) -> (Integer)
      =
      -> f(g(2)) : Integer

    --- public functions ---

    @singleBlock
      =
      result : Integer = double(5) |x : Integer| { x * 2 }
      -> :result

    @argsAndBlock
      =
      result : Integer = test(3, label: "hi") |n : Integer| { n + 1 }
      -> :result

    @inlineLocal
      =
      apply = |n : Integer, f : (Integer) -> (Integer)| { r : Integer = f(n) }
      result : Integer = apply(7) |x : Integer| { x * 3 }
      -> :result

    @twoInline
      =
      result : Integer = both() |x : Integer| { x + 1 } |x : Integer| { x * 10 }
      -> :result

    @twoMultiLine
      =
      result : Integer = both2()
        |x : Integer| { x + 5 }
        |x : Integer| { x * 3 }
      -> :result

    --- lineal trailing blocks ---

    @spaciousSingle
      =
      result : Integer = double(5)
        =
        x : Integer
        =
        -> x * 2 : Integer
      -> :result

    @spaciousArgs
      =
      result : Integer = test(3, label: "hi")
        =
        n : Integer
        =
        -> (n + 1) as Integer
      -> :result

    @spaciousTwo
      =
      result : Integer = both2()
        =
        x : Integer
        =
        -> x + 5 : Integer
        =
        x : Integer
        =
        -> x * 3 : Integer
      -> :result
  `;

  it('single trailing block appended as positional function arg', async () => {
    await expectReply({
      script, receive: { id: '1', op: '@singleBlock', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' },
    });
  });

  it('regular args + named arg + trailing block', async () => {
    await expectReply({
      script, receive: { id: '2', op: '@argsAndBlock', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 4 }, to: 'c' },
    });
  });

  it('inline trailing block on a local function', async () => {
    await expectReply({
      script, receive: { id: '3', op: '@inlineLocal', from: 'c' },
      reply: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 21 }, to: 'c' },
    });
  });

  it('two trailing blocks appended in order', async () => {
    await expectReply({
      script, receive: { id: '4', op: '@twoInline', from: 'c' },
      reply: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' },
    });
  });

  it('two trailing blocks on subsequent lines', async () => {
    await expectReply({
      script, receive: { id: '5', op: '@twoMultiLine', from: 'c' },
      reply: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' },
    });
  });

  it('lineal trailing block — single', async () => {
    await expectReply({
      script, receive: { id: '6', op: '@spaciousSingle', from: 'c' },
      reply: { id: '6', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' },
    });
  });

  it('lineal trailing block — with regular args', async () => {
    await expectReply({
      script, receive: { id: '7', op: '@spaciousArgs', from: 'c' },
      reply: { id: '7', 'bv-a': { result: 'Integer' }, re: { result: 4 }, to: 'c' },
    });
  });

  it('lineal trailing block — two blocks', async () => {
    await expectReply({
      script, receive: { id: '8', op: '@spaciousTwo', from: 'c' },
      reply: { id: '8', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' },
    });
  });
});
