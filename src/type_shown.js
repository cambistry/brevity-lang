// A type as a message shows it: as the source writes it, from its encoding
// (src/type_enc.js). A class of this file by its name (`W::V`), a type reached
// through a dependency by the dependency's alias (`Svc::Point`), a List of
// anything as `List`. A type with no encoding (a constructor profile, an
// interface) is shown from its type tree.

import { show, ownNames } from './type_enc.js';
import { renderType } from './type_tree.js';
import { _opre_quote as quote, _opre_split as split } from './codegen/opre_tokens.js';

// Each dependency's address, and each name one binds, by the alias the file gives it.
export function dependencyAliases(ast) {
  const byAddress = new Map();
  for (const d of ast?.dependencies || []) {
    if (d.type !== 'Dependency' || !d.path) continue;
    if (!d.destructures) byAddress.set(quote(d.path), d.name);
    for (const { local, remote } of d.destructures || []) if (remote) byAddress.set(`${quote(d.path)}:${quote(remote)}`, local);
  }
  return byAddress;
}

// An address as the source names it.
export function addressShown(a, aliases = null) {
  const own = ownNames(a);
  if (own) return own.join('::');
  const bare = a.replace(/:\*$/, '');
  const alias = aliases?.get(bare);
  if (alias) return alias;
  let tokens;
  try { tokens = split(bare); } catch { return a; }
  for (let n = tokens.length - 1; n > 0; n--) {
    const head = aliases?.get(tokens.slice(0, n).map(quote).join(':'));
    if (head) return [head, ...tokens.slice(n)].join('::');
  }
  return tokens.join('::');
}

// `t` as a message shows it. `aliases` from dependencyAliases.
export const typeShown = (t, aliases = null) => show(t, (a) => addressShown(a, aliases), { bareList: true });

// The type a node holds under `key` (`type`, `typeName`, …), as a message shows it;
// `Anything` when it has none.
export function nodeTypeShown(node, key = 'type', aliases = null) {
  if (node?.[`${key}Tree`]) return renderType(node[`${key}Tree`]);
  return typeShown(node?.[`${key}Enc`], aliases);
}
