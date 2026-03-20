import { runActor } from './helpers.js';

describe('intercom', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      use Remote

      @test
        =
        :msg : Text
        =
        -> :msg
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ msg: 'hello' }, '@test'], from: 'c', 'bv-a': [{ msg: 'Text' }] },
      ],
    });
  });

  it('parses use declaration', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { msg: 'Text' }, re: { msg: 'hello' }, to: 'c' });
  });
});
