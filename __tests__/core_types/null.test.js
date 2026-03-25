import { expectReply } from '../helpers.js';

describe('null literal', () => {
  const script = `
      @nullVar
        =
        x : Integer | null = null
        -> result: x

      @nonNullVar
        =
        x : Integer | null = 42 as Integer
        -> result: x

      @nullDirect
        =
        -> result: null
  `;

  it('null assigned to Integer | null var → result is null', async () => {
    await expectReply({
      script,
      receive: { id: '1', op: '@nullVar', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer | null' }, re: { result: null }, to: 'c' },
    });
  });

  it('Integer | null var with non-null value → correct value and bv-a', async () => {
    await expectReply({
      script,
      receive: { id: '2', op: '@nonNullVar', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Integer | null' }, re: { result: 42 }, to: 'c' },
    });
  });

  it('null replied directly as key-value → field is null', async () => {
    await expectReply({
      script,
      receive: { id: '3', op: '@nullDirect', from: 'c' },
      reply: expect.objectContaining({ re: { result: null } }),
    });
  });
});
