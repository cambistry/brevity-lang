import { createActor, expectActorBehavior, compileActor, compileSource } from '../helpers.js';

// ── Service ref (*) — typed assign sends [Type, "as"] to service ────────────

describe('type coercion — service ref (*)', () => {
  const source = `
    *(
      "/services/counter": (Counter) {
        get: () -> (:count Integer)
      } | Integer
    )
    =

    @readInt
      =
      n Integer = Counter
      -> n as Integer
  `;

  it('typed assign from service ref emits [Integer, as] op', async () => {
    const compiled = await compileActor(source);
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', op: '@readInt', from: 'caller' });

    const outgoing = actor.posts.find(p => p.to === 'Counter');
    expect(outgoing).toBeDefined();
    expect(outgoing.op).toEqual(['Integer', 'as']);
  });

  it('full roundtrip — as reply returns value to caller', async () => {
    const compiled = await compileActor(source);
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', op: '@readInt', from: 'caller' });

    const outgoing = actor.posts.find(p => p.to === 'Counter');
    await actor.sendAsync({ id: outgoing.id, re: [42], 'bv-a': ['Integer'] });

    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply).toBeDefined();
    expect(reply.id).toBe('1');
    expect(reply.re).toEqual([42]);
  });
});

describe('type coercion — service ref, multiple as types', () => {
  const source = `
    *(
      "/services/store": (Store) {
        ping: () -> .
      } | Integer | Text
    )
    =

    @asInt
      =
      n Integer = Store
      -> n as Integer

    @asText
      =
      t Text = Store
      -> t as Text
  `;

  it('Integer coercion sends [Integer, as]', async () => {
    const compiled = await compileActor(source);
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', op: '@asInt', from: 'c' });

    const outgoing = actor.posts.find(p => p.to === 'Store');
    expect(outgoing.op).toEqual(['Integer', 'as']);
  });

  it('Text coercion sends [Text, as]', async () => {
    const compiled = await compileActor(source);
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', op: '@asText', from: 'c' });

    const outgoing = actor.posts.find(p => p.to === 'Store');
    expect(outgoing.op).toEqual(['Text', 'as']);
  });
});

// ── Constructor ref (#) — construct then typed assign ───────────────────────

describe('type coercion — constructor ref (#), two-step', () => {
  const source = `
    *( "service.bv": (Service) *() -> {
        ping: () -> .
      } | Integer
    )
    =

    s = Service()

    @asInt
      =
      n Integer = s
      -> n as Integer
  `;

  it('construction emits new, typed assign emits [Integer, as]', async () => {
    const actor = await createActor(source, {
      expects: [
        { output: expect.objectContaining({ op: [{}, '#new'], to: 'Service' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Service/1>', 'bv-a': '#<Service>', from: 'Service' } },
      { input: { id: '99', op: '@asInt', from: 'caller' } },
      { output: expect.objectContaining({ op: ['Integer', 'as'], to: 'Service/1' }) },
      { input: { id: '2', re: [42], 'bv-a': ['Integer'] } },
      { output: expect.objectContaining({ id: '99', re: [42], to: 'caller' }) },
    );
  });
});

describe('type coercion — constructor ref (#), one-step', () => {
  const source = `
    *( "service.bv": (Service) *() -> {
        ping: () -> .
      } | Integer
    )
    =

    @asInt
      =
      n Integer = Service()
      -> n as Integer
  `;

  it('one-step typed constructor emits new then [Integer, as]', async () => {
    const compiled = await compileActor(source);
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '99', op: '@asInt', from: 'caller' });

    const newMsg = actor.posts.find(p => p.to === 'Service' && Array.isArray(p.op) && p.op[1] === '#new');
    expect(newMsg).toBeDefined();

    await actor.sendAsync({ id: newMsg.id, re: '#<Service/1>', 'bv-a': '#<Service>', from: 'Service' });

    const asMsg = actor.posts.find(p => p.to === 'Service/1' && Array.isArray(p.op) && p.op[1] === 'as');
    expect(asMsg).toBeDefined();
    expect(asMsg.op).toEqual(['Integer', 'as']);

    await actor.sendAsync({ id: asMsg.id, re: [42], 'bv-a': ['Integer'] });

    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply.id).toBe('99');
    expect(reply.re).toEqual([42]);
  });
});

// ── Service ref (*) via options.remotes ──────────────────────────────────────

describe('type coercion — service ref (*) via remotes', () => {
  const serviceManifest = '{\n  get: () -> (:count Integer)\n} | Integer';

  it('bare * with remotes — typed assign emits [Integer, as]', async () => {
    const compiled = await compileActor(`
      *( "/services/counter": (Counter) )
      =

      @readInt
        =
        n Integer = Counter
        -> n as Integer
    `, { compileOptions: { remotes: [{ path: '/services/counter', service: serviceManifest }] } });
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', op: '@readInt', from: 'caller' });

    const outgoing = actor.posts.find(p => p.to === 'Counter');
    expect(outgoing).toBeDefined();
    expect(outgoing.op).toEqual(['Integer', 'as']);
  });

  it('bare * with remotes — full roundtrip', async () => {
    const compiled = await compileActor(`
      *( "/services/counter": (Counter) )
      =

      @readInt
        =
        n Integer = Counter
        -> n as Integer
    `, { compileOptions: { remotes: [{ path: '/services/counter', service: serviceManifest }] } });
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', op: '@readInt', from: 'caller' });

    const outgoing = actor.posts.find(p => p.to === 'Counter');
    await actor.sendAsync({ id: outgoing.id, re: [42], 'bv-a': ['Integer'] });

    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply).toBeDefined();
    expect(reply.id).toBe('1');
    expect(reply.re).toEqual([42]);
  });
});

describe('type coercion — service ref (*) via remotes, multiple as types', () => {
  const manifest = '{\n  ping: () -> .\n} | Integer | Text';

  it('Integer coercion via remotes sends [Integer, as]', async () => {
    const compiled = await compileActor(`
      *( "/services/store": (Store) )
      =

      @asInt
        =
        n Integer = Store
        -> n as Integer
    `, { compileOptions: { remotes: [{ path: '/services/store', service: manifest }] } });
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', op: '@asInt', from: 'c' });

    const outgoing = actor.posts.find(p => p.to === 'Store');
    expect(outgoing.op).toEqual(['Integer', 'as']);
  });

  it('Text coercion via remotes sends [Text, as]', async () => {
    const compiled = await compileActor(`
      *( "/services/store": (Store) )
      =

      @asText
        =
        t Text = Store
        -> t as Text
    `, { compileOptions: { remotes: [{ path: '/services/store', service: manifest }] } });
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', op: '@asText', from: 'c' });

    const outgoing = actor.posts.find(p => p.to === 'Store');
    expect(outgoing.op).toEqual(['Text', 'as']);
  });
});

// ── Constructor ref (#) via options.remotes ──────────────────────────────────

describe('type coercion — constructor ref (#) via remotes, two-step', () => {
  const ctorParams = '*()';
  const ctorService = '{\n  ping: () -> .\n} | Integer';

  it('bare # with remotes — new then [Integer, as] to instance', async () => {
    const actor = await createActor(`
      *( "service.bv": (Service) # )
      =

      s = Service()

      @asInt
        =
        n Integer = s
        -> n as Integer
    `, {
      compileOptions: { remotes: [{ path: 'service.bv', params: ctorParams, service: ctorService }] },
      expects: [
        { output: expect.objectContaining({ op: [{}, '#new'], to: 'Service' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Service/1>', 'bv-a': '#<Service>', from: 'Service' } },
      { input: { id: '99', op: '@asInt', from: 'caller' } },
      { output: expect.objectContaining({ op: ['Integer', 'as'], to: 'Service/1' }) },
      { input: { id: '2', re: [42], 'bv-a': ['Integer'] } },
      { output: expect.objectContaining({ id: '99', re: [42], to: 'caller' }) },
    );
  });
});

describe('type coercion — constructor ref (#) via remotes, one-step', () => {
  const ctorParams = '*()';
  const ctorService = '{\n  ping: () -> .\n} | Integer | Text';

  it('one-step Integer — new then [Integer, as]', async () => {
    const compiled = await compileActor(`
      *( "service.bv": (Service) # )
      =

      @asInt
        =
        n Integer = Service()
        -> n as Integer
    `, { compileOptions: { remotes: [{ path: 'service.bv', params: ctorParams, service: ctorService }] } });
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '99', op: '@asInt', from: 'caller' });

    const newMsg = actor.posts.find(p => p.to === 'Service' && Array.isArray(p.op) && p.op[1] === '#new');
    expect(newMsg).toBeDefined();

    await actor.sendAsync({ id: newMsg.id, re: '#<Service/1>', 'bv-a': '#<Service>', from: 'Service' });

    const asMsg = actor.posts.find(p => p.to === 'Service/1' && Array.isArray(p.op) && p.op[1] === 'as');
    expect(asMsg).toBeDefined();
    expect(asMsg.op).toEqual(['Integer', 'as']);

    await actor.sendAsync({ id: asMsg.id, re: [42], 'bv-a': ['Integer'] });

    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply.id).toBe('99');
    expect(reply.re).toEqual([42]);
  });

  it('one-step Text — new then [Text, as]', async () => {
    const compiled = await compileActor(`
      *( "service.bv": (Service) # )
      =

      @asText
        =
        t Text = Service()
        -> t as Text
    `, { compileOptions: { remotes: [{ path: 'service.bv', params: ctorParams, service: ctorService }] } });
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '99', op: '@asText', from: 'caller' });

    const newMsg = actor.posts.find(p => p.to === 'Service' && Array.isArray(p.op) && p.op[1] === '#new');
    expect(newMsg).toBeDefined();

    await actor.sendAsync({ id: newMsg.id, re: '#<Service/1>', 'bv-a': '#<Service>', from: 'Service' });

    const asMsg = actor.posts.find(p => p.to === 'Service/1' && Array.isArray(p.op) && p.op[1] === 'as');
    expect(asMsg).toBeDefined();
    expect(asMsg.op).toEqual(['Text', 'as']);

    await actor.sendAsync({ id: asMsg.id, re: ['hello'], 'bv-a': ['Text'] });

    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply.id).toBe('99');
    expect(reply.re).toEqual(['hello']);
  });
});

// ── Compile errors via remotes ──────────────────────────────────────────────

describe('type coercion — compile errors via remotes', () => {
  it('service ref — remotes interface lacks as type → error', () => {
    const noAsManifest = '{\n  get: () -> (:count Integer)\n}';
    expect(() => compileSource(`
      *( "/services/counter": (Counter) )
      =

      @readInt
        =
        n Integer = Counter
        -> n as Integer
    `, { remotes: [{ path: '/services/counter', service: noAsManifest }] })).toThrow();
  });

  it('constructor ref — remotes interface lacks as type → error', () => {
    const noAsParams = '*()';
    const noAsService = '{\n  ping: () -> .\n}';
    expect(() => compileSource(`
      *( "service.bv": (Service) # )
      =

      @asInt
        =
        n Integer = Service()
        -> n as Integer
    `, { remotes: [{ path: 'service.bv', params: noAsParams, service: noAsService }] })).toThrow();
  });
});

// ── Compile errors — missing as type in service interface ───────────────────

describe('type coercion — compile errors', () => {
  it('typed assign from service ref fails when interface lacks as type', () => {
    expect(() => compileSource(`
      *(
        "/services/counter": (Counter) {
          get: () -> (:count Integer)
        }
      )
      =

      @readInt
        =
        n Integer = Counter
        -> n as Integer
    `)).toThrow();
  });

  it('typed assign from constructor ref fails when interface lacks as type', () => {
    expect(() => compileSource(`
      *( "service.bv": (Service) *() -> {
          ping: () -> .
        }
      )
      =

      @asInt
        =
        n Integer = Service()
        -> n as Integer
    `)).toThrow();
  });
});
