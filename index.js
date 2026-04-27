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

function buildServiceDocument(ast) {
  const aliasMap = buildAliasMap(ast.dependencies);
  const lines = [];
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
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const n of node) walk(n); return; }
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
            if (a.value && a.value.type === 'interp') {
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

export function extract(source) {
  if (typeof source !== 'string') {
    throw new TypeError('extract expects a string');
  }
  const tokens = tokenize(source);
  const ast = parse(tokens);
  injectFileParamsIntoFileActor(ast);
  assignClosureAddresses(ast);
  synthesizeTemplateClosures(ast);
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
