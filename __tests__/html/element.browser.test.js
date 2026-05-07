import { compileSource } from '../helpers.js';
import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';
import { domManifest as HTML_MANIFEST, documentManifest as DOC_MANIFEST } from '../../src/codegen/browser/runtime.js';

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

// Some compile tests need `<:document>` to resolve — the document service
// declares `document: <Document |>` whose Document superclass is in HTML.
// Both manifests must be registered together for cross-service inheritance
// to walk Node's accessor surface up from the singleton.
const compileWithDocAndHTML = (src) =>
  compileSource(src, { remotes: [
    { path: 'document', service: DOC_MANIFEST },
    { path: 'HTML', service: HTML_MANIFEST },
  ] });

describe('HTML element compile — happy path', () => {
  it('div() with no args (all params nullable)', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div() . }
    `)).not.toThrow();
  });

  it('div(:id Text) — inherited Text attr', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(id: "header") . }
    `)).not.toThrow();
  });

  it('div(:hidden Boolean) — inherited Boolean attr', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(hidden: true) . }
    `)).not.toThrow();
  });

  it('div(:tabindex Integer) — inherited Integer attr', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(tabindex: 0) . }
    `)).not.toThrow();
  });

  it('div(:aria Aria) — bucketed nested constructor', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div, :Aria))
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
      *(HTML: (:div))
      =
      @test = { d = div(id: "x", hidden: true, tabindex: 1) . }
    `)).not.toThrow();
  });

  it('div(:children) — content via structured children', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(children: ["Hello"]) . }
    `)).not.toThrow();
  });

  it('Aria(:level Integer) — own attr on bucketed type', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:Aria))
      =
      @test = { a = Aria(level: 2) . }
    `)).not.toThrow();
  });

  it('Aria(:valuenow Decimal) — Decimal attr', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:Aria))
      =
      @test = { a = Aria(valuenow: 0.5) . }
    `)).not.toThrow();
  });
});

describe('HTML element compile — type mismatches (sad path)', () => {
  it('div(:tabindex Text) is rejected — expects Integer', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(tabindex: "1") . }
    `)).toThrow(/named arg 'tabindex'.*'Text' is not assignable to 'Integer'/);
  });

  it('Aria(:level Text) is rejected — expects Integer', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:Aria))
      =
      @test = { a = Aria(level: "high") . }
    `)).toThrow(/named arg 'level'.*'Text' is not assignable to 'Integer'/);
  });

  it('div(:aria Text) is rejected — expects Aria', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(aria: "Close") . }
    `)).toThrow(/named arg 'aria'.*'Text' is not assignable to 'Aria'/);
  });

  it('div(:spellcheck Integer) is rejected — expects Boolean', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(spellcheck: 1) . }
    `)).toThrow(/named arg 'spellcheck'.*'Integer' is not assignable to 'Boolean'/);
  });

  it('div(:inner_html ...) is rejected — inner_html is a method, not a constructor attr', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
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
      *(HTML: (:div))
      =
      @test = { d = div(${kw}) . }
    `)).not.toThrow();
  });

  it('div(:data Structure) compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(data: Structure(role: "main")) . }
    `)).not.toThrow();
  });

  it('div(:aria Aria) compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div, :Aria))
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
      *(HTML: (:div))
      =
      @test = { d = div(children: ["Hello"]) . }
    `)).not.toThrow();
  });

  it('div with every single-type attribute combined compiles', () => {
    const allKw = cases.map(([, kw]) => kw).join(', ');
    expect(() => compileWithHTML(`
      *(HTML: (:div))
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
      *(HTML: (:div))
      =
      @test = { d = div(hidden: true) . }
    `)).not.toThrow();
  });

  it('accepts Text ("until-found")', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(hidden: "until-found") . }
    `)).not.toThrow();
  });

  it('rejects Integer (not in union)', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(hidden: 1) . }
    `)).toThrow(/named arg 'hidden'.*'Integer' is not assignable to 'Boolean \| Text'/);
  });
});

describe('HTML.div compile — :class Text | List of Texts', () => {
  it('accepts Text (single class)', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(class: "header active") . }
    `)).not.toThrow();
  });

  it('accepts List of Texts via typed local', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
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
      *(HTML: (:div))
      =
      @test = { d = div(class: 42) . }
    `)).toThrow(/named arg 'class'.*'Integer' is not assignable to 'Text \| List of Texts'/);
  });

  it('rejects List of Integers via typed local', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
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
      *(HTML: (:div))
      =
      @test = { d = div(contenteditable: true) . }
    `)).not.toThrow();
  });

  it('accepts Text ("plaintext-only")', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(contenteditable: "plaintext-only") . }
    `)).not.toThrow();
  });

  it('rejects Integer (not in union)', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(contenteditable: 0) . }
    `)).toThrow(/named arg 'contenteditable'.*'Integer' is not assignable to 'Boolean \| Text'/);
  });
});

describe('HTML.div compile — :popover Boolean | Text', () => {
  it('accepts Boolean (true)', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(popover: true) . }
    `)).not.toThrow();
  });

  it('accepts Text ("auto")', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(popover: "auto") . }
    `)).not.toThrow();
  });

  it('rejects Integer (not in union)', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(popover: 0) . }
    `)).toThrow(/named arg 'popover'.*'Integer' is not assignable to 'Boolean \| Text'/);
  });
});

describe('HTML element compile — unknown attrs (sad path)', () => {
  it('div(:nope ...) is rejected — :nope is not on Element', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(nope: "x") . }
    `)).toThrow(/Got named: nope/);
  });

  it('div(:label ...) is rejected — :label belongs on Aria, not Element', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(label: "Close") . }
    `)).toThrow(/Got named: label/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile-time discipline — void / text / parent split
//
// Element is the abstract base. Tags are classified by content model:
//
//   - Void elements (br, hr, img, input) extend Element directly. They
//     cannot accept :children at all — the slot doesn't exist on Element.
//
//   - TextElement < Element accepts `:children List of Texts` only. The
//     constructor rejects element references in the list at compile time.
//     `<textarea>` is the only manifest tag in this bucket today.
//
//   - ParentElement < Element accepts `:children List` (List of Anything),
//     leaving room for the wire-token mix (texts, address strings) that
//     children carry today. Most tags extend ParentElement.
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTML element compile — void elements reject :children', () => {
  for (const tag of ['br', 'hr', 'img', 'input']) {
    it(`${tag}(:children ...) is rejected — ${tag} is a void element`, () => {
      expect(() => compileWithHTML(`
        *(HTML: (:${tag}))
        =
        @test = { e = ${tag}(children: ["x"]) . }
      `)).toThrow(/Got named: children/);
    });
  }
});

describe('HTML element compile — TextElement accepts text-only children', () => {
  it('textarea(:children List of Texts) compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:textarea))
      =
      @test = { t = textarea(children: ["initial value"]) . }
    `)).not.toThrow();
  });

  it('textarea(:children List of Integers) is rejected — children must be Texts', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:textarea))
      =
      @test = {
        nums List of Integers = [1, 2]
        t = textarea(children: nums)
        .
      }
    `)).toThrow(/named arg 'children'.*'List of Integers' is not assignable to 'List of Texts'/);
  });
});

describe('HTML element compile — ParentElement accepts mixed children (List of Anything)', () => {
  it('div(:children [Text]) compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(children: ["Hello"]) . }
    `)).not.toThrow();
  });

  it('div(:children [Integer]) compiles — List of Anything tolerates non-Text', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(children: [1]) . }
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile-time discipline — methods on void / parent / text classifications
//
// The validator resolves `b.method!()` against the manifest-declared body of
// b's static type. A void tag inherits Element only, so it carries the
// sibling-affecting mutators (before!, after!, replace_with!, remove!) but
// NOT the children-affecting ones (append_child!, append!, etc.). Calling
// a children mutator on a void tag is a compile-time error.
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTML element compile — children mutators on void tags rejected', () => {
  it('br.append_child!(...) is rejected — void tag has no append_child!', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:br, :div))
      =
      @test = {
        b = br()
        c = div()
        b.append_child!(child: c)
        .
      }
    `)).toThrow(/'br' has no method 'append_child!'/);
  });

  it('input.append!(...) is rejected — void tag has no append!', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:input))
      =
      @test = {
        i = input()
        i.append!(items: ["x"])
        .
      }
    `)).toThrow(/'input' has no method 'append!'/);
  });

  it('br.remove!() compiles — sibling-affecting mutator IS on Element', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:br))
      =
      @test = {
        b = br()
        b.remove!()
        .
      }
    `)).not.toThrow();
  });

  it('div.bogus_method!() is rejected — method does not exist anywhere', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = {
        d = div()
        d.bogus_method!()
        .
      }
    `)).toThrow(/'div' has no method 'bogus_method!'/);
  });

  it('div.append_child!(...) compiles — ParentElement supplies the method', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div, :span))
      =
      @test = {
        d = div()
        s = span()
        d.append_child!(child: s)
        .
      }
    `)).not.toThrow();
  });
});

describe('HTML element compile — settable-field discipline (`obj.f <- v`)', () => {
  it('div.inner_html <- "..." compiles — declared on ParentElement', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.inner_html <- "Hi" . }
    `)).not.toThrow();
  });

  it('div.text_content <- "..." compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.text_content <- "Hi" . }
    `)).not.toThrow();
  });

  it('div.inner_text <- "..." compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.inner_text <- "Hi" . }
    `)).not.toThrow();
  });

  it('textarea.inner_html <- "..." compiles — declared on TextElement', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:textarea))
      =
      @test = { t = textarea(); t.inner_html <- "Hi" . }
    `)).not.toThrow();
  });

  it('div.id <- "..." rejected — id is a reader, not declared settable', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.id <- "x" . }
    `)).toThrow(/'div' has no settable field 'id'/);
  });

  it('br.inner_html <- "..." rejected — void tag has no children-bearing surface', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:br))
      =
      @test = { b = br(); b.inner_html <- "x" . }
    `)).toThrow(/'br' has no settable field 'inner_html'/);
  });

  it('div.bogus_field <- v rejected — unknown field name', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.bogus_field <- "x" . }
    `)).toThrow(/'div' has no settable field 'bogus_field'/);
  });
});

describe('HTML element compile — content + generic-attribute methods', () => {
  it('div.tag_name() compiles — Element-level reader', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); name = d.tag_name() . }
    `)).not.toThrow();
  });

  it('div.outer_html() compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); h = d.outer_html() . }
    `)).not.toThrow();
  });

  it('div.get_attribute("data-x") compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); v = d.get_attribute("data-x") . }
    `)).not.toThrow();
  });

  it('div.set_attribute!("data-x", "1") compiles — every classification', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.set_attribute!("data-x", "1") . }
    `)).not.toThrow();
  });

  it('br.set_attribute!("data-x", "1") compiles — Element layer applies to void tags too', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:br))
      =
      @test = { b = br(); b.set_attribute!("data-x", "1") . }
    `)).not.toThrow();
  });

  it('div.toggle_attribute!("hidden") compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.toggle_attribute!("hidden") . }
    `)).not.toThrow();
  });
});

describe('HTML element compile — Node traversal', () => {
  it('div.parent_element() compiles — Node-level reader inherited via Element', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); p = d.parent_element() . }
    `)).not.toThrow();
  });

  it('div.children() compiles — Element-narrowed traversal', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); cs = d.children() . }
    `)).not.toThrow();
  });

  it('div.first_child() compiles — Node-level returns Node | null', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); c = d.first_child() . }
    `)).not.toThrow();
  });

  it('div.is_connected() compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); c = d.is_connected() . }
    `)).not.toThrow();
  });

  it('div.contains(other: e) compiles — takes Node arg', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div, :span))
      =
      @test = { d = div(); s = span(); b = d.contains(other: s) . }
    `)).not.toThrow();
  });

  it('br.parent_element() compiles — Node body inherited even on void tags', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:br))
      =
      @test = { b = br(); p = b.parent_element() . }
    `)).not.toThrow();
  });

  it('div.bogus_traversal() rejected', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.bogus_traversal() . }
    `)).toThrow(/'div' has no method 'bogus_traversal'/);
  });
});

describe('HTML element compile — query methods', () => {
  it('div.query_selector("p") compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); m = d.query_selector("p") . }
    `)).not.toThrow();
  });

  it('div.query_selector_all("p") compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); ms = d.query_selector_all("p") . }
    `)).not.toThrow();
  });

  it('div.closest("section") compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); m = d.closest("section") . }
    `)).not.toThrow();
  });

  it('div.matches(".foo") compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); b = d.matches(".foo") . }
    `)).not.toThrow();
  });

  it('div.get_elements_by_tag_name("li") compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); ms = d.get_elements_by_tag_name("li") . }
    `)).not.toThrow();
  });

  it('div.get_elements_by_class_name("foo") compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); ms = d.get_elements_by_class_name("foo") . }
    `)).not.toThrow();
  });

  it('br.matches("br") compiles — query methods inherited via Element on void tags', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:br))
      =
      @test = { b = br(); m = b.matches("br") . }
    `)).not.toThrow();
  });

  it('div.bogus_query() rejected', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.bogus_query("x") . }
    `)).toThrow(/'div' has no method 'bogus_query'/);
  });

  it('document.query_selector("p") compiles — Document inherits from Node, declares queries', () => {
    expect(() => compileWithDocAndHTML(`
      *(:document)
      =
      @test = { m = document.query_selector("p") . }
    `)).not.toThrow();
  });

  it('document.parent_node() compiles — inherited from Node via Document', () => {
    expect(() => compileWithDocAndHTML(`
      *(:document)
      =
      @test = { p = document.parent_node() . }
    `)).not.toThrow();
  });
});

describe('HTML element compile — geometry / scroll / focus / cloning', () => {
  it('div.client_width() compiles — Integer reader', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); w = d.client_width() . }
    `)).not.toThrow();
  });

  it('div.bounding_client_rect() compiles — Structure return', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); r = d.bounding_client_rect() . }
    `)).not.toThrow();
  });

  it('div.client_rects() compiles — List of Structures', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); rs = d.client_rects() . }
    `)).not.toThrow();
  });

  it('div.offset_parent() compiles — Element | null reader', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); p = d.offset_parent() . }
    `)).not.toThrow();
  });

  it('div.scroll_top <- 100 compiles — settable field', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.scroll_top <- 100.0 . }
    `)).not.toThrow();
  });

  it('div.scroll_left <- 50 compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.scroll_left <- 50.0 . }
    `)).not.toThrow();
  });

  it('div.client_width <- v rejected — read-only', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.client_width <- 100 . }
    `)).toThrow(/'div' has no settable field 'client_width'/);
  });

  it('div.scroll_to!(0.0, 100.0) compiles — positional Decimal pair', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.scroll_to!(0.0, 100.0) . }
    `)).not.toThrow();
  });

  it('div.scroll_to!(top: 100, behavior: "smooth") compiles — named options form', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.scroll_to!(top: 100.0, behavior: "smooth") . }
    `)).not.toThrow();
  });

  it('div.scroll_into_view!() compiles — no-arg overload', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.scroll_into_view!() . }
    `)).not.toThrow();
  });

  it('div.focus!() compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.focus!() . }
    `)).not.toThrow();
  });

  it('div.focus!(prevent_scroll: true) compiles — named option', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.focus!(prevent_scroll: true) . }
    `)).not.toThrow();
  });

  it('div.click!() compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.click!() . }
    `)).not.toThrow();
  });

  it('div.clone_node() compiles — Node return inherited', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); c = d.clone_node() . }
    `)).not.toThrow();
  });

  it('div.clone_node(true) compiles — deep flag', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); c = d.clone_node(true) . }
    `)).not.toThrow();
  });

  it('div.is_same_node(other: e) compiles — Boolean return', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { a = div(); b = div(); eq = a.is_same_node(other: b) . }
    `)).not.toThrow();
  });

  it('div.normalize!() compiles — Node-level mutator', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.normalize!() . }
    `)).not.toThrow();
  });

  it('br.client_width() compiles — geometry inherited via Element on void tags', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:br))
      =
      @test = { b = br(); w = b.client_width() . }
    `)).not.toThrow();
  });

  it('document.normalize!() compiles', () => {
    expect(() => compileWithDocAndHTML(`
      *(:document)
      =
      @test = { document.normalize!() . }
    `)).not.toThrow();
  });
});

describe('HTML element compile — ClassList + Dataset sub-reps', () => {
  it('div.class_list() compiles — ClassList sub-rep accessor', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); cl = d.class_list() . }
    `)).not.toThrow();
  });

  it('class_list().add!("foo") compiles — single Text token form', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.class_list().add!("foo") . }
    `)).not.toThrow();
  });

  it('class_list().toggle!("hi", true) compiles — positional Text + Boolean', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); b = d.class_list().toggle!("hi", true) . }
    `)).not.toThrow();
  });

  it('class_list().replace!(old_token: "a", new_token: "b") compiles — named form', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); b = d.class_list().replace!(old_token: "a", new_token: "b") . }
    `)).not.toThrow();
  });

  it('cl.value <- "a b" compiles — settable value field on a bound ClassList', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); cl = d.class_list(); cl.value <- "a b" . }
    `)).not.toThrow();
  });

  it('div.dataset() compiles — Dataset sub-rep accessor', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); ds = d.dataset() . }
    `)).not.toThrow();
  });

  it('dataset().get("fooBar") compiles', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); v = d.dataset().get("fooBar") . }
    `)).not.toThrow();
  });

  it('dataset().put!(key: "k", value: "v") compiles — named form (put! avoids `set` keyword)', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); d.dataset().put!(key: "k", value: "v") . }
    `)).not.toThrow();
  });

  it('dataset().keys() compiles — List of Texts', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:div))
      =
      @test = { d = div(); ks = d.dataset().keys() . }
    `)).not.toThrow();
  });

  it('br.class_list() compiles — sub-reps work on void tags too', () => {
    expect(() => compileWithHTML(`
      *(HTML: (:br))
      =
      @test = { b = br(); cl = b.class_list() . }
    `)).not.toThrow();
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
      { input: { id: '1', op: [{ children: ['Hello'] }, '#new'] } },
      { output: expect.objectContaining({ id: '1', re: '#<HTML @div/1>', 'bv-a': '#<HTML @div>', from: 'HTML' }) },
    );
  });

  it('created element is addressable and has correct content', async () => {
    const page = await loadPage(html);
    const dom = await page.connectActor('HTML @div');

    await expectBehavior(dom,
      { input: { id: '1', op: [{ children: ['Hello'] }, '#new'] } },
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
      { input: { id: '1', op: [{ children: ['First'] }, '#new'] } },
      { output: expect.objectContaining({ id: '1', re: '#<HTML @div/1>', 'bv-a': '#<HTML @div>' }) },
      { input: { id: '2', op: [{ children: ['Second'] }, '#new'] } },
      { output: expect.objectContaining({ id: '2', re: '#<HTML @div/2>', 'bv-a': '#<HTML @div>' }) },
      { input: { id: '3', op: [{ children: ['Third'] }, '#new'] } },
      { output: expect.objectContaining({ id: '3', re: '#<HTML @div/3>', 'bv-a': '#<HTML @div>' }) },
    );
  });

  it('counters are per-tag — div and p number independently', async () => {
    const page = await loadPage(html);
    const domDiv = await page.connectActor('HTML @div');
    const domP = await page.connectActor('HTML @p');

    // Interleave div/p/div/p so a unified counter would produce
    // /1, /2, /3, /4 — per-tag counters instead produce /1, /1, /2, /2.
    await domDiv.sendAsync({ id: '1', op: [{ children: ['d1'] }, '#new'] });
    await domP.sendAsync({ id: '2', op: [{ children: ['p1'] }, '#new'] });
    await domDiv.sendAsync({ id: '3', op: [{ children: ['d2'] }, '#new'] });
    await domP.sendAsync({ id: '4', op: [{ children: ['p2'] }, '#new'] });

    expect(domDiv.posts).toEqual([
      expect.objectContaining({ id: '1', re: '#<HTML @div/1>', 'bv-a': '#<HTML @div>' }),
      expect.objectContaining({ id: '3', re: '#<HTML @div/2>', 'bv-a': '#<HTML @div>' }),
    ]);
    expect(domP.posts).toEqual([
      expect.objectContaining({ id: '2', re: '#<HTML @p/1>', 'bv-a': '#<HTML @p>' }),
      expect.objectContaining({ id: '4', re: '#<HTML @p/2>', 'bv-a': '#<HTML @p>' }),
    ]);
  });

  // Mint a tagged element AND attach it to <body>, returning the element
  // address (bracketed) and a connected actor handle. Most content/setter
  // tests need DOM-side verification, so they always read after attaching.
  async function makeAttached(page, tag, payload = {}) {
    const dom = await page.connectActor(`HTML @${tag}`);
    await dom.sendAsync({ id: 'n', op: [payload, '#new'] });
    const elementAddr = dom.posts[0].re;
    const docActor = await page.connectActor('document');
    await docActor.sendAsync({ id: 'b', op: '@body' });
    const bodyAddr = docActor.posts[0].re.slice(2, -1);
    const body = await page.connectActor(bodyAddr);
    await body.sendAsync({ id: 'a', op: [elementAddr, '@append!'] });
    const inner = elementAddr.slice(2, -1);
    const el = await page.connectActor(inner);
    return { elementAddr, inner, el };
  }

  it('node-identity readers (tag_name, node_name, node_type, local_name)', async () => {
    const page = await loadPage(html);
    const { el } = await makeAttached(page, 'div');
    await expectBehavior(el,
      { input: { id: 't', op: '@tag_name' } },
      { output: expect.objectContaining({ re: 'DIV' }) },
      { input: { id: 'n', op: '@node_name' } },
      { output: expect.objectContaining({ re: 'DIV' }) },
      { input: { id: 'l', op: '@local_name' } },
      { output: expect.objectContaining({ re: 'div' }) },
      { input: { id: 'k', op: '@node_type' } },
      { output: expect.objectContaining({ re: 1 }) },
    );
  });

  it('outer_html() reads the element\'s serialized form', async () => {
    const page = await loadPage(html);
    const { el } = await makeAttached(page, 'div', { id: 'wrap', children: ['hi'] });
    await expectBehavior(el,
      { input: { id: 'oh', op: '@outer_html' } },
      { output: expect.objectContaining({ re: '<div id="wrap">hi</div>' }) },
    );
  });

  it('get_attribute / has_attribute / has_attributes round-trip via direct DOM set', async () => {
    const page = await loadPage(html);
    const { el } = await makeAttached(page, 'div');
    await page.evaluate(() => document.querySelector('div').setAttribute('data-x', 'one'));
    await expectBehavior(el,
      { input: { id: 'g',  op: [['data-x'], '@get_attribute'] } },
      { output: expect.objectContaining({ re: 'one' }) },
      { input: { id: 'gn', op: [['data-missing'], '@get_attribute'] } },
      { output: expect.objectContaining({ re: null }) },
      { input: { id: 'h',  op: [['data-x'], '@has_attribute'] } },
      { output: expect.objectContaining({ re: true }) },
      { input: { id: 'hm', op: [['data-missing'], '@has_attribute'] } },
      { output: expect.objectContaining({ re: false }) },
      { input: { id: 'ha', op: '@has_attributes' } },
      { output: expect.objectContaining({ re: true }) },
    );
  });

  it('get_attribute_names() returns the attribute list', async () => {
    const page = await loadPage(html);
    const { el } = await makeAttached(page, 'div', { id: 'one', class: 'two' });
    await expectBehavior(el,
      { input: { id: 'gn', op: '@get_attribute_names' } },
      { output: expect.objectContaining({ re: expect.arrayContaining(['id', 'class']) }) },
    );
  });

  it('set_attribute! lands an attribute and replies self', async () => {
    const page = await loadPage(html);
    const { el } = await makeAttached(page, 'div');
    await expectBehavior(el,
      { input: { id: 's', op: [['data-x', 'one'], '@set_attribute!'] } },
      { output: expect.objectContaining({ re: {}, 'bv-a': 'self' }) },
    );
    const value = await page.evaluate(() => document.querySelector('div').getAttribute('data-x'));
    expect(value).toBe('one');
  });

  it('remove_attribute! drops the attribute', async () => {
    const page = await loadPage(html);
    const { el } = await makeAttached(page, 'div', { id: 'wrap' });
    await el.sendAsync({ id: 'r', op: [['id'], '@remove_attribute!'] });
    expect(el.posts[0]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
    const has = await page.evaluate(() => document.querySelector('div').hasAttribute('id'));
    expect(has).toBe(false);
  });

  it('toggle_attribute! flips presence; (name, force) form pins it', async () => {
    const page = await loadPage(html);
    const { el } = await makeAttached(page, 'div');
    await el.sendAsync({ id: 't1', op: [['hidden'], '@toggle_attribute!'] });
    let has = await page.evaluate(() => document.querySelector('div').hasAttribute('hidden'));
    expect(has).toBe(true);
    await el.sendAsync({ id: 't2', op: [['hidden', false], '@toggle_attribute!'] });
    has = await page.evaluate(() => document.querySelector('div').hasAttribute('hidden'));
    expect(has).toBe(false);
  });

  it('set inner_html via `<-` wire form updates the DOM and replies self', async () => {
    const page = await loadPage(html);
    const { inner } = await makeAttached(page, 'div');

    const inbox = [];
    await page.register('__t_set_inner', m => inbox.push(m));
    await page.send({
      id: 's', op: [['<b>hi</b>'], '#set'],
      to: `#<${inner} @inner_html>`, from: '__t_set_inner',
    });
    // Two ticks for round-trip + dispatch.
    await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
    await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
    const html_ = await page.evaluate(() => document.querySelector('div').innerHTML);
    expect(html_).toBe('<b>hi</b>');
    expect(inbox[0]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
  });

  it('set text_content via `<-` writes textContent (escapes HTML)', async () => {
    const page = await loadPage(html);
    const { inner } = await makeAttached(page, 'div');

    const inbox = [];
    await page.register('__t_set_tc', m => inbox.push(m));
    await page.send({
      id: 's', op: [['<b>raw</b>'], '#set'],
      to: `#<${inner} @text_content>`, from: '__t_set_tc',
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
    await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
    const html_ = await page.evaluate(() => document.querySelector('div').innerHTML);
    expect(html_).toBe('&lt;b&gt;raw&lt;/b&gt;');
    expect(inbox[0]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
  });

  it('set on a void tag\'s content field is silently ignored (no DOM write, no reply)', async () => {
    const page = await loadPage(html);
    const { inner } = await makeAttached(page, 'br');

    const inbox = [];
    await page.register('__t_set_void', m => inbox.push(m));
    await page.send({
      id: 's', op: [['ignored'], '#set'],
      to: `#<${inner} @inner_html>`, from: '__t_set_void',
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
    await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
    expect(inbox).toEqual([]);
  });

  describe('Node traversal accessors', () => {
    it('parent_element returns the body — same addr as document.body() (identity preserved)', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyToken = docActor.posts[0].re;
      await el.sendAsync({ id: 'p', op: '@parent_element' });
      expect(el.posts[0].re).toBe(bodyToken);
    });

    it('parent_element returns null when detached', async () => {
      const page = await loadPage(html);
      const dom = await page.connectActor('HTML @div');
      await dom.sendAsync({ id: '1', op: [{}, '#new'] });
      const inner = dom.posts[0].re.slice(2, -1);
      const el = await page.connectActor(inner);
      await el.sendAsync({ id: 'p', op: '@parent_element' });
      expect(el.posts[0]).toEqual(expect.objectContaining({ re: null }));
    });

    it('children returns an array of element wire tokens (skips text nodes)', async () => {
      const page = await loadPage(html);
      // div with two element children and a text node interleaved.
      const { el } = await makeAttached(page, 'div');
      const sp = await page.connectActor('HTML @span');
      await sp.sendAsync({ id: 'a', op: [{}, '#new'] });
      await sp.sendAsync({ id: 'b', op: [{}, '#new'] });
      const span1Addr = sp.posts[0].re;
      const span2Addr = sp.posts[1].re;
      await el.sendAsync({ id: 'app', op: [[[span1Addr, ' middle ', span2Addr]], '@append!'] });
      await el.sendAsync({ id: 'c', op: '@children' });
      const last = el.posts[el.posts.length - 1];
      expect(last.re).toEqual([span1Addr, span2Addr]);
    });

    it('child_nodes includes text-node tokens; text nodes get @text/N addresses', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div', { children: ['just text'] });
      await el.sendAsync({ id: 'cn', op: '@child_nodes' });
      const list = el.posts[0].re;
      expect(Array.isArray(list)).toBe(true);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatch(/^#<HTML @text\/\d+>$/);
    });

    it('first_element_child / last_element_child / sibling pointers preserve identity', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      const sp = await page.connectActor('HTML @span');
      await sp.sendAsync({ id: 'a', op: [{}, '#new'] });
      await sp.sendAsync({ id: 'b', op: [{}, '#new'] });
      const span1Addr = sp.posts[0].re;
      const span2Addr = sp.posts[1].re;
      await el.sendAsync({ id: 'app', op: [[[span1Addr, span2Addr]], '@append!'] });

      await el.sendAsync({ id: 'fec', op: '@first_element_child' });
      expect(el.posts[el.posts.length - 1].re).toBe(span1Addr);
      await el.sendAsync({ id: 'lec', op: '@last_element_child' });
      expect(el.posts[el.posts.length - 1].re).toBe(span2Addr);

      const span1 = await page.connectActor(span1Addr.slice(2, -1));
      await span1.sendAsync({ id: 'nes', op: '@next_element_sibling' });
      expect(span1.posts[0].re).toBe(span2Addr);
      await span1.sendAsync({ id: 'pes', op: '@previous_element_sibling' });
      expect(span1.posts[1]).toEqual(expect.objectContaining({ re: null }));
    });

    it('child_element_count returns Integer (BigInt → Number boundary)', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      const sp = await page.connectActor('HTML @span');
      await sp.sendAsync({ id: 'a', op: [{}, '#new'] });
      await sp.sendAsync({ id: 'b', op: [{}, '#new'] });
      const span1Addr = sp.posts[0].re;
      const span2Addr = sp.posts[1].re;
      await el.sendAsync({ id: 'app', op: [[[span1Addr, span2Addr]], '@append!'] });
      await el.sendAsync({ id: 'cec', op: '@child_element_count' });
      expect(el.posts[el.posts.length - 1].re).toBe(2);
    });

    it('is_connected reflects DOM attachment state', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      await el.sendAsync({ id: 'c', op: '@is_connected' });
      expect(el.posts[0]).toEqual(expect.objectContaining({ re: true }));

      const dom = await page.connectActor('HTML @p');
      await dom.sendAsync({ id: 'n', op: [{}, '#new'] });
      const detachedAddr = dom.posts[0].re.slice(2, -1);
      const detached = await page.connectActor(detachedAddr);
      await detached.sendAsync({ id: 'c', op: '@is_connected' });
      expect(detached.posts[0]).toEqual(expect.objectContaining({ re: false }));
    });

    it('owner_document returns the document singleton address', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      await el.sendAsync({ id: 'od', op: '@owner_document' });
      expect(el.posts[0]).toEqual(expect.objectContaining({ re: '#<document>' }));
    });

    it('contains(other) returns true for descendants, false otherwise', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      const sp = await page.connectActor('HTML @span');
      await sp.sendAsync({ id: 'a', op: [{}, '#new'] });
      await sp.sendAsync({ id: 'b', op: [{}, '#new'] });
      const spanAddr = sp.posts[0].re;
      const otherAddr = sp.posts[1].re;
      await el.sendAsync({ id: 'app', op: [{ child: spanAddr }, '@append_child!'] });
      await el.sendAsync({ id: 'c', op: [{ other: spanAddr }, '@contains'] });
      expect(el.posts[el.posts.length - 1]).toEqual(expect.objectContaining({ re: true }));
      await el.sendAsync({ id: 'c2', op: [{ other: otherAddr }, '@contains'] });
      expect(el.posts[el.posts.length - 1]).toEqual(expect.objectContaining({ re: false }));
    });

    it('identity preservation: parent_element of two siblings returns the same parent address', async () => {
      const page = await loadPage(html);
      const { inner: divAddr, el } = await makeAttached(page, 'div');
      const sp = await page.connectActor('HTML @span');
      await sp.sendAsync({ id: 'a', op: [{}, '#new'] });
      await sp.sendAsync({ id: 'b', op: [{}, '#new'] });
      const span1Addr = sp.posts[0].re;
      const span2Addr = sp.posts[1].re;
      await el.sendAsync({ id: 'app', op: [[[span1Addr, span2Addr]], '@append!'] });

      const span1 = await page.connectActor(span1Addr.slice(2, -1));
      await span1.sendAsync({ id: 'p', op: '@parent_element' });
      const span2 = await page.connectActor(span2Addr.slice(2, -1));
      await span2.sendAsync({ id: 'p', op: '@parent_element' });
      expect(span1.posts[0].re).toBe(span2.posts[0].re);
      expect(span1.posts[0].re).toBe('#<' + divAddr + '>');
    });

    it('on-demand minting: an element inserted via insert_adjacent_html surfaces under its tag', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      await el.sendAsync({
        id: 'h', op: [{ position: 'beforeend', html: '<em>x</em>' }, '@insert_adjacent_html!'],
      });
      await el.sendAsync({ id: 'fec', op: '@first_element_child' });
      const reply = el.posts[el.posts.length - 1].re;
      expect(typeof reply).toBe('string');
      expect(reply).toMatch(/^#<HTML @em\/\d+>$/);
    });

    it('text-node actor exposes Node accessors (node_type=3, node_value reads text)', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div', { children: ['hello world'] });
      await el.sendAsync({ id: 'fc', op: '@first_child' });
      const textAddr = el.posts[0].re;
      expect(textAddr).toMatch(/^#<HTML @text\/\d+>$/);
      const textActor = await page.connectActor(textAddr.slice(2, -1));
      await textActor.sendAsync({ id: 'nt', op: '@node_type' });
      expect(textActor.posts[0]).toEqual(expect.objectContaining({ re: 3 }));
      await textActor.sendAsync({ id: 'nv', op: '@node_value' });
      expect(textActor.posts[1]).toEqual(expect.objectContaining({ re: 'hello world' }));
      await textActor.sendAsync({ id: 'nn', op: '@node_name' });
      expect(textActor.posts[2]).toEqual(expect.objectContaining({ re: '#text' }));
    });

    it('node_value on an Element returns null (DOM spec)', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      await el.sendAsync({ id: 'nv', op: '@node_value' });
      expect(el.posts[0]).toEqual(expect.objectContaining({ re: null }));
    });

    it('parent_node mirrors parent_element for normal elements, but reaches document above <html>', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      // Body's parent_node is <html>; parent_element is also <html>.
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyAddr = docActor.posts[0].re.slice(2, -1);
      const body = await page.connectActor(bodyAddr);
      await body.sendAsync({ id: 'pn', op: '@parent_node' });
      const bodyParent = body.posts[0].re;
      expect(bodyParent).toMatch(/^#<HTML @html\/\d+>$/);

      // <html>.parent_node === document (Node form) but parent_element === null.
      const htmlActor = await page.connectActor(bodyParent.slice(2, -1));
      await htmlActor.sendAsync({ id: 'pn', op: '@parent_node' });
      expect(htmlActor.posts[0]).toEqual(expect.objectContaining({ re: '#<document>' }));
      await htmlActor.sendAsync({ id: 'pe', op: '@parent_element' });
      expect(htmlActor.posts[1]).toEqual(expect.objectContaining({ re: null }));

      // div's parent_node === parent_element (both are <body>).
      await el.sendAsync({ id: 'pn', op: '@parent_node' });
      await el.sendAsync({ id: 'pe', op: '@parent_element' });
      expect(el.posts[0].re).toBe(el.posts[1].re);
    });

    it('last_child returns the last child Node (text or element)', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      const sp = await page.connectActor('HTML @span');
      await sp.sendAsync({ id: 'a', op: [{}, '#new'] });
      const spanAddr = sp.posts[0].re;
      // Children: [<span>, ' tail']. last_child is the trailing text node.
      await el.sendAsync({ id: 'app', op: [[[spanAddr, ' tail']], '@append!'] });
      await el.sendAsync({ id: 'lc', op: '@last_child' });
      expect(el.posts[el.posts.length - 1].re).toMatch(/^#<HTML @text\/\d+>$/);

      // Now flip: text first, span last.
      const { el: el2 } = await makeAttached(page, 'div');
      await sp.sendAsync({ id: 'b', op: [{}, '#new'] });
      const span2Addr = sp.posts[1].re;
      await el2.sendAsync({ id: 'app', op: [[['head ', span2Addr]], '@append!'] });
      await el2.sendAsync({ id: 'lc', op: '@last_child' });
      expect(el2.posts[el2.posts.length - 1].re).toBe(span2Addr);
    });

    it('next_sibling / previous_sibling cross text↔element boundaries', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      const sp = await page.connectActor('HTML @span');
      await sp.sendAsync({ id: 'a', op: [{}, '#new'] });
      const spanAddr = sp.posts[0].re;
      // Layout: ['head ', <span>, ' tail']
      await el.sendAsync({ id: 'app', op: [[['head ', spanAddr, ' tail']], '@append!'] });

      const span = await page.connectActor(spanAddr.slice(2, -1));
      await span.sendAsync({ id: 'ps', op: '@previous_sibling' });
      const prev = span.posts[0].re;
      expect(prev).toMatch(/^#<HTML @text\/\d+>$/);
      await span.sendAsync({ id: 'ns', op: '@next_sibling' });
      const next = span.posts[1].re;
      expect(next).toMatch(/^#<HTML @text\/\d+>$/);
      expect(prev).not.toBe(next);

      // The text node before the span has next_sibling === span.
      const prevText = await page.connectActor(prev.slice(2, -1));
      await prevText.sendAsync({ id: 'ns', op: '@next_sibling' });
      expect(prevText.posts[0].re).toBe(spanAddr);
    });

    it('get_root_node returns document when attached, the topmost ancestor when detached', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      await el.sendAsync({ id: 'gr', op: '@get_root_node' });
      expect(el.posts[0]).toEqual(expect.objectContaining({ re: '#<document>' }));

      // Detached subtree: build outer > inner, never attach to body. Root
      // should be the outer div (not document).
      const outerDom = await page.connectActor('HTML @section');
      await outerDom.sendAsync({ id: 'o', op: [{}, '#new'] });
      const outerAddr = outerDom.posts[0].re;
      const innerDom = await page.connectActor('HTML @article');
      await innerDom.sendAsync({ id: 'i', op: [{}, '#new'] });
      const innerAddr = innerDom.posts[0].re;
      const outer = await page.connectActor(outerAddr.slice(2, -1));
      await outer.sendAsync({ id: 'app', op: [{ child: innerAddr }, '@append_child!'] });

      const inner = await page.connectActor(innerAddr.slice(2, -1));
      await inner.sendAsync({ id: 'gr', op: '@get_root_node' });
      expect(inner.posts[0]).toEqual(expect.objectContaining({ re: outerAddr }));
    });

    it('compare_document_position reports FOLLOWING / PRECEDING / CONTAINS / CONTAINED_BY', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      const sp = await page.connectActor('HTML @span');
      await sp.sendAsync({ id: 'a', op: [{}, '#new'] });
      await sp.sendAsync({ id: 'b', op: [{}, '#new'] });
      const span1Addr = sp.posts[0].re;
      const span2Addr = sp.posts[1].re;
      await el.sendAsync({ id: 'app', op: [[[span1Addr, span2Addr]], '@append!'] });

      // span1 vs span2 → span2 is FOLLOWING (4). span1 vs span1's parent → CONTAINS+PRECEDING (10).
      const span1 = await page.connectActor(span1Addr.slice(2, -1));
      await span1.sendAsync({ id: 'cp', op: [{ other: span2Addr }, '@compare_document_position'] });
      const sib = span1.posts[0].re;
      expect(sib & 4).toBe(4);   // DOCUMENT_POSITION_FOLLOWING
      expect(sib & 16).toBe(0);  // not CONTAINED_BY

      // div.compareDocumentPosition(span1) → span1 is FOLLOWING + CONTAINED_BY (4|16=20).
      await el.sendAsync({ id: 'cp', op: [{ other: span1Addr }, '@compare_document_position'] });
      const containment = el.posts[el.posts.length - 1].re;
      expect(containment & 4).toBe(4);
      expect(containment & 16).toBe(16);
    });

    it('child_nodes / children return empty arrays on a leaf element', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      await el.sendAsync({ id: 'cn', op: '@child_nodes' });
      expect(el.posts[0]).toEqual(expect.objectContaining({ re: [] }));
      await el.sendAsync({ id: 'c', op: '@children' });
      expect(el.posts[1]).toEqual(expect.objectContaining({ re: [] }));
      await el.sendAsync({ id: 'cec', op: '@child_element_count' });
      expect(el.posts[2]).toEqual(expect.objectContaining({ re: 0 }));
      await el.sendAsync({ id: 'fc', op: '@first_child' });
      expect(el.posts[3]).toEqual(expect.objectContaining({ re: null }));
      await el.sendAsync({ id: 'lc', op: '@last_child' });
      expect(el.posts[4]).toEqual(expect.objectContaining({ re: null }));
    });

    it('text-node identity preserved: querying first_child twice returns the same @text/N address', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div', { children: ['hi'] });
      await el.sendAsync({ id: 'fc1', op: '@first_child' });
      await el.sendAsync({ id: 'fc2', op: '@first_child' });
      expect(el.posts[0].re).toBe(el.posts[1].re);
      expect(el.posts[0].re).toMatch(/^#<HTML @text\/\d+>$/);
    });

    it('comment-node round-trip: insert via insertAdjacentHTML, surface via child_nodes', async () => {
      const page = await loadPage(html);
      const { el } = await makeAttached(page, 'div');
      await page.evaluate(() => {
        const d = document.querySelector('div');
        d.appendChild(document.createComment('a comment'));
      });
      await el.sendAsync({ id: 'cn', op: '@child_nodes' });
      const list = el.posts[0].re;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatch(/^#<HTML @comment\/\d+>$/);

      const commentActor = await page.connectActor(list[0].slice(2, -1));
      await commentActor.sendAsync({ id: 'nt', op: '@node_type' });
      expect(commentActor.posts[0]).toEqual(expect.objectContaining({ re: 8 }));
      await commentActor.sendAsync({ id: 'nv', op: '@node_value' });
      expect(commentActor.posts[1]).toEqual(expect.objectContaining({ re: 'a comment' }));
      await commentActor.sendAsync({ id: 'nn', op: '@node_name' });
      expect(commentActor.posts[2]).toEqual(expect.objectContaining({ re: '#comment' }));
      // Comment also participates in traversal — its parent is the div.
      const divAddr = await el.sendAsync({ id: 'noop', op: '@is_connected' }).then(() => null);
      expect(divAddr).toBeNull();  // pacify lint; the meaningful check is below
      await commentActor.sendAsync({ id: 'pe', op: '@parent_element' });
      expect(commentActor.posts[3].re).toMatch(/^#<HTML @div\/\d+>$/);
    });

    it('contains is reflexive (a node contains itself)', async () => {
      const page = await loadPage(html);
      const { el, elementAddr } = await makeAttached(page, 'div');
      await el.sendAsync({ id: 'c', op: [{ other: elementAddr }, '@contains'] });
      expect(el.posts[0]).toEqual(expect.objectContaining({ re: true }));
    });

    it('text-node Node accessors: parent_element + previous_sibling', async () => {
      const page = await loadPage(html);
      const { el, elementAddr } = await makeAttached(page, 'div');
      const sp = await page.connectActor('HTML @span');
      await sp.sendAsync({ id: 'a', op: [{}, '#new'] });
      const spanAddr = sp.posts[0].re;
      // Children: [<span>, ' tail'] — text node sits AFTER the span.
      await el.sendAsync({ id: 'app', op: [[[spanAddr, ' tail']], '@append!'] });
      await el.sendAsync({ id: 'lc', op: '@last_child' });
      const textAddr = el.posts[el.posts.length - 1].re;
      const textActor = await page.connectActor(textAddr.slice(2, -1));
      await textActor.sendAsync({ id: 'pe', op: '@parent_element' });
      expect(textActor.posts[0].re).toBe(elementAddr);
      await textActor.sendAsync({ id: 'ps', op: '@previous_sibling' });
      expect(textActor.posts[1].re).toBe(spanAddr);
      await textActor.sendAsync({ id: 'ns', op: '@next_sibling' });
      expect(textActor.posts[2]).toEqual(expect.objectContaining({ re: null }));
    });
  });

  describe('Bare-set on text + comment nodes (`node <- "value"`)', () => {
    // Wire form: `{op: [[v], '#set'], to: '#<<node-addr>>'}` — no field
    // selector in `to`. route() unwraps the hash-angle and delivers with
    // `to: undefined`; the dispatcher recognizes that as the object-level
    // form and writes nodeValue. Distinct from element field-set, which
    // carries `to: '@<field>'`.

    it('text node accepts bare set; nodeValue updates and reply self', async () => {
      const page = await loadPage(html);
      // Mint a div with a text child via insertAdjacentHTML so the text
      // node enters the tree without a CAM addr — addrForNode mints one
      // on first traversal lookup.
      const dom = await page.connectActor('HTML @div');
      await dom.sendAsync({ id: 'n', op: [{}, '#new'] });
      const elementAddr = dom.posts[0].re;
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyAddr = docActor.posts[0].re.slice(2, -1);
      const body = await page.connectActor(bodyAddr);
      await body.sendAsync({ id: 'a', op: [elementAddr, '@append!'] });
      const el = await page.connectActor(elementAddr.slice(2, -1));
      await el.sendAsync({ id: 'iah', op: [{ position: 'beforeend', html: 'original' }, '@insert_adjacent_html!'] });
      await el.sendAsync({ id: 'fc', op: '@first_child' });
      const textAddr = el.posts[el.posts.length - 1].re;
      const textInner = textAddr.slice(2, -1);

      // Send bare-set targeting the text node itself.
      const inbox = [];
      await page.register('__t_node_set', m => inbox.push(m));
      await page.send({
        id: 's', op: [['updated'], '#set'],
        to: textAddr, from: '__t_node_set',
      });
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      expect(inbox[0]).toEqual(expect.objectContaining({ id: 's', re: {}, 'bv-a': 'self' }));

      // Verify the DOM took the write.
      const live = await page.evaluate(() => document.querySelector('div').firstChild.nodeValue);
      expect(live).toBe('updated');

      // And node_value() reads back the new value.
      const text = await page.connectActor(textInner);
      await text.sendAsync({ id: 'r', op: '@node_value' });
      expect(text.posts[0]).toEqual(expect.objectContaining({ re: 'updated' }));
    });

    it('comment node accepts bare set the same way', async () => {
      const page = await loadPage(html);
      const dom = await page.connectActor('HTML @div');
      await dom.sendAsync({ id: 'n', op: [{}, '#new'] });
      const elementAddr = dom.posts[0].re;
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyAddr = docActor.posts[0].re.slice(2, -1);
      const body = await page.connectActor(bodyAddr);
      await body.sendAsync({ id: 'a', op: [elementAddr, '@append!'] });
      // Plant a comment node directly via DOM.
      await page.evaluate(() => {
        const d = document.querySelector('div');
        d.appendChild(document.createComment('before'));
      });
      const el = await page.connectActor(elementAddr.slice(2, -1));
      await el.sendAsync({ id: 'fc', op: '@first_child' });
      const commentAddr = el.posts[el.posts.length - 1].re;

      const inbox = [];
      await page.register('__t_comm_set', m => inbox.push(m));
      await page.send({
        id: 's', op: [['after'], '#set'],
        to: commentAddr, from: '__t_comm_set',
      });
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      expect(inbox[0]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));

      const live = await page.evaluate(() => document.querySelector('div').firstChild.nodeValue);
      expect(live).toBe('after');
    });

    it('null payload coerces to empty string (matches inner_html setter convention)', async () => {
      const page = await loadPage(html);
      const dom = await page.connectActor('HTML @div');
      await dom.sendAsync({ id: 'n', op: [{}, '#new'] });
      const elementAddr = dom.posts[0].re;
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyAddr = docActor.posts[0].re.slice(2, -1);
      const body = await page.connectActor(bodyAddr);
      await body.sendAsync({ id: 'a', op: [elementAddr, '@append!'] });
      const el = await page.connectActor(elementAddr.slice(2, -1));
      await el.sendAsync({ id: 'iah', op: [{ position: 'beforeend', html: 'starting' }, '@insert_adjacent_html!'] });
      await el.sendAsync({ id: 'fc', op: '@first_child' });
      const textAddr = el.posts[el.posts.length - 1].re;

      const inbox = [];
      await page.register('__t_null_set', m => inbox.push(m));
      await page.send({
        id: 's', op: [[null], '#set'],
        to: textAddr, from: '__t_null_set',
      });
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      expect(inbox[0]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
      const live = await page.evaluate(() => document.querySelector('div').firstChild.nodeValue);
      expect(live).toBe('');
    });

    it('bare set on an element is silently ignored (no nodeValue meaning)', async () => {
      // Element dispatcher's existing `set` branch requires a field
      // selector via ELEMENT_SETTERS; a bare set targeting the element
      // itself has no declared semantic and falls through with no reply.
      const page = await loadPage(html);
      const dom = await page.connectActor('HTML @div');
      await dom.sendAsync({ id: 'n', op: [{}, '#new'] });
      const elementAddr = dom.posts[0].re;
      const inbox = [];
      await page.register('__t_el_bare_set', m => inbox.push(m));
      await page.send({
        id: 's', op: [['ignored'], '#set'],
        to: elementAddr, from: '__t_el_bare_set',
      });
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      expect(inbox).toEqual([]); // no reply, no DOM write
    });
  });

  describe('Selector queries', () => {
    // Build a parent <div> containing two <p>s, one classed "hit", one with
    // a nested <span class="hit">. Returns the parent's actor handle plus
    // the wire addresses of every element so identity assertions can refer
    // back to known wrappers.
    async function makeQueryFixture(page) {
      const dom = await page.connectActor('HTML @div');
      // Use insertAdjacentHTML to plant the whole subtree at once — none of
      // these nodes have CAM addresses yet, exercising on-demand minting.
      await dom.sendAsync({ id: 'n', op: [{ children: ['x'] }, '#new'] });
      const parentAddr = dom.posts[0].re;
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyAddr = docActor.posts[0].re.slice(2, -1);
      const body = await page.connectActor(bodyAddr);
      await body.sendAsync({ id: 'a', op: [parentAddr, '@append!'] });
      const parent = await page.connectActor(parentAddr.slice(2, -1));
      // Replace the placeholder 'x' with the real subtree.
      await parent.sendAsync({ id: 'iah', op: [{ position: 'beforeend', html: '<p class="hit">one</p><p>two<span class="hit">deep</span></p>' }, '@insert_adjacent_html!'] });
      return { parent, parentAddr };
    }

    it('query_selector finds first descendant match — addr resolves to element', async () => {
      const page = await loadPage(html);
      const { parent } = await makeQueryFixture(page);
      await parent.sendAsync({ id: 'q', op: [['p'], '@query_selector'] });
      // Mints HTML @p/N for the matched element on first lookup.
      expect(parent.posts[parent.posts.length - 1].re).toMatch(/^#<HTML @p\/\d+>$/);
    });

    it('query_selector returns null when nothing matches', async () => {
      const page = await loadPage(html);
      const { parent } = await makeQueryFixture(page);
      await parent.sendAsync({ id: 'q', op: [['nope'], '@query_selector'] });
      expect(parent.posts[parent.posts.length - 1]).toEqual(expect.objectContaining({ re: null }));
    });

    it('query_selector_all returns every match — list of element addrs', async () => {
      const page = await loadPage(html);
      const { parent } = await makeQueryFixture(page);
      await parent.sendAsync({ id: 'qa', op: [['p'], '@query_selector_all'] });
      const re = parent.posts[parent.posts.length - 1].re;
      expect(re).toEqual([
        expect.stringMatching(/^#<HTML @p\/\d+>$/),
        expect.stringMatching(/^#<HTML @p\/\d+>$/),
      ]);
      expect(re[0]).not.toBe(re[1]); // distinct elements
    });

    it('query_selector_all returns empty list when nothing matches', async () => {
      const page = await loadPage(html);
      const { parent } = await makeQueryFixture(page);
      await parent.sendAsync({ id: 'qa', op: [['nope'], '@query_selector_all'] });
      expect(parent.posts[parent.posts.length - 1]).toEqual(expect.objectContaining({ re: [] }));
    });

    it('query_selector identity — repeated calls return the same address', async () => {
      const page = await loadPage(html);
      const { parent } = await makeQueryFixture(page);
      await parent.sendAsync({ id: 'q1', op: [['.hit'], '@query_selector'] });
      const first = parent.posts[parent.posts.length - 1].re;
      await parent.sendAsync({ id: 'q2', op: [['.hit'], '@query_selector'] });
      const second = parent.posts[parent.posts.length - 1].re;
      expect(first).toBe(second);
    });

    it('closest walks self-or-ancestor — finds the parent', async () => {
      const page = await loadPage(html);
      const { parent, parentAddr } = await makeQueryFixture(page);
      // Drill down to the nested span, then closest("div") should hit the parent.
      await parent.sendAsync({ id: 'qs', op: [['span'], '@query_selector'] });
      const spanAddr = parent.posts[parent.posts.length - 1].re;
      const span = await page.connectActor(spanAddr.slice(2, -1));
      await span.sendAsync({ id: 'cl', op: [['div'], '@closest'] });
      expect(span.posts[span.posts.length - 1].re).toBe(parentAddr);
    });

    it('closest returns null when no ancestor matches', async () => {
      const page = await loadPage(html);
      const { parent } = await makeQueryFixture(page);
      await parent.sendAsync({ id: 'cl', op: [['nav'], '@closest'] });
      expect(parent.posts[parent.posts.length - 1]).toEqual(expect.objectContaining({ re: null }));
    });

    it('matches returns true/false against a CSS selector', async () => {
      const page = await loadPage(html);
      const { parent } = await makeQueryFixture(page);
      await parent.sendAsync({ id: 'm1', op: [['div'], '@matches'] });
      expect(parent.posts[parent.posts.length - 1]).toEqual(expect.objectContaining({ re: true }));
      await parent.sendAsync({ id: 'm2', op: [['span'], '@matches'] });
      expect(parent.posts[parent.posts.length - 1]).toEqual(expect.objectContaining({ re: false }));
    });

    it('get_elements_by_tag_name returns descendants by tag — snapshot list', async () => {
      const page = await loadPage(html);
      const { parent } = await makeQueryFixture(page);
      await parent.sendAsync({ id: 't', op: [['p'], '@get_elements_by_tag_name'] });
      expect(parent.posts[parent.posts.length - 1].re).toEqual([
        expect.stringMatching(/^#<HTML @p\/\d+>$/),
        expect.stringMatching(/^#<HTML @p\/\d+>$/),
      ]);
    });

    it('get_elements_by_class_name filters by class — both .hit elements', async () => {
      const page = await loadPage(html);
      const { parent } = await makeQueryFixture(page);
      await parent.sendAsync({ id: 'c', op: [['hit'], '@get_elements_by_class_name'] });
      const re = parent.posts[parent.posts.length - 1].re;
      expect(re).toHaveLength(2);
      expect(re[0]).toMatch(/^#<HTML @(p|span)\/\d+>$/);
      expect(re[1]).toMatch(/^#<HTML @(p|span)\/\d+>$/);
    });

    it('invalid CSS selector replies with ex (not re) — runtime-error convention', async () => {
      const page = await loadPage(html);
      const { parent } = await makeQueryFixture(page);
      await parent.sendAsync({ id: 'bad', op: [['?? not valid'], '@query_selector'] });
      const last = parent.posts[parent.posts.length - 1];
      expect(last).toEqual(expect.objectContaining({ id: 'bad', ex: { '@query_selector': 'error' } }));
      expect(last.re).toBeUndefined();
    });

    it('document.query_selector matches elements anywhere in the page', async () => {
      const page = await loadPage(html);
      const { parentAddr } = await makeQueryFixture(page);
      const docActor = await page.connectActor('document');
      // First, find the parent div via its known structure.
      await docActor.sendAsync({ id: 'q', op: [{ selector: 'body > div' }, '@query_selector'] });
      // Identity: same address as the one minted at construction time.
      expect(docActor.posts[docActor.posts.length - 1].re).toBe(parentAddr);
    });

    it('document.query_selector_all on body returns the body element', async () => {
      const page = await loadPage(html);
      await makeQueryFixture(page);
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'qa', op: [{ selector: 'body' }, '@query_selector_all'] });
      const re = docActor.posts[docActor.posts.length - 1].re;
      expect(re).toHaveLength(1);
    });

    it('document with invalid selector emits ex reply', async () => {
      const page = await loadPage(html);
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'bad', op: [{ selector: '?? bogus' }, '@query_selector'] });
      const last = docActor.posts[docActor.posts.length - 1];
      expect(last).toEqual(expect.objectContaining({ id: 'bad', ex: { '@query_selector': 'error' } }));
    });
  });

  describe('Layout / geometry / scrolling / focus / cloning', () => {
    // Reused fixture: a 100×80 attached div whose oversized child forces
    // the scroll-dimension paths to disagree from client-dimension paths.
    // Geometry/scroll measurements need a real layout, so the element is
    // appended to <body> before any reads. Inline CSS keeps the test
    // self-contained without plumbing a stylesheet.
    async function makeMeasured(page) {
      const dom = await page.connectActor('HTML @div');
      await dom.sendAsync({ id: 'n', op: [{
        style: 'width: 100px; height: 80px; overflow: auto; padding: 10px; border: 2px solid black; box-sizing: content-box;',
      }, '#new'] });
      const elementAddr = dom.posts[0].re;
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyAddr = docActor.posts[0].re.slice(2, -1);
      const body = await page.connectActor(bodyAddr);
      await body.sendAsync({ id: 'a', op: [elementAddr, '@append!'] });
      const el = await page.connectActor(elementAddr.slice(2, -1));
      await el.sendAsync({ id: 'iah', op: [{ position: 'beforeend', html: '<p style="height: 500px; width: 500px;">tall</p>' }, '@insert_adjacent_html!'] });
      return { el, elementAddr };
    }

    it('client_width/client_height return the inner box as Integers', async () => {
      const page = await loadPage(html);
      const { el } = await makeMeasured(page);
      await el.sendAsync({ id: 'w', op: '@client_width' });
      await el.sendAsync({ id: 'h', op: '@client_height' });
      // 100px width + 10px padding × 2 = 120, but scrollbar steals some;
      // assert it's a positive Integer (BigInt → Number via harness) and
      // sits in a generous-but-bounded range.
      const w = el.posts[el.posts.length - 2].re;
      const h = el.posts[el.posts.length - 1].re;
      expect(typeof w).toBe('number');
      expect(typeof h).toBe('number');
      expect(w).toBeGreaterThan(50);
      expect(w).toBeLessThan(140);
      expect(h).toBeGreaterThan(50);
      expect(h).toBeLessThan(120);
    });

    it('scroll_width/scroll_height exceed client dimensions when content overflows', async () => {
      const page = await loadPage(html);
      const { el } = await makeMeasured(page);
      await el.sendAsync({ id: 'sw', op: '@scroll_width' });
      await el.sendAsync({ id: 'sh', op: '@scroll_height' });
      const sw = el.posts[el.posts.length - 2].re;
      const sh = el.posts[el.posts.length - 1].re;
      // Inner content is 500×500 → both dimensions clearly exceed the box.
      expect(sw).toBeGreaterThan(400);
      expect(sh).toBeGreaterThan(400);
    });

    it('client_top/client_left return the border thickness', async () => {
      const page = await loadPage(html);
      const { el } = await makeMeasured(page);
      await el.sendAsync({ id: 't', op: '@client_top' });
      await el.sendAsync({ id: 'l', op: '@client_left' });
      // 2px border on each side per the inline style.
      expect(el.posts[el.posts.length - 2].re).toBe(2);
      expect(el.posts[el.posts.length - 1].re).toBe(2);
    });

    it('offset_parent returns body for an attached div — identity preserved', async () => {
      const page = await loadPage(html);
      const { el } = await makeMeasured(page);
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyToken = docActor.posts[docActor.posts.length - 1].re;
      await el.sendAsync({ id: 'op', op: '@offset_parent' });
      expect(el.posts[el.posts.length - 1].re).toBe(bodyToken);
    });

    it('bounding_client_rect returns a Structure with all 8 spec fields', async () => {
      const page = await loadPage(html);
      const { el } = await makeMeasured(page);
      await el.sendAsync({ id: 'r', op: '@bounding_client_rect' });
      const r = el.posts[el.posts.length - 1].re;
      expect(r).toEqual(expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number),
        top: expect.any(Number),
        right: expect.any(Number),
        bottom: expect.any(Number),
        left: expect.any(Number),
      }));
      // Geometry sanity: right === left + width, bottom === top + height.
      expect(r.right - r.left).toBeCloseTo(r.width, 5);
      expect(r.bottom - r.top).toBeCloseTo(r.height, 5);
    });

    it('client_rects returns a list (single rect for a block element)', async () => {
      const page = await loadPage(html);
      const { el } = await makeMeasured(page);
      await el.sendAsync({ id: 'rs', op: '@client_rects' });
      const rs = el.posts[el.posts.length - 1].re;
      expect(Array.isArray(rs)).toBe(true);
      expect(rs.length).toBeGreaterThan(0);
      expect(rs[0]).toEqual(expect.objectContaining({ width: expect.any(Number) }));
    });

    it('scroll_top setter writes scrollLeft/scrollTop through to the DOM', async () => {
      const page = await loadPage(html);
      const { elementAddr } = await makeMeasured(page);
      const inner = elementAddr.slice(2, -1);
      const inbox = [];
      await page.register('__t_scroll', m => inbox.push(m));
      await page.send({
        id: 's', op: [[100], '#set'],
        to: `#<${inner} @scroll_top>`, from: '__t_scroll',
      });
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      const t = await page.evaluate(() => document.querySelector('div').scrollTop);
      expect(t).toBe(100);
      expect(inbox[0]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
    });

    it('scroll_to! moves scroll position; scroll_top reads it back', async () => {
      const page = await loadPage(html);
      const { el } = await makeMeasured(page);
      await el.sendAsync({ id: 'sto', op: [{ top: 80, left: 50 }, '@scroll_to!'] });
      expect(el.posts[el.posts.length - 1]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
      await el.sendAsync({ id: 'st', op: '@scroll_top' });
      await el.sendAsync({ id: 'sl', op: '@scroll_left' });
      expect(el.posts[el.posts.length - 2].re).toBe(80);
      expect(el.posts[el.posts.length - 1].re).toBe(50);
    });

    it('scroll_by! shifts relative to current position', async () => {
      const page = await loadPage(html);
      const { el } = await makeMeasured(page);
      await el.sendAsync({ id: 's1', op: [{ top: 50 }, '@scroll_to!'] });
      await el.sendAsync({ id: 's2', op: [{ top: 30 }, '@scroll_by!'] });
      await el.sendAsync({ id: 'r',  op: '@scroll_top' });
      expect(el.posts[el.posts.length - 1].re).toBe(80);
    });

    it('scroll_by! accepts positional Decimal pair', async () => {
      const page = await loadPage(html);
      const { el } = await makeMeasured(page);
      await el.sendAsync({ id: 's', op: [[20, 40], '@scroll_by!'] });
      await el.sendAsync({ id: 'l', op: '@scroll_left' });
      await el.sendAsync({ id: 't', op: '@scroll_top' });
      expect(el.posts[el.posts.length - 2].re).toBe(20);
      expect(el.posts[el.posts.length - 1].re).toBe(40);
    });

    it('scroll_into_view! replies self with no args', async () => {
      const page = await loadPage(html);
      const { el } = await makeMeasured(page);
      await el.sendAsync({ id: 'siv', op: '@scroll_into_view!' });
      expect(el.posts[el.posts.length - 1]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
    });

    it('focus! focuses a tabbable element; activeElement matches', async () => {
      const page = await loadPage(html);
      const dom = await page.connectActor('HTML @input');
      await dom.sendAsync({ id: 'n', op: [{ type: 'text' }, '#new'] });
      const inputAddr = dom.posts[0].re;
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyAddr = docActor.posts[0].re.slice(2, -1);
      const body = await page.connectActor(bodyAddr);
      await body.sendAsync({ id: 'a', op: [inputAddr, '@append!'] });
      const input = await page.connectActor(inputAddr.slice(2, -1));
      await input.sendAsync({ id: 'f', op: '@focus!' });
      expect(input.posts[input.posts.length - 1]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
      const isFocused = await page.evaluate(() => document.activeElement === document.querySelector('input'));
      expect(isFocused).toBe(true);
    });

    it('blur! drops focus', async () => {
      const page = await loadPage(html);
      const dom = await page.connectActor('HTML @input');
      await dom.sendAsync({ id: 'n', op: [{ type: 'text' }, '#new'] });
      const inputAddr = dom.posts[0].re;
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyAddr = docActor.posts[0].re.slice(2, -1);
      const body = await page.connectActor(bodyAddr);
      await body.sendAsync({ id: 'a', op: [inputAddr, '@append!'] });
      const input = await page.connectActor(inputAddr.slice(2, -1));
      await input.sendAsync({ id: 'f', op: '@focus!' });
      await input.sendAsync({ id: 'b', op: '@blur!' });
      const isFocused = await page.evaluate(() => document.activeElement === document.querySelector('input'));
      expect(isFocused).toBe(false);
    });

    it('click! fires a click event on the element', async () => {
      const page = await loadPage(html);
      const { el } = await makeMeasured(page);
      // Wire a JS-side counter and verify click! triggers it.
      await page.evaluate(() => {
        window.__clickCount = 0;
        document.querySelector('div').addEventListener('click', () => { window.__clickCount += 1; });
      });
      await el.sendAsync({ id: 'c', op: '@click!' });
      const count = await page.evaluate(() => window.__clickCount);
      expect(count).toBe(1);
    });

    it('clone_node returns a fresh address; original retains identity', async () => {
      const page = await loadPage(html);
      const { el, elementAddr } = await makeMeasured(page);
      await el.sendAsync({ id: 'cl', op: [[true], '@clone_node'] });
      const cloneAddr = el.posts[el.posts.length - 1].re;
      expect(cloneAddr).toMatch(/^#<HTML @div\/\d+>$/);
      expect(cloneAddr).not.toBe(elementAddr); // distinct DOM nodes → distinct actors
    });

    it('is_same_node is reflexive (self) and false across distinct elements', async () => {
      const page = await loadPage(html);
      const { el, elementAddr } = await makeMeasured(page);
      // Mint a sibling div for the cross-comparison.
      const dom2 = await page.connectActor('HTML @div');
      await dom2.sendAsync({ id: 'n', op: [{}, '#new'] });
      const otherAddr = dom2.posts[0].re;
      await el.sendAsync({ id: 's1', op: [{ other: elementAddr }, '@is_same_node'] });
      await el.sendAsync({ id: 's2', op: [{ other: otherAddr }, '@is_same_node'] });
      expect(el.posts[el.posts.length - 2]).toEqual(expect.objectContaining({ re: true }));
      expect(el.posts[el.posts.length - 1]).toEqual(expect.objectContaining({ re: false }));
    });

    it('is_equal_node distinguishes structural vs identity equality', async () => {
      const page = await loadPage(html);
      const { el, elementAddr } = await makeMeasured(page);
      // Clone the element — clone is structurally equal but a different node.
      await el.sendAsync({ id: 'cl', op: [[true], '@clone_node'] });
      const cloneAddr = el.posts[el.posts.length - 1].re;
      await el.sendAsync({ id: 'eq', op: [{ other: cloneAddr }, '@is_equal_node'] });
      await el.sendAsync({ id: 'sm', op: [{ other: cloneAddr }, '@is_same_node'] });
      expect(el.posts[el.posts.length - 2]).toEqual(expect.objectContaining({ re: true }));
      expect(el.posts[el.posts.length - 1]).toEqual(expect.objectContaining({ re: false }));
      // Sanity: identity vs identity matches by both rules.
      await el.sendAsync({ id: 'eq2', op: [{ other: elementAddr }, '@is_equal_node'] });
      expect(el.posts[el.posts.length - 1]).toEqual(expect.objectContaining({ re: true }));
    });

    it('normalize! merges adjacent text nodes; replies self', async () => {
      const page = await loadPage(html);
      const dom = await page.connectActor('HTML @div');
      await dom.sendAsync({ id: 'n', op: [{}, '#new'] });
      const elementAddr = dom.posts[0].re;
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyAddr = docActor.posts[0].re.slice(2, -1);
      const body = await page.connectActor(bodyAddr);
      await body.sendAsync({ id: 'a', op: [elementAddr, '@append!'] });
      const inner = elementAddr.slice(2, -1);
      const el = await page.connectActor(inner);
      // Plant two adjacent text nodes via direct DOM manipulation.
      await page.evaluate(() => {
        const d = document.querySelector('div');
        d.appendChild(document.createTextNode('a'));
        d.appendChild(document.createTextNode('b'));
      });
      const before = await page.evaluate(() => document.querySelector('div').childNodes.length);
      expect(before).toBe(2);
      await el.sendAsync({ id: 'norm', op: '@normalize!' });
      expect(el.posts[el.posts.length - 1]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
      const after = await page.evaluate(() => document.querySelector('div').childNodes.length);
      expect(after).toBe(1);
    });

    it('void tag rejects scroll_top setter? — not declared voidReject, write happens (no-op effect)', async () => {
      // Guard that the new ELEMENT_SETTERS shape doesn't accidentally
      // reject scroll_top on void tags. The IDL property is harmless
      // there; we want the runtime to accept and reply self.
      const page = await loadPage(html);
      const dom = await page.connectActor('HTML @br');
      await dom.sendAsync({ id: 'n', op: [{}, '#new'] });
      const inner = dom.posts[0].re.slice(2, -1);
      const inbox = [];
      await page.register('__t_void_scroll', m => inbox.push(m));
      await page.send({
        id: 's', op: [[10], '#set'],
        to: `#<${inner} @scroll_top>`, from: '__t_void_scroll',
      });
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      expect(inbox[0]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
    });
  });

  describe('ClassList + Dataset sub-reps', () => {
    // Mint a div, attach to body, fetch the ClassList sub-rep address.
    // Returns both the parent element actor handle and a connected handle
    // to the ClassList sub-rep, ready for direct CAM messaging.
    async function makeWithClassList(page, payload = {}) {
      const dom = await page.connectActor('HTML @div');
      await dom.sendAsync({ id: 'n', op: [payload, '#new'] });
      const elementAddr = dom.posts[0].re;
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyAddr = docActor.posts[0].re.slice(2, -1);
      const body = await page.connectActor(bodyAddr);
      await body.sendAsync({ id: 'a', op: [elementAddr, '@append!'] });
      const el = await page.connectActor(elementAddr.slice(2, -1));
      await el.sendAsync({ id: 'cl', op: '@class_list' });
      const clAddr = el.posts[el.posts.length - 1].re;
      const cl = await page.connectActor(clAddr.slice(2, -1));
      return { el, elementAddr, cl, clAddr };
    }

    it('class_list() returns a ClassList sub-rep with the expected address shape', async () => {
      const page = await loadPage(html);
      const { clAddr } = await makeWithClassList(page);
      expect(clAddr).toMatch(/^#<HTML @classlist\/\d+>$/);
    });

    it('class_list() identity — repeated calls return the same address', async () => {
      const page = await loadPage(html);
      const { el, clAddr } = await makeWithClassList(page);
      await el.sendAsync({ id: 'cl2', op: '@class_list' });
      const second = el.posts[el.posts.length - 1].re;
      expect(second).toBe(clAddr);
    });

    it('add!/remove!/contains round-trip through the live DOM', async () => {
      const page = await loadPage(html);
      const { cl } = await makeWithClassList(page);
      await cl.sendAsync({ id: 'a', op: [['foo'], '@add!'] });
      expect(cl.posts[cl.posts.length - 1]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
      const cls = await page.evaluate(() => document.querySelector('div').className);
      expect(cls).toBe('foo');
      await cl.sendAsync({ id: 'c', op: [['foo'], '@contains'] });
      expect(cl.posts[cl.posts.length - 1]).toEqual(expect.objectContaining({ re: true }));
      await cl.sendAsync({ id: 'r', op: [['foo'], '@remove!'] });
      const after = await page.evaluate(() => document.querySelector('div').className);
      expect(after).toBe('');
    });

    it('add! accepts a List of Texts to add multiple tokens at once', async () => {
      const page = await loadPage(html);
      const { cl } = await makeWithClassList(page);
      await cl.sendAsync({ id: 'a', op: [[['a', 'b', 'c']], '@add!'] });
      const cls = await page.evaluate(() => document.querySelector('div').classList.value);
      expect(cls).toBe('a b c');
    });

    it('toggle! returns the new presence state (Boolean), not self', async () => {
      const page = await loadPage(html);
      const { cl } = await makeWithClassList(page);
      await cl.sendAsync({ id: 't1', op: [['hi'], '@toggle!'] });
      expect(cl.posts[cl.posts.length - 1]).toEqual(expect.objectContaining({ re: true }));
      await cl.sendAsync({ id: 't2', op: [['hi'], '@toggle!'] });
      expect(cl.posts[cl.posts.length - 1]).toEqual(expect.objectContaining({ re: false }));
    });

    it('toggle!(token, force) pins state regardless of current presence', async () => {
      const page = await loadPage(html);
      const { cl } = await makeWithClassList(page);
      await cl.sendAsync({ id: 't1', op: [['hi', false], '@toggle!'] });
      expect(cl.posts[cl.posts.length - 1]).toEqual(expect.objectContaining({ re: false }));
      await cl.sendAsync({ id: 't2', op: [['hi', true], '@toggle!'] });
      expect(cl.posts[cl.posts.length - 1]).toEqual(expect.objectContaining({ re: true }));
    });

    it('replace! returns true when old token is present, false otherwise', async () => {
      const page = await loadPage(html);
      const { cl } = await makeWithClassList(page);
      await cl.sendAsync({ id: 'a', op: [['x'], '@add!'] });
      await cl.sendAsync({ id: 'r1', op: [['x', 'y'], '@replace!'] });
      expect(cl.posts[cl.posts.length - 1]).toEqual(expect.objectContaining({ re: true }));
      // After replacement, x is gone — second replace returns false.
      await cl.sendAsync({ id: 'r2', op: [['x', 'z'], '@replace!'] });
      expect(cl.posts[cl.posts.length - 1]).toEqual(expect.objectContaining({ re: false }));
    });

    it('length and item read the live DOMTokenList', async () => {
      const page = await loadPage(html);
      const { cl } = await makeWithClassList(page);
      await cl.sendAsync({ id: 'a', op: [[['a', 'b']], '@add!'] });
      await cl.sendAsync({ id: 'l', op: '@length' });
      expect(cl.posts[cl.posts.length - 1]).toEqual(expect.objectContaining({ re: 2 }));
      await cl.sendAsync({ id: 'i', op: [[0], '@item'] });
      expect(cl.posts[cl.posts.length - 1]).toEqual(expect.objectContaining({ re: 'a' }));
      await cl.sendAsync({ id: 'i2', op: [[5], '@item'] });
      expect(cl.posts[cl.posts.length - 1]).toEqual(expect.objectContaining({ re: null }));
    });

    it('value reader and `set value` writer round-trip', async () => {
      const page = await loadPage(html);
      const { cl, clAddr } = await makeWithClassList(page);
      const inner = clAddr.slice(2, -1);
      const inbox = [];
      await page.register('__t_cl_set', m => inbox.push(m));
      await page.send({
        id: 's', op: [['foo bar'], '#set'],
        to: `#<${inner} @value>`, from: '__t_cl_set',
      });
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
      expect(inbox[0]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
      await cl.sendAsync({ id: 'v', op: '@value' });
      expect(cl.posts[cl.posts.length - 1]).toEqual(expect.objectContaining({ re: 'foo bar' }));
    });

    // ── Dataset ───────────────────────────────────────────────────────────
    async function makeWithDataset(page) {
      const { el, elementAddr } = await makeWithClassList(page);
      await el.sendAsync({ id: 'ds', op: '@dataset' });
      const dsAddr = el.posts[el.posts.length - 1].re;
      const ds = await page.connectActor(dsAddr.slice(2, -1));
      return { el, elementAddr, ds, dsAddr };
    }

    it('dataset() returns a Dataset sub-rep; identity preserved across calls', async () => {
      const page = await loadPage(html);
      const { el, dsAddr } = await makeWithDataset(page);
      expect(dsAddr).toMatch(/^#<HTML @dataset\/\d+>$/);
      await el.sendAsync({ id: 'ds2', op: '@dataset' });
      expect(el.posts[el.posts.length - 1].re).toBe(dsAddr);
    });

    it('put!/get/has/remove! mutate and read live data-* attributes', async () => {
      const page = await loadPage(html);
      const { ds } = await makeWithDataset(page);
      await ds.sendAsync({ id: 'p', op: [['fooBar', 'one'], '@put!'] });
      expect(ds.posts[ds.posts.length - 1]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
      // camelCase ↔ kebab-case translation is the DOM proxy's job.
      const attr = await page.evaluate(() => document.querySelector('div').getAttribute('data-foo-bar'));
      expect(attr).toBe('one');
      await ds.sendAsync({ id: 'g', op: [['fooBar'], '@get'] });
      expect(ds.posts[ds.posts.length - 1]).toEqual(expect.objectContaining({ re: 'one' }));
      await ds.sendAsync({ id: 'h', op: [['fooBar'], '@has'] });
      expect(ds.posts[ds.posts.length - 1]).toEqual(expect.objectContaining({ re: true }));
      await ds.sendAsync({ id: 'r', op: [['fooBar'], '@remove!'] });
      const after = await page.evaluate(() => document.querySelector('div').hasAttribute('data-foo-bar'));
      expect(after).toBe(false);
    });

    it('get on an unset key returns null (not undefined)', async () => {
      const page = await loadPage(html);
      const { ds } = await makeWithDataset(page);
      await ds.sendAsync({ id: 'g', op: [['nope'], '@get'] });
      expect(ds.posts[ds.posts.length - 1]).toEqual(expect.objectContaining({ re: null }));
    });

    it('keys/values/entries enumerate every data-* key set on the element', async () => {
      const page = await loadPage(html);
      const { ds } = await makeWithDataset(page);
      await ds.sendAsync({ id: 'p1', op: [['one', '1'], '@put!'] });
      await ds.sendAsync({ id: 'p2', op: [['twoWord', '2'], '@put!'] });
      await ds.sendAsync({ id: 'k', op: '@keys' });
      const keys = ds.posts[ds.posts.length - 1].re;
      expect(keys.sort()).toEqual(['one', 'twoWord']);
      await ds.sendAsync({ id: 'v', op: '@values' });
      const values = ds.posts[ds.posts.length - 1].re;
      expect(values.sort()).toEqual(['1', '2']);
      await ds.sendAsync({ id: 'e', op: '@entries' });
      const entries = ds.posts[ds.posts.length - 1].re;
      // Order isn't guaranteed; check both are present.
      expect(entries).toEqual(expect.arrayContaining([
        { key: 'one', value: '1' },
        { key: 'twoWord', value: '2' },
      ]));
      await ds.sendAsync({ id: 's', op: '@size' });
      expect(ds.posts[ds.posts.length - 1]).toEqual(expect.objectContaining({ re: 2 }));
    });

    // ── Aria sub-rep dedup retrofit ─────────────────────────────────────
    it('aria() identity — repeated calls return the same sub-rep address', async () => {
      const page = await loadPage(html);
      const dom = await page.connectActor('HTML @div');
      await dom.sendAsync({ id: 'n', op: [{ aria: { label: 'X' } }, '#new'] });
      const elementAddr = dom.posts[0].re;
      const el = await page.connectActor(elementAddr.slice(2, -1));
      await el.sendAsync({ id: 'a1', op: '@aria' });
      const first = el.posts[el.posts.length - 1].re;
      await el.sendAsync({ id: 'a2', op: '@aria' });
      const second = el.posts[el.posts.length - 1].re;
      expect(first).toBe(second);
    });
  });

  it('each tag-specific element is independently addressable', async () => {
    const page = await loadPage(html);
    const domDiv = await page.connectActor('HTML @div');
    const domP = await page.connectActor('HTML @p');

    await domDiv.sendAsync({ id: '1', op: [{ children: ['div-one'] }, '#new'] });
    await domP.sendAsync({ id: '2', op: [{ children: ['p-one'] }, '#new'] });
    await domDiv.sendAsync({ id: '3', op: [{ children: ['div-two'] }, '#new'] });

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
    <script type="text/brevity" src="/tester.bv"></script>
    </head><body></body></html>`;

  const testerSource = `*(HTML: (:div))
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
    await dom.sendAsync({ id: 'n', op: [payload, '#new'] });
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
    await dom.sendAsync({ id: 'n', op: [{ hidden: value }, '#new'] });
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
    await dom.sendAsync({ id: 'n', op: [{ class: value }, '#new'] });
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
    await dom.sendAsync({ id: 'n', op: [{ contenteditable: value }, '#new'] });
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
    await dom.sendAsync({ id: 'n', op: [{ popover: value }, '#new'] });
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

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Accessors — read attributes back through Brevity's HTML.Element interface
//
// Each accessor is declared in the manifest body alongside the constructor
// slot it reads. Storage is the proxied DOM element itself — no per-rep
// memoization — so we prove the read by setting the attribute directly via
// page.evaluate (bypassing construction entirely) and asserting the
// accessor's return value comes back from the live DOM.
//
// Read mechanics by declared return type:
//   - Text accessors  → getAttribute(name), pass through unchanged
//   - Boolean attrs   → bare presence ⇒ true (HTML's boolean-attribute form)
//   - Integer attrs   → parseInt → BigInt (normalized to Number across CDP)
//   - Aria sub-rep    → mints an Aria-tagged address backed by the same
//                       element; null when no aria-* surface is present
//
// Aria's own booleans differ — they use "true"/"false" string content, not
// bare presence — so the Aria reader has its own truthiness rule.
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTML.Element accessors — read attribute through Brevity service', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    </head><body></body></html>`;

  // Mint an attribute-free element, append it to <body> so it's locatable
  // via querySelector, optionally pre-set one attribute on the live DOM,
  // and return an actor handle on the element. The set happens with raw
  // setAttribute (not through Brevity construction) so the accessor must
  // read live DOM state to return the right value.
  async function setupElement(page, tag, attrName, attrValue) {
    const dom = await page.connectActor('HTML @' + tag);
    await dom.sendAsync({ id: 'n', op: [{}, '#new'] });
    const elementAddr = dom.posts[0].re.slice(2, -1);

    const docActor = await page.connectActor('document');
    await docActor.sendAsync({ id: 'b', op: '@body' });
    const bodyAddr = docActor.posts[0].re.slice(2, -1);
    const body = await page.connectActor(bodyAddr);
    await body.sendAsync({ id: 'a', op: ['#<' + elementAddr + '>', '@append!'] });

    if (attrName !== undefined) {
      await page.evaluate(({ sel, name, value }) => {
        document.querySelector(sel).setAttribute(name, value);
      }, { sel: tag, name: attrName, value: attrValue });
    }
    return page.connectActor(elementAddr);
  }

  // ── Per-slot accessor reads — every Element accessor exercised once ─────
  describe('Element accessors read live DOM attributes', () => {
    const cases = [
      // Text — raw string round-trip via getAttribute
      ['id',                    'id',                    'header',             'header'],
      ['class',                 'class',                 'header active',      'header active'],
      ['style',                 'style',                 'color: red',         'color: red'],
      ['title',                 'title',                 'tooltip',            'tooltip'],
      ['lang',                  'lang',                  'en-US',              'en-US'],
      ['dir',                   'dir',                   'ltr',                'ltr'],
      ['translate',             'translate',             'yes',                'yes'],
      ['accesskey',             'accesskey',             'k',                  'k'],
      ['contenteditable',       'contenteditable',       'true',               'true'],
      ['autocapitalize',        'autocapitalize',        'sentences',          'sentences'],
      ['autocorrect',           'autocorrect',           'on',                 'on'],
      ['inputmode',             'inputmode',             'text',               'text'],
      ['enterkeyhint',          'enterkeyhint',          'send',               'send'],
      ['is',                    'is',                    'my-button',          'my-button'],
      ['nonce',                 'nonce',                 'abc',                'abc'],
      ['popover',               'popover',               'auto',               'auto'],
      ['slot',                  'slot',                  'main',               'main'],
      ['part',                  'part',                  'highlight',          'highlight'],
      ['exportparts',           'exportparts',           'a,b',                'a,b'],
      ['itemid',                'itemid',                '#x',                 '#x'],
      ['itemprop',              'itemprop',              'name',               'name'],
      ['itemref',               'itemref',               'id1',                'id1'],
      ['itemtype',              'itemtype',              'https://schema.org', 'https://schema.org'],
      ['writingsuggestions',    'writingsuggestions',    'true',               'true'],
      ['virtualkeyboardpolicy', 'virtualkeyboardpolicy', 'auto',               'auto'],
      // Boolean — bare-presence convention; value-string is irrelevant
      ['hidden',                'hidden',                '',                   true],
      ['draggable',             'draggable',             'true',               true],
      ['spellcheck',            'spellcheck',            '',                   true],
      ['inert',                 'inert',                 '',                   true],
      ['autofocus',             'autofocus',             '',                   true],
      ['itemscope',             'itemscope',             '',                   true],
      // Integer — parseInt → BigInt → Number across CDP
      ['tabindex',              'tabindex',              '7',                  7],
    ];

    it.each(cases)('div.%s() reads attribute set directly on the DOM',
      async (accessor, attrName, setValue, expected) => {
        const page = await loadPage(html);
        const el = await setupElement(page, 'div', attrName, setValue);
        await el.sendAsync({ id: 'q', op: '@' + accessor });
        expect(el.posts[0].re).toBe(expected);
      });
  });

  // ── Null-when-unset — every return-type family represented ──────────────
  describe('accessors return null when attribute is unset', () => {
    const cases = [
      ['id'],         // Text
      ['hidden'],     // Boolean
      ['tabindex'],   // Integer
      ['class'],      // Text (union'd slot collapses to Text on read)
    ];

    it.each(cases)('div.%s() returns null when not set', async (accessor) => {
      const page = await loadPage(html);
      const el = await setupElement(page, 'div');
      await el.sendAsync({ id: 'q', op: '@' + accessor });
      expect(el.posts[0].re).toBeNull();
    });
  });

  // ── Aria sub-rep round-trip ─────────────────────────────────────────────
  describe('aria() returns a sub-rep backed by the same element', () => {
    it('div.aria() returns null when no aria-* surface is present', async () => {
      const page = await loadPage(html);
      const el = await setupElement(page, 'div');
      await el.sendAsync({ id: 'q', op: '@aria' });
      expect(el.posts[0].re).toBeNull();
    });

    it('div.aria().label() reads aria-label set on the live DOM', async () => {
      const page = await loadPage(html);
      const el = await setupElement(page, 'div', 'aria-label', 'Close');
      await el.sendAsync({ id: 'q1', op: '@aria' });
      const ariaAddr = el.posts[0].re.slice(2, -1);
      const aria = await page.connectActor(ariaAddr);
      await aria.sendAsync({ id: 'q2', op: '@label' });
      expect(aria.posts[0].re).toBe('Close');
    });

    it('aria().role() reads the bare role attribute (no aria- prefix)', async () => {
      const page = await loadPage(html);
      const el = await setupElement(page, 'div', 'role', 'button');
      await el.sendAsync({ id: 'q1', op: '@aria' });
      const ariaAddr = el.posts[0].re.slice(2, -1);
      const aria = await page.connectActor(ariaAddr);
      await aria.sendAsync({ id: 'q2', op: '@role' });
      expect(aria.posts[0].re).toBe('button');
    });

    it('aria booleans use "true" string, not bare-presence', async () => {
      const page = await loadPage(html);
      const el = await setupElement(page, 'div', 'aria-expanded', 'true');
      await el.sendAsync({ id: 'q1', op: '@aria' });
      const ariaAddr = el.posts[0].re.slice(2, -1);
      const aria = await page.connectActor(ariaAddr);
      await aria.sendAsync({ id: 'q2', op: '@expanded' });
      expect(aria.posts[0].re).toBe(true);
    });

    it('aria booleans return false when the value-string is "false"', async () => {
      const page = await loadPage(html);
      const el = await setupElement(page, 'div', 'aria-expanded', 'false');
      await el.sendAsync({ id: 'q1', op: '@aria' });
      const ariaAddr = el.posts[0].re.slice(2, -1);
      const aria = await page.connectActor(ariaAddr);
      await aria.sendAsync({ id: 'q2', op: '@expanded' });
      expect(aria.posts[0].re).toBe(false);
    });

    it('aria integer accessor reads aria-level as Integer', async () => {
      const page = await loadPage(html);
      const el = await setupElement(page, 'div', 'aria-level', '3');
      await el.sendAsync({ id: 'q1', op: '@aria' });
      const ariaAddr = el.posts[0].re.slice(2, -1);
      const aria = await page.connectActor(ariaAddr);
      await aria.sendAsync({ id: 'q2', op: '@level' });
      expect(aria.posts[0].re).toBe(3);
    });

    it('aria.label() returns null when aria-label is unset', async () => {
      const page = await loadPage(html);
      // Need *some* aria-* attribute or aria() returns null itself.
      const el = await setupElement(page, 'div', 'aria-expanded', 'true');
      await el.sendAsync({ id: 'q1', op: '@aria' });
      const ariaAddr = el.posts[0].re.slice(2, -1);
      const aria = await page.connectActor(ariaAddr);
      await aria.sendAsync({ id: 'q2', op: '@label' });
      expect(aria.posts[0].re).toBeNull();
    });
  });

  // ── Subclass-specific accessors — at least one tag's own slot ────────────
  describe('subclass-specific accessors', () => {
    it('a.href() reads the href attribute', async () => {
      const page = await loadPage(html);
      const el = await setupElement(page, 'a', 'href', 'https://example.com');
      await el.sendAsync({ id: 'q', op: '@href' });
      expect(el.posts[0].re).toBe('https://example.com');
    });

    it('input.checked() reads bare-presence boolean', async () => {
      const page = await loadPage(html);
      const el = await setupElement(page, 'input', 'checked', '');
      await el.sendAsync({ id: 'q', op: '@checked' });
      expect(el.posts[0].re).toBe(true);
    });

    it('li.value() reads Integer-typed attribute', async () => {
      const page = await loadPage(html);
      const el = await setupElement(page, 'li', 'value', '5');
      await el.sendAsync({ id: 'q', op: '@value' });
      expect(el.posts[0].re).toBe(5);
    });

    it('input.value() reads Text-typed attribute (union collapsed on read)', async () => {
      const page = await loadPage(html);
      const el = await setupElement(page, 'input', 'value', '5');
      await el.sendAsync({ id: 'q', op: '@value' });
      expect(el.posts[0].re).toBe('5');
    });
  });

  // ── Content reads — inner_html / text_content per classification ────────
  describe('content accessors split across the void / text / parent classes', () => {
    // Small helper specialised to nested children (ParentElement only).
    async function setupParentDivWithText(page, text) {
      const dom = await page.connectActor('HTML @div');
      await dom.sendAsync({ id: 'n', op: [{ children: [text] }, '#new'] });
      const elementAddr = dom.posts[0].re.slice(2, -1);
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyAddr = docActor.posts[0].re.slice(2, -1);
      const body = await page.connectActor(bodyAddr);
      await body.sendAsync({ id: 'a', op: ['#<' + elementAddr + '>', '@append!'] });
      return page.connectActor(elementAddr);
    }

    it('div.text_content() reads textContent for ParentElement', async () => {
      const page = await loadPage(html);
      const el = await setupParentDivWithText(page, 'Hello, world');
      await el.sendAsync({ id: 'q', op: '@text_content' });
      expect(el.posts[0].re).toBe('Hello, world');
    });

    it('div.inner_html() reads innerHTML for ParentElement', async () => {
      const page = await loadPage(html);
      const el = await setupParentDivWithText(page, 'Hi');
      await el.sendAsync({ id: 'q', op: '@inner_html' });
      expect(el.posts[0].re).toBe('Hi');
    });

    it('textarea.text_content() reads textContent for TextElement', async () => {
      const page = await loadPage(html);
      const dom = await page.connectActor('HTML @textarea');
      await dom.sendAsync({ id: 'n', op: [{ children: ['default text'] }, '#new'] });
      const elementAddr = dom.posts[0].re.slice(2, -1);
      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyAddr = docActor.posts[0].re.slice(2, -1);
      const body = await page.connectActor(bodyAddr);
      await body.sendAsync({ id: 'a', op: ['#<' + elementAddr + '>', '@append!'] });
      const el = await page.connectActor(elementAddr);
      await el.sendAsync({ id: 'q', op: '@text_content' });
      expect(el.posts[0].re).toBe('default text');
    });

    // Runtime defense-in-depth: void tags' accessor lookup pyramid has no
    // entry for inner_html, so the dispatch returns nothing — no reply is
    // routed. Compile-time should already prevent the call; this just
    // proves the runtime classification gate is in place.
    it('br.inner_html() drops on the floor — void tag has no content accessor', async () => {
      const page = await loadPage(html);
      const dom = await page.connectActor('HTML @br');
      await dom.sendAsync({ id: 'n', op: [{}, '#new'] });
      const el = await page.connectActor('HTML @br/1');
      await el.sendAsync({ id: 'q', op: '@inner_html' });
      expect(el.posts).toEqual([]);
    });
  });

  // ── Tree mutators — DOM-side effects, self reply ────────────────────────
  describe('tree mutators wrap DOM mutation methods, returning self', () => {
    // Mint two parented divs and append the second to body so the first
    // is initially detached. Many mutator tests start from this shape:
    // a target attached to body and a candidate child to thread in.
    async function setupParentAndChild(page) {
      const dom = await page.connectActor('HTML @div');
      await dom.sendAsync({ id: 'p', op: [{}, '#new'] });
      const parentAddr = dom.posts[0].re.slice(2, -1);
      await dom.sendAsync({ id: 'c', op: [{}, '#new'] });
      const childAddrWrapped = dom.posts[1].re;

      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyAddr = docActor.posts[0].re.slice(2, -1);
      const body = await page.connectActor(bodyAddr);
      await body.sendAsync({ id: 'a', op: ['#<' + parentAddr + '>', '@append!'] });

      const parent = await page.connectActor(parentAddr);
      return { parent, parentAddr, childAddrWrapped };
    }

    it('append_child! attaches the child to the parent', async () => {
      const page = await loadPage(html);
      const { parent, childAddrWrapped } = await setupParentAndChild(page);
      await parent.sendAsync({ id: 'm', op: [{ child: childAddrWrapped }, '@append_child!'] });
      expect(parent.posts[0]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
      const childCount = await page.evaluate(() => document.querySelector('div').childElementCount);
      expect(childCount).toBe(1);
    });

    it('append! takes a List positional and lands every child in order', async () => {
      const page = await loadPage(html);
      const { parent } = await setupParentAndChild(page);
      const dom = await page.connectActor('HTML @span');
      await dom.sendAsync({ id: 's1', op: [{}, '#new'] });
      await dom.sendAsync({ id: 's2', op: [{}, '#new'] });
      const spanA = dom.posts[0].re;
      const spanB = dom.posts[1].re;
      await parent.sendAsync({
        id: 'm', op: [[[spanA, ' between ', spanB]], '@append!'],
      });
      const tagSequence = await page.evaluate(() => {
        const el = document.querySelector('div');
        return [...el.childNodes].map(n => n.nodeType === 1 ? n.tagName.toLowerCase() : `#${n.nodeValue}`);
      });
      expect(tagSequence).toEqual(['span', '# between ', 'span']);
    });

    it('replace_child! swaps an existing child for a new one (named args)', async () => {
      const page = await loadPage(html);
      const { parent } = await setupParentAndChild(page);
      const dom = await page.connectActor('HTML @span');
      await dom.sendAsync({ id: 'a', op: [{}, '#new'] });
      await dom.sendAsync({ id: 'b', op: [{}, '#new'] });
      const oldEl = dom.posts[0].re;
      const newEl = dom.posts[1].re;
      await parent.sendAsync({ id: 'attach', op: [{ child: oldEl }, '@append_child!'] });
      await parent.sendAsync({
        id: 'swap', op: [{ new_child: newEl, old_child: oldEl }, '@replace_child!'],
      });
      const child = await page.evaluate(() => document.querySelector('div').firstElementChild?.tagName);
      expect(child).toBe('SPAN');
    });

    it('replace_child! also accepts positional args (DOM order: new, old)', async () => {
      const page = await loadPage(html);
      const { parent } = await setupParentAndChild(page);
      const dom = await page.connectActor('HTML @span');
      await dom.sendAsync({ id: 'a', op: [{}, '#new'] });
      await dom.sendAsync({ id: 'b', op: [{}, '#new'] });
      const oldEl = dom.posts[0].re;
      const newEl = dom.posts[1].re;
      await parent.sendAsync({ id: 'attach', op: [{ child: oldEl }, '@append_child!'] });
      await parent.sendAsync({ id: 'swap', op: [[newEl, oldEl], '@replace_child!'] });
      const child = await page.evaluate(() => document.querySelector('div').firstElementChild?.tagName);
      expect(child).toBe('SPAN');
    });

    it('remove! detaches self from the document', async () => {
      const page = await loadPage(html);
      const { parent } = await setupParentAndChild(page);
      await parent.sendAsync({ id: 'r', op: '@remove!' });
      expect(parent.posts[0]).toEqual(expect.objectContaining({ re: {}, 'bv-a': 'self' }));
      const stillThere = await page.evaluate(() => document.body.querySelector('div'));
      expect(stillThere).toBeNull();
    });

    it('replace_with! swaps self for a sibling list', async () => {
      const page = await loadPage(html);
      const { parent } = await setupParentAndChild(page);
      const dom = await page.connectActor('HTML @span');
      await dom.sendAsync({ id: 's', op: [{}, '#new'] });
      const spanAddr = dom.posts[0].re;
      await parent.sendAsync({ id: 'rw', op: [[[spanAddr, ' tail']], '@replace_with!'] });
      const summary = await page.evaluate(() => ({
        firstTag: document.body.firstChild?.tagName,
        nextText: document.body.firstChild?.nextSibling?.nodeValue,
        divsLeft: document.body.querySelectorAll('div').length,
      }));
      expect(summary).toEqual({ firstTag: 'SPAN', nextText: ' tail', divsLeft: 0 });
    });

    it('replace_children! wipes existing children and installs new ones', async () => {
      const page = await loadPage(html);
      const { parent } = await setupParentAndChild(page);
      // Pre-populate with two children.
      await parent.sendAsync({ id: 'pre', op: [[['old1', 'old2']], '@append!'] });
      await parent.sendAsync({ id: 'wipe', op: [[['new']], '@replace_children!'] });
      const text = await page.evaluate(() => document.querySelector('div').textContent);
      expect(text).toBe('new');
    });

    it('insert_adjacent_html! at "afterbegin" parses HTML into the parent (Parent-class only)', async () => {
      const page = await loadPage(html);
      const { parent } = await setupParentAndChild(page);
      await parent.sendAsync({
        id: 'h', op: [{ position: 'afterbegin', html: '<span>x</span>' }, '@insert_adjacent_html!'],
      });
      const tag = await page.evaluate(() => document.querySelector('div').firstElementChild?.tagName);
      expect(tag).toBe('SPAN');
    });

    it('insert_adjacent_html! at "beforebegin" works on void elements (sibling position)', async () => {
      const page = await loadPage(html);
      const dom = await page.connectActor('HTML @br');
      await dom.sendAsync({ id: 'n', op: [{}, '#new'] });
      const brAddr = dom.posts[0].re.slice(2, -1);

      const docActor = await page.connectActor('document');
      await docActor.sendAsync({ id: 'b', op: '@body' });
      const bodyAddr = docActor.posts[0].re.slice(2, -1);
      const body = await page.connectActor(bodyAddr);
      await body.sendAsync({ id: 'a', op: ['#<' + brAddr + '>', '@append!'] });

      const br = await page.connectActor(brAddr);
      await br.sendAsync({
        id: 'h', op: [{ position: 'beforebegin', html: '<span>before-br</span>' }, '@insert_adjacent_html!'],
      });
      const summary = await page.evaluate(() => ({
        first: document.body.firstChild?.tagName,
        firstText: document.body.firstChild?.textContent,
      }));
      expect(summary).toEqual({ first: 'SPAN', firstText: 'before-br' });
    });

    it('insert_adjacent_html! at "afterbegin" silently rejected on void elements', async () => {
      const page = await loadPage(html);
      const dom = await page.connectActor('HTML @br');
      await dom.sendAsync({ id: 'n', op: [{}, '#new'] });
      const br = await page.connectActor('HTML @br/1');
      await br.sendAsync({
        id: 'h', op: [{ position: 'afterbegin', html: '<span/>' }, '@insert_adjacent_html!'],
      });
      // No reply: position is invalid for the tag classification.
      expect(br.posts).toEqual([]);
    });
  });
});
