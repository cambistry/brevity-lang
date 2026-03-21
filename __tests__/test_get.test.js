import { runActor } from './helpers.js';

describe('test.get — read state vars', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref x : Integer = 42
        ref name : Text = "hello"
        ref flag : Boolean = true

        @noop
          =
          -> x : Integer
      `,
      receive: [
        { id: '1', test: { get: 'x' }, from: 't' },
        { id: '2', test: { get: 'name' }, from: 't' },
        { id: '3', test: { get: 'flag' }, from: 't' },
      ],
    });
  });

  it('reads integer state var with type', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': 'Integer', re: 42, to: 't' });
  });

  it('reads text state var with type', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': 'Text', re: 'hello', to: 't' });
  });

  it('reads boolean state var with type', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': 'Boolean', re: true, to: 't' });
  });
});

describe('test.get — after mutation', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref x : Integer = 0

        @inc
          =
          x <- x + 1
          -> :x

        @noop
          =
          -> x : Integer
      `,
      receive: [
        { id: '1', test: { get: 'x' }, from: 't' },
        { id: '2', op: '@inc', from: 'c' },
        { id: '3', op: '@inc', from: 'c' },
        { id: '4', test: { get: 'x' }, from: 't' },
      ],
    });
  });

  it('reads initial value', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': 'Integer', re: 0, to: 't' });
  });

  it('reads mutated value', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': 'Integer', re: 2, to: 't' });
  });
});

describe('test.get — single-positional Structure unwraps to scalar', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref s : Structure = Structure(42 : Integer)

        @noop
          =
          -> s : Structure
      `,
      receive: [
        { id: '1', test: { get: 's' }, from: 't' },
      ],
    });
  });

  it.skip('get returns Structure in wire format with type', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': 'Structure', re: [42], to: 't' });
  });
});
