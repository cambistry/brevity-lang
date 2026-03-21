import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Hydrate — restore actor state via cam: [{state}, "hydrate"] wire message
// ═══════════════════════════════════════════════════════════════════════════════

describe('hydrate — integer state', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref x : Integer = 0

        @get
          =
          -> :x
      `,
      receive: [
        { id: '1', cam: [{ x: 42 }, 'hydrate'], from: 'parent' },
        { id: '2', op: '@get', from: 'c' },
      ],
    });
  });

  it('acks the hydrate', () => {
    expect(outputs[0]).toEqual({ id: '1', re: 'hydrate', to: 'parent' });
  });

  it('state reflects hydrated value', () => {
    expect(outputs[1]).toEqual(expect.objectContaining({ id: '2', re: { x: 42 }, to: 'c' }));
  });
});

describe('hydrate — multiple types', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref count : Integer = 0
        ref name : Text = ""
        ref flag : Boolean = false

        @getCount
          =
          -> :count

        @getName
          =
          -> :name

        @getFlag
          =
          -> :flag
      `,
      receive: [
        { id: '1', cam: [{ count: 99, name: 'restored', flag: true }, 'hydrate'], from: 'p' },
        { id: '2', op: '@getCount', from: 'c' },
        { id: '3', op: '@getName', from: 'c' },
        { id: '4', op: '@getFlag', from: 'c' },
      ],
    });
  });

  it('integer hydrated', () => {
    expect(outputs[1]).toEqual(expect.objectContaining({ id: '2', re: { count: 99 }, to: 'c' }));
  });

  it('text hydrated', () => {
    expect(outputs[2]).toEqual(expect.objectContaining({ id: '3', re: { name: 'restored' }, to: 'c' }));
  });

  it('boolean hydrated', () => {
    expect(outputs[3]).toEqual(expect.objectContaining({ id: '4', re: { flag: true }, to: 'c' }));
  });
});

describe('hydrate — decimal and float', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref price : Decimal = 0
        ref ratio : Float = 0.0

        @getPrice
          =
          -> :price

        @getRatio
          =
          -> :ratio
      `,
      receive: [
        { id: '1', cam: [{ price: 9.99, ratio: 3.14 }, 'hydrate'], from: 'p' },
        { id: '2', op: '@getPrice', from: 'c' },
        { id: '3', op: '@getRatio', from: 'c' },
      ],
    });
  });

  it('decimal hydrated', () => {
    expect(outputs[1]).toEqual(expect.objectContaining({ id: '2', re: { price: 9.99 }, to: 'c' }));
  });

  it('float hydrated', () => {
    expect(outputs[2]).toEqual(expect.objectContaining({ id: '3', re: { ratio: 3.14 }, to: 'c' }));
  });
});

describe('hydrate — overwrites init values', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref x : Integer = 999
        ref y : Text = "original"

        @get
          =
          -> :x, :y
      `,
      receive: [
        { id: '1', cam: [{ x: 1, y: 'hydrated' }, 'hydrate'], from: 'p' },
        { id: '2', op: '@get', from: 'c' },
      ],
    });
  });

  it('hydrated values replace init defaults', () => {
    expect(outputs[1]).toEqual(expect.objectContaining({
      id: '2',
      re: { x: 1, y: 'hydrated' },
      to: 'c',
    }));
  });
});

describe('hydrate — mutate after hydrate', () => {
  let outputs;

  beforeAll(async () => {
    outputs = await runActor({
      source: `
        ref x : Integer = 0

        @inc
          =
          x <- x + 1
          -> :x

        @get
          =
          -> :x
      `,
      receive: [
        { id: '1', cam: [{ x: 10 }, 'hydrate'], from: 'p' },
        { id: '2', op: '@inc', from: 'c' },
        { id: '3', op: '@inc', from: 'c' },
        { id: '4', op: '@get', from: 'c' },
      ],
    });
  });

  it('mutations apply on top of hydrated state', () => {
    expect(outputs[3]).toEqual(expect.objectContaining({ id: '4', re: { x: 12 }, to: 'c' }));
  });
});
