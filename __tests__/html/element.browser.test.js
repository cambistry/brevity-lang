import { compileSource } from '../helpers.js';
import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';
import { domManifest as HTML_MANIFEST } from '../../src/codegen/browser/runtime.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HTML element — compile-time, service-side, actor-side
//
// HTML is a browser affordance, so all element tests live alongside the
// browser-runtime tests in this file. Three layers, in order:
//
//   1. Compile-time discipline — typed constructor (`div(...)`) validates
//      attribute types against Element + Aria via the manifest, no browser
//      involved. Drives via compileSource.
//
//   2. Service-side runtime — sending raw CAM `new` messages directly to
//      `HTML @div` and asserting the runtime mints addresses, increments
//      per-tag counters, and surfaces innerHTML.
//
//   3. Actor-side runtime — a Brevity actor file using `<div>...</div>`
//      XML syntax should emit the right CAM `new` and forward the
//      element address back to its caller.
//
// The compile-time tests use a TRIMMED in-test manifest covering one of
// each typed family (Boolean / Integer / Decimal / Text / Aria /
// Structure / List of Texts) — covering the full 70-attribute surface
// adds nothing since the validator's discipline is the same for one
// Boolean param as for ten.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Step-list helper for runtime sections (matches expectActorBehavior) ──────

async function expectBehavior(actor, ...steps) {
  let postIndex = 0;
  for (const step of steps) {
    if (step.input && step.output) throw new Error('Cannot include both input and output in the same step.');
    if (step.input) {
      await actor.sendAsync(step.input);
    } else if (step.output) {
      expect(actor.posts[postIndex]).toEqual(step.output);
      postIndex++;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Compile-time discipline — typed constructor against Element + Aria
//
// `<HTML: (:div, :Aria)>` destructures into local scope and consumes the HTML
// name. Canonical call form is therefore bare: `div(...)` and `Aria(...)`,
// not `HTML.div(...)`.
//
// Nullable params (`Type | null`) on manifest types auto-default to null so
// callers don't have to thread null through every unused attribute. Local
// actor types keep the strict default.
//
// Tests import domManifest directly — the same string the browser runtime
// registers at startup — so we exercise the real ~70-attribute Element and
// ~50-attribute Aria surface, not a hand-rolled trimmed copy.
// ═══════════════════════════════════════════════════════════════════════════════

const compileWithHTML = (src) =>
  compileSource(src, { remotes: [{ path: 'HTML', service: HTML_MANIFEST }] });

describe('HTML element compile — happy path', () => {
  it('div() with no args (all params nullable)', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div() . }
    `)).not.toThrow();
  });

  it('div(:id Text) — inherited Text attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(id: "header") . }
    `)).not.toThrow();
  });

  it('div(:hidden Boolean) — inherited Boolean attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(hidden: true) . }
    `)).not.toThrow();
  });

  it('div(:tabindex Integer) — inherited Integer attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(tabindex: 0) . }
    `)).not.toThrow();
  });

  it('div(:aria Aria) — bucketed nested constructor', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div, :Aria)>
      =
      @test = {
        a = Aria(label: "Close")
        d = div(aria: a)
        .
      }
    `)).not.toThrow();
  });

  it('div with multiple inherited attrs at once', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(id: "x", hidden: true, tabindex: 1) . }
    `)).not.toThrow();
  });

  it('div(:children) — content via structured children', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(children: ["Hello"]) . }
    `)).not.toThrow();
  });

  it('Aria(:level Integer) — own attr on bucketed type', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Aria)>
      =
      @test = { a = Aria(level: 2) . }
    `)).not.toThrow();
  });

  it('Aria(:valuenow Decimal) — Decimal attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Aria)>
      =
      @test = { a = Aria(valuenow: 0.5) . }
    `)).not.toThrow();
  });
});

describe('HTML element compile — type mismatches (sad path)', () => {
  it('div(:hidden Text) is rejected — expects Boolean', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(hidden: "true") . }
    `)).toThrow(/named arg 'hidden'.*'Text' is not assignable to 'Boolean \| null'/);
  });

  it('div(:tabindex Text) is rejected — expects Integer', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(tabindex: "1") . }
    `)).toThrow(/named arg 'tabindex'.*'Text' is not assignable to 'Integer \| null'/);
  });

  it('Aria(:level Text) is rejected — expects Integer', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Aria)>
      =
      @test = { a = Aria(level: "high") . }
    `)).toThrow(/named arg 'level'.*'Text' is not assignable to 'Integer \| null'/);
  });

  it('div(:aria Text) is rejected — expects Aria', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(aria: "Close") . }
    `)).toThrow(/named arg 'aria'.*'Text' is not assignable to 'Aria \| null'/);
  });

  it('div(:inner_html ...) is rejected — inner_html is a method, not a constructor attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(inner_html: "Hello") . }
    `)).toThrow(/Got named: inner_html/);
  });
});

describe('HTML element compile — unknown attrs (sad path)', () => {
  it('div(:nope ...) is rejected — :nope is not on Element', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(nope: "x") . }
    `)).toThrow(/Got named: nope/);
  });

  it('div(:label ...) is rejected — :label belongs on Aria, not Element', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(label: "Close") . }
    `)).toThrow(/Got named: label/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Service-side runtime — raw CAM `new` to `HTML @tag`
//
// connectActor establishes a com channel to an existing address (like
// "HTML @div") so we can send messages and assert replies.
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTML element runtime — service side', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    </head><body></body></html>`;

  it('HTML @div new creates a <div> and responds with element address', async () => {
    const page = await loadPage(html);
    const dom = await page.connectActor('HTML @div');

    await expectBehavior(dom,
      { input: { id: '1', op: [{ children: ['Hello'] }, 'new'] } },
      { output: expect.objectContaining({ id: '1', re: '#<HTML @div/1>', 'bv-a': '#<HTML @div>', from: 'HTML' }) },
    );
  });

  it('created element is addressable and has correct content', async () => {
    const page = await loadPage(html);
    const dom = await page.connectActor('HTML @div');

    await expectBehavior(dom,
      { input: { id: '1', op: [{ children: ['Hello'] }, 'new'] } },
      { output: expect.objectContaining({ re: '#<HTML @div/1>' }) },
    );

    const el = await page.connectActor('HTML @div/1');
    await expectBehavior(el,
      { input: { id: '2', op: '@inner_html' } },
      { output: expect.objectContaining({ re: 'Hello' }) },
    );
  });

  it('counter increments sequentially within a single tag', async () => {
    const page = await loadPage(html);
    const domDiv = await page.connectActor('HTML @div');

    await expectBehavior(domDiv,
      { input: { id: '1', op: [{ children: ['First'] }, 'new'] } },
      { output: expect.objectContaining({ id: '1', re: '#<HTML @div/1>', 'bv-a': '#<HTML @div>' }) },
      { input: { id: '2', op: [{ children: ['Second'] }, 'new'] } },
      { output: expect.objectContaining({ id: '2', re: '#<HTML @div/2>', 'bv-a': '#<HTML @div>' }) },
      { input: { id: '3', op: [{ children: ['Third'] }, 'new'] } },
      { output: expect.objectContaining({ id: '3', re: '#<HTML @div/3>', 'bv-a': '#<HTML @div>' }) },
    );
  });

  it('counters are per-tag — div and p number independently', async () => {
    const page = await loadPage(html);
    const domDiv = await page.connectActor('HTML @div');
    const domP = await page.connectActor('HTML @p');

    // Interleave div/p/div/p so a unified counter would produce
    // /1, /2, /3, /4 — per-tag counters instead produce /1, /1, /2, /2.
    await domDiv.sendAsync({ id: '1', op: [{ children: ['d1'] }, 'new'] });
    await domP.sendAsync({ id: '2', op: [{ children: ['p1'] }, 'new'] });
    await domDiv.sendAsync({ id: '3', op: [{ children: ['d2'] }, 'new'] });
    await domP.sendAsync({ id: '4', op: [{ children: ['p2'] }, 'new'] });

    expect(domDiv.posts).toEqual([
      expect.objectContaining({ id: '1', re: '#<HTML @div/1>', 'bv-a': '#<HTML @div>' }),
      expect.objectContaining({ id: '3', re: '#<HTML @div/2>', 'bv-a': '#<HTML @div>' }),
    ]);
    expect(domP.posts).toEqual([
      expect.objectContaining({ id: '2', re: '#<HTML @p/1>', 'bv-a': '#<HTML @p>' }),
      expect.objectContaining({ id: '4', re: '#<HTML @p/2>', 'bv-a': '#<HTML @p>' }),
    ]);
  });

  it('each tag-specific element is independently addressable', async () => {
    const page = await loadPage(html);
    const domDiv = await page.connectActor('HTML @div');
    const domP = await page.connectActor('HTML @p');

    await domDiv.sendAsync({ id: '1', op: [{ children: ['div-one'] }, 'new'] });
    await domP.sendAsync({ id: '2', op: [{ children: ['p-one'] }, 'new'] });
    await domDiv.sendAsync({ id: '3', op: [{ children: ['div-two'] }, 'new'] });

    // HTML @div/1 and HTML @p/1 are distinct elements despite sharing the "/1" suffix.
    const div1 = await page.connectActor('HTML @div/1');
    const p1 = await page.connectActor('HTML @p/1');
    const div2 = await page.connectActor('HTML @div/2');

    await expectBehavior(div1,
      { input: { id: 'q1', op: '@inner_html' } },
      { output: expect.objectContaining({ re: 'div-one' }) },
    );
    await expectBehavior(p1,
      { input: { id: 'q2', op: '@inner_html' } },
      { output: expect.objectContaining({ re: 'p-one' }) },
    );
    await expectBehavior(div2,
      { input: { id: 'q3', op: '@inner_html' } },
      { output: expect.objectContaining({ re: 'div-two' }) },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Actor-side runtime — Brevity actor file using <div> XML syntax
//
// A .bv file imports HTML, destructures (:div), and issues <div>Hello</div>.
// The actor should emit the correct CAM "new" message and forward the
// address from the HTML service response.
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTML element runtime — actor side', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" id="main" src="/tester.bv"></script>
    </head><body></body></html>`;

  const testerSource = `<HTML: (:div)>
=
@createDiv = -> <div>Hello</div>
`;

  it('actor sends CAM new to HTML @div and returns element address', async () => {
    const page = await loadPage(html, { sources: { '/tester.bv': testerSource } });
    const actor = await page.connectActor('tester.bv');

    await expectBehavior(actor,
      { input: { id: '1', op: '@createDiv' } },
      { output: expect.objectContaining({ id: '1', re: ['#<HTML @div/1>'] }) },
    );
  });

  it('actor-constructed element is addressable and has correct content', async () => {
    const page = await loadPage(html, { sources: { '/tester.bv': testerSource } });
    const actor = await page.connectActor('tester.bv');

    await expectBehavior(actor,
      { input: { id: '1', op: '@createDiv' } },
      { output: expect.objectContaining({ re: ['#<HTML @div/1>'] }) },
    );

    const el = await page.connectActor('HTML @div/1');
    await expectBehavior(el,
      { input: { id: '2', op: '@inner_html' } },
      { output: expect.objectContaining({ re: 'Hello' }) },
    );
  });
});
