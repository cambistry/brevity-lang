// The types a program knows, keyed by the name the source uses for each, and the
// address that identifies each one. A type's key is its address: its authority
// followed by the classes that own it and its bare name.
//   - a type of this file:      `:Point`, `:W:X`
//   - a type of a service:      `svc.bv:Point`, `svc.bv:W:X` (the dependency's path)
// The key is the type's runtime identity (`__type`), its key in the wire
// registry, and its tag. See notes/type-keyword-and-actor-scoped-types-2026-11-13.md.
import { _opre_quote as quoteToken } from './opre_tokens.js';

// `authority` is already written; '' is self, so a local key starts with `:`.
// `owner` is the owning classes' tokens: each by its wire label, a private class
// with its `~`.
const address = (authority, owner, name) => [authority, ...[...(owner || []), name].map(quoteToken)].join(':');

// sourceName → { name, fields, owner, key, authority }. `name` is the bare name.
export function buildTypeTable(ast) {
  const table = new Map();
  const deps = new Map((ast.dependencies || []).map(d => [d.name, d]));
  const pathOf = (alias) => deps.get(alias)?.path || alias;
  for (const t of ast.types || []) {
    const name = t.bareName ?? t.name;
    table.set(t.name, { ...t, name, key: address('', t.ownerTokens ?? t.owner, name), authority: '' });
  }
  // A type destructured out of a header binds under its local name and its remote
  // one: `(Point: P)` keeps `Point` on the wire.
  for (const [local, info] of Object.entries(ast.importedTypes || {})) {
    const authority = pathOf(info.sourceAlias);
    const entry = { name: info.remote, fields: info.decl.fields, key: address(quoteToken(authority), [], info.remote), authority };
    if (!table.has(local)) table.set(local, entry);
    if (!table.has(info.remote)) table.set(info.remote, entry);
  }
  // A type reached through a service: `Svc::Point`, `Svc::W::X`.
  for (const [key, info] of Object.entries(ast.crossModuleTypes || {})) {
    const authority = info.path || '';
    const entry = { name: info.name, fields: info.fields, ...(info.owner ? { owner: info.owner } : {}), key: address(quoteToken(authority), info.owner, info.name), authority };
    if (!table.has(key)) table.set(key, entry);
  }
  return table;
}

// The wire registry: one entry per type, under its key. A tag reached through a
// dependency names it by its source (`svc.bv:Point`), never by its local alias:
// dependencies are addressed by source, so no parent spells it otherwise. Each
// entry is [lookup, key, fields].
// Two local names for one type (`Point`, `Svc::Point`) are one entry.
export function registryEntries(_ast, table) {
  const byKey = new Map();
  for (const e of table.values()) if (!byKey.has(e.key)) byKey.set(e.key, [e.key, e.key, e.fields || []]);
  return [...byKey.values()];
}
