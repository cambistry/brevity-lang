import { compileActor, compileSource } from '../helpers.js';
import { domManifest as HTML_MANIFEST } from '../../src/codegen/browser/runtime.js';

// ═══════════════════════════════════════════════════════════════════════════════
// XML text interpolation — `#{expr}` inside element bodies
//
// In XML text content, `#{expr}` is a pure string interpolation: the expression
// evaluates once when the parent element is constructed, is stringified via
// `_bv_str`, and is spliced inline as a text run. It is NOT reactive — the
// lexer does not synthesize a closure for it; the JS codegen emits the
// stringified value directly into the structured-children wire array.
//
// Contrast with `{expr}` (the prior form): that lifts `expr` into a
// synthesized `@N` closure on the enclosing actor and sends the closure
// address `#<main @N>` on the wire; the HTML runtime subscribes and lives
// re-renders. Reactivity comes from the closure; `#{}` is a snapshot splice.
//
// Escapes in XML text are narrow:
//   \\   → literal backslash
//   \{   → literal `{` (would otherwise open a closure)
//   \#{  → literal `#{` (would otherwise open an interpolation)
//   anything else after a backslash → compile error
// ═══════════════════════════════════════════════════════════════════════════════

async function expectEmission(script, ...steps) {
  const compiled = await compileActor(script, {
    compileOptions: {
      remotes: [{ path: 'HTML', service: HTML_MANIFEST }],
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

describe('XML text interpolation `#{expr}`', () => {
  // ── Snapshot interpolation of various primitive value types ─────────────

  describe('primitive value stringification', () => {
    it('Text ref value is spliced as-is', async () => {
      const script = `
        <HTML: (:div)>
        content Text! = "hello"
        @create = -> <div>#{ content }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['hello'] }, 'new'],
          to: 'HTML @div',
        }) },
      );
    });

    it('Integer ref value is spliced in decimal', async () => {
      const script = `
        <HTML: (:div)>
        count Integer! = 42
        @create = -> <div>#{ count }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['42'] }, 'new'],
          to: 'HTML @div',
        }) },
      );
    });

    it('Boolean ref value is spliced as "true"/"false"', async () => {
      const script = `
        <HTML: (:div)>
        flag Boolean! = true
        @create = -> <div>#{ flag }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['true'] }, 'new'],
          to: 'HTML @div',
        }) },
      );
    });

    it('Float ref value is spliced in JSON-compatible e-notation', async () => {
      const script = `
        <HTML: (:div)>
        ratio Float! = 1.0e-1
        @create = -> <div>#{ ratio }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['1.0e-1'] }, 'new'],
          to: 'HTML @div',
        }) },
      );
    });
  });

  // ── Non-reactive: `#{ }` does NOT synthesize a closure address ──────────

  describe('non-reactive — no closure is synthesized', () => {
    it('`#{x}` emits no `#<main @N>` address for its expression', async () => {
      const script = `
        <HTML: (:div)>
        content Text! = "hello"
        @create = -> <div>#{ content }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['hello'] }, 'new'],
        }) },
      );
    });

    it('`{x}` and `#{x}` coexist — `{}` breaks a run; adjacent text + `#{}` merges', async () => {
      const script = `
        <HTML: (:div)>
        a Text! = "dynamic"
        b Text! = "static"
        @create = -> <div>{ a } / #{ b }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['#<main @0>', ' / static'] }, 'new'],
          to: 'HTML @div',
        }) },
      );
    });
  });

  // ── Mixed text + interpolation runs ─────────────────────────────────────
  //
  // `#{}` is pure textual splice — it does NOT impose a child-node boundary.
  // Adjacent literal text + `#{}` pieces merge into a single concatenated
  // string child on the wire.

  describe('mixed static text and interpolation merges into one text child', () => {
    it('literal text surrounding `#{expr}` concatenates into one child', async () => {
      const script = `
        <HTML: (:div)>
        name Text! = "world"
        @create = -> <div>hello #{ name }!</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['hello world!'] }, 'new'],
        }) },
      );
    });

    it('two adjacent `#{}` concatenate into one child', async () => {
      const script = `
        <HTML: (:div)>
        a Text! = "x"
        b Text! = "y"
        @create = -> <div>#{ a }#{ b }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['xy'] }, 'new'],
        }) },
      );
    });

    it('a reactive `{}` DOES break a run; text either side is merged with any adjacent `#{}`', async () => {
      const script = `
        <HTML: (:div)>
        pre_val Text! = "p"
        reactive Text! = "r"
        post_val Text! = "q"
        @create = -> <div>A #{ pre_val } B { reactive } C #{ post_val } D</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['A p B ', '#<main @0>', ' C q D'] }, 'new'],
        }) },
      );
    });
  });

  // ── Interpolation inside nested elements ────────────────────────────────

  describe('nested elements', () => {
    it('`#{}` inside a nested tag merges with surrounding text into one child', async () => {
      const script = `
        <HTML: (:div, :p)>
        name Text! = "Chris"
        @create = -> <div><p>hi #{ name }</p></div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['hi Chris'] }, 'new'],
          to: 'HTML @p',
        }) },
      );
    });
  });

  // ── Escape sequences ────────────────────────────────────────────────────

  describe('escape sequences in XML text', () => {
    it('`\\\\` emits a single backslash', async () => {
      const script = `
        <HTML: (:div)>
        @create = -> <div>a \\\\ b</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['a \\ b'] }, 'new'],
        }) },
      );
    });

    it('`\\{` emits a literal `{` (not a closure)', async () => {
      const script = `
        <HTML: (:div)>
        @create = -> <div>\\{ not a closure }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['{ not a closure }'] }, 'new'],
        }) },
      );
    });

    it('`\\#{` emits a literal `#{` (not an interpolation)', async () => {
      const script = `
        <HTML: (:div)>
        @create = -> <div>\\#{ not an interp }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['#{ not an interp }'] }, 'new'],
        }) },
      );
    });

    it('bare `#` without `{` stays literal', async () => {
      const script = `
        <HTML: (:div)>
        @create = -> <div>price: #5</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['price: #5'] }, 'new'],
        }) },
      );
    });

    it('escapes and live interpolation coexist, merged into one text child', async () => {
      const script = `
        <HTML: (:div)>
        x Text! = "ok"
        @create = -> <div>\\\\ \\{ \\#{ #{ x }</div>
      `;
      await expectEmission(script,
        { input: { id: '1', op: '@create', from: 'c' } },
        { output: expect.objectContaining({
          op: [{ children: ['\\ { #{ ok'] }, 'new'],
        }) },
      );
    });
  });

  // ── Compile errors on unsupported escapes ──────────────────────────────

  describe('invalid escapes are compile errors', () => {
    const mustFail = (body) => {
      expect(() => compileSource(`
        <HTML: (:div)>
        @create = -> <div>${body}</div>
      `, {
        remotes: [{ path: 'HTML', service: HTML_MANIFEST }],
      })).toThrow();
    };

    it('`\\n` is rejected', () => mustFail('a\\nb'));
    it('`\\t` is rejected', () => mustFail('a\\tb'));
    it('`\\"` is rejected', () => mustFail('a\\"b'));
    it('`\\#` without `{` is rejected', () => mustFail('a\\#b'));
    it('trailing lone `\\` is rejected', () => mustFail('a\\'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Non-reactive `{expr}` collapse — runtime wire output
//
// `{ expr }` where expr has no RefRead nodes collapses to an inline text splice
// (same wire shape as `#{expr}`). Reactive `{ expr }` (reads a * ref) continues
// to emit a `#<actor @N>` subscription address.
//
// Pure-thunk case: `{ para }` where `para = -> <p>…</p>` inlines the element —
// the <p> is pre-dispatched before the parent <div>, exactly as if the element
// were written inline as a nested tag.
// ═══════════════════════════════════════════════════════════════════════════════

describe('non-reactive { expr } collapses to inline text', () => {
  it('plain Text binding inlines as text (no closure address)', async () => {
    const script = `
      <HTML: (:div)>
      label Text = "hello"
      @create = -> <div>{ label }</div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: ['hello'] }, 'new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('non-reactive Text binding with surrounding text merges into one child', async () => {
    const script = `
      <HTML: (:div)>
      name Text = "world"
      @create = -> <div>hello { name }!</div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: ['hello world!'] }, 'new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('reactive Text ref still emits a closure address', async () => {
    const script = `
      <HTML: (:div)>
      label Text! = "hello"
      @create = -> <div>{ label }</div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: ['#<main @0>'] }, 'new'],
        to: 'HTML @div',
      }) },
    );
  });

  it('reactive and non-reactive Text slots coexist: address + inlined text', async () => {
    const script = `
      <HTML: (:div)>
      reactive Text! = "r"
      constant Text = "c"
      @create = -> <div>{ reactive } / { constant }</div>
    `;
    await expectEmission(script,
      { input: { id: '1', op: '@create', from: 'c' } },
      { output: expect.objectContaining({
        op: [{ children: ['#<main @0>', ' / c'] }, 'new'],
        to: 'HTML @div',
      }) },
    );
  });
});

describe('non-reactive { expr } — pure thunk inlining', () => {
  it('{ para } pre-dispatches <p> then delivers its address to <div>', async () => {
    // para = -> <p>Inner</p> is a pure thunk; { para } inside <div> inlines the
    // DomConstructor. The <p> is pre-dispatched first; once we stub its reply
    // the actor continues and sends <div> with the <p> address in children.
    const script = `
      <HTML: (:div, :p)>
      para = -> <p>Inner</p>
      @create = -> <div>{ para }</div>
    `;
    const compiled = await compileActor(script, {
      compileOptions: {
        remotes: [{ path: 'HTML', service: HTML_MANIFEST }],
        selfAddr: 'main',
      },
    });
    const actor = await compiled.spawn();

    // Trigger @create — actor pre-dispatches <p>
    await actor.sendAsync({ id: '1', op: '@create', from: 'c' });
    const pPost = actor.posts[0];
    expect(pPost).toEqual(expect.objectContaining({
      op: [{ children: ['Inner'] }, 'new'],
      to: 'HTML @p',
    }));

    // Stub the HTML @p reply with a constructed element address
    await actor.sendAsync({ id: pPost.id, re: '#<HTML @p/1>' });

    // Actor continues and sends <div> with the <p> address in children
    expect(actor.posts[1]).toEqual(expect.objectContaining({
      op: [{ children: ['#<HTML @p/1>'] }, 'new'],
      to: 'HTML @div',
    }));
  });
});
