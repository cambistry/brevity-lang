import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Compile checks — Type | null valid syntax (no build needed — instant)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Type | null — valid syntax', () => {
  it('Integer | null is valid', () => {
    expect(() => compile(`@test = x : Integer | null = null\n  -> result: 0 as Integer\n`)).not.toThrow();
  });

  it('Text | null is valid', () => {
    expect(() => compile(`@test = x : Text | null = null\n  -> result: 0 as Integer\n`)).not.toThrow();
  });

  it('Float | null is valid', () => {
    expect(() => compile(`@test = x : Float | null = null\n  -> result: 0 as Integer\n`)).not.toThrow();
  });

  it('Boolean | null is valid', () => {
    expect(() => compile(`@test = x : Boolean | null = null\n  -> result: 0 as Integer\n`)).not.toThrow();
  });

  it('List of Integers | null is valid', () => {
    expect(() => compile(`@test = x : List of Integers | null = null\n  -> result: 0 as Integer\n`)).not.toThrow();
  });

  it('List of Texts | null is valid', () => {
    expect(() => compile(`@test = x : List of Texts | null = null\n  -> result: 0 as Integer\n`)).not.toThrow();
  });
});

describe('Type | null — plural standalone still errors', () => {
  it('Integers | null throws', () => {
    expect(() => compile(`@test = x : Integers | null = null\n  -> result: 0 as Integer\n`))
      .toThrow(/'Integers' is not a valid standalone type/);
  });

  it('Texts | null throws', () => {
    expect(() => compile(`@test = x : Texts | null = null\n  -> result: 0 as Integer\n`))
      .toThrow(/'Texts' is not a valid standalone type/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Type | null runtime behaviour
// ═══════════════════════════════════════════════════════════════════════════════

describe('Type | null — runtime behaviour', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @textNonNull
        =
        msg : Text | null = "hello" as Text
        -> result: msg

      @floatNull
        =
        x : Float | null = null
        -> result: x
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@textNonNull', from: 'c' },
        { id: '2', op: '@floatNull', from: 'c' },
      ],
    });
  });

  it('Text | null var holding a Text value replies correctly', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Text | null' }, re: { result: 'hello' }, to: 'c' });
  });

  it('Float | null var holding null replies correctly', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Float | null' }, re: { result: null }, to: 'c' });
  });
});
