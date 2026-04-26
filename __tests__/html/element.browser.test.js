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
// Manifest fields prefixed `? ` are optional slots — callers can omit any
// of them and the runtime supplies a default (null for unset attributes).
// `? ` is interface-level only; source-level actor params declare
// optionality via an explicit default value.
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
  it('div(:tabindex Text) is rejected — expects Integer', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(tabindex: "1") . }
    `)).toThrow(/named arg 'tabindex'.*'Text' is not assignable to 'Integer'/);
  });

  it('Aria(:level Text) is rejected — expects Integer', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Aria)>
      =
      @test = { a = Aria(level: "high") . }
    `)).toThrow(/named arg 'level'.*'Text' is not assignable to 'Integer'/);
  });

  it('div(:aria Text) is rejected — expects Aria', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(aria: "Close") . }
    `)).toThrow(/named arg 'aria'.*'Text' is not assignable to 'Aria'/);
  });

  it('div(:spellcheck Integer) is rejected — expects Boolean', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(spellcheck: 1) . }
    `)).toThrow(/named arg 'spellcheck'.*'Integer' is not assignable to 'Boolean'/);
  });

  it('div(:inner_html ...) is rejected — inner_html is a method, not a constructor attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(inner_html: "Hello") . }
    `)).toThrow(/Got named: inner_html/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile-time happy path — every Element attribute on HTML.div
//
// `div` adds no own params, so it's the cleanest probe for Element's full
// surface. One row per attribute, naming the type the manifest declares.
// Union'd attributes get their own block below; here we cover only the
// single-type slots so each row tests exactly one path through isAssignable.
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTML.div compile — every single-type Element attribute', () => {
  const cases = [
    ['id Text',                 'id: "header"'],
    ['style Text',              'style: "color:red"'],
    ['title Text',              'title: "tooltip"'],
    ['lang Text',               'lang: "en"'],
    ['dir Text',                'dir: "ltr"'],
    ['translate Text',          'translate: "yes"'],
    ['tabindex Integer',        'tabindex: 0'],
    ['accesskey Text',          'accesskey: "k"'],
    ['draggable Boolean',       'draggable: true'],
    ['spellcheck Boolean',      'spellcheck: true'],
    ['inert Boolean',           'inert: true'],
    ['autofocus Boolean',       'autofocus: true'],
    ['autocapitalize Text',     'autocapitalize: "sentences"'],
    ['autocorrect Text',        'autocorrect: "on"'],
    ['inputmode Text',          'inputmode: "text"'],
    ['enterkeyhint Text',       'enterkeyhint: "send"'],
    ['is Text',                 'is: "my-button"'],
    ['nonce Text',              'nonce: "abc"'],
    ['slot Text',               'slot: "main"'],
    ['part Text',               'part: "highlight"'],
    ['exportparts Text',        'exportparts: "a,b"'],
    ['itemid Text',             'itemid: "#x"'],
    ['itemprop Text',           'itemprop: "name"'],
    ['itemref Text',            'itemref: "id1"'],
    ['itemscope Boolean',       'itemscope: true'],
    ['itemtype Text',           'itemtype: "https://schema.org"'],
    ['writingsuggestions Text', 'writingsuggestions: "true"'],
    ['virtualkeyboardpolicy Text', 'virtualkeyboardpolicy: "auto"'],
  ];
  it.each(cases)('div(%s) compiles', (_label, kw) => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(${kw}) . }
    `)).not.toThrow();
  });

  it('div(:data Structure) compiles', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(data: Structure(role: "main")) . }
    `)).not.toThrow();
  });

  it('div(:aria Aria) compiles', () => {
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

  it('div(:children List of Texts) compiles', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(children: ["Hello"]) . }
    `)).not.toThrow();
  });

  it('div with every single-type attribute combined compiles', () => {
    const allKw = cases.map(([, kw]) => kw).join(', ');
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(${allKw}) . }
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile-time happy path — union overloads on Element attributes
//
// Four Element attributes carry unions where the HTML spec admits more
// than one value shape:
//   :hidden          Boolean | Text          (boolean attr OR "until-found")
//   :class           Text | List of Texts    (single string OR multi-class list)
//   :contenteditable Boolean | Text          (true/false OR "plaintext-only")
//   :popover         Boolean | Text          (boolean attr OR "auto"/"manual")
//
// For each union we exercise both members on the happy path (one literal
// per branch where literal inference covers it; for `List of Texts` we
// bind a typed local because list literals don't infer through to
// isAssignable), plus a sad-path arg whose type belongs to no member.
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTML.div compile — :hidden Boolean | Text', () => {
  it('accepts Boolean (true)', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(hidden: true) . }
    `)).not.toThrow();
  });

  it('accepts Text ("until-found")', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(hidden: "until-found") . }
    `)).not.toThrow();
  });

  it('rejects Integer (not in union)', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(hidden: 1) . }
    `)).toThrow(/named arg 'hidden'.*'Integer' is not assignable to 'Boolean \| Text'/);
  });
});

describe('HTML.div compile — :class Text | List of Texts', () => {
  it('accepts Text (single class)', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(class: "header active") . }
    `)).not.toThrow();
  });

  it('accepts List of Texts via typed local', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = {
        classes List of Texts = ["header", "active"]
        d = div(class: classes)
        .
      }
    `)).not.toThrow();
  });

  it('rejects Integer (not in union)', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(class: 42) . }
    `)).toThrow(/named arg 'class'.*'Integer' is not assignable to 'Text \| List of Texts'/);
  });

  it('rejects List of Integers via typed local', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = {
        nums List of Integers = [1, 2]
        d = div(class: nums)
        .
      }
    `)).toThrow(/named arg 'class'.*'List of Integers' is not assignable to 'Text \| List of Texts'/);
  });
});

describe('HTML.div compile — :contenteditable Boolean | Text', () => {
  it('accepts Boolean (true)', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(contenteditable: true) . }
    `)).not.toThrow();
  });

  it('accepts Text ("plaintext-only")', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(contenteditable: "plaintext-only") . }
    `)).not.toThrow();
  });

  it('rejects Integer (not in union)', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(contenteditable: 0) . }
    `)).toThrow(/named arg 'contenteditable'.*'Integer' is not assignable to 'Boolean \| Text'/);
  });
});

describe('HTML.div compile — :popover Boolean | Text', () => {
  it('accepts Boolean (true)', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(popover: true) . }
    `)).not.toThrow();
  });

  it('accepts Text ("auto")', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(popover: "auto") . }
    `)).not.toThrow();
  });

  it('rejects Integer (not in union)', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      =
      @test = { d = div(popover: 0) . }
    `)).toThrow(/named arg 'popover'.*'Integer' is not assignable to 'Boolean \| Text'/);
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

// ═══════════════════════════════════════════════════════════════════════════════
// 4. DOM render — element actually lands on the page with the right attrs
//
// Sends a raw CAM `new` to `HTML @div` with the attribute payload, then sends
// `@append!` to `document body` so the constructed element joins the live
// document tree. Asserts the resulting DOM via Playwright's page.evaluate
// (Jest sees a plain object back). Each test starts with a fresh page so the
// per-tag counters reset and `HTML @<tag>/1` is reliably the just-built node.
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTML.div DOM render — every Element attribute lands on the element', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    </head><body></body></html>`;

  // Construct `HTML @<tag>` with `payload` (the named-args bag of the `new`
  // op), append the result to <body>, then run `queryFn` inside the page and
  // return its value. queryFn receives no args and runs in browser context.
  async function renderAndQuery(page, tag, payload, queryFn) {
    const dom = await page.connectActor('HTML @' + tag);
    await dom.sendAsync({ id: 'n', op: [payload, 'new'] });
    const elementAddr = dom.posts[0].re; // '#<HTML @<tag>/1>'

    const docActor = await page.connectActor('document');
    await docActor.sendAsync({ id: 'b', op: '@body' });
    const bodyAddrWrapped = docActor.posts[0].re; // '#<document body>'
    const bodyAddr = bodyAddrWrapped.slice(2, -1); // 'document body'

    const body = await page.connectActor(bodyAddr);
    await body.sendAsync({ id: 'a', op: [elementAddr, '@append!'] });

    return page.evaluate(queryFn);
  }

  it('every single-type attribute is present with the exact serialised value', async () => {
    const page = await loadPage(html);
    // One element carrying every single-type Element slot, then assert all
    // attributes at once. Using one render keeps the page-load cost flat
    // while still proving each slot reaches the DOM.
    const payload = {
      id: 'header',
      style: 'color:red',
      title: 'tooltip',
      lang: 'en',
      dir: 'ltr',
      translate: 'yes',
      tabindex: 0,
      accesskey: 'k',
      draggable: true,
      spellcheck: true,
      inert: true,
      autofocus: true,
      autocapitalize: 'sentences',
      autocorrect: 'on',
      inputmode: 'text',
      enterkeyhint: 'send',
      is: 'my-button',
      nonce: 'abc',
      slot: 'main',
      part: 'highlight',
      exportparts: 'a,b',
      itemid: '#x',
      itemprop: 'name',
      itemref: 'id1',
      itemscope: true,
      itemtype: 'https://schema.org',
      writingsuggestions: 'true',
      virtualkeyboardpolicy: 'auto',
    };
    const attrs = await renderAndQuery(page, 'div', payload, () => {
      const el = document.querySelector('div');
      const out = { _tagName: el.tagName };
      for (const a of el.getAttributeNames()) out[a] = el.getAttribute(a);
      return out;
    });
    expect(attrs._tagName).toBe('DIV');
    // Boolean-true → present with empty value (boolean-attribute convention).
    expect(attrs.draggable).toBe('');
    expect(attrs.spellcheck).toBe('');
    expect(attrs.inert).toBe('');
    expect(attrs.autofocus).toBe('');
    expect(attrs.itemscope).toBe('');
    // Integer → string form.
    expect(attrs.tabindex).toBe('0');
    // Text values pass through.
    expect(attrs.id).toBe('header');
    expect(attrs.style).toBe('color:red');
    expect(attrs.title).toBe('tooltip');
    expect(attrs.lang).toBe('en');
    expect(attrs.dir).toBe('ltr');
    expect(attrs.translate).toBe('yes');
    expect(attrs.accesskey).toBe('k');
    expect(attrs.autocapitalize).toBe('sentences');
    expect(attrs.autocorrect).toBe('on');
    expect(attrs.inputmode).toBe('text');
    expect(attrs.enterkeyhint).toBe('send');
    expect(attrs.is).toBe('my-button');
    expect(attrs.nonce).toBe('abc');
    expect(attrs.slot).toBe('main');
    expect(attrs.part).toBe('highlight');
    expect(attrs.exportparts).toBe('a,b');
    expect(attrs.itemid).toBe('#x');
    expect(attrs.itemprop).toBe('name');
    expect(attrs.itemref).toBe('id1');
    expect(attrs.itemtype).toBe('https://schema.org');
    expect(attrs.writingsuggestions).toBe('true');
    expect(attrs.virtualkeyboardpolicy).toBe('auto');
  });

  it('Boolean false omits the attribute entirely', async () => {
    const page = await loadPage(html);
    const has = await renderAndQuery(page, 'div', { hidden: false, draggable: false }, () => {
      const el = document.querySelector('div');
      return { hidden: el.hasAttribute('hidden'), draggable: el.hasAttribute('draggable') };
    });
    expect(has).toEqual({ hidden: false, draggable: false });
  });

  it(':children — text run renders as the element textContent', async () => {
    const page = await loadPage(html);
    const text = await renderAndQuery(page, 'div', { children: ['Hello, world'] }, () => {
      return document.querySelector('div').textContent;
    });
    expect(text).toBe('Hello, world');
  });

  it(':aria — fields become aria-* attributes, :role drops the prefix', async () => {
    const page = await loadPage(html);
    const attrs = await renderAndQuery(page, 'div',
      { aria: { role: 'button', label: 'Close', describedby: 'hint', expanded: true } },
      () => {
        const el = document.querySelector('div');
        return {
          role: el.getAttribute('role'),
          'aria-label': el.getAttribute('aria-label'),
          'aria-describedby': el.getAttribute('aria-describedby'),
          'aria-expanded': el.getAttribute('aria-expanded'),
          // The literal "aria-role" form must NOT be set.
          'aria-role': el.getAttribute('aria-role'),
        };
      });
    expect(attrs).toEqual({
      role: 'button',
      'aria-label': 'Close',
      'aria-describedby': 'hint',
      'aria-expanded': '',
      'aria-role': null,
    });
  });

  it(':data — fields become data-* attributes', async () => {
    const page = await loadPage(html);
    const attrs = await renderAndQuery(page, 'div',
      { data: { foo: 'bar', count: 7 } },
      () => {
        const el = document.querySelector('div');
        return { foo: el.getAttribute('data-foo'), count: el.getAttribute('data-count') };
      });
    expect(attrs).toEqual({ foo: 'bar', count: '7' });
  });
});

// ─── Union variants — each member of every union'd Element slot lands ─────

describe('HTML.div DOM render — :hidden Boolean | Text', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    </head><body></body></html>`;

  async function renderHiddenDiv(page, value) {
    const dom = await page.connectActor('HTML @div');
    await dom.sendAsync({ id: 'n', op: [{ hidden: value }, 'new'] });
    const elementAddr = dom.posts[0].re;
    const docActor = await page.connectActor('document');
    await docActor.sendAsync({ id: 'b', op: '@body' });
    const bodyAddr = docActor.posts[0].re.slice(2, -1);
    const body = await page.connectActor(bodyAddr);
    await body.sendAsync({ id: 'a', op: [elementAddr, '@append!'] });
    return page.evaluate(() => {
      const el = document.querySelector('div');
      return { has: el.hasAttribute('hidden'), value: el.getAttribute('hidden') };
    });
  }

  it('Boolean true → hidden present with empty value', async () => {
    const page = await loadPage(html);
    expect(await renderHiddenDiv(page, true)).toEqual({ has: true, value: '' });
  });

  it('Text "until-found" → hidden="until-found"', async () => {
    const page = await loadPage(html);
    expect(await renderHiddenDiv(page, 'until-found')).toEqual({ has: true, value: 'until-found' });
  });

  it('Boolean false → hidden absent', async () => {
    const page = await loadPage(html);
    expect(await renderHiddenDiv(page, false)).toEqual({ has: false, value: null });
  });
});

describe('HTML.div DOM render — :class Text | List of Texts', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    </head><body></body></html>`;

  async function renderClassDiv(page, value) {
    const dom = await page.connectActor('HTML @div');
    await dom.sendAsync({ id: 'n', op: [{ class: value }, 'new'] });
    const elementAddr = dom.posts[0].re;
    const docActor = await page.connectActor('document');
    await docActor.sendAsync({ id: 'b', op: '@body' });
    const bodyAddr = docActor.posts[0].re.slice(2, -1);
    const body = await page.connectActor(bodyAddr);
    await body.sendAsync({ id: 'a', op: [elementAddr, '@append!'] });
    return page.evaluate(() => {
      const el = document.querySelector('div');
      return { value: el.getAttribute('class'), list: [...el.classList] };
    });
  }

  it('Text "header active" → class="header active"', async () => {
    const page = await loadPage(html);
    expect(await renderClassDiv(page, 'header active')).toEqual({
      value: 'header active', list: ['header', 'active'],
    });
  });

  it('List of Texts ["header","active"] → class="header active"', async () => {
    const page = await loadPage(html);
    expect(await renderClassDiv(page, ['header', 'active'])).toEqual({
      value: 'header active', list: ['header', 'active'],
    });
  });
});

describe('HTML.div DOM render — :contenteditable Boolean | Text', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    </head><body></body></html>`;

  async function renderCeDiv(page, value) {
    const dom = await page.connectActor('HTML @div');
    await dom.sendAsync({ id: 'n', op: [{ contenteditable: value }, 'new'] });
    const elementAddr = dom.posts[0].re;
    const docActor = await page.connectActor('document');
    await docActor.sendAsync({ id: 'b', op: '@body' });
    const bodyAddr = docActor.posts[0].re.slice(2, -1);
    const body = await page.connectActor(bodyAddr);
    await body.sendAsync({ id: 'a', op: [elementAddr, '@append!'] });
    return page.evaluate(() => document.querySelector('div').getAttribute('contenteditable'));
  }

  it('Boolean true → contenteditable=""', async () => {
    const page = await loadPage(html);
    expect(await renderCeDiv(page, true)).toBe('');
  });

  it('Text "plaintext-only" → contenteditable="plaintext-only"', async () => {
    const page = await loadPage(html);
    expect(await renderCeDiv(page, 'plaintext-only')).toBe('plaintext-only');
  });
});

describe('HTML.div DOM render — :popover Boolean | Text', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    </head><body></body></html>`;

  async function renderPopoverDiv(page, value) {
    const dom = await page.connectActor('HTML @div');
    await dom.sendAsync({ id: 'n', op: [{ popover: value }, 'new'] });
    const elementAddr = dom.posts[0].re;
    const docActor = await page.connectActor('document');
    await docActor.sendAsync({ id: 'b', op: '@body' });
    const bodyAddr = docActor.posts[0].re.slice(2, -1);
    const body = await page.connectActor(bodyAddr);
    await body.sendAsync({ id: 'a', op: [elementAddr, '@append!'] });
    return page.evaluate(() => document.querySelector('div').getAttribute('popover'));
  }

  it('Boolean true → popover=""', async () => {
    const page = await loadPage(html);
    expect(await renderPopoverDiv(page, true)).toBe('');
  });

  it('Text "auto" → popover="auto"', async () => {
    const page = await loadPage(html);
    expect(await renderPopoverDiv(page, 'auto')).toBe('auto');
  });

  it('Text "manual" → popover="manual"', async () => {
    const page = await loadPage(html);
    expect(await renderPopoverDiv(page, 'manual')).toBe('manual');
  });
});
