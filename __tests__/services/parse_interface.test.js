import { parseInterface } from '../../src/codegen/javascript/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// parseInterface — type-form declarations
//
// `parseInterface` previously parsed only flat op signatures (`name: (params)
// -> (returns)`). It now also accepts type declarations of shape
// `Name: <[Sup |] params> [-> { method-body }]`. Type entries land under
// `result.__types[Name]` so existing op-keyed lookups don't collide with
// type names.
//
// These are direct unit tests on the parser output — independent of the
// validator's interpretation of the parsed shape.
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseInterface — op form (backward compat)', () => {
  it('single-line op signature parses unchanged', () => {
    const r = parseInterface(`{
      div: (:inner_html Text) -> (HTMLElement)
    }`);
    expect(r.div).toEqual([{
      params: [{ name: 'inner_html', type: 'Text', positional: false }],
      returns: [{ name: null, type: 'HTMLElement', positional: true }],
    }]);
    expect(r.__types).toBeUndefined();
  });

  it('silent op (returns `.`) parses with returns=null', () => {
    const r = parseInterface(`{
      ping: () -> .
    }`);
    expect(r.ping).toEqual([{ params: [], returns: null }]);
  });
});

describe('parseInterface — type form', () => {
  it('empty type body — `<>` only', () => {
    const r = parseInterface(`{
      Empty: <>
    }`);
    expect(r.__types.Empty).toEqual({
      supertypes: [],
      initParams: [],
      functions: [],
    });
  });

  it('single-line type with one nullable named param', () => {
    const r = parseInterface(`{
      T: <:x Text | null>
    }`);
    expect(r.__types.T.initParams).toEqual([
      { name: 'x', type: 'Text | null', positional: false },
    ]);
  });

  it('multi-line type with multiple named params', () => {
    const r = parseInterface(`{
      Element: <
        :id Text | null,
        :hidden Boolean | null,
        :tabindex Integer | null
      >
    }`);
    expect(r.__types.Element.initParams).toEqual([
      { name: 'id', type: 'Text | null', positional: false },
      { name: 'hidden', type: 'Boolean | null', positional: false },
      { name: 'tabindex', type: 'Integer | null', positional: false },
    ]);
  });

  it('subtype with empty own params', () => {
    const r = parseInterface(`{
      Element: <:id Text | null>
      Div: <Element |>
    }`);
    expect(r.__types.Div).toEqual({
      supertypes: [{ supertype: 'Element' }],
      initParams: [],
      functions: [],
    });
  });

  it('subtype with own params after the pipe', () => {
    const r = parseInterface(`{
      Element: <:id Text | null>
      Span: <Element | :inner Text | null>
    }`);
    expect(r.__types.Span.supertypes).toEqual([{ supertype: 'Element' }]);
    expect(r.__types.Span.initParams).toEqual([
      { name: 'inner', type: 'Text | null', positional: false },
    ]);
  });

  it('multi-parent supertype list', () => {
    const r = parseInterface(`{
      A: <:a Integer>
      B: <:b Integer>
      C: <A, B | :c Integer>
    }`);
    expect(r.__types.C.supertypes).toEqual([
      { supertype: 'A' },
      { supertype: 'B' },
    ]);
    expect(r.__types.C.initParams).toEqual([
      { name: 'c', type: 'Integer', positional: false },
    ]);
  });

  it('wrapped-as marker on a supertype', () => {
    const r = parseInterface(`{
      T: <>
      U: <T *sup |>
    }`);
    expect(r.__types.U.supertypes).toEqual([
      { supertype: 'T', wrappedAs: 'sup' },
    ]);
  });

  it('type with method body', () => {
    const r = parseInterface(`{
      Greeter: <> -> {
        hello: () -> (:greeting Text)
      }
    }`);
    expect(r.__types.Greeter.functions).toEqual([
      {
        name: 'hello',
        params: [],
        returns: [{ name: 'greeting', type: 'Text', positional: false }],
      },
    ]);
  });

  it('nullable union pipe inside a param does not split as supertype divider', () => {
    // `<:x Text | null>` — the `|` is part of the type, not a supertype divider.
    const r = parseInterface(`{
      T: <:x Text | null>
    }`);
    expect(r.__types.T.supertypes).toEqual([]);
    expect(r.__types.T.initParams[0].type).toBe('Text | null');
  });
});

describe('parseInterface — mixed op + type entries', () => {
  it('type entries go to __types; op entries stay top-level', () => {
    const r = parseInterface(`{
      Element: <:id Text | null>
      div: (:inner_html Text) -> (HTMLElement)
    }`);
    expect(r.__types.Element).toBeDefined();
    expect(r.div).toBeDefined();
    expect(r.Element).toBeUndefined();
    expect(r.__types.div).toBeUndefined();
  });
});
