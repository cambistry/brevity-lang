import { runActor } from './helpers.js';

describe('null literal', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @nullVar
        =
        x : Integer | null = null
        -> result: x

      @nonNullVar
        =
        x : Integer | null = 42 : Integer
        -> result: x

      @nullDirect
        =
        -> result: null
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'nullVar', from: 'c' },
        { id: '2', op: 'nonNullVar', from: 'c' },
        { id: '3', op: 'nullDirect', from: 'c' },
      ],
    });
  });

  it('null assigned to Integer | null var → result is null', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer | null' }, re: { result: null }, to: 'c' });
  });

  it('Integer | null var with non-null value → correct value and bv-a', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer | null' }, re: { result: 42 }, to: 'c' });
  });

  it('null replied directly as key-value → field is null', () => {
    expect(outputs[2]).toEqual(expect.objectContaining({ re: { result: null } }));
  });
});
