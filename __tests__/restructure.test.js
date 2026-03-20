import { runActor } from './helpers.js';

describe('restructure', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @echo2
        =
        :x : Integer
        =
        a : Integer = x
        ->(:a)
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ x: 42 }, '@echo2'], 'bv-a': [{ x: 'Integer' }], from: 'c' },
      ],
    });
  });

  it('local var assignment and restructure — a = x, ->(:a)', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { a: 'Integer' }, re: { a: 42 }, to: 'c' });
  });
});
