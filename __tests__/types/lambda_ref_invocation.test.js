import { compileActor, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════
// Runtime invocation of a locally-constructed lambda held in a callback slot.
//
// Companion to lambda_param_inference.test.js, which proves a lambda filling a
// callback slot infers its parameter type (and implicitly imports it, scoped).
// Here we prove the lowered lambda actually RUNS through CAM:
//
//   - assigned to a service-hosted type's callback field, then invoked locally;
//   - passed to a service method as a callback, where the remote holds a
//     fully-qualified reference back to it and invokes it through CAM.
//
// A lambda in a routed position is lowered to a synthesized dispatch handler
// `@N` and encoded as a local-form self-address `#<@N>` — the same convention
// the DOM closure-prop path uses. The host's perspective translation promotes
// `#<@N>` to `#<selfAddr @N>` as the carrying message leaves the actor, so a
// holder on another actor gets a reference it can route back through. The base
// runner doesn't relay in-process, so these tests model that promotion
// explicitly when invoking the reference back.
//
// Fully fictional service (`Widget`) and types (`Signal`, `Panel`) — no DOM,
// no browser. The Signal's `dismiss` is a silent endpoint reference; invoking
// `s.dismiss()` inside the lambda fires to whatever address the value carries,
// which is how each test observes that the lambda ran against a correctly
// reconstructed, reference-bearing value. (Members are called by their declared
// names — `onpress`, `dismiss` — with no `!`: silentness comes from the `-> .`
// return type, not a call-site sigil.)
// ═══════════════════════════════════════════════════════════════════════════

const WIDGET_FIELD = `{
  ::Signal = (dismiss: () -> ., code: Integer)
  ::Panel = (onpress: (s: Signal) -> ., label: Text)
}`;

const WIDGET_METHOD = `{
  ::Signal = (dismiss: () -> ., code: Integer)
  watch: (on: (s: Signal) -> .) -> .
}`;

// A Signal value as it arrives on the wire: its silent `dismiss` reference
// holds an address, its `code` a datum. Positional — all fields required.
const sigWire = ['#<caller @d>', 7];
const sigTag = '#<Widget ::Signal>';

// ── Carrier 1: a service-hosted type's callback field ────────────────────────
// Construct `Panel` (imported from Widget) with a lambda for its `onpress`
// callback field, then invoke that field locally. The lambda's body fires the
// Signal's silent `dismiss` reference, which must reach the carried address.

describe('lambda ref invocation — service-hosted type callback field', () => {
  const fixture = `
    *( "Widget": (:Panel) )
    =
    // Generic lambda: param type inferred as Widget::Signal from the field.
    @generic = (sig: Widget::Signal) {
      p = Panel(onpress: (s) { s.dismiss() }, label: "a")
      p.onpress(sig)
      .
    }
    // Typed lambda: param explicitly qualified, matching the slot.
    @typed = (sig: Widget::Signal) {
      p = Panel(onpress: (s Widget::Signal) { s.dismiss() }, label: "b")
      p.onpress(sig)
      .
    }
  `;
  const remotes = [{ path: 'Widget', service: WIDGET_FIELD }];

  it('invokes a generic lambda assigned to the field (fires to the carried address)', async () => {
    const actor = await (await compileActor(fixture, { compileOptions: { remotes } })).spawn();
    await expectActorBehavior(actor,
      { input: { id: '1', op: [{ sig: sigWire }, '@generic'], 'bv-a': [{ sig: sigTag }], from: 'caller' } },
      { output: { id: expect.any(String), op: '@d', to: '#<caller @d>' } },
    );
  });

  it('invokes a correctly-typed lambda assigned to the field', async () => {
    const actor = await (await compileActor(fixture, { compileOptions: { remotes } })).spawn();
    await expectActorBehavior(actor,
      { input: { id: '2', op: [{ sig: sigWire }, '@typed'], 'bv-a': [{ sig: sigTag }], from: 'caller' } },
      { output: { id: expect.any(String), op: '@d', to: '#<caller @d>' } },
    );
  });
});

// ── Carrier 2: a service method callback parameter, invoked through CAM ───────
// Pass a lambda to `Widget.watch`. The outgoing call must carry a routable
// self-reference to the lambda (`#<@N>`), not a bare label. Then — modelling
// the host promoting it to `#<selfAddr @N>` and the remote invoking it — a CAM
// message routed to that reference runs the lambda.

describe('lambda ref invocation — service method callback param (CAM round-trip)', () => {
  const fixture = `
    *( "Widget": (Widget) )
    =
    @go = { Widget.watch(on: (s) { s.dismiss() }) . }
  `;
  const remotes = [{ path: 'Widget', service: WIDGET_METHOD }];

  it('hands the remote a routable self-reference to the lambda', async () => {
    const actor = await (await compileActor(fixture, { compileOptions: { remotes } })).spawn();
    await actor.sendAsync({ id: '1', op: '@go', from: 'caller' });
    const watch = actor.posts.find(p => Array.isArray(p.op) && p.op[p.op.length - 1] === '@watch');
    expect(watch).toBeTruthy();
    expect(watch.to).toBe('Widget');
    // The callback arg is a local-form self-address (#<@N>): a reference the
    // host promotes to #<selfAddr @N> so the remote can route back to us.
    expect(watch.op[0].on).toMatch(/^#<@\d+>$/);
  });

  it('runs the lambda when the remote invokes the reference through CAM', async () => {
    const actor = await (await compileActor(fixture, { compileOptions: { remotes } })).spawn();
    await actor.sendAsync({ id: '1', op: '@go', from: 'caller' });
    const watch = actor.posts.find(p => Array.isArray(p.op) && p.op[p.op.length - 1] === '@watch');
    const selector = watch.op[0].on.slice(2, -1); // '#<@0>' → '@0'

    const before = actor.posts.length;
    // The host promoted our reference to a fully-qualified address; the remote
    // invokes the callback through CAM by sending to it (positional arg, as a
    // callback invocation is lowered). The value arrives as a wire Signal.
    await actor.sendAsync({
      id: '2',
      op: [[sigWire], selector],
      'bv-a': [[sigTag]],
      to: `#<here ${selector}>`,
      from: 'Widget',
    });
    const fired = actor.posts.slice(before);
    expect(fired).toContainEqual(
      expect.objectContaining({ op: '@d', to: '#<caller @d>' }),
    );
  });
});
