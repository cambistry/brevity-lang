import { expectReply } from '../helpers.js';

describe('test.get — read state vars', () => {
  const script = `
    ref x Integer = 42
    ref name Text = "hello"
    ref flag Boolean = true
    @noop = -> x as Integer
  `;

  it('reads integer state var with type', async () => {
    await expectReply({
      script, receive: { id: '1', test: { get: 'x' }, from: 't' },
      reply: { id: '1', 'bv-a': 'Integer', re: 42, to: 't' },
    });
  });

  it('reads text state var with type', async () => {
    await expectReply({
      script, receive: { id: '2', test: { get: 'name' }, from: 't' },
      reply: { id: '2', 'bv-a': 'Text', re: 'hello', to: 't' },
    });
  });

  it('reads boolean state var with type', async () => {
    await expectReply({
      script, receive: { id: '3', test: { get: 'flag' }, from: 't' },
      reply: { id: '3', 'bv-a': 'Boolean', re: true, to: 't' },
    });
  });
});

describe('test.get — after mutation', () => {
  const script = `
    ref x Integer = 0
    @inc = { x <- x + 1; -> :x }
    @noop = -> x as Integer
  `;

  it('reads initial value', async () => {
    await expectReply({
      script, receive: { id: '1', test: { get: 'x' }, from: 't' },
      reply: { id: '1', 'bv-a': 'Integer', re: 0, to: 't' },
    });
  });

  it('reads mutated value after increments', async () => {
    await expectReply({
      script,
      receive: [
        { id: '2', op: '@inc', from: 'c' },
        { id: '3', op: '@inc', from: 'c' },
        { id: '4', test: { get: 'x' }, from: 't' },
      ],
      reply: [
        expect.objectContaining({ id: '2', re: { x: 1 } }),
        expect.objectContaining({ id: '3', re: { x: 2 } }),
        { id: '4', 'bv-a': 'Integer', re: 2, to: 't' },
      ],
    });
  });
});

describe('test.get — single-positional Structure', () => {
  const script = `
    ref s Structure = Structure(42 as Integer)
    @noop = -> s as Structure
  `;

  it.skip('get returns Structure in wire format with type', async () => {
    await expectReply({
      script, receive: { id: '1', test: { get: 's' }, from: 't' },
      reply: { id: '1', 'bv-a': 'Structure', re: [42], to: 't' },
    });
  });
});
