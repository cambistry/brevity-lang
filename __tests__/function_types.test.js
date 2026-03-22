import compile from '../index.js';
import { compileActor, expectActorReply } from './helpers.js';

describe('Function types', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
      @basic
        =
        fn : (Integer) -> (Boolean) = |x : Integer| { x > 0 } : Boolean
        result : Boolean = fn(5)
        -> result

      @namedArgs
        =
        fn : (msg: Text, flag: Boolean) -> (Text) = |:msg : Text, :flag : Boolean| { "result" } : Text
        result : Text = fn(msg: "hello", flag: true)
        -> result

      @namedOutput
        =
        fn : () -> (output: Text) = { ->(output: "result") } : (output: Text)
        :output : Text = fn()
        -> output : Text

      @mixedArgs
        =
        fn : (Text, find: Text, replace: Text) -> (Text) = |s : Text, :find : Text, :replace : Text| { "replaced" } : Text
        result : Text = fn("hello world", find: "world", replace: "earth")
        -> result

      @structureField
        =
        s : Structure = Structure(fn: |x : Integer| { x * 2 } : Integer : (Integer) -> (Integer))
        :fn = s
        result : Integer = fn(10)
        -> result
    `);
  });

  it('basic function type parsing and assignment', async () => {
    await expectActorReply({
      compiled, receive: { id: '1', op: [{}, '@basic'], from: 'c' },
      reply: { id: '1', 'bv-a': ['Boolean'], re: [true], to: 'c' },
    });
  });

  it('function type with named arguments', async () => {
    await expectActorReply({
      compiled, receive: { id: '2', op: [{}, '@namedArgs'], from: 'c' },
      reply: { id: '2', 'bv-a': ['Text'], re: ['result'], to: 'c' },
    });
  });

  it('function type with named output', async () => {
    await expectActorReply({
      compiled, receive: { id: '3', op: [{}, '@namedOutput'], from: 'c' },
      reply: { id: '3', 'bv-a': ['Text'], re: ['result'], to: 'c' },
    });
  });

  it('mixed positional and named function type', async () => {
    await expectActorReply({
      compiled, receive: { id: '4', op: [{}, '@mixedArgs'], from: 'c' },
      reply: { id: '4', 'bv-a': ['Text'], re: ['replaced'], to: 'c' },
    });
  });

  it('function type in structure field', async () => {
    await expectActorReply({
      compiled, receive: { id: '5', op: [{}, '@structureField'], from: 'c' },
      reply: { id: '5', 'bv-a': ['Integer'], re: [20], to: 'c' },
    });
  });
});

describe('Function types — compile errors', () => {
  it('type mismatch error for incompatible function signatures', () => {
    const source = `
      @test
        =
        f = |x : Text| { 100 } : Integer
        f2 : () -> (Integer) = f
        -> f2()
    `;
    expect(() => compile(source)).toThrow(/function signature mismatch/i);
  });
});
