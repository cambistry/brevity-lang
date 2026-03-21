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

describe('capture — function reference state', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref transform : Function = |x : Integer| x : Integer

        @useDouble
          =
          transform <- |x : Integer| x * 2 : Integer
          .

        @useNegate
          =
          transform <- |x : Integer| 0 - x : Integer
          .

        @apply
          =
          :n : Integer
          =
          result : Integer = transform(n)
          -> :result
      `,
      receive: [
        { id: '1', cam: 'capture', from: 'p' },
        { id: '2', op: '@useDouble', from: 'c' },
        { id: '3', cam: 'capture', from: 'p' },
        { id: '4', op: [{ n: 5 }, '@apply'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
        { id: '5', op: '@useNegate', from: 'c' },
        { id: '6', cam: 'capture', from: 'p' },
        { id: '7', op: [{ n: 5 }, '@apply'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
      ],
    });
  });

  it('initial capture has identity function label', () => {
    const re = outputs.find(o => o.id === '1').re;
    expect(typeof re.transform).toBe('string');
    expect(re.transform).toMatch(/^_lambda_/);
  });

  it('capture after @useDouble has a different label', () => {
    const before = outputs.find(o => o.id === '1').re.transform;
    const after = outputs.find(o => o.id === '3').re.transform;
    expect(after).toMatch(/^_lambda_/);
    expect(after).not.toBe(before);
  });

  it('@apply calls the current function reference', () => {
    expect(outputs.find(o => o.id === '4')).toEqual(expect.objectContaining({
      re: { result: 10 },
    }));
  });

  it('capture after @useNegate has a third label', () => {
    const doubleLabel = outputs.find(o => o.id === '3').re.transform;
    const negateLabel = outputs.find(o => o.id === '6').re.transform;
    expect(negateLabel).toMatch(/^_lambda_/);
    expect(negateLabel).not.toBe(doubleLabel);
  });

  it('@apply reflects the latest behavior', () => {
    expect(outputs.find(o => o.id === '7')).toEqual(expect.objectContaining({
      re: { result: -5 },
    }));
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
