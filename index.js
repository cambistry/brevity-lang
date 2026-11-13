import { purportedFunctions } from './src/effects.js';
import { parseInterface } from './src/codegen/javascript/types.js';
import { tokenize } from './src/lexer.js';
import { parse } from './src/parser.js';
import { validate } from './src/validate.js';
import { renamePublicClasses, validateWithSourceNames } from './src/subclass.js';
import { loadTargets, getTarget, getTargetNames } from './src/codegen/targets.js';
import { returnShapes, unionMembers } from './src/return_shapes.js';
import { runExtractPasses } from './src/extract_passes.js';

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

function resolveType(typeNameInFile, aliasMap) {
  // A doc is the outside view, where a public class has no `@`.
  const typeName = typeNameInFile?.replace(/@(?=\w)/g, '');
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
  return `${opt}${param.key || param.name}: ${resolved}`;
}

const formatSlot = ({ name, type }, aliasMap) => {
  const resolved = unionMembers(type).map(t => resolveType(t, aliasMap)).join(' | ');
  return name === null ? resolved : `${name}: ${resolved}`;
};

function formatPublicFnSig(fn, aliasMap, purported = null) {
  const input = fn.params.map(p => formatParam(p, aliasMap)).join(', ');
  // Bodies are checked by the compiler, so a generated arrow states the fact.
  const arrow = fn.name.endsWith('!') ? '=>' : (purported?.has(fn.name) ? '~>' : '->');
  if (fn.body.some(stmt => stmt.type === 'SilentTerminator')) return `(${input}) => .`;
  const { alternatives, orSelf } = returnShapes(fn);
  const values = alternatives.map(alt => `(${alt.map(slot => formatSlot(slot, aliasMap)).join(', ')})`);
  if (values.length > 0) return `(${input}) ${arrow} ${values.join(' | ')}${orSelf ? ' | self' : ''}`;
  return orSelf ? `(${input}) ${arrow} self` : `(${input}) ${arrow} ()`;
}

function formatConstructorSig(actor, aliasMap, purported = null, arrow = '->', singletonBlock = () => null) {
  const ownParams = (actor.params || []).map(p => formatParam(p, aliasMap));
  const supertypes = (actor.supertypes || []).map(st => (st.sourceName ?? st.supertype).replace(/^@/, ''));
  // Input: when subtyping, prefix with `Parent1 ++ Parent2 ++ ` and keep only
  // the subtype's own params after the last `++` (inherited params are implied
  // by the spread `...Parent` on the body side). No params: `(T++)`, `(A ++ B)`.
  const input = !supertypes.length ? ownParams.join(', ')
    : ownParams.length ? `${supertypes.join(' ++ ')} ++ ${ownParams.join(', ')}`
    : supertypes.length === 1 ? `${supertypes[0]}++`
    : supertypes.join(' ++ ');
  // Published params (`@name Type`) read as read-only fields.
  const fieldLines = publishedParamLines(actor, aliasMap).map(l => `    ${l}`);
  const methods = (actor.functions || []).filter(f => f.name && f.name.startsWith('@'));
  const setterOf = (name) => (actor.functions || []).filter(f => f.name === 'set' + name);
  const methodLines = methods.map(fn => {
    const name = fn.name.replace(/^@/, '');
    const cell = cellLine(actor, name, [fn], setterOf(fn.name), aliasMap);
    if (cell) return `    ${cell}`;
    const sig = singletonBlock(fn) ?? formatPublicFnSig(fn, aliasMap, purported);
    return `    ${name} ${sig}`;
  });
  // Body: when subtyping, lead with `...Parent` markers to signal inheritance
  // (consumer can expand from the parent's own render). Keep own methods as
  // before; the spread makes additions vs. replacements explicit.
  const spreadLines = supertypes.map(s => `    ...${s}`);
  const bodyLines = [...spreadLines, ...fieldLines, ...methodLines];
  if (bodyLines.length === 0) return `(${input}) ${arrow} *{}`;
  return `(${input}) ${arrow} *{\n${bodyLines.join('\n')}\n  }`;
}

const untrackedPrefix = (actor, name) =>
  (actor.stateVarDecls || []).some(d => d.untracked && d.name === name) ? 'untracked ' : '';

function publishedParamLines(actor, aliasMap) {
  return (actor.initParams || [])
    .filter(p => p.accessor)
    .map(p => `${p.accessor} ${p.type ? resolveType(p.type, aliasMap) : 'Anything'}`);
}

// One entry of the params document: the caller-facing side of a header entry.
// Bindings are private and dropped — a positional param's name, a renamed
// param's local, a dependency's alias or destructure. A positional entry is
// its type; a named entry is `"key": Type`, and a dependency with no declared
// type (it comes from the remote's own document) is `"key":`. Every named key
// is quoted: keys are paths.
function renderParamsEntry(entry) {
  if (entry.type === 'FileParam') {
    const typeName = entry.paramType || 'Anything';
    if (entry.positional) return typeName;
    return `${renderParamsKey(entry.key || entry.name)}: ${typeName}`;
  }
  const key = renderParamsKey(entry.path);
  const type = dependencyTypeText(entry);
  return type ? `${key}: ${type.replace(/\n/g, '\n  ')}` : `${key}:`;
}

function renderParamsKey(key) {
  return JSON.stringify(key);
}

function dependencyTypeText(dep) {
  if (dep.constructorParams) {
    const params = dep.constructorParams.map(p => formatParam(p, new Map())).join(', ');
    return `(${params}) -> *${dep.interface || '{}'}`;
  }
  if (dep.generic) return '#';
  return dep.interface || null;
}

function buildParamsDocument(ast) {
  const entries = (ast.dependencies || [])
    .filter(d => d.type === 'FileParam' || (d.type === 'Dependency' && d.path))
    .map(renderParamsEntry);
  // Same outer shape as a delimited header's param list: `( … )`.
  if (entries.length === 0) return '()';
  return '(\n  ' + entries.join('\n  ') + '\n)';
}

// A public cell's entry: `name *Type` when it's settable, `name &Type` when it
// isn't (a cell whose type has no synthesized setter). Null for anything else.
function cellLine(actor, bare, getters, setters, aliasMap) {
  if (getters.length !== 1 || setters.length > 1) return null;
  const [getter] = getters;
  if (setters.length === 1) {
    const cellType = reactiveCellType(getter, setters[0], aliasMap);
    return cellType ? `${bare} *${cellType}` : null;
  }
  if (!getter.cellGetter) return null;
  const field = getter.body.find(s => s.type === 'Reply')?.fields?.[0];
  return field?.type ? `${bare} &${resolveType(field.type, aliasMap)}` : null;
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
// interface document in the same form as their declaration (`type Name (…)`,
// no `=`). Field declarations preserve names regardless of declaration style.
function formatTypeField(field) {
  const opt = field.optional ? '? ' : '';
  // A silent-function field shows its silent `.` (stored without it).
  const name = /=>\s*\.\s*$/.test(field.paramType || '') ? `${field.name}.` : field.name;
  if (field.named) return `${opt}${name}: ${field.paramType}`;
  return `${opt}${name} ${field.paramType}`;
}

function formatTypeDecl(decl) {
  const fields = (decl.fields || []).map(formatTypeField);
  if (fields.length === 0) return `type ${decl.name} ()`;
  if (fields.length <= 2 && fields.every(f => f.length < 24)) {
    return `type ${decl.name} (${fields.join(', ')})`;
  }
  return `type ${decl.name} (\n    ${fields.join(',\n    ')}\n  )`;
}

// A private superclass has no doc entry for `...T` to expand from, so a public
// class states what it inherits from one in place, with its own members winning.
function withPrivateSupers(actor, privateClasses, purportedByActor) {
  const supertypes = [];
  const params = [];
  const initParams = [];
  const functions = [];
  const purported = new Set();
  for (const st of actor.supertypes || []) {
    const parent = privateClasses.get(st.supertype);
    if (!parent) {
      supertypes.push(st);
      continue;
    }
    const flat = withPrivateSupers(parent, privateClasses, purportedByActor);
    supertypes.push(...flat.supertypes);
    params.push(...flat.params);
    initParams.push(...flat.initParams);
    functions.push(...flat.functions);
    for (const name of flat.purported) purported.add(name);
  }
  const ownNames = new Set((actor.functions || []).map(f => f.name));
  const ownParams = new Set((actor.params || []).map(p => p.name));
  const ownInit = new Set((actor.initParams || []).map(p => p.name));
  for (const name of ownNames) purported.delete(name);
  for (const name of purportedByActor.get(actor) || []) purported.add(name);
  return {
    supertypes,
    params: [...params.filter(p => !ownParams.has(p.name)), ...(actor.params || [])],
    initParams: [...initParams.filter(p => !ownInit.has(p.name)), ...(actor.initParams || [])],
    functions: [...functions.filter(f => !ownNames.has(f.name)), ...(actor.functions || [])],
    purported,
  };
}

function buildServiceDocument(ast) {
  const aliasMap = buildAliasMap(ast.dependencies);
  const lines = [];
  const purportedByActor = purportedFunctions(ast, parseInterface);
  const privateClasses = new Map(ast.actors.filter(a => a.name && !a.name.startsWith('@')).map(a => [a.name, a]));
  for (const decl of (ast.types || [])) {
    lines.push(formatTypeDecl(decl));
  }
  for (const actor of ast.actors) {
    // Public constructor: actor with @-prefixed name
    if (actor.name && actor.name.startsWith('@')) {
      const name = (actor.sourceName ?? actor.name).replace(/^@/, '');
      const flat = withPrivateSupers(actor, privateClasses, purportedByActor);
      const singletonBlock = (fn) => {
        const cls = singletonIn(ast, actor, fn.name);
        return cls ? formatSingletonBlock(ast, cls, aliasMap, purportedByActor, 4) : null;
      };
      lines.push(`${name} ${formatConstructorSig(flat, aliasMap, flat.purported, name.endsWith('!') ? '=>' : '->', singletonBlock)}`);
      continue;
    }
    // A private class isn't part of the file's surface.
    if (actor.name) continue;
    // The file's published params read as read-only fields.
    lines.push(...publishedParamLines(actor, aliasMap));
    lines.push(...publicMemberLines(ast, actor, aliasMap, purportedByActor, 2));
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

// The public singleton `@name` declared directly in `owner` (src/parser.js), if any.
const singletonIn = (ast, owner, name) =>
  ast.actors.find(a => a.singletonOf === name && (a.enclosing ?? null) === (owner.name ?? null));

// A public singleton is a sub-service: `name { members }`, its members one level
// in. `depth` is the indent of the line it starts on.
function formatSingletonBlock(ast, cls, aliasMap, purportedByActor, depth) {
  const members = publicMemberLines(ast, cls, aliasMap, purportedByActor, depth + 2);
  if (members.length === 0) return '{}';
  const pad = ' '.repeat(depth + 2);
  return `{\n${members.map(l => pad + l).join('\n')}\n${' '.repeat(depth)}}`;
}

// An actor's public members, one entry each (the first line unindented; a
// multi-line entry carries its own indent, for an entry starting at `depth`).
// An autogenerated @name getter + set@name setter collapse to `name *Type`.
function publicMemberLines(ast, actor, aliasMap, purportedByActor, depth) {
  const lines = [];
  {
    const purported = purportedByActor.get(actor);
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
      const cell = cellLine(actor, bare, getters, setters, aliasMap);
      if (cell) {
        lines.push(`${untrackedPrefix(actor, '@' + bare)}${cell}`);
        continue;
      }
      const singleton = getters.length === 1 && singletonIn(ast, actor, '@' + bare);
      if (singleton) {
        lines.push(`${bare} ${formatSingletonBlock(ast, singleton, aliasMap, purportedByActor, depth)}`);
        continue;
      }
      // One line per overload, repeating the name.
      for (const fn of getters) lines.push(`${fn.untracked ? 'untracked ' : ''}${bare} ${formatPublicFnSig(fn, aliasMap, purported)}`);
      for (const fn of setters) {
        lines.push(`set ${bare} (${fn.params.map(p => formatParam(p, aliasMap)).join(', ')})`);
      }
    }
  }
  return lines;
}

export function extract(source) {
  if (typeof source !== 'string') {
    throw new TypeError('extract expects a string');
  }
  const tokens = tokenize(source);
  const ast = parse(tokens);
  runExtractPasses(ast);
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
  renamePublicClasses(ast);
  validateWithSourceNames(validate, ast, options);
  const name = options.target || process.env.BREVITY_TARGET || 'js';
  const target = getTarget(name);
  if (!target) {
    throw new Error(`Unknown BREVITY_TARGET: '${name}'. Valid targets: ${getTargetNames().join(', ')}`);
  }
  return target.codegen(ast, options);
}
