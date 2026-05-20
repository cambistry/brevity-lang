import { inferExprType } from '../../inference.js';

export function inferLiteralType(expr) {
  if (!expr) return null;
  if (expr.type === 'IntLiteral')     return 'Integer';
  if (expr.type === 'StringLiteral')  return 'Text';
  if (expr.type === 'DecimalLiteral') return 'Decimal';
  if (expr.type === 'FloatLiteral')   return 'Float';
  if (expr.type === 'BoolLiteral')    return 'Boolean';
  if (expr.type === 'NullLiteral')    return 'null';
  if (expr.type === 'TypeConstruction') return expr.typeName;
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
  const typeEnv = ctx?.currentTypeEnv;
  let posIdx = 0;
  for (const f of fields) {
    if (f.positional && f.expr && NEEDS_TYPE.has(f.expr.type) && f.type === null) {
      const hasInferred = structured && structured.positional[posIdx] != null;
      posIdx += 1;
      if (hasInferred) continue;
      if (inferExprType(f.expr, typeEnv)) continue;
      throw new Error(`Reply/return expression requires a type annotation — use 'expr : Type'`);
    }
    if (f.key !== undefined && f.value && NEEDS_TYPE.has(f.value.type) && f.type === null) {
      const hasInferred = structured && structured.named.has(f.key);
      if (hasInferred) continue;
      if (inferExprType(f.value, typeEnv)) continue;
      throw new Error(`Reply/return field '${f.key}: ...' requires a type annotation — use '${f.key}: expr : Type'`);
    }
    if (f.positional) posIdx += 1;
  }
}

export function parseFieldList(str) {
  // Parses ":name Type, :name2 Type2" or "Type" (positional) entries.
  // Leading "? " prefix marks an optional slot (caller may omit; the
  // service supplies a default). Optionality is an interface-level
  // concern; the specific default value is internal to the implementation
  // and is not part of the manifest.
  const fields = [];
  for (const part of str.split(',')) {
    let trimmed = part.trim();
    if (!trimmed) continue;
    let optional = false;
    if (trimmed.startsWith('? ')) { optional = true; trimmed = trimmed.slice(2).trim(); }
    if (trimmed.startsWith(':')) {
      // :name Type — prefix sigil form
      const rest = trimmed.slice(1);
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx === -1) {
        fields.push({ name: rest, type: null, positional: false, ...(optional && { optional: true }) });
      } else {
        const name = rest.slice(0, spaceIdx);
        const type = rest.slice(spaceIdx + 1).trim();
        fields.push({ name, type, positional: false, ...(optional && { optional: true }) });
      }
    } else {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) {
        fields.push({ name: null, type: trimmed, positional: true, ...(optional && { optional: true }) });
      } else {
        // name: Type — named field
        const name = trimmed.slice(0, colonIdx).trim();
        const type = trimmed.slice(colonIdx + 1).trim();
        fields.push({ name, type, positional: false, ...(optional && { optional: true }) });
      }
    }
  }
  return fields;
}

// Walks a manifest body and returns one record per top-level entry.
// Newlines INSIDE a balanced group (`<...>`, `(...)`, `{...}`) do not
// terminate an entry, so multi-line type declarations are supported.
function tokenizeManifestEntries(body) {
  const entries = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;
    // Slice 15: `::Name = (fields)` is an exported type declaration. The
    // separator is `=` (not `:`) and the value is a parenthesized field
    // list. Parsed into a typedecl entry distinguished by the `typeDecl`
    // flag so parseInterface can route it into __typeDecls.
    if (body[i] === ':' && body[i + 1] === ':') {
      i += 2;
      const tnStart = i;
      while (i < body.length && /[A-Za-z0-9_]/.test(body[i])) i++;
      const typeName = body.slice(tnStart, i);
      while (i < body.length && /\s/.test(body[i])) i++;
      if (body[i] !== '=') continue;
      i++;
      while (i < body.length && /\s/.test(body[i])) i++;
      if (body[i] !== '(') continue;
      const valStart = i;
      let depth = 0;
      while (i < body.length) {
        const ch = body[i];
        if (ch === '(') depth++;
        else if (ch === ')') { depth--; i++; if (depth === 0) break; continue; }
        i++;
      }
      const valueText = body.slice(valStart, i).trim();
      if (typeName) entries.push({ name: typeName, valueText, typeDecl: true });
      continue;
    }
    const nameStart = i;
    while (i < body.length && /[A-Za-z0-9_]/.test(body[i])) i++;
    // Mutator methods carry a trailing `!` (e.g. `append_child!`). Accept it
    // as part of the name so the entry isn't silently dropped here.
    if (i < body.length && body[i] === '!') i++;
    let name = body.slice(nameStart, i);
    if (!name) { i++; continue; }
    // `set <name>: (Type)` declares that <name> is a settable field —
    // valid as the LHS of `obj.<name> <- value`. Stored alongside readers
    // but flagged so the validator/codegen can pick it up.
    let setter = false;
    if (name === 'set' && i < body.length && body[i] === ' ') {
      let j = i;
      while (j < body.length && body[j] === ' ') j++;
      const subStart = j;
      while (j < body.length && /[A-Za-z0-9_]/.test(body[j])) j++;
      let k = j;
      while (k < body.length && body[k] === ' ') k++;
      if (j > subStart && body[k] === ':') {
        name = body.slice(subStart, j);
        setter = true;
        i = j;
      }
    }
    while (i < body.length && body[i] === ' ') i++;
    if (body[i] !== ':') continue;
    i++;
    while (i < body.length && body[i] === ' ') i++;
    const valueStart = i;
    let depth = 0;
    while (i < body.length) {
      const ch = body[i];
      // `->` arrow's `>` must not be treated as a closing bracket.
      if (ch === '-' && body[i + 1] === '>') { i += 2; continue; }
      if (ch === '<' || ch === '(' || ch === '{') depth++;
      else if (ch === '>' || ch === ')' || ch === '}') {
        if (depth === 0) break;
        depth--;
      } else if (ch === '\n' && depth === 0) break;
      i++;
    }
    const valueText = body.slice(valueStart, i).trim();
    if (valueText) entries.push({ name, valueText, setter });
  }
  return entries;
}

function parseSigForm(sig) {
  const arrowIdx = sig.indexOf('->');
  if (arrowIdx === -1) return { params: [], returns: null };
  const paramStr = sig.slice(0, arrowIdx).trim().replace(/^\(/, '').replace(/\)$/, '').trim();
  const retStr = sig.slice(arrowIdx + 2).trim();
  const params = paramStr ? parseFieldList(paramStr) : [];
  if (retStr === '.') return { params, returns: null };
  const retInner = retStr.replace(/^\(/, '').replace(/\)$/, '').trim();
  return { params, returns: retInner ? parseFieldList(retInner) : null };
}

function splitOverloadsOnPipe(str) {
  const out = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '-' && str[i + 1] === '>') { i++; continue; }
    if (ch === '<' || ch === '(' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === '}') depth--;
    else if (ch === '|' && depth === 0) { out.push(str.slice(last, i).trim()); last = i + 1; }
  }
  out.push(str.slice(last).trim());
  return out;
}

// Disambiguates `<T | own>` (superclass divider) from `<:id Text | null>`
// (nullable union inside a single param). The superclass form requires that
// the LHS of `|` is an identifier-list (optionally with `*alias` markers).
const SUPERTYPE_LHS_RE = /^[A-Za-z_][A-Za-z0-9_]*(\s*\*\s*[A-Za-z_][A-Za-z0-9_]*)?(\s*,\s*[A-Za-z_][A-Za-z0-9_]*(\s*\*\s*[A-Za-z_][A-Za-z0-9_]*)?)*$/;
function trySplitSupertypePipe(inner) {
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '-' && inner[i + 1] === '>') { i++; continue; }
    if (ch === '<' || ch === '(' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === '}') depth--;
    else if (ch === '|' && depth === 0) {
      const lhs = inner.slice(0, i).trim();
      if (lhs === '' || SUPERTYPE_LHS_RE.test(lhs)) {
        return { supertypeStr: lhs, paramStr: inner.slice(i + 1).trim() };
      }
      return null;
    }
  }
  return null;
}

// Parses a `*([Sup |] own) [-> { body }]` value into an actor-shaped record:
//   { supertypes, initParams, functions }
// `supertypes` is an array of `{ supertype, wrappedAs? }` matching the AST.
function parseTypeForm(value) {
  if (!value.startsWith('*(')) return { supertypes: [], initParams: [], functions: [], setters: [] };
  let depth = 1;
  let parenEnd = -1;
  for (let i = 2; i < value.length; i++) {
    const ch = value[i];
    if (ch === '-' && value[i + 1] === '>') { i++; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) { parenEnd = i; break; }
    }
  }
  if (parenEnd === -1) return { supertypes: [], initParams: [], functions: [], setters: [] };
  const inner = value.slice(2, parenEnd).trim();
  const rest = value.slice(parenEnd + 1).trim();

  const split = trySplitSupertypePipe(inner);
  const supertypeStr = split ? split.supertypeStr : '';
  const paramStr = split ? split.paramStr : inner;

  const supertypes = supertypeStr ? supertypeStr.split(',').map(s => {
    const trimmed = s.trim();
    const starIdx = trimmed.indexOf('*');
    if (starIdx !== -1) {
      return { supertype: trimmed.slice(0, starIdx).trim(), wrappedAs: trimmed.slice(starIdx + 1).trim() };
    }
    return { supertype: trimmed };
  }) : [];

  const initParams = paramStr ? parseFieldList(paramStr) : [];

  const functions = [];
  const setters = [];
  if (rest.startsWith('->')) {
    const after = rest.slice(2).trim();
    if (after.startsWith('{') && after.endsWith('}')) {
      const bodyInner = after.slice(1, -1).trim();
      for (const e of tokenizeManifestEntries(bodyInner)) {
        if (e.setter) {
          // `set <name>: (Type)` — record name + the inner field type. The
          // value text is `(Type)` for a single-arg setter; strip the
          // parens to expose the bare type.
          const inner = e.valueText.replace(/^\(/, '').replace(/\)$/, '').trim();
          setters.push({ name: e.name, type: inner });
        } else {
          functions.push({ name: e.name, ...parseSigForm(e.valueText) });
        }
      }
    }
  }

  return { supertypes, initParams, functions, setters };
}

// Slice 15: parses the inner of a `(...)` typedecl into AST-shape TypeField
// nodes. Field syntax is `[? ]name[: ]Type` — `name Type` is positional,
// `name: Type` is named, with optional `? ` prefix in either form.
function parseTypeDeclFields(valueText) {
  const inner = valueText.replace(/^\(/, '').replace(/\)$/, '').trim();
  if (!inner) return [];
  // Top-level comma split; nested `()` (e.g. anonymous shape) preserved.
  const parts = [];
  let depth = 0, last = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { parts.push(inner.slice(last, i)); last = i + 1; }
  }
  parts.push(inner.slice(last));
  const fields = [];
  for (const raw of parts) {
    let trimmed = raw.trim();
    if (!trimmed) continue;
    let optional = false;
    if (trimmed.startsWith('? ')) { optional = true; trimmed = trimmed.slice(2).trim(); }
    const colonIdx = trimmed.indexOf(':');
    const spaceIdx = trimmed.indexOf(' ');
    let name, paramType, named;
    if (colonIdx !== -1 && (spaceIdx === -1 || colonIdx < spaceIdx)) {
      name = trimmed.slice(0, colonIdx).trim();
      paramType = trimmed.slice(colonIdx + 1).trim();
      named = true;
    } else if (spaceIdx !== -1) {
      name = trimmed.slice(0, spaceIdx).trim();
      paramType = trimmed.slice(spaceIdx + 1).trim();
      named = false;
    } else {
      continue;
    }
    const out = { type: 'TypeField', name, paramType };
    if (optional) out.optional = true;
    if (named) out.named = true;
    fields.push(out);
  }
  return fields;
}

export function parseInterface(manifestStr) {
  // Parses the interface string format. Three entry shapes are supported:
  //   - Constructor: `Name: <[Sup |] params> [-> { method-body }]`. Stored
  //     under `result.__types[Name] = { supertypes, initParams, functions }`.
  //   - Type decl: `::Name = (fields)`. Stored under
  //     `result.__typeDecls[Name] = { fields: [TypeField...] }` (slice 15).
  //   - Method: `name: (params) -> (returns)`. Stored under `result[name]`
  //     as an array of overload records. Used for non-constructor service
  //     methods (e.g. a remote actor that exposes operations directly).
  // Method bodies inside a constructor's `{...}` use the same op-form
  // signature shape.
  const result = {};
  const inner = manifestStr.replace(/^\{/, '').replace(/\}$/, '').trim();
  if (!inner) return result;
  for (const { name, valueText, typeDecl } of tokenizeManifestEntries(inner)) {
    if (typeDecl) {
      result.__typeDecls = result.__typeDecls || {};
      result.__typeDecls[name] = { fields: parseTypeDeclFields(valueText) };
    } else if (valueText.startsWith('*(')) {
      result.__types = result.__types || {};
      result.__types[name] = parseTypeForm(valueText);
    } else {
      result[name] = splitOverloadsOnPipe(valueText).map(parseSigForm);
    }
  }
  return result;
}

export function buildTypeEnv(params, body, stateVarEnv = null, remotes = null, typeDecls = null) {
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
      // Typed-value source: propagate each field's declared type to the
      // destructured local so downstream emission (`as`-less returns,
      // arithmetic, etc.) sees the right type without explicit annotation.
      let srcTypeName = null;
      if (src.type === 'TypeConstruction') srcTypeName = src.typeName;
      else if (src.type === 'Identifier' && env.has(src.name)) srcTypeName = env.get(src.name);
      const srcDecl = (typeDecls && srcTypeName && typeDecls.has(srcTypeName))
        ? typeDecls.get(srcTypeName) : null;
      for (const item of s.pattern) {
        if (item.discard || !item.name) continue;
        let typeName = item.type;
        if (!typeName && srcDecl) {
          const fields = srcDecl.fields || [];
          let field;
          if (item.named) field = fields.find(f => f.name === item.name);
          else if (item.key !== undefined) field = fields.find(f => f.name === item.key);
          else if (item.positional) field = fields[item.idx];
          // Skip propagation for optional fields — the local must stay
          // polymorphic so `??` and `(expr)?` see the absent state.
          if (field?.paramType && !field.optional) typeName = field.paramType;
        }
        // Propagate explicit types from ObjectConstructor RHS when LHS has no annotation
        if (!typeName && src.type === 'ObjectConstructor') {
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
            // Op-form: parsed[method] = [{ params, returns }, ...].
            // Type-form: parsed.__types[actorName].functions = [{ name, params, returns }, ...]
            // where the dep alias names a typed singleton (e.g. document).
            const returns = parsed?.[methodName]?.[0]?.returns
              || parsed?.__types?.[actorName]?.functions?.find(f => f.name === methodName)?.returns;
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
