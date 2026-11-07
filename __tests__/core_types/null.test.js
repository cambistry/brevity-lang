import { expectBehavior } from '../helpers.js';

describe('null literal', () => {
  const script = `
      @nullVar
        =
        x Integer | null = null
        return result: x

      @nonNullVar
        =
        x Integer | null = 42
        return result: x

      @nullDirect
        =
        -> result: null
  `;

  it('null assigned to Integer | null var → result is null', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@nullVar', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'null' }, re: { result: null }, to: 'c' } },
    );
  });

  it('Integer | null var with non-null value → correct value and ty', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@nonNullVar', from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('null replied directly as key-value → field is null', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@nullDirect', from: 'c' } },
      { output: expect.objectContaining({ re: { result: null } }) },
    );
  });
});
