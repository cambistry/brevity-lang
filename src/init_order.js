// A constructor block runs in text order, so an actor can't read one of its own cells
// above the line that declares it: it would be waiting on a line it hasn't reached.
// `b Integer = a` then `a *Integer = 1` is an error, and so is `x = y` / `y = x`. Nor
// can it write one there: the write would be lost to the initializer, or land after it.
// A `<-` in the block itself is refused by the parser; this catches one in a function
// the block calls.
//
// A read (or write) is anything that runs at that point in the block:
//   - the cell itself, in the statement;
//   - a read in one of the actor's own functions the statement calls, followed through
//     the functions that one calls;
//   - a read of the cell by a class the statement constructs, in that class's own
//     constructor block (and so on through the classes it constructs).
// A function or lambda that is only created, not called, reads nothing yet. A function
// handed to `over`, `reduce` or a list method runs there, so its body counts.
//
// Passing a cell to a child counts as a read: the child is constructed on the spot.
//
// One exception: a class declared in this actor whose construction reads cells of
// ours declared below. Its reads are messages to us, so they can wait. The call that
// constructs it is marked `deferredConstruct` (the class `spawnable`, the cells
// it waits on in the actor's `pendingCells`), and the targets spawn it without
// waiting, answer its reads at those cells' lines, and join it at the end of the
// block. Using the child before those lines is an error: what we send it waits behind
// its construction.
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
// `writes` does the same for the names it writes (`<-`, `<|`); `outer` holds the reads
// it makes of enclosing actors, as [name, level, via].
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
      case 'SetStatement':
        if (node.name && !shadow.has(node.name)) addOwn(acc, node.name, null, 'writes');
        break;
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
    const acc = { own: new Map(), writes: new Map(), outer: [] };
    fnReads.set(name, acc); // a recursive call sees what's gathered so far
    const f = fnByName.get(name);
    const shadow = new Set((f.params || []).map(p => p?.name).filter(Boolean));
    for (const s of f.body || []) if (s.type !== 'StateAssign') for (const n of declaredNames(s)) shadow.add(n);
    walk(f.body, acc, shadow, f.type);
    return acc;
  };

  const readsOf = (node) => { const acc = { own: new Map(), writes: new Map(), outer: [] }; walk(node, acc, new Set(), null); return acc; };
  return { readsOf };
}

// A direct use wins over one through a call, so the error names the nearest cause.
function addOwn(acc, name, via, key = 'own') {
  const m = acc[key];
  if (!m.has(name) || (m.get(name) !== null && via === null)) m.set(name, via);
}

// `via` is the chain of calls from the statement to the read: `h' → 'g`.
const chain = (callee, via) => via ? `${callee}' → '${via}` : callee;

function mergeInto(acc, more, callee) {
  for (const [n, via] of more.own) addOwn(acc, n, chain(callee, via));
  for (const [n, via] of more.writes || []) addOwn(acc, n, chain(callee, via), 'writes');
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
      const out = { own: new Map(), writes: new Map(), outer: [] };
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

  let nextSite = 0;
  for (const actor of actors) {
    const body = actor.constructorBody || [];
    const declaredAt = new Map();
    body.forEach((s, i) => { for (const n of declaredNames(s)) if (!declaredAt.has(n)) declaredAt.set(n, i); });
    const params = new Set((actor.params || []).map(p => p?.name).filter(Boolean));
    // A child whose construction waits on our later cells, by the name holding it:
    // the cells it waits on.
    const deferred = new Map();
    body.forEach((s, i) => {
      const early = (name) => { const at = declaredAt.get(name); return at !== undefined && at >= i && !params.has(name); };
      let r = null;
      // `i = Inner(…)`, a class declared in us whose construction reads
      // cells of ours declared below: we don't wait for it. It's spawned here, its
      // reads wait for those cells' lines, and we join it at the end of the block.
      const call = constructionCall(s);
      const cls = call && ctx.nestedClass(actor, call.callee.name);
      if (cls) {
        const waitsOn = [...ctx.constructionReads(cls).own.keys()].filter(early);
        if (waitsOn.length) {
          // The last of those lines, for a target that runs the construction there.
          const readyAfter = waitsOn.reduce((x, y) => (declaredAt.get(y) > declaredAt.get(x) ? y : x));
          const site = nextSite++;
          call.deferredConstruct = { waitsOn, site, readyAfter };
          actor.deferredRuns = [...(actor.deferredRuns || []), { site, after: readyAfter, cls: cls.name }];
          cls.spawnable = true;
          actor.pendingCells = [...new Set([...(actor.pendingCells || []), ...waitsOn])];
          for (const n of declaredNames(s)) deferred.set(n, waitsOn);
          r = reader(actor).readsOf(call.args || []);
        }
      }
      r ??= reader(actor).readsOf(s);
      for (const [verb, uses] of [['read', r.own], ['written', r.writes]]) for (const [name, via] of uses) {
        if (!early(name)) continue;
        const by = statementLabel(s);
        const through = via ? `, through '${via}'` : '';
        throw new Error(`'${name}' is ${verb} before its declaration (by ${by}${through}) — declare '${name}' above it`);
      }
      // Anything sent to such a child waits behind its construction, which waits on
      // us: using it before those cells are declared would never finish.
      for (const [name, via] of r.own) {
        const waitsOn = deferred.get(name)?.filter(early);
        if (!waitsOn?.length) continue;
        const by = statementLabel(s);
        const through = via ? `, through '${via}'` : '';
        throw new Error(`'${name}' is used before '${waitsOn[0]}' is declared, and its construction reads '${waitsOn[0]}' (by ${by}${through}) — use '${name}' below '${waitsOn[0]}'`);
      }
    });
  }
}

// The class construction a statement is, if it's nothing else: `i = Inner(…)`. (A bare
// `Inner()` in a constructor block is read as a declaration of `Inner`, not a call.)
function constructionCall(s) {
  const e = (s.type === 'TypedAssign' || s.type === 'Assign') ? s.value : null;
  return e?.type === 'FunctionCallExpr' && e.callee?.type === 'Identifier' ? e : null;
}

function statementLabel(s) {
  const names = declaredNames(s);
  if (names.length) return `'${names.join(', ')}'`;
  const callee = s.expr?.callee?.name ?? s.expr?.method;
  if (callee) return `'${callee}(…)'`;
  if (s.type === 'SetStatement') return `'${s.name} <-'`;
  return 'a statement';
}

// A constructor block with a `CellReady` statement after each line that declares a
// cell a class constructed here waits on: its held reads are answered there. For
// targets that generate the block as one run of statements.
export function withCellReady(body, pendingCells) {
  if (!pendingCells?.length) return body;
  return body.flatMap(s => {
    const name = s.type === 'ExprStatement' ? null : s.name;
    return name && pendingCells.includes(name)
      ? [s, { type: 'ExprStatement', expr: { type: 'CellReady', name } }]
      : [s];
  });
}

// A constructor block with a `RunDeferred` statement after the line declaring the last
// cell a deferred construction waits on. For a target that runs every actor on one
// thread: it makes the child's address at its line and runs its construction here,
// a schedule the child's own concurrency allows.
export function withDeferredRuns(body, actor) {
  const runs = actor.deferredRuns || [];
  if (!runs.length) return body;
  return body.flatMap(s => {
    const name = s.type === 'ExprStatement' ? null : s.name;
    const here = runs.filter(r => r.after === name);
    return [s, ...here.map(r => ({ type: 'ExprStatement', expr: { type: 'RunDeferred', site: r.site, cls: r.cls } }))];
  });
}
