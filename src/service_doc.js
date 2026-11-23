// The Opre service document (notes/opre-type-encoding-2026-11-21.md, "The
// document"): a tree of addresses, each node listing the ops it takes (`public`,
// `protected`), the types it declares (`types`), and its nested addresses under
// keys with a leading colon.
//
// `interfaceNode` builds a node from an interface as the compiler reads one
// (the shape parseInterface gives, src/codegen/javascript/types.js), its types
// encoded by src/opre_types.js.

import { cellNode, typeScope, SELF } from './opre_types.js';
import { intern, translate } from './type_enc.js';
import { _opre_quote as quote } from './codegen/opre_tokens.js';

const WRITES = { read: false, write: true };
const own = (o) => Object.keys(o || {}).filter(k => !k.startsWith('__'));
// A record's encoded type (`typeEnc`); `Anything` when it has no type. One with a
// type's text and no encoding is the compiler's mistake, never `Anything`.
const encOf = (r) => {
  if (r?.typeEnc !== undefined) return r.typeEnc;
  if (r?.type && r.type !== 'Anything') throw new Error(`Compiler bug: the type '${r.type}' has no encoding`);
  return 'Anything';
};

// Entries already encoded as an entry list: positional ones as items, named ones in
// one object after them.
export function entryList(items) {
  const out = [];
  let named = null;
  for (const { name, enc, optional } of items) {
    const t = optional ? { '%opt': enc } : enc;
    if (name == null) out.push(t);
    else (named ??= {})[name] = t;
  }
  if (named) out.push(named);
  return intern(out);
}

// A list of fields as an entry list: `[{ name, typeEnc, positional, optional }]`.
function entries(fields) {
  return entryList((fields || []).map(f => ({
    name: f.positional === false || (f.positional === undefined && f.name) ? f.name : null,
    enc: encOf(f),
    optional: f.optional,
  })));
}

function signature(s, scope, { untracked = false } = {}) {
  const sig = {};
  if (s.params?.length) sig.args = entries(s.params);
  if (s.returnAlternatives?.length || (s.returnsSelf && s.returns)) {
    const shapes = (s.returnAlternatives ?? [s.returns]).map(r => entries(r));
    sig.re = { '%or': [...shapes, ...(s.returnsSelf ? [[SELF]] : [])] };
  } else if (s.returnsSelf) sig.re = [SELF];
  else if (!s.noReply) sig.re = s.returns ? entries(s.returns) : [];
  const writes = s.effect === undefined ? false : WRITES[s.effect];
  if (writes !== undefined) sig.writes = untracked && writes ? 'untracked' : writes;
  return sig;
}

// The ops and cells of one section (public or protected) of an interface.
function section(doc, scope, node, sectionName, untracked = new Set()) {
  const ops = {};
  for (const name of own(doc)) {
    const field = doc.__fields?.[name];
    if (field && !field.writeOnly) {
      const type = encOf(field);
      ops[name] = [{ re: [type], writes: false }];
      if (field.cell) node[`:${name}`] = cellNode(type, { readOnly: field.readOnly, untracked: untracked.has(name) });
      continue;
    }
    ops[name] = doc[name].map(s => signature(s, scope, { untracked: untracked.has(name) }));
  }
  for (const [name, field] of Object.entries(doc.__fields || {})) {
    if (field.writeOnly) node[`:${name}`] = { public: { $set: [{ args: [encOf(field)], writes: true }] } };
  }
  if (Object.keys(ops).length) node[sectionName] = { ...node[sectionName], ...ops };
}

// A declared type's fields, as an entry list. A positional field is read by its
// name too (`p.x`), so the names of the positional ones, in order, are its
// `%names`, in the object of its named entries.
function typesOf(typeDecls) {
  const out = {};
  for (const [name, { fields }] of Object.entries(typeDecls || {})) {
    const list = [...entryList((fields || []).map(f => ({
      name: f.named ? f.name : null, enc: f.paramTypeEnc ?? 'Anything', optional: f.optional,
    })))];
    const names = (fields || []).filter(f => !f.named).map(f => f.name);
    if (names.length) {
      const last = list[list.length - 1];
      if (isEntryObject(last)) list[list.length - 1] = { ...last, '%names': names };
      else list.push({ '%names': names });
    }
    out[`:${name}`] = list;
  }
  return out;
}

// A class's node: `$new`, its class block's ops beside it, its instances under `:*`.
function classNode(name, cls, outer) {
  const node = {};
  const scope = outer.within(name);
  if (cls.supertypes?.length) node.extends = cls.supertypes.map(st => outer.resolve(st.supertype.split('::'), { asClass: true }));
  const block = cls.members ? interfaceNode(cls.members, scope) : {};
  // Its instances are the `:*` under it.
  const newSig = { ...(cls.initParams?.length && { args: entries(cls.initParams) }), re: [`:${quote(name)}:*`] };
  const writes = cls.effect === undefined ? false : WRITES[cls.effect];
  if (writes !== undefined) newSig.writes = writes;
  node.public = { $new: [newSig], ...block.public };
  if (block.protected) node.protected = block.protected;
  const types = { ...typesOf(cls.typeDecls), ...block.types };
  if (Object.keys(types).length) node.types = types;
  for (const k of Object.keys(block).filter(k => k.startsWith(':'))) node[k] = block[k];
  const inst = {};
  const instDoc = {};
  for (const f of cls.functions || []) (instDoc[f.name] ??= []).push(f);
  if (cls.fields) instDoc.__fields = cls.fields;
  for (const s of cls.setters || []) if (!cls.fields?.[s.name]) (instDoc.__fields ??= {})[s.name] = { type: s.type, typeEnc: s.typeEnc, cell: true, writeOnly: true };
  section(instDoc, scope, inst, 'public');
  if (cls.instanceProtected) section(cls.instanceProtected, scope, inst, 'protected');
  for (const [sub, svc] of Object.entries(cls.services || {})) inst[`:${sub}`] = interfaceNode(svc, scope);
  node[':*'] = inst;
  return node;
}

export function interfaceNode(doc, scope) {
  const node = {};
  section(doc, scope, node, 'public', new Set(doc.__untracked || []));
  // `$as` takes the type to convert to, and replies the value as it: one signature
  // per type, its arg the type of its reply.
  if (doc.__asTypesEnc?.length) node.public = { ...node.public, $as: doc.__asTypesEnc.map(t => ({ re: [t], writes: false })) };
  if (doc.__protected) section(doc.__protected, scope, node, 'protected');
  const types = typesOf(doc.__typeDecls);
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
  // A class with no constructor of its own takes its parents' params.
  const at = nodeAt(root);
  const done = new Set();
  const inheritNew = (name, cls) => {
    const node = root[`:${name}`];
    if (done.has(node)) return;
    done.add(node);
    const parents = (node.extends || []).map(a => [a, at(a)]).filter(([, p]) => p);
    for (const [a] of parents) if (parsed.__types?.[a.slice(1)]) inheritNew(a.slice(1), parsed.__types[a.slice(1)]);
    if (parents.length && !cls.ownNew && !cls.initParams?.length) {
      const args = mergeEntries(parents.map(([, p]) => p.public?.$new?.[0]?.args || []));
      if (args.length) node.public.$new = node.public.$new.map(s => orderSig({ ...s, args }));
    }
  };
  for (const [name, cls] of Object.entries(parsed.__types || {})) inheritNew(name, cls);
  return expandInheritance(root);
}

const nodeAt = (root) => (address) => (address.startsWith(':') ? address.slice(1).split(':').reduce((n, seg) => n?.[`:${seg}`], root) : null);

// Each class's instances with what they inherit from a parent in the document:
// its parents' instance ops it doesn't define, and their cells.
export function expandInheritance(root) {
  const at = nodeAt(root);
  const done = new Set();
  const expand = (node) => {
    if (done.has(node)) return;
    done.add(node);
    const parents = (node.extends || []).map(at).filter(Boolean);
    parents.forEach(expand);
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
  };
  for (const [key, node] of Object.entries(root)) if (key.startsWith(':') && node.public?.$new) expand(node);
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

// ── Reading a document ───────────────────────────────────────────────────────
//
// A service's published document, as the compiler reads an interface: the shape
// parseInterface gives (src/codegen/javascript/types.js), each type as the service
// names it (`:Point` is `Point`, `:T:*` an instance of its class `T`).

const PLURAL_OF = new Map([['Integer', 'Integers'], ['Text', 'Texts'], ['Float', 'Floats'], ['Boolean', 'Booleans'], ['Blob', 'Blobs'], ['Decimal', 'Decimals']]);
const isEntryObject = (v) => v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).some(k => k.startsWith('%'));

// An address in the document as a type name of the service's.
function addressName(address) {
  if (!address.startsWith(':')) {
    if (address.includes(':')) throw new Error(`A type from another service ('${address}') in a service document isn't supported yet`);
    return address;
  }
  const segs = address.slice(1).split(':');
  if (segs[segs.length - 1] === '*') segs.pop();
  return segs.join('::');
}

// A generic's element, after `of`: a plural for "any number of".
function elementText(param) {
  if (!Array.isArray(param)) return typeText(param);
  const [inner] = param;
  if (typeof inner === 'string' && PLURAL_OF.has(inner)) return PLURAL_OF.get(inner);
  if (Array.isArray(inner) && inner[inner.length - 1]?.['%t'] === 'List') return `Lists of ${elementText(inner[0])}`;
  return typeText(inner);
}

export function typeText(t) {
  if (t === null) return 'null';
  if (typeof t === 'string') return addressName(t);
  if (Array.isArray(t)) {
    const tag = t[t.length - 1];
    if (!tag || typeof tag !== 'object' || !('%t' in tag)) throw new Error(`A type list ends in its '%t' entry: ${JSON.stringify(t)}`);
    const { '%t': name, ...named } = tag;
    const items = t.slice(0, -1);
    if (name === 'Object') return `(${fieldsText(decodeEntries([...items, ...(Object.keys(named).length ? [named] : [])]))})`;
    if (items.length !== 1 || Object.keys(named).length) throw new Error(`'${name}' takes one parameter in Brevity: ${JSON.stringify(t)}`);
    return `${addressName(name)} of ${elementText(items[0])}`;
  }
  if ('%or' in t) return t['%or'].map(typeText).join(' | ');
  if ('%fn' in t) return fnText(t['%fn'][0]);
  throw new Error(`Unrecognized type in a service document: ${JSON.stringify(t)}`);
}

const fieldsText = (fields) => fields.map(f => `${f.optional ? '? ' : ''}${f.positional ? f.type : `${f.name}: ${f.type}`}`).join(', ');
const ARROW = (writes) => (writes === false ? '->' : writes === undefined ? '~>' : '=>');
const isSelf = (shape) => shape.length === 1 && shape[0]?.['%self'] === true;

function fnText(sig) {
  const args = `(${fieldsText(decodeEntries(sig.args || []))})`;
  if (!sig.re) return `${args} => .`;
  const shapes = Array.isArray(sig.re) ? [sig.re] : sig.re['%or'];
  const self = shapes.some(isSelf);
  const values = shapes.filter(s => !isSelf(s)).map(s => `(${fieldsText(decodeEntries(s))})`);
  return `${args} ${ARROW(sig.writes)} ${[...values, ...(self ? ['self'] : [])].join(' | ')}`;
}

const isCell = (node) => node?.public?.$get && Object.keys(node.public).every(k => k === '$get' || k === '$set');

// An entry list as fields: `[{ name, type, positional, optional }]`.
function decodeEntries(list) {
  const fields = [];
  const one = (name, t) => {
    const optional = t && typeof t === 'object' && '%opt' in t;
    const bare = optional ? t['%opt'] : t;
    fields.push({ name, type: typeText(bare), typeEnc: intern(bare), positional: name === null, ...(optional && { optional: true }) });
  };
  for (const e of list) {
    if (isEntryObject(e)) for (const [k, v] of Object.entries(e)) one(k, v);
    else one(null, e);
  }
  return fields;
}

const EFFECT = (writes) => (writes === false ? 'read' : writes === undefined ? 'purported' : 'write');

function decodeSignature(sig) {
  const out = { params: decodeEntries(sig.args || []), returns: null, effect: EFFECT(sig.writes) };
  // No `re`: the op never replies. Its name has no say in it. With nothing to
  // read, it is called for what it writes.
  if (!sig.re) {
    if (sig.writes !== true && sig.writes !== 'untracked') throw new Error(`A signature with no 're' never replies, so it has nothing to read: its 'writes' is true, not ${JSON.stringify(sig.writes)}`);
    return { ...out, noReply: true, silent: true };
  }
  const shapes = Array.isArray(sig.re) ? [sig.re] : sig.re['%or'];
  const values = shapes.filter(s => !isSelf(s)).map(decodeEntries);
  if (shapes.some(isSelf)) out.returnsSelf = true;
  if (values.length) out.returns = values.length === 1 && !values[0].length && !out.returnsSelf ? null : values[0];
  if (values.length > 1) out.returnAlternatives = values;
  return out;
}

// One section's ops, into `doc`; a cell is the op of its name with a node of its own.
function readSection(ops, node, doc) {
  for (const [op, sigs] of Object.entries(ops || {})) {
    const child = node[`:${op}`];
    if (isCell(child)) {
      const enc = intern(child.public.$get[0].re[0]);
      const type = typeText(enc);
      (doc[op] ??= []).push({ params: [], returns: [{ name: null, type, typeEnc: enc, positional: true }] });
      (doc.__fields ??= {})[op] = { type, typeEnc: enc, cell: true, readOnly: !child.public.$set };
      if (child.public.$set?.[0]?.writes === 'untracked') (doc.__untracked ??= []).push(op);
      continue;
    }
    doc[op] = sigs.map(decodeSignature);
    if (sigs.some(s => s.writes === 'untracked')) (doc.__untracked ??= []).push(op);
  }
}

function readTypes(types) {
  return Object.fromEntries(Object.entries(types || {}).map(([key, list]) => {
    const last = list[list.length - 1];
    const names = last && typeof last === 'object' && !Array.isArray(last) ? last['%names'] || [] : [];
    let entries = list;
    if (names.length) {
      const named = Object.fromEntries(Object.entries(last).filter(([k]) => k !== '%names'));
      entries = [...list.slice(0, -1), ...(Object.keys(named).length ? [named] : [])];
    }
    let i = 0;
    // A silent-function field is named with its silent `.`, stored without it.
    const bare = (name, type) => (name?.endsWith('.') && /=>\s*\.\s*$/.test(type) ? name.slice(0, -1) : name);
    const fields = decodeEntries(entries).map(f => ({
      type: 'TypeField', name: bare(f.positional ? names[i++] : f.name, f.type), paramType: f.type, paramTypeEnc: f.typeEnc,
      ...(f.optional && { optional: true }), ...(!f.positional && { named: true }),
    }));
    return [key.slice(1), { fields }];
  }));
}

export function documentShape(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error(`A node of a service document is an object, not ${JSON.stringify(node)}`);
  const doc = {};
  const { $as, ...ops } = node.public || {};
  readSection(ops, node, doc);
  if ($as) doc.__asTypes = $as.map(s => typeText(s.re[0]));
  if (node.protected) {
    const prot = {};
    readSection(node.protected, node, prot);
    doc.__protected = prot;
  }
  if (node.types) doc.__typeDecls = readTypes(node.types);
  for (const key of Object.keys(node).filter(k => k.startsWith(':') && k !== ':*')) {
    const name = key.slice(1);
    const child = node[key];
    if (doc.__fields?.[name] || doc.__protected?.__fields?.[name]) continue;
    if (child.public?.$new) (doc.__types ??= {})[name] = readClass(child);
    else if (child.public?.$set && Object.keys(child.public).length === 1) {
      const enc = intern(child.public.$set[0].args[0]);
      const type = typeText(enc);
      (doc.__setters ??= []).push({ name, type, typeEnc: enc });
      (doc.__fields ??= {})[name] = { type, typeEnc: enc, cell: true, writeOnly: true };
    } else (doc.__services ??= {})[name] = documentShape(child);
  }
  return doc;
}

function readClass(node) {
  const { $new: [newSig], ...blockOps } = node.public;
  const nu = decodeSignature(newSig);
  const inst = documentShape(node[':*'] || {});
  // A published param reads as an op of its name and type, taking nothing.
  for (const p of nu.params) {
    const sigs = inst[p.name];
    if (p.positional || inst.__fields?.[p.name] || sigs?.length !== 1 || sigs[0].params.length || sigs[0].returns?.[0]?.type !== p.type) continue;
    (inst.__fields ??= {})[p.name] = { type: p.type, typeEnc: p.typeEnc, cell: false, readOnly: true };
  }
  const functions = Object.keys(inst).filter(k => !k.startsWith('__')).flatMap(name => inst[name].map(s => ({ name, ...s })));
  const setters = Object.entries(inst.__fields || {}).filter(([, f]) => f.cell && !f.readOnly).map(([name, f]) => ({ name, type: f.type, typeEnc: f.typeEnc }));
  const block = { public: blockOps, ...(node.protected && { protected: node.protected }) };
  for (const k of Object.keys(node).filter(k => k.startsWith(':') && k !== ':*')) block[k] = node[k];
  const hasBlock = Object.keys(blockOps).length || node.protected;
  return {
    effect: nu.effect,
    supertypes: (node.extends || []).map(a => ({ supertype: addressName(a) })),
    initParams: nu.params,
    functions,
    setters,
    ...(inst.__services && { services: inst.__services }),
    ...(inst.__fields && { fields: inst.__fields }),
    ...(node.types && { typeDecls: readTypes(node.types) }),
    ...(hasBlock && { members: documentShape(block) }),
    ...(node.extends?.length && { ownNew: true }),
    ...(inst.__protected && { instanceProtected: inst.__protected }),
  };
}

// The document of the service at `path`, as this file reads it: each type's
// encoding in this file's terms (src/type_enc.js, translate). Its text stays as the
// service writes it.
export function readDocument(node, path) {
  const doc = documentShape(node);
  if (!path) return doc;
  const from = quote(path);
  const seen = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object' || Object.isFrozen(v) || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach(walk); return; }
    for (const [k, x] of Object.entries(v)) {
      if (k.endsWith('Enc')) v[k] = translate(x, from);
      else walk(x);
    }
  };
  walk(doc);
  return doc;
}
