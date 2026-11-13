import { expectBehavior } from '../helpers.js';

describe('restructure', () => {
  const script = `
    @echo2
      =
      x: Integer
      =
      a Integer = x
      return (:a)
  `;

  it('local var assignment and restructure — a = x, ->(:a)', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ x: 42 }, 'echo2'], 'ty': [{ x: 'Integer' }], from: 'c' } },
      { output: { id: '1', 'ty': { a: 'Integer' }, re: { a: 42 }, to: 'c' } },
    );
  });
});
