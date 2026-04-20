import { expectBehavior, createActor } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// subscribe@<cell> — long-lived correlation. Initial `re` is the current value;
// every subsequent set@<cell> replays a new `re` to each registered subscriber
// using the stored id.
//
// Single combined script keeps the compiled artifact consistent across test
// suites (the Erlang target writes to a shared per-worker dir, so each unique
// source overwrites the prior compile).
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
  @val *Integer = 0
  @label *Text = "hi"
  @flag *Boolean = false
`;

describe('subscribe — initial value', () => {
  it('integer cell: first re carries current value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'subscribe@val', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [0], to: 'c' } },
    );
  });

  it('text cell: first re carries current text', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'subscribe@label', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Text'], re: ['hi'], to: 'c' } },
    );
  });

  it('boolean cell: first re carries current flag', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'subscribe@flag', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Boolean'], re: [false], to: 'c' } },
    );
  });
});

describe('subscribe — replay on set', () => {
  it('set after subscribe replays new value with same id', async () => {
    await expectBehavior(script,
      { input: { id: '9', op: 'subscribe@val', from: 'c' } },
      { output: { id: '9', 'bv-a': ['Integer'], re: [0], to: 'c' } },
      { input: { op: [[7], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '9', 'bv-a': ['Integer'], re: [7], to: 'c' } },
    );
  });

  it('multiple sets each replay', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'subscribe@val', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [0], to: 'c' } },
      { input: { op: [[10], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [10], to: 'c' } },
      { input: { op: [[20], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [20], to: 'c' } },
      { input: { op: [[30], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [30], to: 'c' } },
    );
  });

  it('text cell replays on set', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: 'subscribe@label', from: 'c' } },
      { output: { id: '5', 'bv-a': ['Text'], re: ['hi'], to: 'c' } },
      { input: { op: [['bye'], 'set@label'], 'bv-a': [['Text']], from: 'c' } },
      { output: { id: '5', 'bv-a': ['Text'], re: ['bye'], to: 'c' } },
    );
  });
});

describe('subscribe — multiple subscribers', () => {
  it('two subscribers each receive replays under their own ids', async () => {
    await expectBehavior(script,
      { input: { id: 'A', op: 'subscribe@val', from: 'a' } },
      { output: { id: 'A', 'bv-a': ['Integer'], re: [0], to: 'a' } },
      { input: { id: 'B', op: 'subscribe@val', from: 'b' } },
      { output: { id: 'B', 'bv-a': ['Integer'], re: [0], to: 'b' } },
      { input: { op: [[42], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: 'A', 'bv-a': ['Integer'], re: [42], to: 'a' } },
      { output: { id: 'B', 'bv-a': ['Integer'], re: [42], to: 'b' } },
    );
  });
});

describe('subscribe — independence from get', () => {
  it('subscribe does not interfere with normal get/set', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'subscribe@val', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [0], to: 'c' } },
      { input: { op: [[5], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [5], to: 'c' } },
      { input: { id: '2', op: '@val', from: 'c' } },
      { output: { id: '2', 'bv-a': ['Integer'], re: [5], to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Call-site syntax — `<child>.<field>.subscribe |v| { body }`
//
// Covers the Brevity source-level subscribe expression against a locally-
// defined actor. The caller posts `subscribe@<field>` to the child, registers
// a persistent handler on its own side, and each incoming `re` dispatches to
// the handler body with `v` bound to the new value.
// ═══════════════════════════════════════════════════════════════════════════════

describe('subscribe — call-site syntax', () => {
  // Module-level `c = C()` keeps the child actor alive across calls. Tests
  // drive the actor with external messages (subscribe, set, read) so the
  // event loop processes pending notifications between invocations.
  const callSiteScript = `
    C = <> { @val *Integer = 0 }

    c = C()
    last *Integer = 0

    @doSubscribe = { c.val.subscribe |v| { last <- v } ; . }

    @setVal = |:n Integer| { c.val <- n . }

    @readLast = -> :last as Integer
  `;

  it('handler captures initial value after subscribe', async () => {
    await expectBehavior(callSiteScript,
      { input: { id: '1', op: '@doSubscribe', from: 'caller' } },
      { input: { id: '2', op: '@readLast', from: 'caller' } },
      { output: { id: '2', 'bv-a': { last: 'Integer' }, re: { last: 0 }, to: 'caller' } },
    );
  });

  it('handler re-runs when the subscribed cell is set', async () => {
    await expectBehavior(callSiteScript,
      { input: { id: '1', op: '@doSubscribe', from: 'caller' } },
      { input: { id: '2', op: [{ n: 42 }, '@setVal'], 'bv-a': [{ n: 'Integer' }], from: 'caller' } },
      { input: { id: '3', op: '@readLast', from: 'caller' } },
      { output: { id: '3', 'bv-a': { last: 'Integer' }, re: { last: 42 }, to: 'caller' } },
    );
  });

  it('handler captures the latest value across multiple sets', async () => {
    await expectBehavior(callSiteScript,
      { input: { id: '1', op: '@doSubscribe', from: 'caller' } },
      { input: { id: '2', op: [{ n: 5 }, '@setVal'], 'bv-a': [{ n: 'Integer' }], from: 'caller' } },
      { input: { id: '3', op: [{ n: 10 }, '@setVal'], 'bv-a': [{ n: 'Integer' }], from: 'caller' } },
      { input: { id: '4', op: [{ n: 99 }, '@setVal'], 'bv-a': [{ n: 'Integer' }], from: 'caller' } },
      { input: { id: '5', op: '@readLast', from: 'caller' } },
      { output: { id: '5', 'bv-a': { last: 'Integer' }, re: { last: 99 }, to: 'caller' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-file subscription — subscriber script subscribes to a remote actor
// declared by alias import. Tests capture the outbound subscribe@<field>
// request on the wire, inject stubbed `re` replies that simulate the remote
// publisher, and verify the subscriber's handler state.
// ═══════════════════════════════════════════════════════════════════════════════

describe('subscribe — remote (unit test with stubbed publisher)', () => {
  const remoteScript = `
    < "Remote": (Remote) { val: *Integer } >

    last *Integer = 0

    @doSubscribe = { Remote.val.subscribe |v| { last <- v } ; . }

    @readLast = -> :last as Integer
  `;

  it('subscribe@val message is posted to the remote alias', async () => {
    await createActor(remoteScript, {
      expects: [
        { input: { id: '1', op: '@doSubscribe', from: 'caller' } },
        { output: expect.objectContaining({ op: 'subscribe@val', to: 'Remote' }) },
      ],
    });
  });

  it('stubbed initial re updates local state', async () => {
    await createActor(remoteScript, {
      expects: [
        { input: { id: '1', op: '@doSubscribe', from: 'caller' } },
        { output: expect.objectContaining({ id: '1', op: 'subscribe@val', to: 'Remote' }) },
        { input: { id: '1', re: [7] } },
        { input: { id: '2', op: '@readLast', from: 'caller' } },
        { output: { id: '2', 'bv-a': { last: 'Integer' }, re: { last: 7 }, to: 'caller' } },
      ],
    });
  });

  it('stubbed later re (simulated set notification) replays to handler', async () => {
    await createActor(remoteScript, {
      expects: [
        { input: { id: '1', op: '@doSubscribe', from: 'caller' } },
        { output: expect.objectContaining({ id: '1', op: 'subscribe@val', to: 'Remote' }) },
        { input: { id: '1', re: [0] } },
        { input: { id: '1', re: [5] } },
        { input: { id: '1', re: [10] } },
        { input: { id: '1', re: [42] } },
        { input: { id: '2', op: '@readLast', from: 'caller' } },
        { output: { id: '2', 'bv-a': { last: 'Integer' }, re: { last: 42 }, to: 'caller' } },
      ],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Interop — two separately compiled actors, manually shepherded.
//
// Rather than relying on a runActors-style auto-wiring harness (JS-only
// today), the test spawns publisher and subscriber independently and
// routes messages between them in the test body. Works on any target whose
// single-actor harness (createActor) supports sendAsync + posts inspection.
//
// See notes/multi-actor-test-harness-2026-04-20.md for why a dedicated
// multi-actor runner is deferred.
// ═══════════════════════════════════════════════════════════════════════════════

describe('subscribe — interop (two actors, manually shepherded)', () => {
  // Drain `srcActor.posts` for messages addressed to `dstAddr` that appeared
  // after `srcPrev`, and deliver each one to `dstActor.sendAsync(...)` tagged
  // with `from: srcAddr`. Returns the new srcPrev watermark.
  async function routeNew(srcActor, srcPrev, dstAddr, srcAddr, dstActor) {
    const fresh = srcActor.posts.slice(srcPrev);
    for (const msg of fresh) {
      if (msg.to === dstAddr) {
        await dstActor.sendAsync({ ...msg, from: srcAddr });
      }
    }
    return srcActor.posts.length;
  }

  it('subscriber receives initial value then replay on set from publisher', async () => {
    const publisher = `@val *Integer = 0`;
    const subscriber = `
      < "pub": (pub) { val: *Integer } >

      last *Integer = 0

      @doSubscribe = { pub.val.subscribe |v| { last <- v } ; . }
      @setPub = |:n Integer| { pub.val <- n . }
      @readLast = -> :last as Integer
    `;

    const pub = await createActor(publisher);
    const sub = await createActor(subscriber);
    let pubPrev = pub.posts.length;
    let subPrev = sub.posts.length;

    // 1. Subscribe: caller -> sub. sub posts subscribe@val to pub.
    await sub.sendAsync({ id: '1', op: '@doSubscribe', from: 'caller' });
    subPrev = await routeNew(sub, subPrev, 'pub', 'sub', pub);
    //    pub replies with re:[0] addressed back to sub.
    pubPrev = await routeNew(pub, pubPrev, 'sub', 'pub', sub);
    //    sub's persistent handler runs, last <- 0.
    subPrev = sub.posts.length;

    // 2. Set: caller -> sub. sub posts set@val(77) to pub.
    await sub.sendAsync({ id: '2', op: [{ n: 77 }, '@setPub'], 'bv-a': [{ n: 'Integer' }], from: 'caller' });
    subPrev = await routeNew(sub, subPrev, 'pub', 'sub', pub);
    //    pub mutates state, notifies sub with re:[77] on the subscription id.
    pubPrev = await routeNew(pub, pubPrev, 'sub', 'pub', sub);
    //    sub's handler runs, last <- 77.
    subPrev = sub.posts.length;

    // 3. Read: caller -> sub. sub replies with {last: 77} to caller.
    await sub.sendAsync({ id: '3', op: '@readLast', from: 'caller' });
    const readReply = sub.posts.slice(subPrev).find(p => p.id === '3');
    expect(readReply).toEqual(expect.objectContaining({
      id: '3', re: { last: 77 }, to: 'caller',
    }));
  });
});
