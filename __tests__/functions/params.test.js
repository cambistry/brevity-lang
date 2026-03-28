import { expectReply } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Private function (lambda) param forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('function params — all forms', () => {
  const script = `
    --- named via sigil ---

    @namedSigil
      =
      fn = |:name| { name }
      result Integer = fn(name: 42)
      -> :result

    @namedTyped
      =
      fn = |n: Integer| { n * 2 }
      result Integer = fn(n: 5)
      -> :result

    --- key-mapped ---

    @keyMapped
      =
      fn = |label: (x)| { x + 1 }
      result Integer = fn(label: 9)
      -> :result

    @keyMappedTwo
      =
      fn = |first: (a), last: (b)| { a + b }
      result Integer = fn(first: 3, last: 4)
      -> :result

    @keyMappedTyped
      =
      fn = |label: (x) Integer| { x + 1 }
      result Integer = fn(label: 9)
      -> :result

    --- mixed positional + named ---

    @mixedPosNamed
      =
      fn = |a, :b| { a + b }
      result Integer = fn(3, b: 4)
      -> :result

    @twoNamed
      =
      fn = |:a, :b| { a + b }
      result Integer = fn(a: 10, b: 20)
      -> :result

    --- positional ---

    @twoPosUntyped
      =
      fn = |a, b| { a + b }
      result Integer = fn(3, 4)
      -> :result

    @twoPosTyped
      =
      fn = |a Integer, b Integer| { a + b }
      result Integer = fn(3, 4)
      -> :result

    --- no params ---

    @noParam
      =
      fn = { 42 }
      result Integer = fn()
      -> :result
  `;

  it('|:name| binds named field', async () => {
    await expectReply({
      script, receive: { id: '1', op: '@namedSigil', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' },
    });
  });

  it('|n: Integer| typed sigil', async () => {
    await expectReply({
      script, receive: { id: '2', op: '@namedTyped', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' },
    });
  });

  it('|label: x| binds key to local name', async () => {
    await expectReply({
      script, receive: { id: '3', op: '@keyMapped', from: 'c' },
      reply: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' },
    });
  });

  it('|first: a, last: b| two key-mapped params', async () => {
    await expectReply({
      script, receive: { id: '4', op: '@keyMappedTwo', from: 'c' },
      reply: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' },
    });
  });

  it('|label: (x) Integer| key-mapped with type', async () => {
    await expectReply({
      script, receive: { id: '5', op: '@keyMappedTyped', from: 'c' },
      reply: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' },
    });
  });

  it('|a, :b| positional + named', async () => {
    await expectReply({
      script, receive: { id: '6', op: '@mixedPosNamed', from: 'c' },
      reply: { id: '6', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' },
    });
  });

  it('|:a, :b| two named-only params', async () => {
    await expectReply({
      script, receive: { id: '7', op: '@twoNamed', from: 'c' },
      reply: { id: '7', 'bv-a': { result: 'Integer' }, re: { result: 30 }, to: 'c' },
    });
  });

  it('|a, b| untyped positional', async () => {
    await expectReply({
      script, receive: { id: '8', op: '@twoPosUntyped', from: 'c' },
      reply: { id: '8', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' },
    });
  });

  it('|a Integer, b Integer| typed positional', async () => {
    await expectReply({
      script, receive: { id: '9', op: '@twoPosTyped', from: 'c' },
      reply: { id: '9', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' },
    });
  });

  it('no params — bare braces { 42 }', async () => {
    await expectReply({
      script, receive: { id: '10', op: '@noParam', from: 'c' },
      reply: { id: '10', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' },
    });
  });
});
