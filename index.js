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
  const opt = param.defaultValue ? '?' : '';
  if (!param?.type) return `Anything${opt}`;
  const resolved = resolveType(param.type, aliasMap);
  if (param.positional) return `${resolved}${opt}`;
  return `:${param.name} ${resolved}${opt}`;
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
  if (!typeName) return `:arg${index + 1} Anything`;
  const resolved = resolveType(typeName, aliasMap);
  if (field.positional) return resolved;
  if ('sigil' in field) return `:${field.sigil} ${resolved}`;
  if (field.key !== undefined) return `:${field.key} ${resolved}`;
  return `:arg${index + 1} ${resolved}`;
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
  const input = actor.params.map(p => formatParam(p, aliasMap)).join(', ');
  const methods = actor.functions.filter(f => f.name && f.name.startsWith('@'));
  const methodLines = methods.map(fn => {
    const name = fn.name.replace(/^@/, '');
    const sig = formatPublicFnSig(fn, aliasMap);
    return `    ${name}: ${sig}`;
  });
  return `<${input}> -> {\n${methodLines.join('\n')}\n  }`;
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
  // Dependency: service (*) or constructor (#). Compact form drops the alias.
  const isCtor = entry.constructorParams != null || entry.generic;
  const sigil = isCtor ? '#' : '*';
  if (entry.destructures) {
    const members = entry.destructures.map(d =>
      d.local === d.remote ? `:${d.local}` : `${d.remote}: ${d.local}${d.type ? ' ' + d.type : ''}`,
    ).join(', ');
    return `:${quoteParamPath(entry.path)} (${members}) ${sigil}`;
  }
  return `:${quoteParamPath(entry.path)} ${sigil}`;
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
          lines.push(`${bare}: *${cellType}`);
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
