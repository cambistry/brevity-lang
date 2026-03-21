import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Capture — actor state serialization via cam: "capture" wire message
// ═══════════════════════════════════════════════════════════════════════════════

describe('capture — single state var', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref x : Integer = 10

        @get
          =
          -> :x
      `,
      receive: [
        { id: '1', cam: 'capture', from: 'parent' },
      ],
    });
  });

  it('integer state var', () => {
    expect(outputs[0]).toEqual({ id: '1', re: { x: 10 }, to: 'parent' });
  });
});

describe('capture — multiple state vars', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref count : Integer = 42
        ref name : Text = "hello"
        ref flag : Boolean = true

        @noop
          =
          -> count : Integer
      `,
      receive: [
        { id: '1', cam: 'capture', from: 'p' },
      ],
    });
  });

  it('returns all state vars', () => {
    expect(outputs[0]).toEqual({
      id: '1',
      re: { count: 42, name: 'hello', flag: true },
      to: 'p',
    });
  });
});

describe('capture — state after mutation', () => {
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
        { id: '1', op: '@inc', from: 'c' },
        { id: '2', op: '@inc', from: 'c' },
        { id: '3', op: '@inc', from: 'c' },
        { id: '4', cam: 'capture', from: 'p' },
      ],
    });
  });

  it('reflects mutated state', () => {
    expect(outputs[3]).toEqual({ id: '4', re: { x: 3 }, to: 'p' });
  });
});

describe('capture — decimal and float state', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref price : Decimal = 9.99
        ref ratio : Float = 3.14

        @noop
          =
          -> price : Decimal
      `,
      receive: [
        { id: '1', cam: 'capture', from: 'p' },
      ],
    });
  });

  it('decimal and float values serialize', () => {
    expect(outputs[0]).toEqual({
      id: '1',
      re: { price: 9.99, ratio: 3.14 },
      to: 'p',
    });
  });
});

describe('capture — null and zero values', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref a : Integer = 0
        ref b : Text = ""
        ref c : Boolean = false

        @noop
          =
          -> a : Integer
      `,
      receive: [
        { id: '1', cam: 'capture', from: 'p' },
      ],
    });
  });

  it('zero/empty/false values serialize correctly', () => {
    expect(outputs[0]).toEqual({
      id: '1',
      re: { a: 0, b: '', c: false },
      to: 'p',
    });
  });
});
