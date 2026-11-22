// The Opre service document (notes/opre-type-encoding-2026-11-21.md, "The
// document"): a tree of addresses, each node listing the ops it takes (`public`,
// `protected`), the types it declares (`types`), and its nested addresses under
// keys with a leading colon.
//
// `interfaceNode` builds a node from an interface as the compiler reads one
// (the shape parseInterface gives, src/codegen/javascript/types.js), its types
// encoded by src/opre_types.js.

import { encodeType, encodeEntries, cellNode, typeScope, SELF } from './opre_types.js';
import { TT } from './type_tree.js';
import { parseTypeTree } from './parser.js';

const WRITES = { read: false, write: true };
const own = (o) => Object.keys(o || {}).filter(k => !k.startsWith('__'));
// A type as the compiler names it: the type grammar's, or `null`, the type of the
// `null` literal.
const tree = (text) => (text === 'null' ? TT.null() : parseTypeTree(text));
const typeOf = (text, scope) => (text ? encodeType(tree(text), scope) : 'Anything');

// A list of fields as an entry list: `[{ name, type, positional, optional }]`.
function entries(fields, scope) {
  return encodeEntries((fields || []).map(f => ({
    name: f.positional === false || (f.positional === undefined && f.name) ? f.name : null,
    type: f.type ? tree(f.type) : null,
    optional: f.optional,
  })), scope);
}

function signature(s, scope, { untracked = false } = {}) {
  const sig = {};
  if (s.params?.length) sig.args = entries(s.params, scope);
  if (s.returnAlternatives?.length || (s.returnsSelf && s.returns)) {
    const shapes = (s.returnAlternatives ?? [s.returns]).map(r => entries(r, scope));
    sig.re = { '%or': [...shapes, ...(s.returnsSelf ? [[SELF]] : [])] };
  } else if (s.returnsSelf) sig.re = [SELF];
  else if (!s.noReply) sig.re = s.returns ? entries(s.returns, scope) : [];
  const writes = s.effect === undefined ? false : WRITES[s.effect];
  if (writes !== undefined) sig.writes = untracked && writes ? 'untracked' : writes;
  return sig;
}

// The ops and cells of one section (public or protected) of an interface.
function section(doc, scope, node, sectionName, untracked = new Set()) {
  const ops = {};
  for (const name of own(doc)) {
    const field = doc.__fields?.[name];
    if (field?.writeOnly) continue;
    if (field) {
      const type = typeOf(field.type, scope);
      ops[name] = [{ re: [type], writes: false }];
      if (field.cell) node[`:${name}`] = cellNode(type, { readOnly: field.readOnly, untracked: untracked.has(name) });
      continue;
    }
    ops[name] = doc[name].map(s => signature(s, scope, { untracked: untracked.has(name) }));
  }
  for (const [name, field] of Object.entries(doc.__fields || {})) {
    if (field.writeOnly) node[`:${name}`] = { public: { $set: [{ args: [typeOf(field.type, scope)], writes: true }] } };
  }
  if (Object.keys(ops).length) node[sectionName] = { ...node[sectionName], ...ops };
}

function typesOf(typeDecls, scope) {
  const out = {};
  for (const [name, { fields }] of Object.entries(typeDecls || {})) {
    out[`:${name}`] = encodeEntries((fields || []).map(f => ({
      name: f.named ? f.name : null, type: f.paramType ? tree(f.paramType) : null, optional: f.optional,
    })), scope);
  }
  return out;
}

// A class's node: `$new`, its class block's ops beside it, its instances under `:*`.
function classNode(name, cls, outer) {
  const node = {};
  const scope = outer.within(name);
  if (cls.supertypes?.length) node.extends = cls.supertypes.map(st => outer.resolve(st.supertype.split('::'), { asClass: true }));
  const block = cls.members ? interfaceNode(cls.members, scope) : {};
  const newSig = { ...(cls.initParams?.length && { args: entries(cls.initParams, scope) }), re: [outer.resolve([name])] };
  const writes = cls.effect === undefined ? false : WRITES[cls.effect];
  if (writes !== undefined) newSig.writes = writes;
  node.public = { $new: [newSig], ...block.public };
  if (block.protected) node.protected = block.protected;
  const types = { ...typesOf(cls.typeDecls, scope), ...block.types };
  if (Object.keys(types).length) node.types = types;
  for (const k of Object.keys(block).filter(k => k.startsWith(':'))) node[k] = block[k];
  const inst = {};
  const instDoc = {};
  for (const f of cls.functions || []) (instDoc[f.name] ??= []).push(f);
  if (cls.fields) instDoc.__fields = cls.fields;
  for (const s of cls.setters || []) if (!cls.fields?.[s.name]) (instDoc.__fields ??= {})[s.name] = { type: s.type, cell: true, writeOnly: true };
  section(instDoc, scope, inst, 'public');
  if (cls.instanceProtected) section(cls.instanceProtected, scope, inst, 'protected');
  for (const [sub, svc] of Object.entries(cls.services || {})) inst[`:${sub}`] = interfaceNode(svc, scope);
  node[':*'] = inst;
  return node;
}

export function interfaceNode(doc, scope) {
  const node = {};
  section(doc, scope, node, 'public', new Set(doc.__untracked || []));
  if (doc.__protected) section(doc.__protected, scope, node, 'protected');
  const types = typesOf(doc.__typeDecls, scope);
  if (Object.keys(types).length) node.types = types;
  for (const [name, svc] of Object.entries(doc.__services || {})) node[`:${name}`] = interfaceNode(svc, scope);
  for (const [name, cls] of Object.entries(doc.__types || {})) node[`:${name}`] = classNode(name, cls, scope);
  return orderNode(node);
}

// `extends`, `public`, `protected`, `types`, then nested addresses.
function orderNode(node) {
  const out = {};
  for (const k of ['extends', 'public', 'protected', 'types']) if (node[k]) out[k] = node[k];
  for (const k of Object.keys(node)) if (k.startsWith(':')) out[k] = node[k];
  return out;
}

// The names of a file's types, classes and dependencies, for its addresses.
// `remotes` (`[{ path, service }]`, parsed) says which names a dependency binds
// are classes.
export function fileScope(ast, remoteDocs = {}) {
  const services = {};
  const bindings = {};
  for (const d of ast.dependencies || []) {
    if (d.type !== 'Dependency' || !d.path) continue;
    if (!d.destructures) { services[d.name] = d.path; continue; }
    for (const { local, remote } of d.destructures) {
      bindings[local] = { address: `${d.path}:${remote}`, isClass: !!remoteDocs[d.path]?.__types?.[remote] };
    }
  }
  const isClass = (a) => a.name && !a.singletonOf && !a.membersOf && !a.remoteStub;
  return typeScope({
    types: (ast.types || []).map(t => t.name),
    classes: (ast.actors || []).filter(isClass).map(a => a.sourceName ?? a.name),
    services,
    bindings,
    serviceClasses: (path, rest) => {
      let doc = remoteDocs[path];
      for (const seg of rest.slice(0, -1)) doc = doc?.__types?.[seg]?.members ?? doc?.__services?.[seg];
      return !!doc?.__types?.[rest[rest.length - 1]];
    },
  });
}

// A file's published document: the node of its service, each class's instances
// with what they inherit from a parent in this file, a class with no constructor
// of its own taking its parents' params.
export function serviceDocument(parsed, scope) {
  const root = interfaceNode(parsed, scope);
  const done = new Set();
  const at = (address) => address.startsWith(':') ? address.slice(1).split(':').reduce((n, seg) => n?.[`:${seg}`], root) : null;
  const expand = (node, cls) => {
    if (done.has(node)) return;
    done.add(node);
    const parents = (node.extends || []).map(at).filter(Boolean);
    parents.forEach(p => expand(p, null));
    const inst = node[':*'] ??= {};
    for (const p of parents) {
      const theirs = p[':*'] || {};
      for (const sec of ['public', 'protected']) {
        if (!theirs[sec]) continue;
        inst[sec] = { ...inst[sec] };
        for (const [op, sigs] of Object.entries(theirs[sec])) if (!(op in inst[sec])) inst[sec][op] = sigs;
      }
      for (const k of Object.keys(theirs)) if (k.startsWith(':') && !(k in inst)) inst[k] = theirs[k];
    }
    node[':*'] = orderNode(inst);
    if (cls && parents.length && !cls.ownNew && !cls.initParams?.length) {
      const args = mergeEntries(parents.map(p => p.public?.$new?.[0]?.args || []));
      if (args.length) node.public.$new = node.public.$new.map(s => orderSig({ ...s, args }));
    }
  };
  for (const [name, cls] of Object.entries(parsed.__types || {})) expand(root[`:${name}`], cls);
  return root;
}

// Entry lists one after another: positional entries in order, named ones in one object.
function mergeEntries(lists) {
  const pos = [];
  let named = null;
  for (const l of lists) for (const e of l) {
    if (e && typeof e === 'object' && !Array.isArray(e) && !Object.keys(e).some(k => k.startsWith('%'))) named = { ...named, ...e };
    else pos.push(e);
  }
  return named ? [...pos, named] : pos;
}

const orderSig = (s) => {
  const out = {};
  for (const k of ['args', 're', 'writes']) if (k in s) out[k] = s[k];
  return out;
};
