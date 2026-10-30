import { createActor, expectActorBehavior, expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Binding a remote call's reply. `x T = r.m()` binds the reply's single
// unnamed value; `:x T = r.m()` destructures its named `x`. The local's name
// never selects a named field of the reply — that was a leniency (the mirror
// of the positional→named fallback removed in c6fe13e).
// ═══════════════════════════════════════════════════════════════════════════════

const THING = `
  *
    "thing.bv": Thing (a: Integer) -> *{
      get () -> (Integer)
      pair () -> (x: Integer)
    }
  *
`;

const constructed = (src) => createActor(src, {
  expects: [{ output: expect.objectContaining({ op: [{ a: 5 }, '#new'], to: 'Thing' }) }],
});

const NEW_REPLY = { input: { id: '1', re: '#<Thing/1>', 'bv-a': '#<Thing>', from: 'Thing' } };

describe('remote actor (constructor-block construction)', () => {
  it('x T = r.m() binds a one-element positional reply', async () => {
    const actor = await constructed(`${THING}
      t = Thing(a: 5)
      @go = { x Integer = t.get(); return a1: x }
    `);
    await expectActorBehavior(actor,
      NEW_REPLY,
      { input: { id: '99', op: '@go', from: 'caller' } },
      { output: expect.objectContaining({ op: '@get', to: 'Thing/1' }) },
      { input: { id: '2', re: [17], 'bv-a': ['Integer'] } },
      { output: expect.objectContaining({ id: '99', re: { a1: 17 }, to: 'caller' }) },
    );
  });

  it('x = r.m() (untyped) binds the unnamed reply', async () => {
    const actor = await constructed(`${THING}
      t = Thing(a: 5)
      @go = { x = t.get(); return a1: x }
    `);
    await expectActorBehavior(actor,
      NEW_REPLY,
      { input: { id: '99', op: '@go', from: 'caller' } },
      { output: expect.objectContaining({ op: '@get', to: 'Thing/1' }) },
      { input: { id: '2', re: [17], 'bv-a': ['Integer'] } },
      { output: expect.objectContaining({ id: '99', re: { a1: 17 }, to: 'caller' }) },
    );
  });

  it(':x T = r.m() destructures a named reply', async () => {
    const actor = await constructed(`${THING}
      t = Thing(a: 5)
      @go = { :x Integer = t.pair(); return a1: x }
    `);
    await expectActorBehavior(actor,
      NEW_REPLY,
      { input: { id: '99', op: '@go', from: 'caller' } },
      { output: expect.objectContaining({ op: '@pair', to: 'Thing/1' }) },
      { input: { id: '2', re: { x: 17 } } },
      { output: expect.objectContaining({ id: '99', re: { a1: 17 }, to: 'caller' }) },
    );
  });
});

describe('remote actor (handler-local construction)', () => {
  const run = (src, reply) => createActor(src).then(actor => expectActorBehavior(actor,
    { input: { id: '99', op: '@go', from: 'caller' } },
    { output: expect.objectContaining({ op: [{ a: 5 }, '#new'], to: 'Thing' }) },
    NEW_REPLY,
    { output: expect.objectContaining({ to: 'Thing/1' }) },
    { input: { id: '2', ...reply } },
    { output: expect.objectContaining({ id: '99', re: { a1: 17 }, to: 'caller' }) },
  ));

  it('x T = r.m() binds the unnamed reply', async () => {
    await run(`${THING}
      @go = { t = Thing(a: 5); x Integer = t.get(); return a1: x }
    `, { re: [17], 'bv-a': ['Integer'] });
  });

  it('x = r.m() (untyped) binds the unnamed reply', async () => {
    await run(`${THING}
      @go = { t = Thing(a: 5); x = t.get(); return a1: x }
    `, { re: [17], 'bv-a': ['Integer'] });
  });

  it(':x T = r.m() destructures a named reply', async () => {
    await run(`${THING}
      @go = { t = Thing(a: 5); :x Integer = t.pair(); return a1: x }
    `, { re: { x: 17 } });
  });
});

describe('remote reply carrying only a field named like the local — not a single value', () => {
  const run = (src) => constructed(src).then(actor => expectActorBehavior(actor,
    NEW_REPLY,
    { input: { id: '99', op: '@go', from: 'caller' } },
    { output: expect.objectContaining({ op: '@pair', to: 'Thing/1' }) },
    { input: { id: '2', re: { x: 17 } } },
    { output: expect.objectContaining({ id: '99', ex: { '@go': 'error' }, to: 'caller' }) },
  ));

  it('x T = r.m()', async () => {
    await run(`${THING}
      t = Thing(a: 5)
      @go = { x Integer = t.pair(); return a1: x }
    `);
  });

  it('x = r.m() (untyped)', async () => {
    await run(`${THING}
      t = Thing(a: 5)
      @go = { x = t.pair(); return a1: x }
    `);
  });
});

describe('destructured service member — bare read', () => {
  const run = (reply, expected) => createActor(`
    *
      "counter.bv": (:count)
    *
    @go = { n Integer = count; return a1: n }
  `, { compileOptions: { remotes: [{ path: 'counter.bv', service: '{ count () -> (Integer) }' }] } })
    .then(actor => expectActorBehavior(actor,
      { input: { id: '99', op: '@go', from: 'caller' } },
      { output: expect.objectContaining({ op: '@count', to: 'counter.bv' }) },
      { input: { id: '1', ...reply } },
      { output: expect.objectContaining({ id: '99', ...expected, to: 'caller' }) },
    ));

  it('binds the unnamed reply', async () => {
    await run({ re: [17], 'bv-a': ['Integer'] }, { re: { a1: 17 } });
  });

  it('a reply carrying only a field named like the local is not a single value', async () => {
    await run({ re: { n: 17 } }, { ex: { '@go': 'error' } });
  });
});

describe('reference-field callback — typed bind', () => {
  const fixture = `
    ::Call (arg Integer, fn: (value: Integer) -> (Integer))
    @go = (c: Call) { out Integer = c.fn(c.arg); return a1: out }
  `;
  const run = (reply, expected) => expectBehavior(fixture,
    { input: { id: '50', op: [{ c: [200, '#<caller @cb>'] }, '@go'], 'bv-a': [{ c: '::Call' }], from: 'caller' } },
    { output: expect.objectContaining({ id: '1', op: [[200], '@cb'], to: '#<caller @cb>' }) },
    { input: { id: '1', ...reply } },
    { output: expect.objectContaining({ id: '50', ...expected, to: 'caller' }) },
  );

  it('binds the unnamed reply', async () => {
    await run({ re: [999], 'bv-a': ['Integer'] }, { re: { a1: 999 } });
  });

  it('a reply carrying only a field named like the local is not a single value', async () => {
    await run({ re: { out: 999 } }, { ex: { '@go': 'error' } });
  });
});

describe('actor ref in a lambda — call in tail position', () => {
  it('returns the unnamed reply', async () => {
    await expectBehavior(`
      C = *{ @seven = { 7 } }
      @run = { cs List = [C(), C()]; xs List = over(cs) (c) { c.seven() }; return a1: xs }
    `,
      { input: { id: '1', op: '@run', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { a1: [7, 7] } }) },
    );
  });

  it('a reply carrying only a field named after the method is not a single value', async () => {
    await expectBehavior(`
      C = *{ @seven = -> seven: 7 }
      @run = { cs List = [C()]; xs List = over(cs) (c) { c.seven() }; return a1: xs }
    `,
      { input: { id: '1', op: '@run', from: 'c' } },
      { output: expect.objectContaining({ id: '1', ex: { '@run': 'error' } }) },
    );
  });
});
