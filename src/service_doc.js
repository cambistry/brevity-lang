// The Opre service document (notes/opre-type-encoding-2026-11-21.md, "The
// document"): a tree of addresses, each node listing the ops it takes (`public`,
// `protected`), the types it declares (`types`), and its nested addresses under
// keys with a leading colon.
//
// `interfaceNode` builds a node from an interface as the compiler reads one
// (the shape parseInterface gives, src/codegen/javascript/types.js), its types
// encoded by src/opre_types.js.

import { encodeTypeText, encodeEntries, cellNode, SELF } from './opre_types.js';
import { parseTypeTree } from './parser.js';

const WRITES = { read: false, write: true };
const own = (o) => Object.keys(o || {}).filter(k => !k.startsWith('__'));
const typeOf = (text, scope) => (text ? encodeTypeText(text, scope) : 'Anything');

// A list of fields as an entry list: `[{ name, type, positional, optional }]`.
function entries(fields, scope) {
  return encodeEntries((fields || []).map(f => ({
    name: f.positional === false || (f.positional === undefined && f.name) ? f.name : null,
    type: f.type ? parseTypeTree(f.type) : null,
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
      name: f.named ? f.name : null, type: f.paramType ? parseTypeTree(f.paramType) : null, optional: f.optional,
    })), scope);
  }
  return out;
}

// A class's node: `$new`, its class block's ops beside it, its instances under `:*`.
function classNode(name, cls, scope) {
  const node = {};
  if (cls.supertypes?.length) node.extends = cls.supertypes.map(st => scope.resolve(st.supertype.split('::'), { asClass: true }));
  const block = cls.members ? interfaceNode(cls.members, scope) : {};
  const newSig = { ...(cls.initParams?.length && { args: entries(cls.initParams, scope) }), re: [scope.resolve([name])] };
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
