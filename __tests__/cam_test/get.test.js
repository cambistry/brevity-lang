import { expectBehavior } from '../helpers.js';

describe('test.get — read state vars', () => {
  const script = `
    x Integer! = 42
    name Text! = "hello"
    flag Boolean! = true
    @noop = -> x
  `;

  it('reads integer state var with type', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { get: 'x' }, from: 't' } },
      { output: { id: '1', 'bv-a': 'Integer', re: 42, to: 't' } },
    );
  });

  it('reads text state var with type', async () => {
    await expectBehavior(script,
      { input: { id: '2', test: { get: 'name' }, from: 't' } },
      { output: { id: '2', 'bv-a': 'Text', re: 'hello', to: 't' } },
    );
  });

  it('reads boolean state var with type', async () => {
    await expectBehavior(script,
      { input: { id: '3', test: { get: 'flag' }, from: 't' } },
      { output: { id: '3', 'bv-a': 'Boolean', re: true, to: 't' } },
    );
  });
});

describe('test.get — after mutation', () => {
  const script = `
    x Integer! = 0
    @inc = { x <- x + 1; -> :x }
    @noop = -> x
  `;

  it('reads initial value', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { get: 'x' }, from: 't' } },
      { output: { id: '1', 'bv-a': 'Integer', re: 0, to: 't' } },
    );
  });

  it('reads mutated value after increments', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@inc', from: 'c' } },
      { input: { id: '3', op: '@inc', from: 'c' } },
      { input: { id: '4', test: { get: 'x' }, from: 't' } },
      { output: expect.objectContaining({ id: '2', re: { x: 1 } }) },
      { output: expect.objectContaining({ id: '3', re: { x: 2 } }) },
      { output: { id: '4', 'bv-a': 'Integer', re: 2, to: 't' } },
    );
  });
});

describe('test.get — single-positional Structure', () => {
  const script = `
    s Structure! = Structure(42)
    @noop = -> s
  `;

  it.skip('get returns Structure in wire format with type', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { get: 's' }, from: 't' } },
      { output: { id: '1', 'bv-a': 'Structure', re: [42], to: 't' } },
    );
  });
});
