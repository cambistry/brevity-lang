import { compileSource } from '../helpers.js';
import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';
import { domManifest as HTML_MANIFEST } from '../../src/codegen/browser/runtime.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Per-tag smoke tests for the HTML manifest
//
// Element + Aria carry the full attribute discipline (covered exhaustively in
// element.browser.test.js); this file just confirms each concrete tag in
// domManifest:
//
//   1. is reachable as a typed constructor (`tag()` compiles with no args
//      because every Element field is declared `?` optional and tags inherit
//      via `<Element |>`),
//   2. accepts its own tag-specific attributes (where present),
//   3. rejects an unknown attribute,
//   4. routes union'd own-attrs (e.g. `a :download`, `input :value`,
//      `img :width`) through every member of the union.
// ═══════════════════════════════════════════════════════════════════════════════

const compileWithHTML = (src) =>
  compileSource(src, { remotes: [{ path: 'HTML', service: HTML_MANIFEST }] });

// All 57 concrete tags exposed by domManifest. Listed in manifest order.
const ALL_TAGS = [
  'html', 'head', 'body',
  'header', 'footer', 'main', 'nav', 'section', 'article', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'div', 'p', 'span',
  'pre', 'hr', 'br', 'blockquote',
  'a', 'em', 'strong', 'code', 'mark', 'small',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'caption',
  'form', 'input', 'button', 'select', 'option', 'textarea', 'label',
  'img', 'canvas', 'iframe',
  'figure', 'figcaption',
  'details', 'summary', 'dialog',
];

// ═══════════════════════════════════════════════════════════════════════════════
// (1) Smoke: every tag is reachable as a no-arg typed constructor
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTML tag smoke — no-arg construction', () => {
  it.each(ALL_TAGS)('%s() compiles', (tag) => {
    expect(() => compileWithHTML(`
      <HTML: (:${tag})>
      =
      @test = { e = ${tag}() . }
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// (2) Smoke: each tag still accepts inherited Element attributes
//
// Sampling :id Text on every tag is enough — the inheritance machinery is
// the same for all Element fields, and we already exhaustively test those
// fields in element.browser.test.js. A single representative call per tag
// confirms `<Element |>` actually pulls the parent's surface in.
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTML tag smoke — inherits Element attributes', () => {
  it.each(ALL_TAGS)('%s(id: ...) compiles', (tag) => {
    expect(() => compileWithHTML(`
      <HTML: (:${tag})>
      =
      @test = { e = ${tag}(id: "x") . }
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// (3) Smoke: unknown attribute is rejected on every tag
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTML tag smoke — unknown attribute rejected', () => {
  it.each(ALL_TAGS)('%s(nope: ...) rejected', (tag) => {
    expect(() => compileWithHTML(`
      <HTML: (:${tag})>
      =
      @test = { e = ${tag}(nope: "x") . }
    `)).toThrow(/Got named: nope/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// (4) Per-tag own attributes — happy paths for tags that add their own surface
//
// One representative call per tag, exercising every own attribute. Type
// errors are caught by the same isAssignable path tested under div, so the
// goal here is to confirm the tag-specific manifest entries are wired up.
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTML tag own attributes — happy paths', () => {
  it('a — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:a)>
      =
      @test = { e = a(href: "/x", target: "_blank", rel: "noopener", download: "file.pdf", type: "application/pdf", hreflang: "en", ping: "https://example.com/p", referrerpolicy: "no-referrer") . }
    `)).not.toThrow();
  });

  it('blockquote(:cite Text)', () => {
    expect(() => compileWithHTML(`
      <HTML: (:blockquote)>
      =
      @test = { e = blockquote(cite: "https://example.com") . }
    `)).not.toThrow();
  });

  it('ol — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:ol)>
      =
      @test = { e = ol(type: "1", start: 5, reversed: true) . }
    `)).not.toThrow();
  });

  it('li(:value Integer)', () => {
    expect(() => compileWithHTML(`
      <HTML: (:li)>
      =
      @test = { e = li(value: 3) . }
    `)).not.toThrow();
  });

  it('td — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:td)>
      =
      @test = { e = td(colspan: 2, rowspan: 1, headers: "h1") . }
    `)).not.toThrow();
  });

  it('th — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:th)>
      =
      @test = { e = th(colspan: 2, rowspan: 1, headers: "h1", scope: "row", abbr: "abbr") . }
    `)).not.toThrow();
  });

  it('form — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:form)>
      =
      @test = { e = form(action: "/submit", method: "post", target: "_self", enctype: "multipart/form-data", autocomplete: "on", novalidate: true, name: "main") . }
    `)).not.toThrow();
  });

  it('input — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:input)>
      =
      @test = { e = input(type: "text", name: "q", value: "hello", placeholder: "search", required: true, disabled: false, readonly: false, min: 0, max: 100, step: 1, minlength: 1, maxlength: 64, pattern: "[a-z]+", accept: "image/*", multiple: false, checked: false, autocomplete: "off", list: "options", src: "/img.png", alt: "alt text", form: "main", height: 16, width: 24, size: 32) . }
    `)).not.toThrow();
  });

  it('button — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:button)>
      =
      @test = { e = button(type: "submit", name: "go", value: "yes", disabled: false, form: "main", formaction: "/x", formmethod: "post", formnovalidate: true, formtarget: "_self") . }
    `)).not.toThrow();
  });

  it('select — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:select)>
      =
      @test = { e = select(name: "x", multiple: true, required: true, disabled: false, size: 4, autocomplete: "on", form: "main") . }
    `)).not.toThrow();
  });

  it('option — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:option)>
      =
      @test = { e = option(value: "a", selected: true, disabled: false, label: "Apple") . }
    `)).not.toThrow();
  });

  it('textarea — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:textarea)>
      =
      @test = { e = textarea(name: "msg", rows: 4, cols: 40, placeholder: "Type", required: true, disabled: false, readonly: false, minlength: 1, maxlength: 1000, wrap: "soft", autocomplete: "off", form: "main") . }
    `)).not.toThrow();
  });

  it('label — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:label)>
      =
      @test = { e = label(for: "x", form: "main") . }
    `)).not.toThrow();
  });

  it('img — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:img)>
      =
      @test = { e = img(src: "/i.png", srcset: "/i.png 1x, /i2.png 2x", alt: "x", width: 100, height: 80, sizes: "100vw", loading: "lazy", decoding: "async", fetchpriority: "high", crossorigin: "anonymous", referrerpolicy: "no-referrer", usemap: "#m", ismap: false) . }
    `)).not.toThrow();
  });

  it('canvas — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:canvas)>
      =
      @test = { e = canvas(width: 320, height: 240) . }
    `)).not.toThrow();
  });

  it('iframe — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:iframe)>
      =
      @test = { e = iframe(src: "/x", srcdoc: "<p>x</p>", name: "f1", sandbox: "allow-scripts", allow: "camera", allowfullscreen: true, loading: "lazy", referrerpolicy: "no-referrer", width: 640, height: 480) . }
    `)).not.toThrow();
  });

  it('details — every own attribute', () => {
    expect(() => compileWithHTML(`
      <HTML: (:details)>
      =
      @test = { e = details(open: true, name: "g1") . }
    `)).not.toThrow();
  });

  it('dialog(:open Boolean)', () => {
    expect(() => compileWithHTML(`
      <HTML: (:dialog)>
      =
      @test = { e = dialog(open: true) . }
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// (5) Per-tag union overloads — every member of every union'd own attribute
//
// Tag-specific union'd slots:
//   a       :download Boolean | Text
//   button  :value    Text | Integer
//   option  :value    Text | Integer | Decimal
//   input   :value    Text | Integer | Decimal
//           :min      Integer | Decimal | Text
//           :max      Integer | Decimal | Text
//           :step     Integer | Decimal | Text
//           :width    Integer | Text
//           :height   Integer | Text
//   img     :width    Integer | Text
//           :height   Integer | Text
//   canvas  :width    Integer | Text
//           :height   Integer | Text
//   iframe  :width    Integer | Text
//           :height   Integer | Text
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTML tag union overloads — happy variants', () => {
  it('a(:download Boolean) accepted', () => {
    expect(() => compileWithHTML(`
      <HTML: (:a)>
      =
      @test = { e = a(download: true) . }
    `)).not.toThrow();
  });

  it('a(:download Text) accepted', () => {
    expect(() => compileWithHTML(`
      <HTML: (:a)>
      =
      @test = { e = a(download: "file.pdf") . }
    `)).not.toThrow();
  });

  it('a(:download Integer) rejected', () => {
    expect(() => compileWithHTML(`
      <HTML: (:a)>
      =
      @test = { e = a(download: 1) . }
    `)).toThrow(/named arg 'download'.*'Integer' is not assignable to 'Boolean \| Text'/);
  });

  it.each([
    ['Text',    '"hello"'],
    ['Integer', '42'],
    ['Decimal', '3.14'],
  ])('input(:value %s) accepted', (_label, val) => {
    expect(() => compileWithHTML(`
      <HTML: (:input)>
      =
      @test = { e = input(value: ${val}) . }
    `)).not.toThrow();
  });

  it('input(:value Boolean) rejected', () => {
    expect(() => compileWithHTML(`
      <HTML: (:input)>
      =
      @test = { e = input(value: true) . }
    `)).toThrow(/named arg 'value'.*'Boolean' is not assignable to 'Text \| Integer \| Decimal'/);
  });

  it.each([
    ['Integer', '0'],
    ['Decimal', '0.5'],
    ['Text',    '"2026-01-01"'],
  ])('input(:min %s) accepted', (_label, val) => {
    expect(() => compileWithHTML(`
      <HTML: (:input)>
      =
      @test = { e = input(min: ${val}) . }
    `)).not.toThrow();
  });

  it.each([
    ['Integer', '100'],
    ['Decimal', '99.9'],
    ['Text',    '"2026-12-31"'],
  ])('input(:max %s) accepted', (_label, val) => {
    expect(() => compileWithHTML(`
      <HTML: (:input)>
      =
      @test = { e = input(max: ${val}) . }
    `)).not.toThrow();
  });

  it.each([
    ['Integer', '1'],
    ['Decimal', '0.1'],
    ['Text',    '"any"'],
  ])('input(:step %s) accepted', (_label, val) => {
    expect(() => compileWithHTML(`
      <HTML: (:input)>
      =
      @test = { e = input(step: ${val}) . }
    `)).not.toThrow();
  });

  it.each([
    ['Text',    '"v"'],
    ['Integer', '7'],
  ])('button(:value %s) accepted', (_label, val) => {
    expect(() => compileWithHTML(`
      <HTML: (:button)>
      =
      @test = { e = button(value: ${val}) . }
    `)).not.toThrow();
  });

  it('button(:value Boolean) rejected', () => {
    expect(() => compileWithHTML(`
      <HTML: (:button)>
      =
      @test = { e = button(value: true) . }
    `)).toThrow(/named arg 'value'.*'Boolean' is not assignable to 'Text \| Integer'/);
  });

  it.each([
    ['Text',    '"a"'],
    ['Integer', '1'],
    ['Decimal', '1.5'],
  ])('option(:value %s) accepted', (_label, val) => {
    expect(() => compileWithHTML(`
      <HTML: (:option)>
      =
      @test = { e = option(value: ${val}) . }
    `)).not.toThrow();
  });

  it.each([
    ['img',    '100',  '"50%"'],
    ['canvas', '320',  '"100%"'],
    ['iframe', '640',  '"100vw"'],
    ['input',  '24',   '"auto"'],
  ])('%s(:width Integer / Text) accepted', (tag, intVal, textVal) => {
    expect(() => compileWithHTML(`
      <HTML: (:${tag})>
      =
      @test = {
        e1 = ${tag}(width: ${intVal})
        e2 = ${tag}(width: ${textVal})
        .
      }
    `)).not.toThrow();
  });

  it.each([
    ['img',    '80'],
    ['canvas', '240'],
    ['iframe', '480'],
    ['input',  '16'],
  ])('%s(:height Boolean) rejected — not in Integer | Text', (tag, _intVal) => {
    expect(() => compileWithHTML(`
      <HTML: (:${tag})>
      =
      @test = { e = ${tag}(height: true) . }
    `)).toThrow(/named arg 'height'.*'Boolean' is not assignable to 'Integer \| Text'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// (6) DOM render — every tag actually lands in the document
//
// Sends a raw CAM `new` to `HTML @<tag>`, gets the element address back,
// appends to <body>, then queries the DOM via Playwright. Per-tag counters
// reset on each fresh page so the just-built node is reliably `HTML @<tag>/1`.
//
// The test page is HTML-fragment territory (no <html>/<head>/<body> wrapper
// around the constructed tag), so we don't enforce DOM nesting rules — e.g.
// appending `<thead>` to <body> works at the runtime level even though it
// wouldn't lay out as a thead. Smoke tests are about the runtime stamping
// the right tag name and attributes, not about HTML structural validity.
// ═══════════════════════════════════════════════════════════════════════════════

const PAGE_HTML = `<html><head>
  <script type="module" src="/src/codegen/browser/brevity.js"></script>
  </head><body></body></html>`;

// Construct `HTML @<tag>` with `payload`, append the result to <body>, then
// run `queryFn` (browser-context) and return its value to the test.
async function renderAndQuery(page, tag, payload, queryFn) {
  const dom = await page.connectActor('HTML @' + tag);
  await dom.sendAsync({ id: 'n', op: [payload, 'new'] });
  const elementAddr = dom.posts[0].re;

  const docActor = await page.connectActor('document');
  await docActor.sendAsync({ id: 'b', op: '@body' });
  const bodyAddr = docActor.posts[0].re.slice(2, -1);

  const body = await page.connectActor(bodyAddr);
  await body.sendAsync({ id: 'a', op: [elementAddr, '@append!'] });

  return page.evaluate(queryFn);
}

describe('HTML tag DOM render — every tag lands with the right tagName', () => {
  // Batched into one page load — the assertion is uniform (tagName matches
  // input), so per-tag isolation buys nothing and 57 individual loadPage
  // calls add real CPU contention to the parallel test run. Each tag
  // appends one element to <body>; the final assertion compares the
  // complete tagName sequence in one shot.
  it('all tags render to document.body with their declared tagName', async () => {
    const page = await loadPage(PAGE_HTML);
    const docActor = await page.connectActor('document');
    await docActor.sendAsync({ id: 'b', op: '@body' });
    const bodyAddr = docActor.posts[0].re.slice(2, -1);
    const body = await page.connectActor(bodyAddr);

    for (const tag of ALL_TAGS) {
      const dom = await page.connectActor('HTML @' + tag);
      await dom.sendAsync({ id: 'n_' + tag, op: [{}, 'new'] });
      const elementAddr = dom.posts[0].re;
      await body.sendAsync({ id: 'a_' + tag, op: [elementAddr, '@append!'] });
    }

    const tagNames = await page.evaluate(() =>
      [...document.body.children].map(el => el.tagName.toLowerCase()),
    );
    expect(tagNames).toEqual(ALL_TAGS);
  });
});

// ─── Per-tag own attributes — verify each lands as a real DOM attribute ────

describe('HTML tag DOM render — own attributes land on the element', () => {
  it('a — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'a', {
      href: '/x',
      target: '_blank',
      rel: 'noopener',
      download: 'file.pdf',
      type: 'application/pdf',
      hreflang: 'en',
      ping: 'https://example.com/p',
      referrerpolicy: 'no-referrer',
    }, () => {
      const el = document.querySelector('a');
      const o = {};
      for (const a of ['href', 'target', 'rel', 'download', 'type', 'hreflang', 'ping', 'referrerpolicy']) {
        o[a] = el.getAttribute(a);
      }
      return o;
    });
    expect(attrs).toEqual({
      href: '/x', target: '_blank', rel: 'noopener', download: 'file.pdf',
      type: 'application/pdf', hreflang: 'en', ping: 'https://example.com/p',
      referrerpolicy: 'no-referrer',
    });
  });

  it('a(:download Boolean true) → bare boolean attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attr = await renderAndQuery(page, 'a', { download: true }, () => {
      const el = document.querySelector('a');
      return { has: el.hasAttribute('download'), value: el.getAttribute('download') };
    });
    expect(attr).toEqual({ has: true, value: '' });
  });

  it('blockquote(:cite Text)', async () => {
    const page = await loadPage(PAGE_HTML);
    const cite = await renderAndQuery(page, 'blockquote',
      { cite: 'https://example.com' },
      () => document.querySelector('blockquote').getAttribute('cite'),
    );
    expect(cite).toBe('https://example.com');
  });

  it('ol — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'ol',
      { type: '1', start: 5, reversed: true },
      () => {
        const el = document.querySelector('ol');
        return {
          type: el.getAttribute('type'),
          start: el.getAttribute('start'),
          reversed: el.hasAttribute('reversed'),
        };
      });
    expect(attrs).toEqual({ type: '1', start: '5', reversed: true });
  });

  it('li(:value Integer)', async () => {
    const page = await loadPage(PAGE_HTML);
    const v = await renderAndQuery(page, 'li', { value: 3 },
      () => document.querySelector('li').getAttribute('value'));
    expect(v).toBe('3');
  });

  it('td — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'td',
      { colspan: 2, rowspan: 1, headers: 'h1' },
      () => {
        const el = document.querySelector('td');
        return {
          colspan: el.getAttribute('colspan'),
          rowspan: el.getAttribute('rowspan'),
          headers: el.getAttribute('headers'),
        };
      });
    expect(attrs).toEqual({ colspan: '2', rowspan: '1', headers: 'h1' });
  });

  it('th — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'th',
      { colspan: 2, rowspan: 1, headers: 'h1', scope: 'row', abbr: 'abbr' },
      () => {
        const el = document.querySelector('th');
        return {
          colspan: el.getAttribute('colspan'),
          rowspan: el.getAttribute('rowspan'),
          headers: el.getAttribute('headers'),
          scope: el.getAttribute('scope'),
          abbr: el.getAttribute('abbr'),
        };
      });
    expect(attrs).toEqual({
      colspan: '2', rowspan: '1', headers: 'h1', scope: 'row', abbr: 'abbr',
    });
  });

  it('form — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'form', {
      action: '/submit', method: 'post', target: '_self',
      enctype: 'multipart/form-data', autocomplete: 'on',
      novalidate: true, name: 'main',
    }, () => {
      const el = document.querySelector('form');
      const o = {};
      for (const a of ['action', 'method', 'target', 'enctype', 'autocomplete', 'name']) {
        o[a] = el.getAttribute(a);
      }
      o.novalidate = el.hasAttribute('novalidate');
      return o;
    });
    expect(attrs).toEqual({
      action: '/submit', method: 'post', target: '_self',
      enctype: 'multipart/form-data', autocomplete: 'on',
      name: 'main', novalidate: true,
    });
  });

  it('input — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'input', {
      type: 'text', name: 'q', value: 'hello', placeholder: 'search',
      required: true, disabled: false, readonly: false,
      min: 0, max: 100, step: 1,
      minlength: 1, maxlength: 64, pattern: '[a-z]+',
      accept: 'image/*', multiple: false, checked: false,
      autocomplete: 'off', list: 'options',
      src: '/img.png', alt: 'alt text', form: 'main',
      height: 16, width: 24, size: 32,
    }, () => {
      const el = document.querySelector('input');
      const out = {};
      for (const a of el.getAttributeNames()) out[a] = el.getAttribute(a);
      return out;
    });
    // false-valued booleans are absent; true-valued are present and empty.
    expect(attrs.disabled).toBeUndefined();
    expect(attrs.readonly).toBeUndefined();
    expect(attrs.multiple).toBeUndefined();
    expect(attrs.checked).toBeUndefined();
    expect(attrs.required).toBe('');
    expect(attrs.type).toBe('text');
    expect(attrs.value).toBe('hello');
    expect(attrs.min).toBe('0');
    expect(attrs.max).toBe('100');
    expect(attrs.step).toBe('1');
    expect(attrs.pattern).toBe('[a-z]+');
    expect(attrs.height).toBe('16');
    expect(attrs.width).toBe('24');
    expect(attrs.size).toBe('32');
  });

  it('button — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'button', {
      type: 'submit', name: 'go', value: 'yes', disabled: false,
      form: 'main', formaction: '/x', formmethod: 'post',
      formnovalidate: true, formtarget: '_self',
    }, () => {
      const el = document.querySelector('button');
      const out = {};
      for (const a of el.getAttributeNames()) out[a] = el.getAttribute(a);
      return out;
    });
    expect(attrs.disabled).toBeUndefined();
    expect(attrs.formnovalidate).toBe('');
    expect(attrs.type).toBe('submit');
    expect(attrs.value).toBe('yes');
    expect(attrs.formaction).toBe('/x');
    expect(attrs.formmethod).toBe('post');
    expect(attrs.formtarget).toBe('_self');
  });

  it('select — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'select', {
      name: 'x', multiple: true, required: true, disabled: false,
      size: 4, autocomplete: 'on', form: 'main',
    }, () => {
      const el = document.querySelector('select');
      const out = {};
      for (const a of el.getAttributeNames()) out[a] = el.getAttribute(a);
      return out;
    });
    expect(attrs.disabled).toBeUndefined();
    expect(attrs.multiple).toBe('');
    expect(attrs.required).toBe('');
    expect(attrs.size).toBe('4');
  });

  it('option — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'option', {
      value: 'a', selected: true, disabled: false, label: 'Apple',
    }, () => {
      const el = document.querySelector('option');
      return {
        value: el.getAttribute('value'),
        selected: el.hasAttribute('selected'),
        disabled: el.hasAttribute('disabled'),
        label: el.getAttribute('label'),
      };
    });
    expect(attrs).toEqual({ value: 'a', selected: true, disabled: false, label: 'Apple' });
  });

  it('textarea — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'textarea', {
      name: 'msg', rows: 4, cols: 40, placeholder: 'Type',
      required: true, disabled: false, readonly: false,
      minlength: 1, maxlength: 1000, wrap: 'soft',
      autocomplete: 'off', form: 'main',
    }, () => {
      const el = document.querySelector('textarea');
      const out = {};
      for (const a of el.getAttributeNames()) out[a] = el.getAttribute(a);
      return out;
    });
    expect(attrs.rows).toBe('4');
    expect(attrs.cols).toBe('40');
    expect(attrs.required).toBe('');
    expect(attrs.disabled).toBeUndefined();
    expect(attrs.wrap).toBe('soft');
  });

  it('label — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'label', { for: 'x', form: 'main' },
      () => {
        const el = document.querySelector('label');
        return { for: el.getAttribute('for'), form: el.getAttribute('form') };
      });
    expect(attrs).toEqual({ for: 'x', form: 'main' });
  });

  it('img — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'img', {
      src: '/i.png', srcset: '/i.png 1x, /i2.png 2x', alt: 'x',
      width: 100, height: 80, sizes: '100vw',
      loading: 'lazy', decoding: 'async', fetchpriority: 'high',
      crossorigin: 'anonymous', referrerpolicy: 'no-referrer',
      usemap: '#m', ismap: false,
    }, () => {
      const el = document.querySelector('img');
      const out = {};
      for (const a of el.getAttributeNames()) out[a] = el.getAttribute(a);
      return out;
    });
    expect(attrs.src).toBe('/i.png');
    expect(attrs.alt).toBe('x');
    expect(attrs.width).toBe('100');
    expect(attrs.height).toBe('80');
    expect(attrs.loading).toBe('lazy');
    expect(attrs.ismap).toBeUndefined();
  });

  it('canvas — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'canvas', { width: 320, height: 240 },
      () => {
        const el = document.querySelector('canvas');
        return { width: el.getAttribute('width'), height: el.getAttribute('height') };
      });
    expect(attrs).toEqual({ width: '320', height: '240' });
  });

  it('iframe — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'iframe', {
      src: '/x', srcdoc: '<p>x</p>', name: 'f1',
      sandbox: 'allow-scripts', allow: 'camera', allowfullscreen: true,
      loading: 'lazy', referrerpolicy: 'no-referrer',
      width: 640, height: 480,
    }, () => {
      const el = document.querySelector('iframe');
      const out = {};
      for (const a of el.getAttributeNames()) out[a] = el.getAttribute(a);
      return out;
    });
    expect(attrs.src).toBe('/x');
    expect(attrs.allowfullscreen).toBe('');
    expect(attrs.width).toBe('640');
    expect(attrs.height).toBe('480');
  });

  it('details — every own attribute', async () => {
    const page = await loadPage(PAGE_HTML);
    const attrs = await renderAndQuery(page, 'details', { open: true, name: 'g1' },
      () => {
        const el = document.querySelector('details');
        return { open: el.hasAttribute('open'), name: el.getAttribute('name') };
      });
    expect(attrs).toEqual({ open: true, name: 'g1' });
  });

  it('dialog(:open Boolean)', async () => {
    const page = await loadPage(PAGE_HTML);
    const has = await renderAndQuery(page, 'dialog', { open: true },
      () => document.querySelector('dialog').hasAttribute('open'));
    expect(has).toBe(true);
  });
});

// ─── Per-tag union variants — each member of a union'd own slot lands ─────

describe('HTML tag DOM render — union variants', () => {
  it.each([
    ['Text',    'hello',  'hello'],
    ['Integer', 42,       '42'],
    ['Decimal', 3.14,     '3.14'],
  ])('input(:value %s) → DOM "%s"', async (_label, value, expected) => {
    const page = await loadPage(PAGE_HTML);
    const v = await renderAndQuery(page, 'input', { value },
      () => document.querySelector('input').getAttribute('value'));
    expect(v).toBe(expected);
  });

  it.each([
    ['Integer min', { min: 0 },     'min',  '0'],
    ['Decimal min', { min: 0.5 },   'min',  '0.5'],
    ['Text min',    { min: '2026-01-01' }, 'min', '2026-01-01'],
    ['Integer max', { max: 100 },   'max',  '100'],
    ['Decimal max', { max: 99.9 },  'max',  '99.9'],
    ['Text max',    { max: '2026-12-31' }, 'max', '2026-12-31'],
    ['Integer step', { step: 1 },   'step', '1'],
    ['Decimal step', { step: 0.1 }, 'step', '0.1'],
    ['Text step',    { step: 'any' }, 'step', 'any'],
  ])('input %s → %s="%s"', async (_label, payload, attrName, expected) => {
    const page = await loadPage(PAGE_HTML);
    const v = await renderAndQuery(page, 'input', payload,
      () => document.querySelector('input'),
    );
    // queryFn returned an element; grab the attribute back via a second eval
    // (small inefficiency, but keeps the helper fn shape uniform).
    const attr = await page.evaluate(
      (name) => document.querySelector('input').getAttribute(name),
      attrName,
    );
    expect(attr).toBe(expected);
    expect(v).toBeDefined();
  });

  it.each([
    ['button :value Text',    { value: 'v' }, 'v'],
    ['button :value Integer', { value: 7 },   '7'],
  ])('%s → DOM value="%s"', async (_label, payload, expected) => {
    const page = await loadPage(PAGE_HTML);
    const v = await renderAndQuery(page, 'button', payload,
      () => document.querySelector('button').getAttribute('value'));
    expect(v).toBe(expected);
  });

  it.each([
    ['option :value Text',    { value: 'a' },   'a'],
    ['option :value Integer', { value: 1 },     '1'],
    ['option :value Decimal', { value: 1.5 },   '1.5'],
  ])('%s → DOM value="%s"', async (_label, payload, expected) => {
    const page = await loadPage(PAGE_HTML);
    const v = await renderAndQuery(page, 'option', payload,
      () => document.querySelector('option').getAttribute('value'));
    expect(v).toBe(expected);
  });

  it.each([
    ['img',    { width: 100 },     'width',  '100'],
    ['img',    { width: '50%' },   'width',  '50%'],
    ['img',    { height: 80 },     'height', '80'],
    ['img',    { height: '100%' }, 'height', '100%'],
    ['canvas', { width: 320 },     'width',  '320'],
    ['canvas', { height: '100%' }, 'height', '100%'],
    ['iframe', { width: 640 },     'width',  '640'],
    ['iframe', { height: '100vh' }, 'height', '100vh'],
    ['input',  { width: 24 },      'width',  '24'],
    ['input',  { height: 'auto' }, 'height', 'auto'],
  ])('%s %j → %s="%s"', async (tag, payload, attrName, expected) => {
    const page = await loadPage(PAGE_HTML);
    await renderAndQuery(page, tag, payload, () => null);
    const attr = await page.evaluate(
      ([t, n]) => document.querySelector(t).getAttribute(n),
      [tag, attrName],
    );
    expect(attr).toBe(expected);
  });
});
