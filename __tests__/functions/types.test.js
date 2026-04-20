import { expectBehavior, compileSource } from '../helpers.js';

describe('Function types', () => {
  const script = `
    @basic
      =
      fn (Integer) -> (Boolean) = |x Integer| { x > 0 } as Boolean
      result Boolean = fn(5)
      -> result

    @namedArgs
      =
      fn (msg: Text, flag: Boolean) -> (Text) = |:msg Text, :flag Boolean| { "result" } as Text
      result Text = fn(msg: "hello", flag: true)
      -> result

    @namedOutput
      =
      fn () -> (output: Text) = { ->(output: "result") } as (output: Text)
      :output Text = fn()
      -> output
    @mixedArgs
      =
      fn (Text, find: Text, replace: Text) -> (Text) = |s Text, :find Text, :replace Text| { "replaced" } as Text
      result Text = fn("hello world", find: "world", replace: "earth")
      -> result

    @structureField
      =
      s Structure = Structure(fn: |x Integer| { x * 2 } as Integer as (Integer) -> (Integer))
      :fn = s
      result Integer = fn(10)
      -> result
  `;

  it('basic function type parsing and assignment', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@basic', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Boolean'], re: [true], to: 'c' } },
    );
  });

  it('function type with named arguments', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@namedArgs', from: 'c' } },
      { output: { id: '2', 'bv-a': ['Text'], re: ['result'], to: 'c' } },
    );
  });

  it('function type with named output', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@namedOutput', from: 'c' } },
      { output: { id: '3', 'bv-a': ['Text'], re: ['result'], to: 'c' } },
    );
  });

  it('mixed positional and named function type', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@mixedArgs', from: 'c' } },
      { output: { id: '4', 'bv-a': ['Text'], re: ['replaced'], to: 'c' } },
    );
  });

  it('function type in structure field', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@structureField', from: 'c' } },
      { output: { id: '5', 'bv-a': ['Integer'], re: [20], to: 'c' } },
    );
  });
});

describe('Function types — compile errors', () => {
  it('type mismatch error for incompatible function signatures', () => {
    const source = `
      @test
        =
        f = |x Text| { 100 } as Integer
        f2 () -> (Integer) = f
        -> f2()
    `;
    expect(() => compileSource(source)).toThrow(/function signature mismatch/i);
  });
});
