import { expectReply } from './helpers.js';

describe('null literal', () => {
  it('null assigned to Integer | null var → reply is null at runtime', async () => {
    const source = `
      on test()
        x : Integer | null = null
        reply result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer | null' },
        re: { result: null },
        to: 'caller',
      },
    });
  });

  it('Integer | null var with non-null value → runtime value correct, bv-a emits type string', async () => {
    const source = `
      on test()
        x : Integer | null = 42 : Integer
        reply result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer | null' },
        re: { result: 42 },
        to: 'caller',
      },
    });
  });

  it('null replied directly as key-value → reply field is null', async () => {
    const source = `
      on test()
        reply result: null
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({
        re: { result: null },
      }),
    });
  });
});
