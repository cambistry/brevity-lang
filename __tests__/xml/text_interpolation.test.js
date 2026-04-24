import { extract, compile } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// XML text interpolation — `#{expr}` inside element bodies (language level)
//
// In the text body of an XML element, `#{expr}` is pure string interpolation:
// the expression evaluates once when the parent element is constructed and
// is spliced inline as a text run (no closure synthesis, no reactivity).
//
// Contrast with `{expr}` (reactive closure) which the browser synthesis pass
// lifts into a `@N` handler; `#{}` passes through as a plain `strinterp`
// child and any backend that implements XML element emission stringifies
// the expression inline.
//
// Escapes in raw XML text are narrow:
//   \\   → literal backslash
//   \{   → literal `{` (would otherwise open a closure)
//   \#{  → literal `#{` (would otherwise open an interpolation)
//   anything else after a backslash → compile error
//
// These rules live in the lexer (src/lexer.js parseDomChildren), so they
// apply on every backend. This file runs under the target-agnostic project
// set — it exercises lex + parse + validate (via compile's early stages)
// and checks AST shape; it does not run the emitted code.
// ═══════════════════════════════════════════════════════════════════════════════

const DOM_MANIFEST = `{
  div: (:inner_html Text) -> (HTMLElement)
  p: (:inner_html Text) -> (HTMLElement)
}`;

function parse(source) {
  return extract(source).ast;
}

function compileWithDOM(source) {
  const { ast } = extract(source);
  return compile(ast, { remotes: [{ path: 'DOM', service: DOM_MANIFEST }] });
}

function findDomConstructor(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const f = findDomConstructor(n); if (f) return f; }
    return null;
  }
  if (node.type === 'DomConstructor') return node;
  for (const k of Object.keys(node)) {
    if (k === 'type') continue;
    const f = findDomConstructor(node[k]);
    if (f) return f;
  }
  return null;
}

describe('XML text interpolation — lex + parse + AST shape', () => {
  // ── AST shape: `#{expr}` becomes a strinterp child node ────────────────

  describe('AST produces a `strinterp` child for `#{expr}`', () => {
    it('bare `#{name}` yields a strinterp child with the expression', () => {
      const ast = parse(`
        name Text! = "x"
        e = <div>#{ name }</div>
      `);
      const dom = findDomConstructor(ast);
      expect(dom).not.toBeNull();
      expect(dom.tag).toBe('div');
      expect(dom.children).toHaveLength(1);
      expect(dom.children[0].type).toBe('strinterp');
      expect(dom.children[0].expr).toBeDefined();
    });

    it('`{expr}` remains a separate `interp` child — not collapsed', () => {
      const ast = parse(`
        name Text! = "x"
        e = <div>{ name }</div>
      `);
      const dom = findDomConstructor(ast);
      expect(dom.children[0].type).toBe('interp');
    });

    it('mixed static + #{} + {} yields a heterogeneous children array', () => {
      const ast = parse(`
        a Text! = "a"
        b Text! = "b"
        e = <div>pre #{ a } mid { b } end</div>
      `);
      const dom = findDomConstructor(ast);
      expect(dom.children.map(c => c.type)).toEqual([
        'text', 'strinterp', 'text', 'interp', 'text',
      ]);
      expect(dom.children[0].value).toBe('pre ');
      expect(dom.children[2].value).toBe(' mid ');
      expect(dom.children[4].value).toBe(' end');
    });

    it('two adjacent `#{}` produce two consecutive strinterp children', () => {
      const ast = parse(`
        a Text! = "x"
        b Text! = "y"
        e = <div>#{ a }#{ b }</div>
      `);
      const dom = findDomConstructor(ast);
      expect(dom.children.map(c => c.type)).toEqual(['strinterp', 'strinterp']);
    });

    it('`#{}` inside a nested element attaches to that element\'s children', () => {
      const ast = parse(`
        n Text! = "Chris"
        e = <div><p>hi #{ n }</p></div>
      `);
      const outer = findDomConstructor(ast);
      expect(outer.tag).toBe('div');
      const inner = outer.children.find(c => c.type === 'DomConstructor');
      expect(inner.tag).toBe('p');
      expect(inner.children.map(c => c.type)).toEqual(['text', 'strinterp']);
    });
  });

  // ── Escape decoding — text child values are the decoded literal ─────────

  describe('escapes produce the expected literal character in text children', () => {
    it('`\\\\` decodes to a single backslash', () => {
      const ast = parse(`
        e = <div>a \\\\ b</div>
      `);
      const dom = findDomConstructor(ast);
      expect(dom.children).toHaveLength(1);
      expect(dom.children[0]).toEqual({ type: 'text', value: 'a \\ b' });
    });

    it('`\\{` decodes to a literal `{` (not a closure)', () => {
      const ast = parse(`
        e = <div>\\{ not a closure }</div>
      `);
      const dom = findDomConstructor(ast);
      expect(dom.children).toEqual([{ type: 'text', value: '{ not a closure }' }]);
    });

    it('`\\#{` decodes to a literal `#{` (not an interpolation)', () => {
      const ast = parse(`
        e = <div>\\#{ not interp }</div>
      `);
      const dom = findDomConstructor(ast);
      expect(dom.children).toEqual([{ type: 'text', value: '#{ not interp }' }]);
    });

    it('bare `#` without a following `{` stays literal (no escape needed)', () => {
      const ast = parse(`
        e = <div>price: #5</div>
      `);
      const dom = findDomConstructor(ast);
      expect(dom.children).toEqual([{ type: 'text', value: 'price: #5' }]);
    });

    it('escapes coexist with live `#{}` on the same run', () => {
      const ast = parse(`
        x Text! = "ok"
        e = <div>\\\\ \\{ \\#{ #{ x }</div>
      `);
      const dom = findDomConstructor(ast);
      expect(dom.children[0]).toEqual({ type: 'text', value: '\\ { #{ ' });
      expect(dom.children[1].type).toBe('strinterp');
    });
  });

  // ── Invalid escapes are a compile error ─────────────────────────────────

  describe('invalid escapes are rejected at lex time', () => {
    const mustFail = (body) => {
      expect(() => extract(`
        e = <div>${body}</div>
      `)).toThrow(/Invalid escape/);
    };

    it('`\\n` is rejected', () => mustFail('a\\nb'));
    it('`\\t` is rejected', () => mustFail('a\\tb'));
    it('`\\"` is rejected', () => mustFail('a\\"b'));
    it('`\\\'` is rejected', () => mustFail("a\\'b"));
    it('`\\r` is rejected', () => mustFail('a\\rb'));
    it('`\\#` without `{` is rejected', () => mustFail('a\\#b'));
    it('`\\u{...}` is rejected (not a recognised escape in XML text)', () => {
      expect(() => extract(`e = <div>a\\u{1F600}b</div>`)).toThrow(/Invalid escape/);
    });
    it('trailing lone `\\` is rejected', () => mustFail('a\\'));
  });

  // ── End-to-end compile: valid shapes compile with DOM manifest ──────────

  describe('compile with DOM manifest — valid interpolations succeed', () => {
    it('bare `#{expr}` compiles', () => {
      expect(() => compileWithDOM(`
        <DOM: (:div)>
        name Text! = "x"
        @create = -> <div>#{ name }</div>
      `)).not.toThrow();
    });

    it('mixed static text, `#{}` and `{}` compiles', () => {
      expect(() => compileWithDOM(`
        <DOM: (:div)>
        a Text! = "a"
        b Text! = "b"
        @create = -> <div>pre #{ a } mid { b } end</div>
      `)).not.toThrow();
    });

    it('valid escapes compile', () => {
      expect(() => compileWithDOM(`
        <DOM: (:div)>
        @create = -> <div>\\\\ \\{ \\#{ literal</div>
      `)).not.toThrow();
    });

    it('invalid escape throws before reaching codegen', () => {
      expect(() => compileWithDOM(`
        <DOM: (:div)>
        @create = -> <div>oops \\q here</div>
      `)).toThrow(/Invalid escape/);
    });
  });
});
