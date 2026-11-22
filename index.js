import { purportedFunctions } from './src/effects.js';
import { parseInterface } from './src/codegen/javascript/types.js';
import { serviceDocument, fileScope } from './src/service_doc.js';
import { validate, readRemote } from './src/validate.js';
import { tokenize } from './src/lexer.js';
import { parse } from './src/parser.js';
import { renamePublicClasses, validateWithSourceNames, resolveSuperclassChain } from './src/subclass.js';
import { buildsBase } from './src/super_calls.js';
import { loadTargets, getTarget, getTargetNames } from './src/codegen/targets.js';
import { returnShapes, unionMembers } from './src/return_shapes.js';
import { runExtractPasses } from './src/extract_passes.js';
import { RUNTIME_MODULE } from './src/codegen/erlang/preambles.js';

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

  // A type reached through a service: "Alias::Member", "Alias::C::Member"
  const pathIdx = typeName.indexOf('::');
  if (pathIdx !== -1) {
    const alias = typeName.slice(0, pathIdx);
    const member = typeName.slice(pathIdx + 2);
    const resolved = aliasMap.get(alias);
    if (resolved) return `${resolved}::${member}`;
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

function formatConstructorSig(actor, aliasMap, purported = null, arrow = '->', singletonBlock = () => null, typeDecls = [], protectedLines = []) {
  const ownParams = (actor.params || []).map(p => formatParam(p, aliasMap));
  const supertypes = (actor.supertypes || []).map(st => (st.sourceName ?? st.supertype).replace(/^@/, ''));
  // Input: when subtyping, the parents come first, `Parent1 ^ Parent2 ^ `, and the
  // parens hold only the subtype's own params (inherited params are implied by the
  // spread `...Parent` on the body side). No params: `T ^ -> *{…}`.
  const parents = supertypes.length ? `${supertypes.join(' ^ ')} ^ ` : '';
  // A subclass with a constructor of its own takes only its own params, and shows
  // them even when there are none: `T ^ ()`.
  const input = !supertypes.length || ownParams.length || buildsBase(actor) ? `${parents}(${ownParams.join(', ')})` : parents.trimEnd();
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
  const typeLines = typeDecls.map(d => `    ${formatTypeDecl(d)}`);
  const bodyLines = [...spreadLines, ...typeLines, ...fieldLines, ...methodLines, ...protectedLines.map(l => `    ${l}`)];
  if (bodyLines.length === 0) return `${input} ${arrow} *{}`;
  return `${input} ${arrow} *{\n${bodyLines.join('\n')}\n  }`;
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
  const name = decl.bareName ?? decl.name;
  const fields = (decl.fields || []).map(formatTypeField);
  if (fields.length === 0) return `type ${name} ()`;
  if (fields.length <= 2 && fields.every(f => f.length < 24)) {
    return `type ${name} (${fields.join(', ')})`;
  }
  return `type ${name} (\n    ${fields.join(',\n    ')}\n  )`;
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
    // A class with a constructor of its own takes none of its parent's params; the
    // parent's published ones still read as fields.
    const taken = buildsBase(actor) ? flat.initParams.filter(p => p.accessor) : flat.initParams;
    if (!buildsBase(actor)) params.push(...flat.params);
    initParams.push(...taken);
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
    ...(buildsBase(actor) && { ownNew: true }),
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
  // A type declared in a class's constructor block goes in that class's entry.
  for (const decl of (ast.types || [])) {
    if (!decl.ownerClass) lines.push(formatTypeDecl(decl));
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
      // A class with members of its own (src/singleton_classes.js) has them after
      // its constructor: `C (…) -> *{ … } ^ { members }`.
      const members = actor.membersClass ? ast.actors.find(a => a.name === actor.membersClass) : null;
      const membersBlock = members ? ` ^ ${formatSingletonBlock(ast, members, aliasMap, purportedByActor, 2)}` : '';
      // Every actor is extensible for now: its instances' protected members are
      // published too, composite (notes/opre-extend-and-as-2026-11-20.md).
      const protectedLines = instanceProtectedLines(ast, actor, aliasMap, purportedByActor);
      lines.push(`${name} ${formatConstructorSig(flat, aliasMap, flat.purported, name.endsWith('!') ? '=>' : '->', singletonBlock, ownTypes(ast, actor), protectedLines)}${membersBlock}`);
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

// The types declared in a class's constructor block.
const ownTypes = (ast, actor) => (ast.types || []).filter(t => t.ownerClass && (t.ownerClass === actor.name || t.ownerClass === actor.sourceName));

// The public singleton `@name` declared directly in `owner` (src/parser.js), if any.
const singletonIn = (ast, owner, name) =>
  ast.actors.find(a => a.singletonOf === name && (a.enclosing ?? null) === (owner.name ?? null));

// A public singleton is a sub-service: `name { members }`, its members one level
// in. `depth` is the indent of the line it starts on.
function formatSingletonBlock(ast, cls, aliasMap, purportedByActor, depth) {
  const members = [...ownTypes(ast, cls).map(formatTypeDecl),
    ...(cls.membersOf ? [...blockPublicLines(ast, cls, aliasMap, purportedByActor, depth + 2), ...protectedMemberLines(ast, cls, aliasMap, purportedByActor)]
      : publicMemberLines(ast, cls, aliasMap, purportedByActor, depth + 2))];
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

// ── The extension doc ────────────────────────────────────────────────────────
//
// Every actor is extensible for now, so a class block's doc also lists what an
// extender may use and override: its protected functions (`~h (Integer) -> (Integer)`)
// and protected cells (`~count *Integer`, `~limit &Integer` for one that isn't `*`),
// beside its public members. A block that extends another presents the composite: its
// own names, then what it inherits that it doesn't redefine.
// See notes/opre-extend-and-as-2026-11-20.md ("The extension doc").

// The name of a cell's generated accessor, or null.
const accessorCell = (f) => f.cellGetter ? f.name : f.name?.match(/^(?:set|update|subscribe)[@.#]/) ? f.name : null;

// A block's protected functions and cells, composite over the blocks it extends.
function protectedMembers(ast, block) {
  const byName = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  const fns = new Map();
  const cells = new Map();
  for (let b = block; b; b = b.blockParent ? byName.get(b.blockParent) : null) {
    const here = new Map();
    for (const f of b.functions || []) {
      if (typeof f.name !== 'string' || /^[@#]/.test(f.name) || f.inheritedFrom || f.baseOf || f.actorDef || accessorCell(f) || f.name.includes('__')) continue;
      if (!fns.has(f.name) && !cells.has(f.name)) (here.get(f.name) ?? here.set(f.name, []).get(f.name)).push(f);
    }
    for (const [name, clauses] of here) fns.set(name, clauses);
    for (const d of b.stateVarDecls || []) {
      if (typeof d.name !== 'string' || /^[@#]/.test(d.name) || d.baseOf || d.name.includes('__')) continue;
      if (!fns.has(d.name) && !cells.has(d.name)) cells.set(d.name, d);
    }
  }
  return { fns, cells };
}

// A block's public members, composite: its own, then those of the block it extends
// that it doesn't define.
function blockPublicLines(ast, block, aliasMap, purportedByActor, depth) {
  const own = publicMemberLines(ast, { ...block, functions: (block.functions || []).filter(f => !f.inheritedFrom) }, aliasMap, purportedByActor, depth);
  const parent = block.blockParent && ast.actors.find(a => a.name === block.blockParent);
  const entryName = (line) => line.match(/^(?:untracked )?(?:set )?([^\s(]+)/)?.[1];
  const names = new Set(own.map(entryName));
  const inherited = parent ? blockPublicLines(ast, parent, aliasMap, purportedByActor, depth)
    : block.remoteBase ? remoteDocLines(block.remoteBase.doc).filter(l => !l.startsWith('~')) : [];
  return [...own, ...inherited.filter(l => !names.has(entryName(l)))];
}

// A parent block in another file, by its published doc (src/singleton_classes.js,
// addRemoteParents): its entries, as lines of a doc.
function remoteDocLines(doc) {
  const sig = (s) => `(${(s.params || []).map(p => p.positional === false ? `${p.name}: ${p.type}` : p.type).join(', ')}) ${s.effect === 'write' ? '=>' : '->'} (${(s.returns || []).map(r => r.name ? `${r.name}: ${r.type}` : r.type).join(', ')})`;
  const entries = (part, prefix) => Object.entries(part || {}).filter(([n]) => !n.startsWith('__')).flatMap(([n, sigs]) => {
    const f = part.__fields?.[n];
    if (f) return [`${prefix}${n.replace(/^~/, '')} ${f.readOnly ? '&' : '*'}${f.type}`];
    return sigs.map(x => `${prefix}${n.replace(/^~/, '')} ${sig(x)}`);
  });
  return [...entries(doc, ''), ...entries(doc.__protected, '~')];
}

function protectedMemberLines(ast, block, aliasMap, purportedByActor) {
  const { fns, cells } = protectedMembers(ast, block);
  const purported = purportedByActor.get(block);
  const lines = [
    ...[...cells.values()].map(d => `~${d.name} ${d.isRef ? '*' : '&'}${d.typeName ? resolveType(d.typeName, aliasMap) : 'Anything'}`),
    ...[...fns].flatMap(([name, clauses]) => clauses.map(f => `~${name} ${formatPublicFnSig(f, aliasMap, purported)}`)),
  ];
  // What a block whose parent is in another file inherits from it, by its doc.
  let top = block;
  const byName = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  while (top.blockParent && byName.get(top.blockParent)) top = byName.get(top.blockParent);
  if (!top.remoteBase) return lines;
  const have = new Set([...cells.keys(), ...fns.keys()].map(n => `~${n}`));
  return [...lines, ...remoteDocLines(top.remoteBase.doc).filter(l => l.startsWith('~') && !have.has(l.split(' ')[0]))];
}

// A class block's extension doc: its public and protected members, as the
// `^ { … }` part of its class's entry in the service doc.
function blockDocument(ast, block, aliasMap, purportedByActor, { own = false } = {}) {
  const view = own ? { ...block, functions: (block.functions || []).filter(f => !f.inheritedFrom), blockParent: null, remoteBase: null } : block;
  const lines = [...blockPublicLines(ast, view, aliasMap, purportedByActor, 0), ...protectedMemberLines(ast, view, aliasMap, purportedByActor)];
  return `{\n${lines.join('\n')}\n}`;
}

// The parent's public and protected names a block overrides (a function) or
// redeclares (a cell), in the parent's terms: wire names, `~` on protected ones.
// Built from the parent block's extension doc, never its source, so a parent known
// only by its doc is the same case. A clash with the parent's declaration is the
// child's compile error.
export function settleOverrideTables(ast) {
  const aliasMap = buildAliasMap(ast.dependencies);
  const purportedByActor = purportedFunctions(ast, parseInterface);
  const byName = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  const shown = (name) => (byName.get(name)?.sourceName ?? name ?? '').replace(/^@/, '').replace(/__pub$/, '');
  const docNames = (doc) => [...Object.keys(doc).filter(k => !k.startsWith('__')), ...Object.keys(doc.__protected || {}).filter(k => !k.startsWith('__'))];
  // What each block declares, by wire name: what a `$extend` to it may name. And
  // what each class's instances declare, for the `instance` section.
  for (const block of ast.actors) {
    if (!block.membersOf) continue;
    const doc = parseInterface(blockDocument(ast, block, aliasMap, purportedByActor));
    Object.defineProperty(block, 'extensionNames', { value: docNames(doc), configurable: true, enumerable: false });
  }
  const isClass = (a) => a.name && !a.singletonOf && !a.membersOf && !a.remoteStub;
  for (const cls of ast.actors.filter(isClass)) {
    const doc = parseInterface(instanceDocument(ast, cls, aliasMap, purportedByActor));
    Object.defineProperty(cls, 'instanceNames', { value: docNames(doc), configurable: true, enumerable: false });
  }
  for (const block of ast.actors) {
    if (!block.blockParent) continue;
    const parent = byName.get(block.blockParent);
    // A parent in another file is known by its published doc only.
    const theirs = parent ? parseInterface(blockDocument(ast, parent, aliasMap, purportedByActor)) : block.remoteBase?.doc;
    if (!theirs) continue;
    const mine = parseInterface(blockDocument(ast, block, aliasMap, purportedByActor, { own: true }));
    const where = `the class block of '${shown(block.membersOf)}'`;
    const parentWhere = parent ? `the class block of '${shown(parent.membersOf)}'` : `the class block of '${(block.remoteBase.address.split(':').pop())}' (in '${block.remoteBase.address.split(':')[0]}')`;
    const table = overrides(mine, theirs, where, parentWhere);
    Object.defineProperty(block, 'overrideTable', { value: { block: table }, configurable: true, enumerable: false });
  }
  // The `instance` section: for each parent, its instances' names that the class's
  // instances supply in place of its own: what the class declares, and what a later
  // parent supplies (the later parent winning).
  // A parent in another file, by its doc's entry: its instances' doc.
  const remoteInstanceDoc = (entry) => {
    const doc = {};
    for (const f of entry.functions || []) (doc[f.name] ??= []).push({ params: f.params || [], returns: f.returns ?? null, effect: f.effect });
    if (entry.fields) doc.__fields = entry.fields;
    if (entry.instanceProtected) doc.__protected = entry.instanceProtected;
    return doc;
  };
  for (const cls of ast.actors.filter(isClass)) {
    if (!cls.remoteLayers?.length) continue;
    const mine = parseInterface(instanceDocument(ast, cls, aliasMap, purportedByActor, { own: true }));
    const tables = {};
    for (const L of cls.remoteLayers) {
      const addr = L.address.split(':');
      tables[L.name] = overrides(mine, remoteInstanceDoc(L.doc), `'${shown(cls.name)}'`, `'${addr.pop()}' (in '${addr.join(':')}')`);
      // A parent there with a class block: our block's \`$extend\` to it speaks for the
      // class, carrying the section, in place of a handshake of its own.
      const block = cls.membersClass ? byName.get(cls.membersClass) : null;
      if (block?.remoteBase?.address === L.address) {
        L.viaBlock = true;
        if (block.overrideTable && tables[L.name].length) block.overrideTable.instance = tables[L.name];
      }
    }
    Object.defineProperty(cls, 'instanceTables', { value: tables, configurable: true, enumerable: false });
  }
  for (const cls of ast.actors.filter(isClass)) {
    const parents = (cls.supertypes || []).map(st => byName.get(st.supertype)).filter(p => p && isClass(p));
    if (!parents.length) continue;
    const mine = parseInterface(instanceDocument(ast, cls, aliasMap, purportedByActor, { own: true }));
    const tables = { ...(cls.instanceTables || {}) };
    parents.forEach((P, i) => {
      const theirs = parseInterface(instanceDocument(ast, P, aliasMap, purportedByActor));
      const table = overrides(mine, theirs, `'${shown(cls.name)}'`, `'${shown(P.name)}'`);
      const theirNames = new Set(docNames(theirs));
      for (const later of parents.slice(i + 1)) {
        for (const n of later.instanceNames || []) if (theirNames.has(n) && !table.includes(n)) table.push(n);
      }
      tables[P.name] = table;
    });
    Object.defineProperty(cls, 'instanceTables', { value: tables, configurable: true, enumerable: false });
    // A class block's `$extend` speaks for the class: it carries the section for the
    // class whose block it extends.
    const block = cls.membersClass ? byName.get(cls.membersClass) : null;
    const parentBlock = block?.blockParent ? byName.get(block.blockParent) : null;
    const instance = parentBlock ? tables[parentBlock.membersOf] : null;
    if (block?.overrideTable && instance?.length) block.overrideTable.instance = instance;
  }
}

// The parent's public and protected names that `mine` overrides (a function) or
// redeclares (a cell), in the parent's terms, checked against the parent's doc.
function overrides(mine, theirs, where, parentWhere) {
  const table = [];
  const check = (label, source, my, their) => {
    if (!their) return;
    // A prop (a published param) is read as an op; a function may stand in for it.
    // Its type is the accessor rule's to check (src/validate.js).
    if (their.field && !their.field.cell) { table.push(label); return; }
    const myCell = !!my.field;
    const theirCell = !!their.field;
    if (myCell !== theirCell) {
      throw new Error(`'${source}' in ${where} is a ${myCell ? 'cell' : 'function'}, and in ${parentWhere}, which it extends, '${source}' is a ${theirCell ? 'cell' : 'function'}`);
    }
    if (myCell) {
      if (!sameType(my.field.type, their.field.type)) {
        throw new Error(`'${source}' in ${where} is a ${my.field.type}, and in ${parentWhere}, which it extends, a ${their.field.type}`);
      }
    } else {
      for (const sig of my.sigs) {
        const match = their.sigs.find(t => t.params.length === sig.params.length);
        if (!match) {
          const arities = [...new Set(their.sigs.map(t => t.params.length))].join(' or ');
          throw new Error(`'${source}' in ${where} takes ${sig.params.length} arg${sig.params.length === 1 ? '' : 's'}, and in ${parentWhere}, which it extends, ${arities}`);
        }
        sig.params.forEach((p, i) => {
          const q = match.params[i];
          if (!sameType(p.type, q.type)) throw new Error(`'${source}' in ${where}: its arg ${i + 1} is a ${p.type}, and in ${parentWhere}, which it extends, a ${q.type}`);
        });
        const [r, q] = [sig.returns, match.returns];
        if (r && q && (r.length !== q.length || r.some((x, i) => !sameType(x.type, q[i].type)))) {
          const fmt = (xs) => `(${xs.map(x => x.type).join(', ')})`;
          throw new Error(`'${source}' in ${where} replies ${fmt(r)}, and in ${parentWhere}, which it extends, ${fmt(q)}`);
        }
      }
    }
    table.push(label);
  };
  const entry = (doc, name) => doc[name] ? { sigs: doc[name], field: doc.__fields?.[name] } : null;
  for (const name of Object.keys(mine).filter(k => !k.startsWith('__'))) check(name, '@' + name, entry(mine, name), entry(theirs, name));
  const prot = (doc, name) => (doc.__protected?.[name] ? { sigs: doc.__protected[name], field: doc.__protected.__fields?.[name] } : null);
  for (const name of Object.keys(mine.__protected || {}).filter(k => !k.startsWith('__'))) check(name, name.slice(1), prot(mine, name), prot(theirs, name));
  return table;
}

// What a class's instances present to an extender: their public and protected
// members, composite (own, then inherited), published params as public fields.
// With `own`, its own only.
function instanceMembers(ast, cls, { own = false } = {}) {
  const byName = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  const chain = own ? { inheritedFunctions: [], inheritedState: [], inheritedParams: [] } : resolveSuperclassChain(byName, cls);
  const ownNames = new Set((cls.functions || []).map(f => f.name));
  const functions = [...chain.inheritedFunctions.filter(f => !ownNames.has(f.name)), ...(cls.functions || [])]
    .filter(f => typeof f.name === 'string' && !f.actorDef && !f.baseOf && !f.name.includes('__'));
  const ownCells = new Set((cls.stateVarDecls || []).map(d => d.name));
  const cells = [...(cls.stateVarDecls || []), ...chain.inheritedState.filter(d => !ownCells.has(d.name))]
    .filter(d => typeof d.name === 'string' && !d.baseOf && !d.name.includes('__') && !d.name.startsWith('#'));
  const params = [...chain.inheritedParams, ...(cls.initParams || [])].filter(p => p.accessor);
  return { functions, cells, params };
}

function instanceProtectedLines(ast, cls, aliasMap, purportedByActor, opts) {
  const { functions, cells } = instanceMembers(ast, cls, opts);
  const purported = purportedByActor.get(cls);
  const isAccessor = (f) => f.cellGetter || /^(set|update|subscribe|new)[@.#]/.test(f.name);
  // A cell holding an actor of a dependency is typed Actor, as any actor value is.
  const deps = new Set((ast.dependencies || []).map(d => d.name));
  const typeOf = (d) => !d.typeName ? 'Anything' : deps.has(d.typeName) ? 'Actor' : resolveType(d.typeName, aliasMap);
  return [
    ...cells.filter(d => !d.name.startsWith('@')).map(d => `~${d.name} ${d.isRef ? '*' : '&'}${typeOf(d)}`),
    ...functions.filter(f => !/^[@#]/.test(f.name) && !isAccessor(f)).map(f => `~${f.name} ${formatPublicFnSig(f, aliasMap, purported)}`),
  ];
}

// A class's instance doc, flat: its public members and protected ones, as the
// `*{ … }` part of its entry presents them once its parents' spreads are expanded.
function instanceDocument(ast, cls, aliasMap, purportedByActor, opts = {}) {
  const { functions, params } = instanceMembers(ast, cls, opts);
  const view = { ...cls, functions };
  const publics = [
    ...params.map(p => `${p.accessor.replace(/^@/, '')} ${p.type ? resolveType(p.type, aliasMap) : 'Anything'}`),
    ...publicMemberLines(ast, view, aliasMap, purportedByActor, 0),
  ];
  return `{\n${[...publics, ...instanceProtectedLines(ast, cls, aliasMap, purportedByActor, opts)].join('\n')}\n}`;
}

// Two types in a signature agree: the same, or either one unknown.
const sameType = (a, b) => !a || !b || a === b || a === 'Anything' || b === 'Anything';

// ── The service document ─────────────────────────────────────────────────────
//
// The file's Opre service document (notes/opre-type-encoding-2026-11-21.md): its
// interface as the compiler reads one (the shape parseInterface gives), built from
// the AST with each type as the file names it, then encoded (src/service_doc.js).
// A synthesized name (a closure's `@0`) is reached through a function value, typed
// where the value is, so it is no op of the service's.

const SYNTHESIZED = /^@(\d+$|__)/;

function shapeParam(p) {
  const optional = !!(p.defaultValue || p.optional);
  return { name: p.positional ? null : (p.key || p.name), type: p.type || 'Anything', positional: !!p.positional, ...(optional && { optional }) };
}

function fnShape(fn, purported) {
  const params = fn.params.map(shapeParam);
  if (fn.body.some(stmt => stmt.type === 'SilentTerminator')) return { params, returns: null, effect: 'write', noReply: true };
  const effect = fn.name.endsWith('!') ? 'write' : purported?.has(fn.name) ? 'purported' : 'read';
  const { alternatives, orSelf } = returnShapes(fn);
  const slots = (alt) => alt.map(({ name, type }) => ({ name, type: unionMembers(type).join(' | '), positional: name === null }));
  const shapes = alternatives.map(slots);
  return {
    params, returns: shapes[0] ?? null, effect,
    ...(orSelf && { returnsSelf: true }),
    ...(shapes.length > 1 && { returnAlternatives: shapes }),
  };
}

// A public cell `@name`: its type, and whether it is read-only. Null for anything else.
function cellShape(actor, getters, setters) {
  if (getters.length !== 1 || setters.length > 1) return null;
  const [getter] = getters;
  if (setters.length === 1) {
    const type = reactiveCellType(getter, setters[0], new Map());
    return type ? { type, readOnly: false } : null;
  }
  if (!getter.cellGetter) return null;
  const field = getter.body.find(s => s.type === 'Reply')?.fields?.[0];
  return field?.type ? { type: field.type, readOnly: true } : null;
}

const addFn = (doc, name, sig, untracked = false) => {
  (doc[name] ??= []).push(sig);
  if (untracked) (doc.__untracked ??= []).push(name);
};
const addField = (doc, name, { type, cell, readOnly }, untracked = false) => {
  (doc[name] ??= []).push({ params: [], returns: [{ name: null, type, positional: true }] });
  (doc.__fields ??= {})[name] = { type, cell, readOnly };
  if (untracked) (doc.__untracked ??= []).push(name);
};
const addSetter = (doc, name, type) => {
  (doc.__setters ??= []).push({ name, type });
  (doc.__fields ??= {})[name] = { type, cell: true, writeOnly: true };
};
const docNames = (doc) => new Set([...Object.keys(doc).filter(k => !k.startsWith('__')), ...Object.keys(doc.__fields || {}), ...Object.keys(doc.__services || {})]);

// Copies `from`'s entries whose names `into` doesn't have.
function inherit(into, from) {
  const have = docNames(into);
  for (const name of docNames(from)) {
    if (have.has(name)) continue;
    if (from[name]) into[name] = from[name];
    if (from.__fields?.[name]) (into.__fields ??= {})[name] = from.__fields[name];
    if (from.__services?.[name]) (into.__services ??= {})[name] = from.__services[name];
    if (from.__untracked?.includes(name)) (into.__untracked ??= []).push(name);
    for (const st of from.__setters || []) if (st.name === name) (into.__setters ??= []).push(st);
  }
  return into;
}

const typeDeclShape = (decl) => ({
  fields: (decl.fields || []).map(f => (/=>\s*\.\s*$/.test(f.paramType || '') && f.named ? { ...f, name: `${f.name}.` } : f)),
});

// An actor's public members (src/singleton_classes.js has the singletons).
function publicMembersShape(ast, actor, purportedByActor, doc = {}) {
  const purported = purportedByActor.get(actor);
  const grouped = new Map();
  for (const fn of actor.functions) {
    if (!fn.name || SYNTHESIZED.test(fn.name)) continue;
    const isGetter = fn.name.startsWith('@');
    const isSetter = fn.name.startsWith('set@');
    if (!isGetter && !isSetter) continue;
    const bare = fn.name.replace(/^set@|^@/, '');
    if (!grouped.has(bare)) grouped.set(bare, { getters: [], setters: [] });
    (isGetter ? grouped.get(bare).getters : grouped.get(bare).setters).push(fn);
  }
  for (const [bare, { getters, setters }] of grouped) {
    const cell = cellShape(actor, getters, setters);
    if (cell) { addField(doc, bare, { ...cell, cell: true }, !!untrackedPrefix(actor, '@' + bare)); continue; }
    const singleton = getters.length === 1 && singletonIn(ast, actor, '@' + bare);
    if (singleton) { (doc.__services ??= {})[bare] = singletonShape(ast, singleton, purportedByActor); continue; }
    for (const fn of getters) addFn(doc, bare, fnShape(fn, purported), !!fn.untracked);
    for (const fn of setters) addSetter(doc, bare, fn.params[0]?.type || 'Anything');
  }
  return doc;
}

// A public singleton, or a class block: a document of its own.
function singletonShape(ast, cls, purportedByActor) {
  const doc = {};
  for (const decl of ownTypes(ast, cls)) (doc.__typeDecls ??= {})[decl.bareName ?? decl.name] = typeDeclShape(decl);
  if (!cls.membersOf) return publicMembersShape(ast, cls, purportedByActor, doc);
  blockPublicShape(ast, cls, purportedByActor, doc);
  const prot = protectedShape(ast, cls, purportedByActor);
  if (docNames(prot).size) doc.__protected = prot;
  return doc;
}

// A class block's public members, composite: its own, then those of the block it
// extends that it doesn't define.
function blockPublicShape(ast, block, purportedByActor, doc = {}) {
  publicMembersShape(ast, { ...block, functions: (block.functions || []).filter(f => !f.inheritedFrom) }, purportedByActor, doc);
  const parent = block.blockParent && ast.actors.find(a => a.name === block.blockParent);
  if (parent) inherit(doc, blockPublicShape(ast, parent, purportedByActor));
  else if (block.remoteBase) inherit(doc, { ...block.remoteBase.doc, __protected: undefined, __types: undefined, __typeDecls: undefined });
  return doc;
}

// A class block's protected functions and cells, composite; then what a parent in
// another file gives it.
function protectedShape(ast, block, purportedByActor) {
  const { fns, cells } = protectedMembers(ast, block);
  const purported = purportedByActor.get(block);
  const doc = {};
  for (const d of cells.values()) addField(doc, `~${d.name}`, { type: d.typeName || 'Anything', cell: true, readOnly: !d.isRef });
  for (const [name, clauses] of fns) for (const f of clauses) addFn(doc, `~${name}`, fnShape(f, purported));
  let top = block;
  const byName = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  while (top.blockParent && byName.get(top.blockParent)) top = byName.get(top.blockParent);
  if (top.remoteBase?.doc.__protected) inherit(doc, top.remoteBase.doc.__protected);
  return doc;
}

// What a class's instances present to an extender beyond their public members.
function instanceProtectedShape(ast, cls, purportedByActor, opts) {
  const { functions, cells } = instanceMembers(ast, cls, opts);
  const purported = purportedByActor.get(cls);
  const isAccessor = (f) => f.cellGetter || /^(set|update|subscribe|new)[@.#]/.test(f.name);
  const deps = new Set((ast.dependencies || []).map(d => d.name));
  const typeOf = (d) => !d.typeName ? 'Anything' : deps.has(d.typeName) ? 'Actor' : d.typeName;
  const doc = {};
  for (const d of cells.filter(d => !d.name.startsWith('@'))) addField(doc, `~${d.name}`, { type: typeOf(d), cell: true, readOnly: !d.isRef });
  for (const f of functions.filter(f => !/^[@#]/.test(f.name) && !isAccessor(f))) addFn(doc, `~${f.name}`, fnShape(f, purported));
  return doc;
}

function classShape(ast, actor, privateClasses, purportedByActor) {
  const name = (actor.sourceName ?? actor.name).replace(/^@/, '');
  const flat = withPrivateSupers(actor, privateClasses, purportedByActor);
  const supertypes = (flat.supertypes || []).map(st => ({ supertype: (st.sourceName ?? st.supertype).replace(/^@/, '') }));
  const ownNew = !supertypes.length || (flat.params || []).length > 0 || buildsBase(actor);
  const inst = {};
  for (const p of flat.initParams || []) if (p.accessor) addField(inst, p.accessor, { type: p.type || 'Anything', cell: false, readOnly: true });
  const setterOf = (fnName) => (flat.functions || []).filter(f => f.name === 'set' + fnName);
  for (const fn of (flat.functions || []).filter(f => f.name?.startsWith('@') && !SYNTHESIZED.test(f.name))) {
    const bare = fn.name.replace(/^@/, '');
    const cell = cellShape(flat, [fn], setterOf(fn.name));
    if (cell) { addField(inst, bare, { ...cell, cell: true }); continue; }
    const singleton = singletonIn(ast, actor, fn.name);
    if (singleton) { (inst.__services ??= {})[bare] = singletonShape(ast, singleton, purportedByActor); continue; }
    addFn(inst, bare, fnShape(fn, flat.purported));
  }
  const functions = own(inst).flatMap(n => inst[n].map(sig => ({ name: n, ...sig })));
  const setters = Object.entries(inst.__fields || {}).filter(([, f]) => f.cell && !f.readOnly).map(([n, f]) => ({ name: n, type: f.type }));
  const typeDecls = Object.fromEntries(ownTypes(ast, actor).map(d => [d.bareName ?? d.name, typeDeclShape(d)]));
  const instanceProtected = instanceProtectedShape(ast, actor, purportedByActor);
  const members = actor.membersClass ? ast.actors.find(a => a.name === actor.membersClass) : null;
  return [name, {
    effect: name.endsWith('!') ? 'write' : 'read',
    supertypes,
    initParams: (flat.params || []).map(shapeParam),
    functions,
    setters,
    ...(inst.__services && { services: inst.__services }),
    ...(inst.__fields && { fields: inst.__fields }),
    ...(Object.keys(typeDecls).length && { typeDecls }),
    ...(members && { members: singletonShape(ast, members, purportedByActor) }),
    ...(ownNew && supertypes.length && { ownNew: true }),
    ...(docNames(instanceProtected).size && { instanceProtected }),
  }];
}
const own = (doc) => Object.keys(doc).filter(k => !k.startsWith('__'));

// The file's interface, as the compiler reads one.
function serviceShape(ast) {
  const purportedByActor = purportedFunctions(ast, parseInterface);
  const privateClasses = new Map(ast.actors.filter(a => a.name && !a.name.startsWith('@')).map(a => [a.name, a]));
  const doc = {};
  for (const decl of ast.types || []) if (!decl.ownerClass) (doc.__typeDecls ??= {})[decl.bareName ?? decl.name] = typeDeclShape(decl);
  for (const actor of ast.actors) {
    if (actor.name?.startsWith('@')) {
      const [name, cls] = classShape(ast, actor, privateClasses, purportedByActor);
      (doc.__types ??= {})[name] = cls;
      continue;
    }
    if (actor.name) continue;
    for (const p of actor.initParams || []) if (p.accessor) addField(doc, p.accessor, { type: p.type || 'Anything', cell: false, readOnly: true });
    publicMembersShape(ast, actor, purportedByActor, doc);
  }
  return doc;
}

// The documents of the services a file uses, by path, for what its own says of
// them. A malformed one is reported by validation, with the context to explain it.
function remoteDocsByPath(ast, remotes) {
  const docs = {};
  const entries = Array.isArray(remotes) ? remotes.map(r => [r.path, r.service, r.params])
    : Object.entries(remotes || {}).map(([name, service]) => [(ast.dependencies || []).find(d => d.name === name)?.path ?? name, service]);
  for (const [path, service, params] of entries) {
    try { docs[path] = readRemote(service, params).doc; } catch { /* reported by validation */ }
  }
  return docs;
}

function buildServiceJson(ast, remotes) {
  return serviceDocument(serviceShape(ast), fileScope(ast, remoteDocsByPath(ast, remotes)));
}

// \`remotes\` (\`[{ path, service }]\`, as compile takes): the docs of the files this one
// uses, for what the parse needs of them (a parent class from another file).
export function extract(source, { remotes = null } = {}) {
  if (typeof source !== 'string') {
    throw new TypeError('extract expects a string');
  }
  const tokens = tokenize(source);
  const ast = parse(tokens, { remotes });
  runExtractPasses(ast);
  return {
    ast,
    interface: {
      structures: [],
      params: buildParamsDocument(ast),
      service: buildServiceDocument(ast),
      document: buildServiceJson(ast, remotes),
    },
  };
}

// The Erlang target's shared runtime, brevity_rt.erl. Every module the Erlang
// target emits imports it, so it is compiled and loaded beside them.
export function erlangRuntime() {
  return RUNTIME_MODULE;
}

export function compile(ast, options = {}) {
  settleOverrideTables(ast);
  renamePublicClasses(ast);
  validateWithSourceNames(validate, ast, options);
  const name = options.target || process.env.BREVITY_TARGET || 'js';
  const target = getTarget(name);
  if (!target) {
    throw new Error(`Unknown BREVITY_TARGET: '${name}'. Valid targets: ${getTargetNames().join(', ')}`);
  }
  return target.codegen(ast, options);
}
