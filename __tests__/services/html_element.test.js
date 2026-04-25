import { compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HTML.Element / HTML.Aria / HTML.div — manifest-hosted subtype discipline
//
// These are compile-time tests: compileSource runs through the validator on
// every target, so the discipline applied here doesn't depend on the runtime
// implementation of the typed constructors.
//
// HTML hosts an abstract `Element` parent (every non-event-handler global
// attribute, plus content fields `inner_html` and `children`) and an `Aria`
// bucket (the ARIA states/properties grouped as one cohesive sub-type so
// Element's surface stays manageable). Concrete tags use lowercase names
// matching the HTML tag exactly — `div`, `p`, `span`, etc. — and subtype
// Element with empty own params for tags that add no tag-specific
// attributes.
//
// The manifest used here is a TRIMMED version of the real one in
// src/codegen/browser/runtime.js. Each typed family (Boolean / Integer /
// Decimal / Text / Aria / Structure / List of Texts) is represented;
// covering the full 70-attribute surface adds nothing — the validator's
// discipline is the same for one Boolean param as for ten.
// ═══════════════════════════════════════════════════════════════════════════════

const HTML_MANIFEST = `{
  Element: <
    :id Text | null,
    :class Text | null,
    :hidden Boolean | null,
    :tabindex Integer | null,
    :data Structure | null,
    :aria Aria | null,
    :inner_html Text | null,
    :children List of Texts | null
  >

  Aria: <
    :label Text | null,
    :level Integer | null,
    :hidden Boolean | null,
    :valuenow Decimal | null
  >

  div: <Element |>
}`;

const compileWithHTML = (src) =>
  compileSource(src, { remotes: [{ path: 'HTML', service: HTML_MANIFEST }] });

// ── Happy path ───────────────────────────────────────────────────────────────

describe('HTML element manifest — happy path', () => {
  it('div() with no args (all params nullable)', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d div = HTML.div() . }
    `)).not.toThrow();
  });

  it('div(:id Text) — inherited Text attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d div = HTML.div(id: "header") . }
    `)).not.toThrow();
  });

  it('div(:hidden Boolean) — inherited Boolean attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d div = HTML.div(hidden: true) . }
    `)).not.toThrow();
  });

  it('div(:tabindex Integer) — inherited Integer attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d div = HTML.div(tabindex: 0) . }
    `)).not.toThrow();
  });

  it('div(:aria Aria) — bucketed nested constructor', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div, :Aria)>
      @test = {
        a Aria = HTML.Aria(label: "Close")
        d div = HTML.div(aria: a)
        .
      }
    `)).not.toThrow();
  });

  it('div with multiple inherited attrs at once', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d div = HTML.div(id: "x", hidden: true, tabindex: 1) . }
    `)).not.toThrow();
  });

  it('div(:inner_html Text) — content field', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d div = HTML.div(inner_html: "Hello") . }
    `)).not.toThrow();
  });

  it('Aria(:level Integer) — own attr on bucketed type', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Aria)>
      @test = { a Aria = HTML.Aria(level: 2) . }
    `)).not.toThrow();
  });

  it('Aria(:valuenow Decimal) — Decimal attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Aria)>
      @test = { a Aria = HTML.Aria(valuenow: 0.5) . }
    `)).not.toThrow();
  });
});

// ── Sad path: type mismatch on inherited attrs ───────────────────────────────

describe('HTML element manifest — type mismatches (sad path)', () => {
  it('div(:hidden Text) is rejected — expects Boolean', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d div = HTML.div(hidden: "true") . }
    `)).toThrow(/named arg 'hidden'.*(Boolean.*Text|Text.*Boolean)/);
  });

  it('div(:tabindex Text) is rejected — expects Integer', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d div = HTML.div(tabindex: "1") . }
    `)).toThrow(/named arg 'tabindex'.*(Integer.*Text|Text.*Integer)/);
  });

  it('Aria(:level Text) is rejected — expects Integer', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Aria)>
      @test = { a Aria = HTML.Aria(level: "high") . }
    `)).toThrow(/named arg 'level'.*(Integer.*Text|Text.*Integer)/);
  });

  it('div(:aria Text) is rejected — expects Aria', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d div = HTML.div(aria: "Close") . }
    `)).toThrow(/named arg 'aria'.*(Aria.*Text|Text.*Aria)/);
  });

  it('div(:inner_html Integer) is rejected — expects Text', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d div = HTML.div(inner_html: 42) . }
    `)).toThrow(/named arg 'inner_html'.*(Text.*Integer|Integer.*Text)/);
  });
});

// ── Sad path: unknown attribute ──────────────────────────────────────────────

describe('HTML element manifest — unknown attrs (sad path)', () => {
  it("div(:nope ...) is rejected — :nope is not on Element", () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d div = HTML.div(nope: "x") . }
    `)).toThrow(/unexpected: nope/);
  });

  it('div(:label ...) is rejected — :label belongs on Aria, not Element', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d div = HTML.div(label: "Close") . }
    `)).toThrow(/unexpected: label/);
  });
});

// ── Sad path: unknown type at the call site ──────────────────────────────────

describe('HTML element manifest — unknown call target (sad path)', () => {
  it("HTML.Span() is rejected — Span isn't declared", () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d div = HTML.Span() . }
    `)).toThrow(/has no function 'Span'/);
  });
});
