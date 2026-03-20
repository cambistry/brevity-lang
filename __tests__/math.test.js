import { runActor } from './helpers.js';

describe('math', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @inc
        =
        :x : Integer
        =
        bigger : Integer = x + 1
        -> :bigger
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ x: 5 }, '@inc'], 'bv-a': [{ x: 'Integer' }], from: 'c' },
      ],
    });
  });

  it('integer math — bigger = x + 1', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { bigger: 'Integer' }, re: { bigger: 6 }, to: 'c' });
  });
});
