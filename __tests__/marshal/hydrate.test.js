import { createActor, expectBehavior, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Hydrate — restore actor state via cam: [{state}, "hydrate"] wire message
// ═══════════════════════════════════════════════════════════════════════════════

describe('hydrate — integer state', () => {
  it('acks and state reflects hydrated value', async () => {
    const script = `
      ref x Integer = 0
      @get = -> :x
    `;
    await expectBehavior(script,
      { input: { id: '1', cam: [{ x: 42 }, 'hydrate'], from: 'parent' } },
      { output: { id: '1', re: 'hydrate', to: 'parent' } },
      { input: { id: '2', op: '@get', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: { x: 42 }, to: 'c' }) },
    );
  });
});

describe('hydrate — multiple types', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      ref count Integer = 0
      ref name Text = ""
      ref flag Boolean = false

      @getCount = -> :count
      @getName  = -> :name
      @getFlag  = -> :flag
    `);
    await expectActorBehavior(actor,
      { input: { id: '1', cam: [{ count: 99, name: 'restored', flag: true }, 'hydrate'], from: 'p' } },
      { output: { id: '1', re: 'hydrate', to: 'p' } },
    );
  });

  it('integer hydrated', async () => {
    await expectActorBehavior(actor, { input: { id: '2', op: '@getCount', from: 'c' } }, { output: expect.objectContaining({ re: { count: 99 } }) });
  });

  it('text hydrated', async () => {
    await expectActorBehavior(actor, { input: { id: '3', op: '@getName', from: 'c' } }, { output: expect.objectContaining({ re: { name: 'restored' } }) });
  });

  it('boolean hydrated', async () => {
    await expectActorBehavior(actor, { input: { id: '4', op: '@getFlag', from: 'c' } }, { output: expect.objectContaining({ re: { flag: true } }) });
  });
});

describe('hydrate — decimal and float', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      ref price Decimal = 0
      ref ratio Float = 0.0
      @getPrice = -> :price
      @getRatio = -> :ratio
    `);
    await expectActorBehavior(actor,
      { input: { id: '1', cam: [{ price: 9.99, ratio: 3.14 }, 'hydrate'], from: 'p' } },
      { output: { id: '1', re: 'hydrate', to: 'p' } },
    );
  });

  it('decimal hydrated', async () => {
    await expectActorBehavior(actor, { input: { id: '2', op: '@getPrice', from: 'c' } }, { output: expect.objectContaining({ re: { price: 9.99 } }) });
  });

  it('float hydrated', async () => {
    await expectActorBehavior(actor, { input: { id: '3', op: '@getRatio', from: 'c' } }, { output: expect.objectContaining({ re: { ratio: 3.14 } }) });
  });
});

describe('hydrate — overwrites init values', () => {
  it('hydrated values replace init defaults', async () => {
    const script = `
      ref x Integer = 999
      ref y Text = "original"
      @get = -> :x, :y
    `;
    await expectBehavior(script,
      { input: { id: '1', cam: [{ x: 1, y: 'hydrated' }, 'hydrate'], from: 'p' } },
      { output: { id: '1', re: 'hydrate', to: 'p' } },
      { input: { id: '2', op: '@get', from: 'c' } },
      { output: expect.objectContaining({ re: { x: 1, y: 'hydrated' } }) },
    );
  });
});

describe('hydrate — mutate after hydrate', () => {
  it('mutations apply on top of hydrated state', async () => {
    const script = `
      ref x Integer = 0
      @inc = { x <- x + 1; -> :x }
      @get = -> :x
    `;
  await expectBehavior(script,
      { input: { id: '1', cam: [{ x: 10 }, 'hydrate'], from: 'p' } },
      { output: { id: '1', re: 'hydrate', to: 'p' } },
      { input: { id: '2', op: '@inc', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: { x: 11 } }) },
      { input: { id: '3', op: '@inc', from: 'c' } },
      { output: expect.objectContaining({ id: '3', re: { x: 12 } }) },
      { input: { id: '4', op: '@get', from: 'c' } },
      { output: expect.objectContaining({ id: '4', re: { x: 12 } }) },
    );
  });
});
