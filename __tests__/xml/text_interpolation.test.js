import { extract, compile } from '../../index.js';
import { domManifest as HTML_MANIFEST } from '../../src/codegen/browser/runtime.js';

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

function parse(source) {
  return extract(source).ast;
}

function compileWithHTML(source) {
  const { ast } = extract(source);
  return compile(ast, { remotes: [{ path: 'HTML', service: HTML_MANIFEST }] });
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

function findDomConstructorByTag(node, tag) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const f = findDomConstructorByTag(n, tag); if (f) return f; }
    return null;
  }
  if (node.type === 'DomConstructor' && node.tag === tag) return node;
  for (const k of Object.keys(node)) {
    if (k === 'type') continue;
    const f = findDomConstructorByTag(node[k], tag);
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

    it('`{expr}` remains a separate child — not collapsed (reactive → closure_ref)', () => {
      const ast = parse(`
        name Text! = "x"
        e = <div>{ name }</div>
      `);
      const dom = findDomConstructor(ast);
      expect(dom.children[0].type).toBe('closure_ref');
    });

    it('mixed static + #{} + {} yields a heterogeneous children array', () => {
      const ast = parse(`
        a Text! = "a"
        b Text! = "b"
        e = <div>pre #{ a } mid { b } end</div>
      `);
      const dom = findDomConstructor(ast);
      expect(dom.children.map(c => c.type)).toEqual([
        'text', 'strinterp', 'text', 'closure_ref', 'text',
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

  // ── End-to-end compile: valid shapes compile with HTML manifest ──────────

  describe('compile with HTML manifest — valid interpolations succeed', () => {
    it('bare `#{expr}` compiles', () => {
      expect(() => compileWithHTML(`
        *(HTML: (:div))
        =
        name Text! = "x"
        @create = -> <div>#{ name }</div>
      `)).not.toThrow();
    });

    it('mixed static text, `#{}` and `{}` compiles', () => {
      expect(() => compileWithHTML(`
        *(HTML: (:div))
        =
        a Text! = "a"
        b Text! = "b"
        @create = -> <div>pre #{ a } mid { b } end</div>
      `)).not.toThrow();
    });

    it('valid escapes compile', () => {
      expect(() => compileWithHTML(`
        *(HTML: (:div))
        =
        @create = -> <div>\\\\ \\{ \\#{ literal</div>
      `)).not.toThrow();
    });

    it('invalid escape throws before reaching codegen', () => {
      expect(() => compileWithHTML(`
        *(HTML: (:div))
        =
        @create = -> <div>oops \\q here</div>
      `)).toThrow(/Invalid escape/);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Non-reactive `{expr}` collapse — post-extract AST shape
//
// After extract(), `{ expr }` interpolations whose expression tree contains no
// RefRead nodes (i.e. no * ref accesses) are collapsed to `strinterp` children
// rather than synthesized as `@N` closures. Reactive interpolations (those that
// read at least one * ref) continue to produce `closure_ref` children.
//
// A special case: when the non-reactive expr is an Identifier bound to a
// zero-arg pure thunk whose body is a DomConstructor, the interp is replaced
// by the DomConstructor itself (inline pre-dispatch rather than text splice).
// ═══════════════════════════════════════════════════════════════════════════════

function extractAst(source) {
  return extract(source).ast;
}

describe('non-reactive { expr } collapse — post-extract AST', () => {
  // synthesizeTemplateClosures runs during extract() and walks actor.functions,
  // constructorBody, and initBody — so both handler-body templates and
  // file-level element assignments are subject to the interp → closure_ref /
  // strinterp / inline-DOM rewrite.

  describe('non-reactive binding becomes strinterp', () => {
    it('`{ name }` where name is a non-reactive Text binding becomes strinterp', () => {
      const ast = extractAst(`
        name Text = "Chris"
        @create = -> <div>{ name }</div>
      `);
      const dom = findDomConstructor(ast);
      expect(dom.children).toHaveLength(1);
      expect(dom.children[0].type).toBe('strinterp');
    });

    it('`{ count }` where count is a non-reactive Integer stays closure_ref — not Text, type conflict for validation', () => {
      const ast = extractAst(`
        count Integer = 42
        @create = -> <div>{ count }</div>
      `);
      const dom = findDomConstructor(ast);
      // Integer is not a valid HTML text child. The synthesis preserves closure_ref
      // rather than silently stringifying; the validation pass will flag the type.
      expect(dom.children[0].type).toBe('closure_ref');
    });

    it('`{ name }` where name is a reactive Text ref stays as closure_ref', () => {
      const ast = extractAst(`
        name Text! = "Chris"
        @create = -> <div>{ name }</div>
      `);
      const dom = findDomConstructor(ast);
      expect(dom.children[0].type).toBe('closure_ref');
    });
  });

  describe('pure thunk referencing a DomConstructor is inlined', () => {
    it('`{ para }` where para = -> <p>…</p> inlines the DomConstructor', () => {
      const ast = extractAst(`
        para = -> <p>Inner</p>
        @create = -> <div>{ para }</div>
      `);
      // Find the <div> specifically — findDomConstructor may find <p> first
      // since para's own function body is traversed before @create's body.
      const div = findDomConstructorByTag(ast, 'div');
      expect(div).not.toBeNull();
      expect(div.children).toHaveLength(1);
      expect(div.children[0].type).toBe('DomConstructor');
      expect(div.children[0].tag).toBe('p');
    });
  });

  describe('mixed reactive and non-reactive slots', () => {
    it('reactive slot stays closure_ref; non-reactive sibling becomes strinterp', () => {
      const ast = extractAst(`
        reactive Text! = "r"
        constant Text = "c"
        @create = -> <div>{ reactive }{ constant }</div>
      `);
      const dom = findDomConstructor(ast);
      expect(dom.children[0].type).toBe('closure_ref');
      expect(dom.children[1].type).toBe('strinterp');
    });
  });
});
