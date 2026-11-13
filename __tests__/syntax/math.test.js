import { expectBehavior } from '../helpers.js';

describe('math', () => {
  const script = `
    @inc
      =
      x: Integer
      =
      bigger Integer = x + 1
      return :bigger
  `;

  it('integer math — bigger = x + 1', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ x: 5 }, 'inc'], 'ty': [{ x: 'Integer' }], from: 'c' } },
      { output: { id: '1', 'ty': { bigger: 'Integer' }, re: { bigger: 6 }, to: 'c' } },
    );
  });
});
