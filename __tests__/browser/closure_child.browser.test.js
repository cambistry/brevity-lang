import { compileActor } from '../helpers.js';

// Mirror of src/codegen/browser/runtime.js domManifest — supplied via
// compileOptions.remotes so <DOM: (:div) *> validates. The in-page runtime
// auto-injects this for <script type="text/brevity">-loaded scripts; the
// test harness path compileActor → spawn does not, so we supply it here.
const DOM_MANIFEST = `{
  div: (:children List) -> (HTMLElement)
  p: (:children List) -> (HTMLElement)
  span: (:children List) -> (HTMLElement)
}`;

async function expectEmission(script, ...steps) {
  const compiled = await compileActor(script, {
    compileOptions: { remotes: [{ path: 'DOM', service: DOM_MANIFEST }] },
  });
  const actor = await compiled.spawn();
  let postIndex = actor.posts.length;
  for (const step of steps) {
    if (step.input) await actor.sendAsync(step.input);
    else if (step.output) {
      expect(actor.posts[postIndex]).toEqual(step.output);
      postIndex++;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Closure-as-child — template emission (Layer A Phase 2).
//
// Templates in handler bodies compile to `new` ops whose `children` payload
// interleaves literal strings (static text) and `<<@N>>` closure addresses
// (dynamic expressions). A `{ expr }` interpolation inside `<tag>...</tag>`
// allocates a closure with numeric address @N on the enclosing actor,
// reusing Phase 1's mechanism (parameter-less fn, at least one ref capture).
//
// Addresses are emitted in the sender-local frame (bare `<<@N>>`). Phase 3
// will add transport-layer rewriting to tree-global form
// (e.g. `<</factory.bv @0>>` after hop).
//
// The `to` field on the outbound `new` op is pinned to "DOM @div" — plain
// alias + selector, no angle brackets around DOM yet. Full wire shape with
// `<<DOM>> @div` (where angles mark DOM as requiring transport re-
// coordination, stripped on delivery to the DOM actor as bare "@div")
// activates when translation lands. Single-process browser pass doesn't
// need it yet.
//
// Discriminator note: a recipient recognizes an address field purely by the
// presence of `<<…>>` in a string value (unescaped). No bv-a dances — type
// annotations don't participate in address-detection. Applies uniformly to
// `to`, `re`, and payload-carried addresses like `children`.
// ═══════════════════════════════════════════════════════════════════════════════

describe('closure-as-child — template emission', () => {
  // ── Baseline: static children round-trip as literal strings ──────────────
  describe('static children only', () => {
    it('<div>hello</div> emits children: ["hello"]', async () => {
      const script = `
        <DOM: (:div) *>
        @create = -> <div>hello</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['hello'] }, 'new'],
          to: 'DOM @div',
        }) },
      );
    });
  });

  // ── Core: single dynamic child → single closure address ──────────────────
  describe('single dynamic child', () => {
    it('<div>{ content }</div> emits children: ["<<@0>>"]', async () => {
      const script = `
        <DOM: (:div) *>
        content *Text = "initial"
        @create = -> <div>{ content }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['<<@0>>'] }, 'new'],
          to: 'DOM @div',
        }) },
      );
    });
  });

  // ── Mixed: literal text interleaved with dynamic slots ───────────────────
  describe('mixed static and dynamic children', () => {
    it('<div>pre { content } post</div> interleaves ["pre ", "<<@0>>", " post"]', async () => {
      const script = `
        <DOM: (:div) *>
        content *Text = "middle"
        @create = -> <div>pre { content } post</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['pre ', '<<@0>>', ' post'] }, 'new'],
          to: 'DOM @div',
        }) },
      );
    });
  });

  // ── Numbering: multiple dynamic slots get distinct numeric addresses ─────
  describe('multiple dynamic children', () => {
    it('two adjacent { expr } slots allocate @0 and @1 in source order', async () => {
      const script = `
        <DOM: (:div) *>
        a *Text = "x"
        b *Text = "y"
        @create = -> <div>{ a }{ b }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['<<@0>>', '<<@1>>'] }, 'new'],
          to: 'DOM @div',
        }) },
      );
    });

    it('dynamic slots separated by literals interleave addresses and text', async () => {
      const script = `
        <DOM: (:div) *>
        first *Text = "A"
        last *Text = "Z"
        @create = -> <div>{ first } middle { last }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['<<@0>>', ' middle ', '<<@1>>'] }, 'new'],
          to: 'DOM @div',
        }) },
      );
    });
  });

  // ── Integration with Phase 1: the emitted closure is subscribable ────────
  //
  // Once the `new` op is emitted with `<<@0>>` in children, @0 itself is a
  // real subscribable handler on the enclosing actor (Phase 1 primitive). A
  // caller who has learned the address can subscribe to it directly. This is
  // the hinge Phase 4 will use — DOM.div receives the address as a child,
  // posts subscribe to it, routes re values to DOM updates.
  describe('emitted closure address is independently subscribable', () => {
    it('subscribe to @0 after @create returns the current captured value', async () => {
      const script = `
        <DOM: (:div) *>
        content *Text = "hello"
        @create = -> <div>{ content }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['<<@0>>'] }, 'new'],
          to: 'DOM @div',
        }) },
        { input: { id: '2', op: 'subscribe', to: '@0', from: 'c' } },
        { output: expect.objectContaining({ id: '2', re: ['hello'], to: 'c' }) },
      );
    });
  });
});
