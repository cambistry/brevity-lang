import { expectBehavior, compileSource } from '../helpers.js';

describe('Function types', () => {
  const script = `
    @basic
      =
      fn (Integer) -> (Boolean) = (x Integer) { x > 0 }
      result Boolean = fn(5)
      return result

    @namedArgs
      =
      fn (msg: Text, flag: Boolean) -> (Text) = (msg: Text, flag: Boolean) { "result" }
      result Text = fn(msg: "hello", flag: true)
      return result

    @namedOutput
      =
      fn () -> (output: Text) = { return (output: "result") }
      :output Text = fn()
      return output
    @mixedArgs
      =
      fn (Text, find: Text, replace: Text) -> (Text) = (s Text, find: Text, replace: Text) { "replaced" }
      result Text = fn("hello world", find: "world", replace: "earth")
      return result

    @structureField
      =
      s Object = Object(fn: (x Integer) { x * 2 })
      :fn = s
      result Integer = fn(10)
      return result
  `;

  it('basic function type parsing and assignment', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@basic', from: 'c' } },
      { output: { id: '1', 'ty': ['Boolean'], re: [true], to: 'c' } },
    );
  });

  it('function type with named arguments', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@namedArgs', from: 'c' } },
      { output: { id: '2', 'ty': ['Text'], re: ['result'], to: 'c' } },
    );
  });

  it('function type with named output', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@namedOutput', from: 'c' } },
      { output: { id: '3', 'ty': ['Text'], re: ['result'], to: 'c' } },
    );
  });

  it('mixed positional and named function type', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@mixedArgs', from: 'c' } },
      { output: { id: '4', 'ty': ['Text'], re: ['replaced'], to: 'c' } },
    );
  });

  it('function type in object field', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@structureField', from: 'c' } },
      { output: { id: '5', 'ty': ['Integer'], re: [20], to: 'c' } },
    );
  });
});

describe('Function types — compile errors', () => {
  it('type mismatch error for incompatible function signatures', () => {
    const source = `
      @test
        =
        f = (x Text) { 100 }
        f2 () -> (Integer) = f
        return f2()
    `;
    expect(() => compileSource(source)).toThrow(/function signature mismatch/i);
  });
});
