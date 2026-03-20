import { runActor } from './helpers.js';

describe('assignment', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @typedAssign
        =
        result : Integer = if true {
          x : Integer = 42
        } else {
          0 as Integer
        }
        -> :result

      @untypedAssign
        =
        result : Integer = if true {
          x : Integer
          x = 42 as Integer
        } else {
          0 as Integer
        }
        -> :result
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@typedAssign', from: 'c' },
        { id: '2', op: '@untypedAssign', from: 'c' },
      ],
    });
  });

  it.todo('plain local var used in expression before reply');

  it('typed assign as last block statement evaluates to assigned value', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' });
  });

  it('untyped assign as last block statement evaluates to assigned value', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' });
  });
});
