import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Closure-as-address primitive.
//
// A closure bound to a bare name at top level — `f = { expr }` — becomes a
// first-class addressable entity on its enclosing actor. The compiler
// allocates each such closure a numeric wire-address (`@0`, `@1`, …) by
// source-position walk. Captured `*` refs trigger replay on change, same
// protocol as cell/fn subscribe: initial `re` with current computed value,
// subsequent `re`s under the same subscription id when any dependency
// mutates.
//
// This is Phase 1 of Layer A — the closure primitive in isolation. Phase 2
// adds payload-carried closure addresses in template `new` ops; Phase 3
// adds transport-layer translation to tree-global form. This test only
// exercises the local wire-level behavior.
//
// Source shape (what Phase 1 must compile):
//
//   content *Text = "initial"
//   f = { content }
//   @bump = (:v Text) { content <- v . }
//
// Wire form:
//
//   subscriber: { id: '1', op: '@subscribe', to: '@0', from: 'c' }
//   publisher:  { id: '1', re: ['initial'], to: 'c' }
//
// bv-a on the reply is not asserted — closure subscribes follow the existing
// fn-subscribe shape (no bv-a emitted), which is consistent with @pub-style
// fns today. Type annotation on fn-subscribe replies is an orthogonal
// improvement that applies uniformly.
//
// ═══════════════════════════════════════════════════════════════════════════════

describe('closure-as-address — primitive', () => {
  const singleClosure = `
    content *Text = "initial"
    f = { content }
    @bump = (:v Text) { content <- v . }
  `;

  it('subscribe to @0 receives initial closure value', async () => {
    await expectBehavior(singleClosure,
      { input: { id: '1', op: '@subscribe', to: '@0', from: 'c' } },
      { output: { id: '1', re: ['initial'], to: 'c' } },
    );
  });

  it('set of captured ref replays to closure subscriber under same id', async () => {
    await expectBehavior(singleClosure,
      { input: { id: '1', op: '@subscribe', to: '@0', from: 'c' } },
      { output: { id: '1', re: ['initial'], to: 'c' } },
      { input: { id: '2', op: [{ v: 'updated' }, '@bump'], 'bv-a': [{ v: 'Text' }], from: 'c' } },
      { output: { id: '1', re: ['updated'], to: 'c' } },
    );
  });

  it('multiple sets each replay with same subscription id', async () => {
    await expectBehavior(singleClosure,
      { input: { id: '1', op: '@subscribe', to: '@0', from: 'c' } },
      { output: { id: '1', re: ['initial'], to: 'c' } },
      { input: { id: '2', op: [{ v: 'a' }, '@bump'], 'bv-a': [{ v: 'Text' }], from: 'c' } },
      { output: { id: '1', re: ['a'], to: 'c' } },
      { input: { id: '3', op: [{ v: 'b' }, '@bump'], 'bv-a': [{ v: 'Text' }], from: 'c' } },
      { output: { id: '1', re: ['b'], to: 'c' } },
    );
  });

  // Closures get numeric addresses in source-position order. `f` is the first
  // closure declared → `@0`; `g` is the second → `@1`. Each tracks its own
  // captures independently (here both capture the same `content`, but the
  // replay is one per subscription).
  const twoClosures = `
    content *Text = "hi"
    f = { content }
    g = { content }
    @bump = (:v Text) { content <- v . }
  `;

  it('second closure binding gets @1', async () => {
    await expectBehavior(twoClosures,
      { input: { id: 'A', op: '@subscribe', to: '@0', from: 'a' } },
      { output: { id: 'A', re: ['hi'], to: 'a' } },
      { input: { id: 'B', op: '@subscribe', to: '@1', from: 'b' } },
      { output: { id: 'B', re: ['hi'], to: 'b' } },
      { input: { id: 'C', op: [{ v: 'bye' }, '@bump'], 'bv-a': [{ v: 'Text' }], from: 'c' } },
      { output: { id: 'A', re: ['bye'], to: 'a' } },
      { output: { id: 'B', re: ['bye'], to: 'b' } },
    );
  });

  // Numeric and alphabetic namespaces are disjoint by grammar. A closure at
  // @0 and a public handler at @bump coexist without collision.
  it('numeric @0 and alphabetic @bump dispatch independently', async () => {
    await expectBehavior(singleClosure,
      { input: { id: '1', op: [{ v: 'x' }, '@bump'], 'bv-a': [{ v: 'Text' }], from: 'c' } },
      { input: { id: '2', op: '@subscribe', to: '@0', from: 'c' } },
      { output: { id: '2', re: ['x'], to: 'c' } },
    );
  });
});
