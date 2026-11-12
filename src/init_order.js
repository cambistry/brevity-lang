// A constructor block runs in text order, so an actor can't read one of its own cells
// above the line that declares it: it would be waiting on a line it hasn't reached.
// `b Integer = a` then `a *Integer = 1` is an error, and so is `x = y` / `y = x`.
//
// A read is anything that runs at that point in the block:
//   - the cell itself, in the statement;
//   - a read in one of the actor's own functions the statement calls, followed through
//     the functions that one calls;
//   - a read of the cell by a class the statement constructs, in that class's own
//     constructor block (and so on through the classes it constructs).
// A function or lambda that is only created, not called, reads nothing yet. A function
// handed to `over`, `reduce` or a list method runs there, so its body counts.
//
// Passing a cell to a child counts as a read: the child is constructed on the spot.
// See notes/forward-reads-in-constructor-blocks-2026-11-11.md.

// The names a constructor-block statement declares.
function declaredNames(s) {
  switch (s.type) {
    case 'RefDecl': case 'TypedAssign': case 'Assign': case 'StateAssign':
    case 'BareTypeDecl': case 'ServiceCoercion':
      return s.name ? [s.name] : [];
    case 'DestructureAssign': case 'ListDestructure':
      return patternNames(s.pattern);
    default:
      return [];
  }
}

function patternNames(p) {
  if (!p) return [];
  if (typeof p === 'string') return [p];
  if (Array.isArray(p)) return p.flatMap(patternNames);
  if (p.type === 'Identifier') return [p.name];
  const out = [];
  for (const k of ['name', 'alias', 'local', 'binding']) if (typeof p[k] === 'string') out.push(p[k]);
  for (const k of ['fields', 'elements', 'names', 'pattern', 'rest']) if (p[k]) out.push(...patternNames(p[k]));
  return out;
}

// Calls a function value on the spot: its body runs where it stands.
const CALLS_FN_ARG = new Set(['OverExpr', 'ReduceExpr', 'ListMethodExpr', 'TextMethodExpr',
  'GraphemeTextMethodExpr', 'BlobMethodExpr', 'MathMethodExpr']);

// Reads one actor makes while running `node`. `own` maps each name it reads that might
// be its own to the function or class it's read through (null when read directly);
// `outer` holds the reads it makes of enclosing actors, as [name, level, via].
function makeReader(actor, ctx) {
  const fnByName = new Map((actor.functions || []).map(f => [f.name, f]));
  const fnReads = new Map();

  const walk = (node, acc, shadow, parentType) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n, acc, shadow, parentType); return; }
    switch (node.type) {
      case 'Function':
        if (!CALLS_FN_ARG.has(parentType)) return;
        { const inner = new Set(shadow); for (const p of node.params || []) if (p?.name) inner.add(p.name);
          walk(node.body, acc, inner, node.type); walk(node.expr, acc, inner, node.type); }
        return;
      case 'FnRef': {
        // `over(xs, &next!)` runs `next!` there; `&next!` alone only names it.
        const name = node.name?.replace(/^&/, '');
        if (CALLS_FN_ARG.has(parentType) && fnByName.has(name) && !shadow.has(name)) mergeInto(acc, readsOfFn(name), name);
        return;
      }
      case 'Identifier': case 'RefRead': case 'StateVar': case 'RefArg':
        if (node.outer) acc.outer.push([node.name, node.outerLevel ?? 1, null]);
        else if (!shadow.has(node.name)) addOwn(acc, node.name, null);
        return;
      case 'Reply': case 'Return':
        for (const f of node.fields || []) {
          if (f.expr) walk(f.expr, acc, shadow, node.type);
          else if (f.name && !f.selfReturn && !shadow.has(f.name)) addOwn(acc, f.name, null);
        }
        return;
      case 'FunctionCallExpr': {
        const callee = node.callee?.type === 'Identifier' ? node.callee.name : null;
        if (callee && !shadow.has(callee)) {
          if (fnByName.has(callee)) mergeInto(acc, readsOfFn(callee), callee);
          else { const cls = ctx.nestedClass(actor, callee); if (cls) mergeInto(acc, ctx.constructionReads(cls), callee); }
        }
        break;
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'type' || k === 'enclosing' || k === 'loc') continue;
      if (v && typeof v === 'object') walk(v, acc, shadow, node.type);
    }
  };

  const readsOfFn = (name) => {
    if (fnReads.has(name)) return fnReads.get(name);
    const acc = { own: new Map(), outer: [] };
    fnReads.set(name, acc); // a recursive call sees what's gathered so far
    const f = fnByName.get(name);
    const shadow = new Set((f.params || []).map(p => p?.name).filter(Boolean));
    for (const s of f.body || []) for (const n of declaredNames(s)) shadow.add(n);
    walk(f.body, acc, shadow, f.type);
    return acc;
  };

  const readsOf = (node) => { const acc = { own: new Map(), outer: [] }; walk(node, acc, new Set(), null); return acc; };
  return { readsOf };
}

// A direct read wins over one through a call, so the error names the nearest cause.
function addOwn(acc, name, via) {
  if (!acc.own.has(name) || (acc.own.get(name) !== null && via === null)) acc.own.set(name, via);
}

// `via` is the chain of calls from the statement to the read: `h' → 'g`.
const chain = (callee, via) => via ? `${callee}' → '${via}` : callee;

function mergeInto(acc, more, callee) {
  for (const [n, via] of more.own) addOwn(acc, n, chain(callee, via));
  for (const [n, level, via] of more.outer) acc.outer.push([n, level, chain(callee, via)]);
}

export function checkInitOrder(ast) {
  const actors = ast.actors || [];
  const readers = new Map();
  const reader = (a) => { if (!readers.has(a)) readers.set(a, makeReader(a, ctx)); return readers.get(a); };
  const enclosingName = (a) => typeof a.enclosing === 'string' ? a.enclosing : a.enclosing?.name;
  const building = new Set();
  const ctx = {
    // A class declared in `actor` (or the file actor's classes, for the file actor).
    nestedClass(actor, name) {
      return actors.find(c => c.name === name && c !== actor && (enclosingName(c) ?? null) === (actor.name ?? null)) || null;
    },
    // The reads a class's construction makes of the actors around it, one level up
    // from where it stands: its own block's reads at level 1 belong to the constructor.
    constructionReads(cls) {
      const out = { own: new Map(), outer: [] };
      if (building.has(cls)) return out;
      building.add(cls);
      const r = reader(cls).readsOf(cls.constructorBody || []);
      for (const [name, level, via] of r.outer) {
        if (level === 1) addOwn(out, name, via);
        else out.outer.push([name, level - 1, via]);
      }
      building.delete(cls);
      return out;
    },
  };

  for (const actor of actors) {
    const body = actor.constructorBody || [];
    const declaredAt = new Map();
    body.forEach((s, i) => { for (const n of declaredNames(s)) if (!declaredAt.has(n)) declaredAt.set(n, i); });
    const params = new Set((actor.params || []).map(p => p?.name).filter(Boolean));
    body.forEach((s, i) => {
      const r = reader(actor).readsOf(s);
      for (const [name, via] of r.own) {
        const at = declaredAt.get(name);
        if (at === undefined || at < i || params.has(name)) continue;
        const by = statementLabel(s);
        const through = via ? `, through '${via}'` : '';
        throw new Error(`'${name}' is read before its declaration (by ${by}${through}) — declare '${name}' above it`);
      }
    });
  }
}

function statementLabel(s) {
  const names = declaredNames(s);
  if (names.length) return `'${names.join(', ')}'`;
  const callee = s.expr?.callee?.name ?? s.expr?.method;
  if (callee) return `'${callee}(…)'`;
  if (s.type === 'SetStatement') return `'${s.name} <-'`;
  return 'a statement';
}
