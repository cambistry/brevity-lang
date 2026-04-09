export function inferLiteralType(expr) {
  if (!expr) return null;
  if (expr.type === 'IntLiteral')     return 'Integer';
  if (expr.type === 'StringLiteral')  return 'Text';
  if (expr.type === 'DecimalLiteral') return 'Decimal';
  if (expr.type === 'FloatLiteral')   return 'Float';
  if (expr.type === 'BoolLiteral')    return 'Boolean';
  if (expr.type === 'NullLiteral')    return 'null';
  return null;
}

export const NEEDS_TYPE = new Set(['BinaryExpr']);

export function parseStructuredType(typeName) {
  if (typeof typeName !== 'string') return null;
  if (!typeName.startsWith('(') || !typeName.endsWith(')')) return null;
  if (typeName.includes('->')) return null;
  const inner = typeName.slice(1, -1).trim();
  if (inner.length === 0) return { positional: [], named: new Map() };
  const parts = inner.split(',').map(s => s.trim()).filter(Boolean);
  const positional = [];
  const named = new Map();
  for (const p of parts) {
    const colon = p.indexOf(':');
    if (colon >= 0) {
      const key = p.slice(0, colon).trim();
      const t = p.slice(colon + 1).trim();
      if (key) named.set(key, t);
    } else {
      positional.push(p);
    }
  }
  return { positional, named };
}

export function checkReplyFieldTypes(ctx, fields, declaredReturnType = null) {
  const structured = parseStructuredType(declaredReturnType);
  let posIdx = 0;
  for (const f of fields) {
    if (f.positional && f.expr && NEEDS_TYPE.has(f.expr.type) && f.type === null) {
      const hasInferred = structured && structured.positional[posIdx] != null;
      posIdx += 1;
      if (hasInferred) continue;
      throw new Error(`Reply/return expression requires a type annotation — use 'expr : Type'`);
    }
    if (f.key !== undefined && f.value && NEEDS_TYPE.has(f.value.type) && f.type === null) {
      const hasInferred = structured && structured.named.has(f.key);
      if (hasInferred) continue;
      throw new Error(`Reply/return field '${f.key}: ...' requires a type annotation — use '${f.key}: expr : Type'`);
    }
    if (f.positional) posIdx += 1;
  }
}

export function parseFieldList(str) {
  // Parses ":name Type, :name2 Type2" or "Type" (positional) entries
  // Also accepts legacy "name: Type" format for backward compatibility
  // ? suffix on types indicates optional (has default)
  const fields = [];
  for (const part of str.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(':')) {
      // :name Type — prefix sigil form
      const rest = trimmed.slice(1);
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx === -1) {
        fields.push({ name: rest, type: null, positional: false });
      } else {
        const name = rest.slice(0, spaceIdx);
        const rawType = rest.slice(spaceIdx + 1).trim();
        const optional = rawType.endsWith('?');
        const type = optional ? rawType.slice(0, -1) : rawType;
        fields.push({ name, type, positional: false, ...(optional && { optional: true }) });
      }
    } else {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) {
        const optional = trimmed.endsWith('?');
        const type = optional ? trimmed.slice(0, -1) : trimmed;
        fields.push({ name: null, type, positional: true, ...(optional && { optional: true }) });
      } else {
        // Legacy name: Type format
        const name = trimmed.slice(0, colonIdx).trim();
        const rawType = trimmed.slice(colonIdx + 1).trim();
        const optional = rawType.endsWith('?');
        const type = optional ? rawType.slice(0, -1) : rawType;
        fields.push({ name, type, positional: false, ...(optional && { optional: true }) });
      }
    }
  }
  return fields;
}

export function parseInterface(manifestStr) {
  // Parses the interface string format into a lookup map:
  //   op -> [{ params: [...], returns: [...] | null }]
  const result = {};
  const inner = manifestStr.replace(/^\{/, '').replace(/\}$/, '').trim();
  if (!inner) return result;
  for (const line of inner.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const op = trimmed.slice(0, colonIdx).trim();
    const sigsPart = trimmed.slice(colonIdx + 1).trim();
    const sigs = sigsPart.split('|').map(s => s.trim());
    result[op] = sigs.map(sig => {
      const arrowIdx = sig.indexOf('->');
      if (arrowIdx === -1) return { params: [], returns: null };
      const paramStr = sig.slice(0, arrowIdx).trim().replace(/^\(/, '').replace(/\)$/, '').trim();
      const retStr = sig.slice(arrowIdx + 2).trim();
      const params = paramStr ? parseFieldList(paramStr) : [];
      if (retStr === '.') return { params, returns: null };
      const retInner = retStr.replace(/^\(/, '').replace(/\)$/, '').trim();
      return { params, returns: retInner ? parseFieldList(retInner) : null };
    });
  }
  return result;
}

export function buildTypeEnv(params, body, stateVarEnv = null, remotes = null) {
  const env = new Map(stateVarEnv ?? []);
  const remoteInferred = new Set();
  for (const p of params) {
    if (p.rest) continue;
    if (p.name && p.type) env.set(p.name, p.type);
  }
  for (const s of body) {
    if (s.type === 'TypedAssign' || s.type === 'BareTypeDecl') {
      env.set(s.name, s.typeName);
    } else if (s.type === 'DestructureAssign') {
      const src = s.source;
      for (const item of s.pattern) {
        if (item.discard || !item.name) continue;
        let typeName = item.type;
        // Propagate explicit types from StructureConstructor RHS when LHS has no annotation
        if (!typeName && src.type === 'StructureConstructor') {
          if (item.positional) {
            const posArgs = src.args.filter(a => a.positional);
            typeName = posArgs[item.idx]?.type;
          } else if (item.named) {
            typeName = src.args.find(a => a.key === item.name)?.type;
          } else if (item.key !== undefined) {
            typeName = src.args.find(a => a.key === item.key)?.type;
          }
        }
        // Infer type from remote interface when LHS has no annotation
        if (!typeName && remotes && src.type === 'DotCallExpr') {
          const actorName = src.object?.name;
          const methodName = src.method;
          const iface = remotes?.[actorName];
          if (iface) {
            const parsed = typeof iface === 'string' ? parseInterface(iface) : iface;
            const returns = parsed?.[methodName]?.[0]?.returns;
            if (returns) {
              const match = returns.find(r => r.name === item.name);
              if (match?.type) {
                typeName = match.type;
                remoteInferred.add(item.name);
              }
            }
          }
        }
        if (typeName) env.set(item.name, typeName);
      }
    } else if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (item.discard || !item.name) continue;
        if (item.type) env.set(item.name, item.type);
      }
    } else if (s.type === 'Assign') {
      const inferred = inferLiteralType(s.value);
      if (inferred) env.set(s.name, inferred);
    } else if (s.type === 'RefDecl' && s.typeName) {
      env.set(s.name, s.typeName);
    }
  }
  return { env, remoteInferred };
}
