import { compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HTML.Element / HTML.Aria / HTML.div — manifest-hosted subtype discipline
//
// `<HTML: (:div, :Aria)>` destructures `div` and `Aria` into local scope and
// consumes the `HTML` name. The canonical call form is therefore bare:
//
//     <HTML: (:div)>
//     @test = { d = div() . }
//
// — not `HTML.div()`. These compile-time tests run through the validator on
// every target, so the discipline applied here doesn't depend on the runtime
// implementation of the typed constructors.
//
// HTML hosts an abstract `Element` parent (every non-event-handler global
// attribute, plus content fields `inner_html` and `children`) and an `Aria`
// bucket (the ARIA states/properties grouped as one cohesive sub-type so
// Element's surface stays manageable). Concrete tags use lowercase names
// matching the HTML tag exactly.
//
// Nullable params (`Type | null`) on manifest types auto-default to null so
// callers don't have to thread `null` through every unused attribute. Local
// actor types keep the strict default — `Type | null` there allows null but
// doesn't make the param optional.
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
      @test = { d = div() . }
    `)).not.toThrow();
  });

  it('div(:id Text) — inherited Text attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d = div(id: "header") . }
    `)).not.toThrow();
  });

  it('div(:hidden Boolean) — inherited Boolean attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d = div(hidden: true) . }
    `)).not.toThrow();
  });

  it('div(:tabindex Integer) — inherited Integer attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d = div(tabindex: 0) . }
    `)).not.toThrow();
  });

  it('div(:aria Aria) — bucketed nested constructor', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div, :Aria)>
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
      @test = { d = div(id: "x", hidden: true, tabindex: 1) . }
    `)).not.toThrow();
  });

  it('div(:inner_html Text) — content field', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d = div(inner_html: "Hello") . }
    `)).not.toThrow();
  });

  it('Aria(:level Integer) — own attr on bucketed type', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Aria)>
      @test = { a = Aria(level: 2) . }
    `)).not.toThrow();
  });

  it('Aria(:valuenow Decimal) — Decimal attr', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Aria)>
      @test = { a = Aria(valuenow: 0.5) . }
    `)).not.toThrow();
  });
});

// ── Sad path: type mismatch on inherited attrs ───────────────────────────────

describe('HTML element manifest — type mismatches (sad path)', () => {
  it('div(:hidden Text) is rejected — expects Boolean', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d = div(hidden: "true") . }
    `)).toThrow(/named arg 'hidden'.*'Text' is not assignable to 'Boolean \| null'/);
  });

  it('div(:tabindex Text) is rejected — expects Integer', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d = div(tabindex: "1") . }
    `)).toThrow(/named arg 'tabindex'.*'Text' is not assignable to 'Integer \| null'/);
  });

  it('Aria(:level Text) is rejected — expects Integer', () => {
    expect(() => compileWithHTML(`
      <HTML: (:Aria)>
      @test = { a = Aria(level: "high") . }
    `)).toThrow(/named arg 'level'.*'Text' is not assignable to 'Integer \| null'/);
  });

  it('div(:aria Text) is rejected — expects Aria', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d = div(aria: "Close") . }
    `)).toThrow(/named arg 'aria'.*'Text' is not assignable to 'Aria \| null'/);
  });

  it('div(:inner_html Integer) is rejected — expects Text', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d = div(inner_html: 42) . }
    `)).toThrow(/named arg 'inner_html'.*'Integer' is not assignable to 'Text \| null'/);
  });
});

// ── Sad path: unknown attribute ──────────────────────────────────────────────

describe('HTML element manifest — unknown attrs (sad path)', () => {
  it("div(:nope ...) is rejected — :nope is not on Element", () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d = div(nope: "x") . }
    `)).toThrow(/Got named: nope/);
  });

  it('div(:label ...) is rejected — :label belongs on Aria, not Element', () => {
    expect(() => compileWithHTML(`
      <HTML: (:div)>
      @test = { d = div(label: "Close") . }
    `)).toThrow(/Got named: label/);
  });
});
