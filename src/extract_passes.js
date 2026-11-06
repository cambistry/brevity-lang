// The passes `extract` runs on a parsed file, before validation. Shared by the
// Node entry point (index.js) and the in-page compiler (src/codegen/browser/brevity.js),
// so this module must not import anything that needs Node.

function hasRefRead(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(hasRefRead);
  if (node.type === 'RefRead') return true;
  for (const k of Object.keys(node)) {
    if (k === 'type') continue;
    if (hasRefRead(node[k])) return true;
  }
  return false;
}

// Returns the DomConstructor returned by a zero-arg pure thunk, or null.
// Handles both ImplicitReturn (synthesized closures) and Reply (user-written
// `->` handlers, which wrap the return value in a positional Reply field).
function thunkDomBody(fn) {
  if (fn.expr && fn.expr.type === 'DomConstructor') return fn.expr;
  if (!fn.body || fn.body.length !== 1) return null;
  const stmt = fn.body[0];
  if (stmt.type === 'ImplicitReturn' && stmt.expr && stmt.expr.type === 'DomConstructor') return stmt.expr;
  if (stmt.type === 'Reply' && Array.isArray(stmt.fields) && stmt.fields.length === 1) {
    const f = stmt.fields[0];
    if (f.positional && f.expr && f.expr.type === 'DomConstructor') return f.expr;
  }
  return null;
}

export function synthesizeTemplateClosures(ast) {
  // `{ expr }` interpolations inside templates become one of three things:
  //   - `closure_ref @N` — reactive: expr reads at least one * ref, OR the
  //     expr doesn't resolve to a known Text binding or pure HTML thunk (so the
  //     existing reactive machinery handles it; validation catches type errors)
  //   - inlined DomConstructor — non-reactive, expr is an Identifier bound to
  //     a pure zero-arg thunk whose body is a DomConstructor (eager element)
  //   - `strinterp` — non-reactive, expr is an Identifier whose declared type
  //     is Text (inline text splice, no subscription)
  // Numbering continues from wherever `assignClosureAddresses` left off.
  for (const actor of (ast.actors || [])) {
    // Pure thunks: named, zero-arg, no RefReads, body is a DomConstructor.
    const pureThunks = new Map();
    for (const fn of (actor.functions || [])) {
      if (!fn.name || fn.name.startsWith('@') || fn.name.startsWith('#')) continue;
      if (fn.params && fn.params.length > 0) continue;
      if (hasRefRead(fn.body) || hasRefRead(fn.expr)) continue;
      const dom = thunkDomBody(fn);
      if (dom) pureThunks.set(fn.name, dom);
    }

    // Text-typed non-ref state bindings: safe to inline as a text splice.
    const textVars = new Set();
    for (const decl of (actor.stateVarDecls || [])) {
      if (!decl.isRef && decl.typeName === 'Text') textVars.add(decl.name);
    }

    let counter = 0;
    for (const fn of (actor.functions || [])) {
      const m = /^@(\d+)$/.exec(fn.name || '');
      if (m) counter = Math.max(counter, parseInt(m[1], 10) + 1);
    }
    const synthesized = [];
    // The same DomConstructor node may be referenced from both constructorBody
    // and initBody (parser back-compat for ExprStatement). Dedup so each
    // interp synthesizes exactly one closure. Identity is preserved across
    // liftReactiveElements via its cloneCache.
    const seenDom = new WeakSet();
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const n of node) walk(n); return; }
      if (node.type === 'DomConstructor' && seenDom.has(node)) return;
      if (node.type === 'DomConstructor') seenDom.add(node);
      if (node.type === 'DomConstructor' && Array.isArray(node.children)) {
        for (let i = 0; i < node.children.length; i++) {
          const c = node.children[i];
          if (c && c.type === 'interp') {
            if (hasRefRead(c.expr)) {
              const name = '@' + counter++;
              synthesized.push({
                type: 'FunctionDecl',
                name,
                params: [],
                body: [{ type: 'ImplicitReturn', expr: c.expr, typeName: null }],
              });
              node.children[i] = { type: 'closure_ref', name };
            } else if (c.expr.type === 'Identifier' && pureThunks.has(c.expr.name)) {
              node.children[i] = pureThunks.get(c.expr.name);
            } else if (c.expr.type === 'Identifier' && textVars.has(c.expr.name)) {
              node.children[i] = { type: 'strinterp', expr: c.expr };
            } else {
              // Non-Text non-thunk non-reactive: preserve closure_ref so validation
              // can report the type conflict; don't silently stringify.
              const name = '@' + counter++;
              synthesized.push({
                type: 'FunctionDecl',
                name,
                params: [],
                body: [{ type: 'ImplicitReturn', expr: c.expr, typeName: null }],
              });
              node.children[i] = { type: 'closure_ref', name };
            }
          }
        }
        if (Array.isArray(node.attrs)) {
          for (let i = 0; i < node.attrs.length; i++) {
            const a = node.attrs[i];
            if (a.value && a.value.type === 'handler') {
              // Event handler body (on* attrs): synthesize as a statement-body
              // closure — no implicit return, side effects only.
              const name = '@' + counter++;
              synthesized.push({
                type: 'FunctionDecl',
                name,
                params: [],
                body: a.value.body,
              });
              node.attrs[i] = { name: a.name, value: { type: 'closure_ref', name } };
            } else if (a.value && a.value.type === 'interp') {
              if (hasRefRead(a.value.expr)) {
                const name = '@' + counter++;
                synthesized.push({
                  type: 'FunctionDecl',
                  name,
                  params: [],
                  body: [{ type: 'ImplicitReturn', expr: a.value.expr, typeName: null }],
                });
                node.attrs[i] = { name: a.name, value: { type: 'closure_ref', name } };
              } else if (a.value.expr.type === 'Identifier' && textVars.has(a.value.expr.name)) {
                node.attrs[i] = { name: a.name, value: { type: 'strinterp', expr: a.value.expr } };
              } else {
                const name = '@' + counter++;
                synthesized.push({
                  type: 'FunctionDecl',
                  name,
                  params: [],
                  body: [{ type: 'ImplicitReturn', expr: a.value.expr, typeName: null }],
                });
                node.attrs[i] = { name: a.name, value: { type: 'closure_ref', name } };
              }
            }
          }
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'type') continue;
        walk(node[k]);
      }
    };
    for (const fn of (actor.functions || [])) walk(fn);
    for (const stmt of (actor.constructorBody || [])) walk(stmt);
    for (const stmt of (actor.initBody || [])) walk(stmt);
    if (synthesized.length) actor.functions.push(...synthesized);
  }
}

// Inline reactive element lifting:
//
// When an element has @decl attrs (e.g. `@color Text! = "black"`), the lexer
// captures the entire attr block as a raw `bvBlock` string and the parser
// produces an AnonymousHtmlActor node. This pass:
//
//   1. Merges ref-typed state vars (from @decl) into the parent actor.
//   2. Merges all functions (getters/setters + reactive closures) into the
//      parent actor so that assignClosureAddresses can number them.
//   3. Replaces the AnonymousHtmlActor with a DomConstructor carrying:
//        - text attrs for static string bindings (e.g. class="btn")
//        - closure_ref attrs with placeholder names for reactive functions;
//          synthesizeReactiveElementBodies updates these to @N after renaming.
export function liftReactiveElements(ast) {
  for (const actor of (ast.actors || [])) {
    const liftedStateVars = [];
    const liftedInitBody = [];
    const liftedFunctions = [];
    const visited = new WeakSet();
    // Preserve identity across the deep-clone so a node referenced from both
    // constructorBody and initBody (parser back-compat for ExprStatement)
    // produces a SINGLE cloned successor — downstream passes that walk both
    // lists can dedup by reference.
    const cloneCache = new WeakMap();

    const processNode = (node) => {
      if (!node || typeof node !== 'object') return node;
      if (Array.isArray(node)) return node.map(processNode);
      if (cloneCache.has(node)) return cloneCache.get(node);
      if (node.type === 'AnonymousHtmlActor') {
        const ab = node.actorBody;
        if (!visited.has(node)) {
          visited.add(node);
          // 1. Collect ref state vars and their init statements (only once per node)
          for (const sv of (ab.stateVarDecls || [])) {
            if (sv.isRef) liftedStateVars.push(sv);
          }
          for (const stmt of (ab.initBody || [])) {
            if (stmt.type === 'StateAssign' && stmt.isRef) liftedInitBody.push(stmt);
          }
          // 2. Collect all functions (only once per node)
          for (const fn of (ab.functions || [])) {
            liftedFunctions.push(fn);
          }
        }
        // 3. Build DomConstructor attrs (always — every occurrence becomes a DomConstructor)
        const attrs = [];
        // Static text attrs from non-ref state vars (e.g. class="btn")
        for (const sv of (ab.stateVarDecls || [])) {
          if (sv.isRef) continue;
          const init = (ab.initBody || []).find(s => s.type === 'StateAssign' && s.name === sv.name);
          if (init && init.value && init.value.type === 'StringLiteral') {
            attrs.push({ name: sv.name, value: { type: 'text', value: init.value.value } });
          }
        }
        // Reactive attrs: parameterless non-@ non-# non-set@ functions
        for (const fn of (ab.functions || [])) {
          if (!fn.name) continue;
          if (fn.name.startsWith('@') || fn.name.startsWith('#')) continue;
          if (fn.name === 'set' || fn.name === 'update' || fn.name.startsWith('set@')) continue;
          if (fn.params && fn.params.length > 0) continue;
          // Placeholder name updated to @N by synthesizeReactiveElementBodies
          attrs.push({ name: fn.name, value: { type: 'closure_ref', name: fn.name } });
        }
        // 4. Return DomConstructor with parsed children
        return { type: 'DomConstructor', tag: node.tag, children: node.children, attrs };
      }
      // Deep-clone with recursive processing; copy 'type' verbatim (don't
      // recurse into it) so plain data objects without a type key don't gain
      // a spurious 'type: undefined' property that corrupts validation.
      const out = {};
      cloneCache.set(node, out);
      for (const k of Object.keys(node)) {
        if (k === 'type') { out[k] = node[k]; continue; }
        out[k] = processNode(node[k]);
      }
      return out;
    };

    // Walk and transform constructorBody, initBody, and function bodies
    if (actor.constructorBody) actor.constructorBody = actor.constructorBody.map(processNode);
    if (actor.initBody) actor.initBody = actor.initBody.map(processNode);
    for (const fn of (actor.functions || [])) {
      if (Array.isArray(fn.body)) fn.body = fn.body.map(processNode);
      if (fn.expr) fn.expr = processNode(fn.expr);
    }

    // Prepend lifted init so ref cells are initialized before element creation
    if (liftedStateVars.length > 0) {
      actor.stateVarDecls = [...liftedStateVars, ...(actor.stateVarDecls || [])];
      actor.initBody = [...liftedInitBody, ...(actor.initBody || [])];
      actor.functions = [...(actor.functions || []), ...liftedFunctions];
    }
  }
}

// After assignClosureAddresses renames reactive functions (e.g. 'style' → '@0'),
// update the placeholder closure_ref names in DomConstructors that were built
// by liftReactiveElements.
export function synthesizeReactiveElementBodies(ast) {
  for (const actor of (ast.actors || [])) {
    const renamedFns = new Map(); // sourceName → @N name
    for (const fn of (actor.functions || [])) {
      if (fn.sourceName) renamedFns.set(fn.sourceName, fn.name);
    }
    if (renamedFns.size === 0) continue;

    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const n of node) walk(n); return; }
      if (node.type === 'DomConstructor' && Array.isArray(node.attrs)) {
        for (const attr of node.attrs) {
          if (attr.value && attr.value.type === 'closure_ref' && renamedFns.has(attr.value.name)) {
            attr.value.name = renamedFns.get(attr.value.name);
          }
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'type') continue;
        walk(node[k]);
      }
    };
    for (const fn of (actor.functions || [])) {
      if (Array.isArray(fn.body)) walk(fn.body);
      if (fn.expr) walk(fn.expr);
    }
    if (actor.constructorBody) walk(actor.constructorBody);
    if (actor.initBody) walk(actor.initBody);
  }
}

export function assignClosureAddresses(ast) {
  // Bare-named function decls that look like reactive closures — parameter-
  // less AND reading at least one captured `*` ref — become addressable as
  // @0, @1, … in source-position order per actor. Downstream codegen then
  // treats them uniformly with @public fns (subscribe/replay machinery,
  // dispatch arm synthesis). Helpers like `fn = |a| { a }` or `fn = { 42 }`
  // stay internal-only — no params or no ref reads means no reactive shape
  // to subscribe to.
  for (const actor of (ast.actors || [])) {
    let counter = 0;
    for (const fn of (actor.functions || [])) {
      if (!fn.name) continue;
      if (fn.name.startsWith('@') || fn.name.startsWith('#')) continue;
      if (fn.name === 'set' || fn.name === 'update' || fn.name.startsWith('set@')) continue;
      if (fn.name.endsWith('!')) continue; // a function that writes has nothing to subscribe to
      if (fn.params && fn.params.length > 0) continue;
      if (!hasRefRead(fn.body)) continue;
      fn.sourceName = fn.name;
      fn.name = '@' + counter;
      counter++;
    }
  }
}

export function injectFileParamsIntoFileActor(ast) {
  // File-level scalar params flow through codegen as regular constructor
  // params on the anonymous file-level actor. They're kept in ast.dependencies
  // for manifest rendering; this step mirrors them into the actor's
  // initParams / params so handlers can reference them as state.
  const fileParams = (ast.dependencies || [])
    .filter(d => d.type === 'FileParam')
    .map(p => ({
      name: p.name,
      ...(p.key ? { key: p.key } : {}),
      type: p.paramType,
      positional: !!p.positional,
      ...(p.defaultValue ? { defaultValue: p.defaultValue } : {}),
      ...(p.accessor ? { accessor: p.accessor } : {}),
    }));
  if (fileParams.length === 0) return;
  const fileActor = (ast.actors || []).find(a => !a.name);
  if (!fileActor) return;
  fileActor.initParams = [...fileParams, ...(fileActor.initParams || [])];
  fileActor.params = [...fileParams, ...(fileActor.params || [])];
}

// Slice 9: when a typed assignment expects a user-declared `::Type` and the
// RHS is a bare Object, coerce the Object into a TypeConstruction by
// mapping positional args to the declared fields. The bare-tuple form
// `p Point = (1, 2)` becomes equivalent to `p Point = Point(1, 2)`.
export function coerceObjectsToTypes(ast) {
  const typesByName = new Map((ast.types || []).map(t => [t.name, t]));
  if (typesByName.size === 0) return;

  function structureToTypeConstruction(typeName, structureExpr) {
    const decl = typesByName.get(typeName);
    if (!decl) return null;
    const positional = (structureExpr.args || []).filter(a => a.positional);
    return { type: 'TypeConstruction', typeName, args: positional.map(a => a.expr) };
  }

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (node.type === 'TypedAssign' &&
        typesByName.has(node.typeName) &&
        node.value &&
        (node.value.type === 'ObjectConstructor' || node.value.type === 'ObjectLiteral')) {
      const rewritten = structureToTypeConstruction(node.typeName, node.value);
      if (rewritten) node.value = rewritten;
    }
    for (const k of Object.keys(node)) {
      if (k === 'type') continue;
      walk(node[k]);
    }
  }
  walk(ast);
}

// Slice 3 of types-implementation-plan-2026-04-27: at parse time the parser
// produces a generic FunctionCallExpr for `Point(0, 0)` because it can't
// distinguish a type construction from a regular call locally. After parse,
// once we know the full set of declared types in the file, rewrite any call
// whose callee identifier matches a declared type into TypeConstruction.
export function rewriteTypeConstructions(ast) {
  const typeNames = new Set((ast.types || []).map(t => t.name));
  if (typeNames.size === 0) return;

  const isTypeCall = (n) =>
    n && n.type === 'FunctionCallExpr' &&
    n.callee?.type === 'Identifier' &&
    typeNames.has(n.callee.name);

  const toTypeConstruction = (n) =>
    ({ type: 'TypeConstruction', typeName: n.callee.name, args: n.args });

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        walk(node[i]);
        if (isTypeCall(node[i])) node[i] = toTypeConstruction(node[i]);
      }
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'type') continue;
      const child = node[k];
      walk(child);
      if (isTypeCall(child)) node[k] = toTypeConstruction(child);
    }
  }
  walk(ast);
}

// All of them, in order.
export function runExtractPasses(ast) {
  injectFileParamsIntoFileActor(ast);
  liftReactiveElements(ast);
  assignClosureAddresses(ast);
  synthesizeReactiveElementBodies(ast);
  synthesizeTemplateClosures(ast);
  rewriteTypeConstructions(ast);
  coerceObjectsToTypes(ast);
}
