import { compileActor } from '../helpers.js';
import { domManifest as HTML_MANIFEST } from '../../src/codegen/browser/runtime.js';

// HTML manifest supplied via compileOptions.remotes so <HTML: (:div)>
// validates. The in-page runtime auto-injects this for <script
// type="text/brevity">-loaded scripts; the test harness path compileActor →
// spawn does not, so we supply it here.

async function expectEmission(script, ...steps) {
  const compiled = await compileActor(script, {
    compileOptions: {
      remotes: [{ path: 'HTML', service: HTML_MANIFEST }],
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
// Template emission — structured children wire shape.
//
// Templates in handler bodies compile to `new` ops whose payload carries
// `children: [...]` — an ordered array matching the XML Information Set's
// `[children]` property. Entries are:
//
//   - bare text strings — literal text runs
//   - `#<actor @N>` address strings — closure subscribers (from `{ expr }`
//     interpolations; synthesizeTemplateClosures allocates @N per actor)
//   - `#<HTML @tag/N>` address strings — already-live nested element actors
//     (pre-dispatched by the codegen's await chain before the parent)
//
// Addresses in local form (`#<@N>` as the sender emits) get the sender's
// address prepended by the parent routing layer (harness) on outbound —
// `#<main @0>` space-inside-angles form. Global form (word-char start
// inside the angles) is left alone. The discriminator is the leading char:
// non-word = local, word = global.
//
// Tests here use a capture-only harness (no HTML responder). Only the first
// outbound `new` lands in posts before the await chain blocks on a reply;
// end-to-end traversal through nested elements is covered by
// nested_template.browser.test.js and factory_end_to_end.browser.test.js
// which use the real in-page runtime.
// ═══════════════════════════════════════════════════════════════════════════════

describe('template emission — structured children wire shape', () => {
  // ── Baseline: static inner text round-trips as a single text child ──────
  describe('static inner only', () => {
    it('<div>hello</div> emits children: ["hello"]', async () => {
      const script = `
        *(HTML: (:div))
        =
        @create = -> <div>hello</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['hello'] }, '#new'],
          to: 'HTML @div',
        }) },
      );
    });
  });

  // ── Core: single dynamic interpolation → single closure address entry ───
  describe('single dynamic interpolation', () => {
    it('<div>{ content }</div> emits children: ["#<main @0>"]', async () => {
      const script = `
        *(HTML: (:div))
        =
        content *Text = "initial"
        @create = -> <div>{ content }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['#<main @0>'] }, '#new'],
          to: 'HTML @div',
        }) },
      );
    });
  });

  // ── Mixed: literal text interleaved with a dynamic closure address ──────
  describe('mixed static and dynamic inner', () => {
    it('<div>pre { content } post</div> emits interleaved children', async () => {
      const script = `
        *(HTML: (:div))
        =
        content *Text = "middle"
        @create = -> <div>pre { content } post</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['pre ', '#<main @0>', ' post'] }, '#new'],
          to: 'HTML @div',
        }) },
      );
    });
  });

  // ── Numbering: multiple dynamic slots get distinct numeric addresses ────
  describe('multiple dynamic interpolations', () => {
    it('two adjacent { expr } slots allocate @0 and @1 in source order', async () => {
      const script = `
        *(HTML: (:div))
        =
        a *Text = "x"
        b *Text = "y"
        @create = -> <div>{ a }{ b }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['#<main @0>', '#<main @1>'] }, '#new'],
          to: 'HTML @div',
        }) },
      );
    });

    it('dynamic slots separated by literals interleave addresses and text', async () => {
      const script = `
        *(HTML: (:div))
        =
        first *Text = "A"
        last *Text = "Z"
        @create = -> <div>{ first } middle { last }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['#<main @0>', ' middle ', '#<main @1>'] }, '#new'],
          to: 'HTML @div',
        }) },
      );
    });
  });

  // ── Nested elements: pre-dispatched, addresses placed in parent children ─
  //
  // Codegen walks nested DomConstructors with sequential awaits. Each nested
  // `new` posts before its await resolves; the returned address is placed
  // into the parent's children array. Here the capture-only harness never
  // replies, so only the first pre-dispatch lands in posts — the inner <h1>
  // (source-first nested element). End-to-end nesting (all posts flowing,
  // addresses threading through) is covered by nested_template.browser.test.js.
  describe('nested tags pre-dispatch in source order', () => {
    it('<div><h1>Title</h1><p>{ content }</p></div> posts <h1> first', async () => {
      const script = `
        *(HTML: (:div, :h1, :p))
        =
        content *Text = "body"
        @create = -> <div><h1>Title</h1><p>{ content }</p></div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['Title'] }, '#new'],
          to: 'HTML @h1',
        }) },
      );
    });
  });

  // ── Phase 3: parent fills from, prepends local-form from, rewrites payload
  //
  // The harness is the parent of the spawned actor. It translates outbound
  // messages as they leave the child: fills in `from` if the child omitted
  // it (selfAddr = 'main' by convention), prepends selfAddr to local-form
  // `from` values, and rewrites payload `#<@N>` addresses to
  // `#<selfAddr @N>` space-inside-angles form.
  describe('parent-layer translation on outbound', () => {
    it('missing `from` on outbound is filled in with selfAddr', async () => {
      const script = `
        *(HTML: (:div))
        =
        content *Text = "x"
        @create = -> <div>{ content }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['#<main @0>'] }, '#new'],
          to: 'HTML @div',
          from: 'main',
        }) },
      );
    });
  });

  // ── Integration with Phase 1: the emitted closure is subscribable ───────
  //
  // Once the `new` op is emitted with `#<@0>` in children, @0 itself is a
  // real subscribable handler on the enclosing actor (Phase 1 primitive). A
  // caller who has learned the address can subscribe to it directly.
  describe('emitted closure address is independently subscribable', () => {
    it('subscribe to @0 after @create returns the current captured value', async () => {
      const script = `
        *(HTML: (:div))
        =
        content *Text = "hello"
        @create = -> <div>{ content }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['#<main @0>'] }, '#new'],
          to: 'HTML @div',
        }) },
        { input: { id: '2', op: '@subscribe', to: '@0', from: 'c' } },
        { output: expect.objectContaining({ id: '2', re: ['hello'], to: 'c' }) },
      );
    });
  });
});
