import { tokenize } from './src/lexer.js';
import { parse } from './src/parser.js';
import { validate } from './src/validate.js';
import { loadTargets, getTarget, getTargetNames } from './src/codegen/targets.js';
import { inferExprType } from './src/inference.js';

await loadTargets();

const BUILT_IN_TYPES = new Set([
  'Integer', 'Text', 'Float', 'Boolean', 'List', 'Anything',
  'Integers', 'Texts', 'Floats', 'Booleans', 'Lists',
]);

function buildAliasMap(dependencies) {
  const map = new Map();
  for (const d of dependencies || []) {
    if (d.type === 'Dependency' && d.path) {
      map.set(d.name, `\`${d.path}\``);
      if (d.destructures) {
        for (const entry of d.destructures) {
          map.set(entry.local, `\`${d.path}\`.${entry.remote}`);
        }
      }
    }
  }
  return map;
}

function resolveType(typeName, aliasMap) {
  if (!typeName || aliasMap.size === 0) return typeName;

  // Handle "X | null" suffix
  if (typeName.endsWith(' | null')) {
    const inner = typeName.slice(0, -7);
    return `${resolveType(inner, aliasMap)} | null`;
  }

  // Handle "List of X" / "Container of X"
  const ofIdx = typeName.indexOf(' of ');
  if (ofIdx !== -1) {
    const container = typeName.slice(0, ofIdx);
    const inner = typeName.slice(ofIdx + 4);
    return `${container} of ${resolveType(inner, aliasMap)}`;
  }

  // Handle dot-access: "Alias.Member"
  const dotIdx = typeName.indexOf('.');
  if (dotIdx !== -1) {
    const alias = typeName.slice(0, dotIdx);
    const member = typeName.slice(dotIdx + 1);
    const resolved = aliasMap.get(alias);
    if (resolved) return `${resolved}.${member}`;
    return typeName;
  }

  // Direct alias lookup
  if (BUILT_IN_TYPES.has(typeName)) return typeName;
  return aliasMap.get(typeName) ?? typeName;
}

function formatParam(param, aliasMap) {
  const opt = (param.defaultValue || param.optional) ? '? ' : '';
  if (!param?.type) return `${opt}Anything`;
  const resolved = resolveType(param.type, aliasMap);
  if (param.positional) return `${opt}${resolved}`;
  return `${opt}${param.name}: ${resolved}`;
}

function formatReplyField(field, index, aliasMap, typeEnv) {
  let typeName = field?.type;
  if (!typeName && typeEnv) {
    // Try inference: sigil name, positional name, identifier value, or expression
    const expr = field?.value ?? field?.expr;
    if ('sigil' in field) {
      typeName = typeEnv.get(field.sigil) || inferExprType(expr, typeEnv);
    } else if (field.name && !expr) {
      // Positional field referencing a variable by name (e.g., `-> retries`)
      typeName = typeEnv.get(field.name);
    } else {
      typeName = inferExprType(expr, typeEnv);
    }
  }
  if (!typeName) return `arg${index + 1}: Anything`;
  const resolved = resolveType(typeName, aliasMap);
  if (field.positional) return resolved;
  if ('sigil' in field) return `${field.sigil}: ${resolved}`;
  if (field.key !== undefined) return `${field.key}: ${resolved}`;
  return `arg${index + 1}: ${resolved}`;
}

function buildExtractTypeEnv(params, body) {
  const env = new Map();
  for (const p of params || []) {
    if (p.rest) continue;
    if (p.name && p.type) env.set(p.name, p.type);
  }
  for (const s of body || []) {
    if (s.type === 'TypedAssign' || s.type === 'BareTypeDecl') {
      env.set(s.name, s.typeName);
    } else if (s.type === 'Assign') {
      const t = inferExprType(s.value, env);
      if (t) env.set(s.name, t);
    } else if (s.type === 'RefDecl' && s.typeName) {
      env.set(s.name, s.typeName);
    }
  }
  return env;
}

function formatPublicFnSig(fn, aliasMap) {
  const input = fn.params.map(p => formatParam(p, aliasMap)).join(', ');
  const reply = fn.body.find(stmt => stmt.type === 'Reply');
  if (!reply) return `(${input}) -> .`;
  const typeEnv = buildExtractTypeEnv(fn.params, fn.body);
  const output = reply.fields.map((f, i) => formatReplyField(f, i, aliasMap, typeEnv)).join(', ');
  return `(${input}) -> (${output})`;
}

function formatConstructorSig(actor, aliasMap) {
  const ownParams = (actor.params || []).map(p => formatParam(p, aliasMap));
  const supertypes = (actor.supertypes || []).map(st => st.supertype);
  // Input: when subtyping, prefix with `Parent1, Parent2 | ` and keep only the
  // subtype's own params on the right of the pipe (inherited params are implied
  // by the spread `...Parent` on the body side).
  const input = supertypes.length
    ? `${supertypes.join(', ')} |${ownParams.length ? ' ' + ownParams.join(', ') : ''}`
    : ownParams.join(', ');
  const methods = (actor.functions || []).filter(f => f.name && f.name.startsWith('@'));
  const methodLines = methods.map(fn => {
    const name = fn.name.replace(/^@/, '');
    const sig = formatPublicFnSig(fn, aliasMap);
    return `    ${name}: ${sig}`;
  });
  // Body: when subtyping, lead with `...Parent` markers to signal inheritance
  // (consumer can expand from the parent's own render). Keep own methods as
  // before; the spread makes additions vs. replacements explicit.
  const spreadLines = supertypes.map(s => `    ...${s}`);
  const bodyLines = [...spreadLines, ...methodLines];
  return `<${input}> -> {\n${bodyLines.join('\n')}\n  }`;
}

function quoteParamPath(path) {
  // Quote the path if it contains any non-word character (including `-`).
  return /^\w+$/.test(path) ? path : JSON.stringify(path);
}

function renderFileHeaderEntry(entry) {
  if (entry.type === 'FileParam') {
    const typeName = entry.paramType || 'Anything';
    if (entry.positional) return typeName;
    return `:${entry.name} ${typeName}`;
  }
  // Dependency: service (no sigil) or constructor (#). Compact form drops the alias.
  const isCtor = entry.constructorParams != null || entry.generic;
  if (entry.destructures) {
    const members = entry.destructures.map(d =>
      d.local === d.remote ? `:${d.local}` : `${d.remote}: ${d.local}${d.type ? ' ' + d.type : ''}`,
    ).join(', ');
    return isCtor
      ? `:${quoteParamPath(entry.path)} (${members}) #`
      : `:${quoteParamPath(entry.path)} (${members})`;
  }
  return isCtor
    ? `:${quoteParamPath(entry.path)} #`
    : `:${quoteParamPath(entry.path)}`;
}

function buildParamsDocument(ast) {
  const entries = [];
  for (const d of ast.dependencies || []) {
    if (d.type === 'FileParam') {
      entries.push(renderFileHeaderEntry(d));
    } else if (d.type === 'Dependency' && d.path) {
      entries.push(renderFileHeaderEntry(d));
    }
  }
  if (entries.length === 0) return '<>';
  return '<\n  ' + entries.join('\n  ') + '\n>';
}

function reactiveCellType(getter, setter, aliasMap) {
  if (!getter || !setter) return null;
  if (getter.params.length !== 0) return null;
  if (setter.params.length !== 1) return null;
  const reply = getter.body.find(s => s.type === 'Reply');
  if (!reply || reply.fields.length !== 1) return null;
  const field = reply.fields[0];
  if (!field || !field.type || !field.positional) return null;
  const setParam = setter.params[0];
  if (!setParam || !setParam.type || !setParam.positional) return null;
  const getType = resolveType(field.type, aliasMap);
  const setType = resolveType(setParam.type, aliasMap);
  if (getType !== setType) return null;
  return getType;
}

// Slice 14 of types-implementation-plan-2026-04-27: types appear in the
// interface document in the same form as their declaration, including the
// `=`. Field declarations preserve names regardless of declaration style.
function formatTypeField(field) {
  const opt = field.optional ? '? ' : '';
  if (field.named) return `${opt}${field.name}: ${field.paramType}`;
  return `${opt}${field.name} ${field.paramType}`;
}

function formatTypeDecl(decl) {
  const fields = (decl.fields || []).map(formatTypeField);
  if (fields.length === 0) return `::${decl.name} = ()`;
  if (fields.length <= 2 && fields.every(f => f.length < 24)) {
    return `::${decl.name} = (${fields.join(', ')})`;
  }
  return `::${decl.name} = (\n    ${fields.join(',\n    ')}\n  )`;
}

function buildServiceDocument(ast) {
  const aliasMap = buildAliasMap(ast.dependencies);
  const lines = [];
  for (const decl of (ast.types || [])) {
    lines.push(formatTypeDecl(decl));
  }
  for (const actor of ast.actors) {
    // Public constructor: actor with @-prefixed name
    if (actor.name && actor.name.startsWith('@')) {
      const name = actor.name.replace(/^@/, '');
      lines.push(`${name}: ${formatConstructorSig(actor, aliasMap)}`);
      continue;
    }
    // Public functions within this actor — group by bare name so an
    // autogenerated @name getter + set@name setter collapse to `name: *Type`.
    const grouped = new Map();
    let order = 0;
    for (const fn of actor.functions) {
      if (!fn.name) continue;
      const isGetter = fn.name.startsWith('@');
      const isSetter = fn.name.startsWith('set@');
      if (!isGetter && !isSetter) continue;
      const bare = fn.name.replace(/^set@|^@/, '');
      if (!grouped.has(bare)) grouped.set(bare, { order: order++, getters: [], setters: [] });
      const entry = grouped.get(bare);
      (isGetter ? entry.getters : entry.setters).push(fn);
    }
    const ordered = [...grouped.entries()].sort((a, b) => a[1].order - b[1].order);
    for (const [bare, { getters, setters }] of ordered) {
      if (getters.length === 1 && setters.length === 1) {
        const cellType = reactiveCellType(getters[0], setters[0], aliasMap);
        if (cellType) {
          lines.push(`${bare}: ${cellType}!`);
          continue;
        }
      }
      if (getters.length > 0) {
        const sigs = getters.map(fn => formatPublicFnSig(fn, aliasMap)).join(' | ');
        lines.push(`${bare}: ${sigs}`);
      }
      if (setters.length > 0) {
        const sigs = setters.map(fn => formatPublicFnSig(fn, aliasMap)).join(' | ');
        lines.push(`set ${bare}: ${sigs}`);
      }
    }
  }

  const base = lines.length === 0 ? '{\n}' : `{\n  ${lines.join('\n  ')}\n}`;

  const asTypes = [];
  for (const actor of ast.actors) {
    if (actor.name) continue;
    for (const clause of actor.asClauses || []) {
      if (clause.negated) continue;
      asTypes.push(resolveType(clause.targetType, aliasMap));
    }
  }
  if (asTypes.length === 0) return base;
  return `${base} | ${asTypes.join(' | ')}`;
}

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

function synthesizeTemplateClosures(ast) {
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
function liftReactiveElements(ast) {
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
function synthesizeReactiveElementBodies(ast) {
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

function assignClosureAddresses(ast) {
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
      if (fn.params && fn.params.length > 0) continue;
      if (!hasRefRead(fn.body)) continue;
      fn.sourceName = fn.name;
      fn.name = '@' + counter;
      counter++;
    }
  }
}

function injectFileParamsIntoFileActor(ast) {
  // File-level scalar params flow through codegen as regular constructor
  // params on the anonymous file-level actor. They're kept in ast.dependencies
  // for manifest rendering; this step mirrors them into the actor's
  // initParams / params so handlers can reference them as state.
  const fileParams = (ast.dependencies || [])
    .filter(d => d.type === 'FileParam')
    .map(p => ({
      name: p.name,
      type: p.paramType,
      positional: !!p.positional,
      ...(p.defaultValue ? { defaultValue: p.defaultValue } : {}),
    }));
  if (fileParams.length === 0) return;
  const fileActor = (ast.actors || []).find(a => !a.name);
  if (!fileActor) return;
  fileActor.initParams = [...fileParams, ...(fileActor.initParams || [])];
  fileActor.params = [...fileParams, ...(fileActor.params || [])];
}

// Slice 9: when a typed assignment expects a user-declared `::Type` and the
// RHS is a bare Structure, coerce the Structure into a TypeConstruction by
// mapping positional args to the declared fields. The bare-tuple form
// `p Point = (1, 2)` becomes equivalent to `p Point = Point(1, 2)`.
function coerceStructuresToTypes(ast) {
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
        (node.value.type === 'StructureConstructor' || node.value.type === 'StructureLiteral')) {
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
function rewriteTypeConstructions(ast) {
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

export function extract(source) {
  if (typeof source !== 'string') {
    throw new TypeError('extract expects a string');
  }
  const tokens = tokenize(source);
  const ast = parse(tokens);
  injectFileParamsIntoFileActor(ast);
  liftReactiveElements(ast);
  assignClosureAddresses(ast);
  synthesizeReactiveElementBodies(ast);
  synthesizeTemplateClosures(ast);
  rewriteTypeConstructions(ast);
  coerceStructuresToTypes(ast);
  return {
    ast,
    interface: {
      structures: [],
      params: buildParamsDocument(ast),
      service: buildServiceDocument(ast),
    },
  };
}

export function compile(ast, options = {}) {
  validate(ast, options);
  const name = options.target || process.env.BREVITY_TARGET || 'js';
  const target = getTarget(name);
  if (!target) {
    throw new Error(`Unknown BREVITY_TARGET: '${name}'. Valid targets: ${getTargetNames().join(', ')}`);
  }
  return target.codegen(ast, options);
}
