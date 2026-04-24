import { compileActor } from '../helpers.js';

// Mirror of src/codegen/browser/runtime.js domManifest — supplied via
// compileOptions.remotes so <DOM: (:div) *> validates. The in-page runtime
// auto-injects this for <script type="text/brevity">-loaded scripts; the
// test harness path compileActor → spawn does not, so we supply it here.
const DOM_MANIFEST = `{
  div: (:inner_html Text) -> (HTMLElement)
  p: (:inner_html Text) -> (HTMLElement)
  span: (:inner_html Text) -> (HTMLElement)
  h1: (:inner_html Text) -> (HTMLElement)
}`;

async function expectEmission(script, ...steps) {
  const compiled = await compileActor(script, {
    compileOptions: {
      remotes: [{ path: 'DOM', service: DOM_MANIFEST }],
      // Phase 3: opt in to parent-layer address translation. Without this,
      // posts flow through the harness untouched (raw sender frame). With
      // it, the harness acts as the parent — fills in missing `from`,
      // prepends selfAddr to local-form `from`, and rewrites payload
      // `#<@N>` addresses to `#<main @N>` space-inside-angles form.
      selfAddr: 'main',
    },
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
// Templates in handler bodies compile to `new` ops whose `inner_html` payload
// is a single string of the element's literal inner markup, with `{ expr }`
// interpolations substituted inline as `#<@N>` closure address tokens.
// A `{ expr }` inside `<tag>...</tag>` allocates a closure with numeric
// address @N on the enclosing actor (Phase 1 primitive: parameter-less fn,
// at least one ref capture).
//
// Addresses embedded in the inner_html string get the sender's address
// prepended by the parent routing layer (harness) as the message moves
// outward — space-inside-angles form: `#<main @0>`. The generalized
// substring scanner rewrites any `#<@N>` / `#<#N>` local-form token
// anywhere in any string field, not just whole-string values.
//
// Discriminator note: a recipient recognizes an address field purely by the
// presence of `#<…>` in a string value (unescaped). No bv-a dances — type
// annotations don't participate in address-detection.
// ═══════════════════════════════════════════════════════════════════════════════

describe('closure-as-child — template emission', () => {
  // ── Baseline: static inner text round-trips as literal string ───────────
  describe('static inner only', () => {
    it('<div>hello</div> emits inner_html: "hello"', async () => {
      const script = `
        <DOM: (:div) *>
        @create = -> <div>hello</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ inner_html: 'hello' }, 'new'],
          to: 'DOM @div',
        }) },
      );
    });
  });

  // ── Core: single dynamic interpolation → single closure address ─────────
  describe('single dynamic interpolation', () => {
    it('<div>{ content }</div> emits inner_html: "#<@0>"', async () => {
      const script = `
        <DOM: (:div) *>
        content Text! = "initial"
        @create = -> <div>{ content }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ inner_html: '#<main @0>' }, 'new'],
          to: 'DOM @div',
        }) },
      );
    });
  });

  // ── Mixed: literal text with a dynamic token inline ──────────────────────
  describe('mixed static and dynamic inner', () => {
    it('<div>pre { content } post</div> emits inner_html: "pre #<main @0> post"', async () => {
      const script = `
        <DOM: (:div) *>
        content Text! = "middle"
        @create = -> <div>pre { content } post</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ inner_html: 'pre #<main @0> post' }, 'new'],
          to: 'DOM @div',
        }) },
      );
    });
  });

  // ── Numbering: multiple dynamic slots get distinct numeric addresses ─────
  describe('multiple dynamic interpolations', () => {
    it('two adjacent { expr } slots allocate @0 and @1 in source order', async () => {
      const script = `
        <DOM: (:div) *>
        a Text! = "x"
        b Text! = "y"
        @create = -> <div>{ a }{ b }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ inner_html: '#<main @0>#<main @1>' }, 'new'],
          to: 'DOM @div',
        }) },
      );
    });

    it('dynamic slots separated by literals interleave addresses and text', async () => {
      const script = `
        <DOM: (:div) *>
        first Text! = "A"
        last Text! = "Z"
        @create = -> <div>{ first } middle { last }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ inner_html: '#<main @0> middle #<main @1>' }, 'new'],
          to: 'DOM @div',
        }) },
      );
    });
  });

  // ── Nested tags: structural markup stays inline in the inner_html ────────
  describe('nested tags in inner_html', () => {
    it('<div><h1>Title</h1><p>{ content }</p></div> emits inner_html with markup inline', async () => {
      const script = `
        <DOM: (:div) *>
        content Text! = "body"
        @create = -> <div><h1>Title</h1><p>{ content }</p></div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ inner_html: '<h1>Title</h1><p>#<main @0></p>' }, 'new'],
          to: 'DOM @div',
        }) },
      );
    });
  });

  // ── Phase 3: parent fills from, prepends local-form from, rewrites payload ─
  //
  // The harness is the parent of the spawned actor. It translates outbound
  // messages as they leave the child: fills in `from` if the child omitted
  // it (selfAddr = 'main' by convention), prepends selfAddr to local-form
  // `from` values, and rewrites payload `#<@N>` addresses to
  // `#<selfAddr @N>` space-inside-angles form.
  describe('parent-layer translation on outbound', () => {
    it('missing `from` on outbound is filled in with selfAddr', async () => {
      const script = `
        <DOM: (:div) *>
        content Text! = "x"
        @create = -> <div>{ content }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ inner_html: '#<main @0>' }, 'new'],
          to: 'DOM @div',
          from: 'main',
        }) },
      );
    });
  });

  // ── Integration with Phase 1: the emitted closure is subscribable ────────
  //
  // Once the `new` op is emitted with `#<@0>` in children, @0 itself is a
  // real subscribable handler on the enclosing actor (Phase 1 primitive). A
  // caller who has learned the address can subscribe to it directly. This is
  // the hinge Phase 4 will use — DOM.div receives the address as a child,
  // posts subscribe to it, routes re values to DOM updates.
  describe('emitted closure address is independently subscribable', () => {
    it('subscribe to @0 after @create returns the current captured value', async () => {
      const script = `
        <DOM: (:div) *>
        content Text! = "hello"
        @create = -> <div>{ content }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ inner_html: '#<main @0>' }, 'new'],
          to: 'DOM @div',
        }) },
        { input: { id: '2', op: 'subscribe', to: '@0', from: 'c' } },
        { output: expect.objectContaining({ id: '2', re: ['hello'], to: 'c' }) },
      );
    });
  });
});
