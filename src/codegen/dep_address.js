// A dependency's wire address is its source, never its local name: `use Svc =
// "svc.bv"` is addressed as `svc.bv`, `use HTML` as `HTML`. The local name only
// binds. A source is one Opre token, quoted on the wire when it needs it
// (`'a:b.bv'`); see opre_tokens.js.
//
// A class reached through a dependency (src/public_classes.js) already carries
// its full wire address as `wireTarget` (`svc.bv:Counter`).
import { _opre_quote } from './opre_tokens.js';

export function dependencyAddressing(ast) {
  const byName = new Map((ast.dependencies || []).filter(d => d.type === 'Dependency').map(d => [d.name, d]));
  // The source, as a token for an address's token list: unquoted.
  const source = (name) => {
    const d = byName.get(name);
    return d && !d.wireTarget ? (d.path ?? d.name) : name;
  };
  // The whole address, as it goes on the wire. A name that isn't a dependency
  // is returned as it is.
  const address = (name) => {
    const d = byName.get(name);
    if (!d) return name;
    if (d.wireTarget) return d.wireTarget;
    return _opre_quote(d.path ?? d.name);
  };
  return { source, address, isDependency: (name) => byName.has(name) };
}

// Is `name`, read as a value, a dependency (not a local, a cell or a member)?
export function isDependencyValue(ctx, name, typeEnv) {
  if (!ctx.depIsDependency?.(name) || ctx.stateVarNames?.has(name)) return false;
  if (ctx.destructuredMembers?.has(name)) return false;
  return !(typeEnv && typeof typeEnv.has === 'function' && typeEnv.has(name));
}
