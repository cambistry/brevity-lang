import compile from '../index.js';
import { expectReply } from './helpers.js';

describe('Callable types', () => {
  it('basic callable type parsing and assignment', async () => {
    const source = `
      on test()
        fn : (Integer) -> (Boolean) = |x : Integer| { x > 0 } : Boolean
        result : Boolean = fn(5)
        -> result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{}, 'test'], from: 'caller' },
      reply: { id: '1', 'bv-a': ['Boolean'], re: [true], to: 'caller' },
    });
  });

  it('callable type with named arguments', async () => {
    const source = `
      on test()
        fn : (msg: Text, flag: Boolean) -> (Text) = |:msg : Text, :flag : Boolean| { "result" } : Text
        result : Text = fn(msg: "hello", flag: true)
        -> result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{}, 'test'], from: 'caller' },
      reply: { id: '1', 'bv-a': ['Text'], re: ["result"], to: 'caller' },
    });
  });

  it('callable type with named output', async () => {
    const source = `
      on test()
        fn : () -> (output: Text) = { return(output: "result") } : (output: Text)
        :output : Text = fn()
        -> output : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{}, 'test'], from: 'caller' },
      reply: { id: '1', 'bv-a': ['Text'], re: ['result'], to: 'caller' },
    });
  });

  it('mixed positional and named callable type', async () => {
    const source = `
      on test()
        fn : (Text, find: Text, replace: Text) -> (Text) = |s : Text, :find : Text, :replace : Text| { "replaced" } : Text
        result : Text = fn("hello world", find: "world", replace: "earth")
        -> result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{}, 'test'], from: 'caller' },
      reply: { id: '1', 'bv-a': ['Text'], re: ["replaced"], to: 'caller' },
    });
  });

  it('type mismatch error for incompatible callable signatures', () => {
    const source = `
      on test()
        f = |x : Text| { 100 } : Integer
        f2 : () -> (Integer) = f
        -> f2()
    `;
    expect(() => compile(source)).toThrow(/callable signature mismatch/i);
  });

  it('callable type in structure field', async () => {
    const source = `
      on test()
        s : Structure = Structure(fn: |x : Integer| { x * 2 } : Integer : (Integer) -> (Integer))
        :fn = s
        result : Integer = fn(10)
        -> result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{}, 'test'], from: 'caller' },
      reply: { id: '1', 'bv-a': ['Integer'], re: [20], to: 'caller' },
    });
  });
});
