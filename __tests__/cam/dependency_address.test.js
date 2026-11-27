import { expectBehavior, createActor, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// A dependency is addressed by its source, never by its local name
//
//   use Svc = "svc.bv"      Svc.n()   →  to: 'svc.bv'
//
// The local name only binds. A source is one Opre token, so a source holding a
// `:` goes on the wire quoted: 'a:b.bv'. `to` is always a bare address; only an
// address inside a payload is bracketed, `#<svc.bv>`.
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
  use Svc = "svc.bv" as { n () -> (Integer) }
  use Odd = "a:b.bv" as { n () -> (Integer) }
  use :inc = "math.bv" as { inc (n: Integer) -> (result: Integer) }
  use Peer = "peer.bv" as { take. (Anything) => . }

  @viaAlias = {
    x Integer = Svc.n()
    return x
  }

  @quoted = {
    x Integer = Odd.n()
    return x
  }

  @member = {
    :result Integer = inc(n: 1)
    return :result
  }

  @inline = {
    x Integer = use("svc.bv").n()
    return x
  }

  @give. = { Peer.take(Svc)... }
`;

describe('dependency addresses', () => {
  it('a call through an alias goes to the source', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'viaAlias', from: 'c' } },
      { output: { id: '1', op: 'n', to: 'svc.bv' } },
      { input: { id: '1', re: [7], ty: ['Integer'], from: 'svc.bv' } },
      { output: { id: '1', re: [7], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a source holding a `:` is quoted', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'quoted', from: 'c' } },
      { output: { id: '1', op: 'n', to: "'a:b.bv'" } },
      { input: { id: '1', re: [3], ty: ['Integer'], from: "'a:b.bv'" } },
      { output: { id: '1', re: [3], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a destructured member goes to its source', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'member', from: 'c' } },
      { output: { id: '1', op: [[{ n: 1 }], 'inc'], to: 'math.bv' } },
      { input: { id: '1', re: [{ result: 2 }], ty: [{ result: 'Integer' }], from: 'math.bv' } },
      { output: { id: '1', re: [{ result: 2 }], ty: [{ result: 'Integer' }], to: 'c' } },
    );
  });

  it('`use("…")` goes to its source', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'inline', from: 'c' } },
      { output: { id: '1', op: 'n', to: 'svc.bv' } },
      { input: { id: '1', re: [5], ty: ['Integer'], from: 'svc.bv' } },
      { output: { id: '1', re: [5], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a dependency passed as a value is its address', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'give.', from: 'c' } },
      { output: expect.objectContaining({ op: [['#<svc.bv>'], 'take.'], to: 'peer.bv' }) },
    );
  });
});

describe('dependency addresses — construction', () => {
  it('`$new` goes to the source, and calls to the address in the reply', async () => {
    const actor = await createActor(`
      use Thing = "thing.bv" as *(a: Integer) -> { get () -> (value: Integer) }
      t = Thing(a: 5)
      @go = { :value Integer = t.get(); return :value }
    `, {
      expects: [
        { output: expect.objectContaining({ op: [[{ a: 5 }], '$new'], to: 'thing.bv' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: ['#<thing.bv:1>'], ty: ['thing.bv'], from: 'thing.bv' } },
      { input: { id: '99', op: 'go', from: 'c' } },
      { output: expect.objectContaining({ op: 'get', to: 'thing.bv:1' }) },
      { input: { id: '2', re: [{ value: 42 }] } },
      { output: expect.objectContaining({ id: '99', re: [{ value: 42 }], to: 'c' }) },
    );
  });
});

describe('dependency addresses — tags', () => {
  it('an actor of a dependency\'s class is tagged with the class\'s address', async () => {
    const actor = await createActor(`
      use Thing = "thing.bv" as *(a: Integer) -> { get () -> (value: Integer) }
      use Peer = "peer.bv" as { take. (Anything) => . }
      t = Thing(a: 5)
      @give. = { Peer.take(t)... }
    `, {
      expects: [
        { output: expect.objectContaining({ op: [[{ a: 5 }], '$new'], to: 'thing.bv' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: ['#<thing.bv:1>'], ty: ['thing.bv'], from: 'thing.bv' } },
      { input: { id: '2', op: 'give.', from: 'c' } },
      { output: expect.objectContaining({ ty: [['thing.bv']], to: 'peer.bv' }) },
    );
  });
});
