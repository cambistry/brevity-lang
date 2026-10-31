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
  // Parses "name: Type, name2: Type2" (named) or "Type" (positional) entries.
  // Leading "? " prefix marks an optional slot (caller may omit; the
  // service supplies a default). Optionality is an interface-level
  // concern; the specific default value is internal to the implementation
  // and is not part of the manifest.
  const fields = [];
  for (const part of splitTopLevel(str, ',')) {
    let trimmed = part.trim();
    if (!trimmed) continue;
    let optional = false;
    if (trimmed.startsWith('? ')) { optional = true; trimmed = trimmed.slice(2).trim(); }
    if (trimmed.startsWith(':')) {
      const name = trimmed.slice(1).split(/\s/)[0];
      throw new Error(`Prefix-colon field ':${name}' is retired — write '${name}: Type'`);
    }
    // `name: Type` is named; a `::` qualifier (`Geom::Point`) is not a label.
    const named = trimmed.match(/^([A-Za-z_]\w*)\s*:(?!:)/);
    if (!named) {
      fields.push({ name: null, type: trimmed, positional: true, ...(optional && { optional: true }) });
    } else {
      const type = trimmed.slice(named[0].length).trim();
      fields.push({ name: named[1], type, positional: false, ...(optional && { optional: true }) });
    }
  }
  return fields;
}

// ── Service documents ──────────────────────────────────────────────────────
//
// A service document is `{ entries }`, one entry per line (or comma-separated).
// Every entry is a name, a space, and a definition — there is no entry colon:
//
//   ::Point (x Integer, y Integer)        type declaration
//   my_func (Type) -> (Type)              function; one line per overload
//   log! (Text) -> .                      silent function
//   Counter (start: Integer) -> *{ … }    constructor; body always written
//   Text (Node |) -> *{}                  constructor with a supertype
//   set name (Type)                       settable field
//   cell *Type                            ref cell (readable and settable)
//   name Type                             read-only field
//   ...Node                               inherited-members marker (ignored)
//
// The `->` before a return or a constructor body is optional on input; the
// emitter always writes it. The space after the name may be any run of
// whitespace, including none.

// Bracket-depth scans skip `->` as a unit so its `>` never reads as a closer.
const isOpenBracket = (ch) => ch === '(' || ch === '{' || ch === '<';
const isCloseBracket = (ch) => ch === ')' || ch === '}' || ch === '>';

// Index just past the bracket group that opens at `start`, or -1.
function groupEnd(str, start) {
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (ch === '-' && str[i + 1] === '>') { i++; continue; }
    if (isOpenBracket(ch)) depth++;
    else if (isCloseBracket(ch)) { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

// Splits `str` at each top-level occurrence of `sep`.
function splitTopLevel(str, sep) {
  const out = [];
  let depth = 0, last = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '-' && str[i + 1] === '>') { i++; continue; }
    if (isOpenBracket(ch)) depth++;
    else if (isCloseBracket(ch)) depth--;
    else if (ch === sep && depth === 0) { out.push(str.slice(last, i)); last = i + 1; }
  }
  out.push(str.slice(last));
  return out;
}

// Disambiguates `(T | own)` (supertype divider) from `(id: Text | null)`
// (nullable union inside a single param). The supertype form requires that
// the LHS of `|` is an identifier-list (optionally with `*alias` markers).
const SUPERTYPE_LHS_RE = /^[A-Za-z_][A-Za-z0-9_]*(\s*\*\s*[A-Za-z_][A-Za-z0-9_]*)?(\s*,\s*[A-Za-z_][A-Za-z0-9_]*(\s*\*\s*[A-Za-z_][A-Za-z0-9_]*)?)*$/;
function trySplitSupertypePipe(inner) {
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '-' && inner[i + 1] === '>') { i++; continue; }
    if (isOpenBracket(ch)) depth++;
    else if (isCloseBracket(ch)) depth--;
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

// Parses the inner of a `(...)` typedecl into AST-shape TypeField nodes.
// Field syntax is `[? ]name[: ]Type` — `name Type` is positional,
// `name: Type` is named, with optional `? ` prefix in either form.
function parseTypeDeclFields(valueText) {
  const inner = valueText.replace(/^\(/, '').replace(/\)$/, '').trim();
  if (!inner) return [];
  // Commas OR newlines separate fields (lineal form); nested `()` (an
  // anonymous shape or a function-signature field type) is preserved.
  const parts = splitTopLevel(inner, ',').flatMap(p => splitTopLevel(p, '\n'));
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
    // A silent-function field is named with the silent `.`, stored without it
    // (same rule as the parser's silentFieldName).
    const silentType = /->\s*\.\s*$/.test(paramType);
    if (name.endsWith('.') && !silentType) {
      throw new Error(`Field '${name}' is silent by its name — its type is a silent function '(…) -> .'`);
    }
    if (silentType && !name.endsWith('.')) {
      throw new Error(`Field '${name}' holds a silent function — name it '${name}.'`);
    }
    if (silentType) name = name.slice(0, -1);
    const out = { type: 'TypeField', name, paramType };
    if (optional) out.optional = true;
    if (named) out.named = true;
    fields.push(out);
  }
  return fields;
}

// A name may end in `?`, `!`, or the silent `.` (`notify. (Text) -> .`).
const ENTRY_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.(?=[\s(]|$)|\??!?)/;
// A read-only field's type: names, `of`, `|` unions, `::` qualifiers.
const FIELD_TYPE_RE = /^[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)?(\s+(of\s+)?[A-Za-z_][A-Za-z0-9_]*)*(\s*\|\s*[A-Za-z_][A-Za-z0-9_]*(\s+of\s+[A-Za-z_][A-Za-z0-9_]*)?)*$/;

function retiredEntryColon(name) {
  return new Error(
    `Interface entry '${name}:' — the entry colon is retired; write '${name} <definition>' ` +
    `(e.g. '${name} (Type) -> (Type)', '${name} *Type', '${name} Type')`,
  );
}

// Parses `(params) [->] ret` where ret is `(fields)`, `.`, or `*{ members }`.
function parseSignature(name, text) {
  const pEnd = groupEnd(text, 0);
  if (pEnd === -1) throw new Error(`Interface entry '${name}': unbalanced parameter list`);
  const paramsInner = text.slice(1, pEnd - 1).trim();
  let rest = text.slice(pEnd).trim();
  if (rest.startsWith('->')) rest = rest.slice(2).trim();
  if (rest.startsWith('*{')) {
    const bEnd = groupEnd(rest, 1);
    if (bEnd === -1) throw new Error(`Interface entry '${name}': unbalanced constructor body`);
    if (rest.slice(bEnd).trim()) {
      throw new Error(`Interface entry '${name}': unexpected text after constructor body: '${rest.slice(bEnd).trim()}'`);
    }
    return { kind: 'constructor', paramsInner, bodyInner: rest.slice(2, bEnd - 1) };
  }
  const params = paramsInner ? parseFieldList(paramsInner) : [];
  // Silence is in the name: `-> .` and a trailing `.` on the name go together
  // (bang names keep their own `-> .` for now).
  if (rest === '.' && !name.endsWith('.') && !name.endsWith('!')) {
    throw new Error(`Interface entry '${name}' is silent — name it '${name}.'`);
  }
  if (rest !== '.' && name.endsWith('.')) {
    throw new Error(`Interface entry '${name}' is silent by its name — its return is '-> .'`);
  }
  if (rest === '.') return { kind: 'function', params, returns: null };
  if (rest.startsWith('(')) {
    const rEnd = groupEnd(rest, 0);
    if (rEnd !== rest.length) {
      const extra = rEnd === -1 ? rest : rest.slice(rEnd).trim();
      throw new Error(
        `Interface entry '${name}': unexpected text after return: '${extra}'` +
        (extra.startsWith('|') ? ' (overloads go on separate lines, repeating the name)' : ''),
      );
    }
    const inner = rest.slice(1, -1).trim();
    return { kind: 'function', params, returns: inner ? parseFieldList(inner) : null };
  }
  if (!rest) {
    throw new Error(
      `Interface entry '${name}': missing return — write '-> (Type)', '-> .', or '-> *{ … }' ` +
      `(a constructor with no members of its own is '-> *{}')`,
    );
  }
  throw new Error(`Interface entry '${name}': return must be parenthesized — write '-> (${rest})'`);
}

// `([Sup, … |] params)` + constructor-body members → actor-shaped record:
//   { supertypes, initParams, functions, setters }
// `supertypes` is an array of `{ supertype, wrappedAs? }` matching the AST.
function parseConstructor(name, paramsInner, bodyInner) {
  const split = trySplitSupertypePipe(paramsInner);
  const supertypeStr = split ? split.supertypeStr : '';
  const paramStr = split ? split.paramStr : paramsInner;
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
  for (const e of parseEntries(bodyInner)) {
    if (e.kind === 'function') {
      functions.push({ name: e.name, params: e.params, returns: e.returns });
    } else if (e.kind === 'field') {
      // A field reads as a zero-arg getter; a ref cell is also settable.
      functions.push({ name: e.name, params: [], returns: [{ name: null, type: e.type, positional: true }] });
      if (!e.readOnly) setters.push({ name: e.name, type: e.type });
    } else if (e.kind === 'setter') {
      setters.push({ name: e.name, type: e.type });
    } else if (e.kind !== 'spread') {
      throw new Error(`Interface entry '${e.name}': a ${e.kind} cannot be declared inside constructor '${name}'`);
    }
  }
  return { supertypes, initParams, functions, setters };
}

function parseEntry(text) {
  if (text.startsWith('...')) return { kind: 'spread', name: text.slice(3).trim() };
  if (text.startsWith('::')) {
    const m = text.slice(2).match(/^([A-Za-z_][A-Za-z0-9_]*)\s*([\s\S]*)$/);
    if (!m) throw new Error(`Malformed type declaration '${text}'`);
    const [, name, rest] = m;
    if (rest.startsWith('=')) {
      throw new Error(`Type declaration '::${name} = (…)' — the '=' is retired; write '::${name} (…)'`);
    }
    if (!rest.startsWith('(') || groupEnd(rest, 0) !== rest.length) {
      throw new Error(`Type declaration '::${name}' expects a parenthesized field list: '::${name} (fields)'`);
    }
    return { kind: 'type', name, fields: parseTypeDeclFields(rest) };
  }
  const m = text.match(ENTRY_NAME_RE);
  if (!m) throw new Error(`Unrecognized interface entry '${text}'`);
  const name = m[0];
  let rest = text.slice(name.length);
  if (name === 'set') {
    // `set name (Type)`; otherwise `set` is an ordinary entry name.
    const sm = rest.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\([\s\S]*\))$/);
    if (sm) return { kind: 'setter', name: sm[1], type: sm[2].slice(1, -1).trim() };
    const old = rest.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    if (old) throw retiredEntryColon(`set ${old[1]}`);
  }
  rest = rest.trim();
  if (rest.startsWith(':')) throw retiredEntryColon(name);
  if (rest.startsWith('(')) {
    const sig = parseSignature(name, rest);
    if (sig.kind === 'constructor') {
      return { kind: 'constructor', name, ...parseConstructor(name, sig.paramsInner, sig.bodyInner) };
    }
    return { kind: 'function', name, params: sig.params, returns: sig.returns };
  }
  if (!rest) throw new Error(`Interface entry '${name}' has no definition`);
  const readOnly = !rest.startsWith('*');
  const type = readOnly ? rest : rest.slice(1).trim();
  if (!FIELD_TYPE_RE.test(type)) throw new Error(`Interface entry '${name}': malformed definition '${rest}'`);
  return { kind: 'field', name, type, readOnly };
}

// One record per top-level entry. Entries are separated by newlines or
// commas; separators inside a bracket group do not end an entry, so
// multi-line type declarations and constructor bodies work.
function parseEntries(body) {
  const entries = [];
  for (const raw of splitTopLevel(body, '\n').flatMap(line => splitTopLevel(line, ','))) {
    const text = raw.trim();
    if (text) entries.push(parseEntry(text));
  }
  return entries;
}

export function parseInterface(manifestStr) {
  // Result shape:
  //   result[name]               — function overloads `[{ params, returns }]`;
  //                                a field contributes a zero-arg getter
  //   result.__types[Name]       — constructors `{ supertypes, initParams, functions, setters }`
  //   result.__typeDecls[Name]   — `{ fields: [TypeField…] }`
  //   result.__fields[name]      — `{ type, readOnly }` for `name Type` / `name *Type`
  //   result.__setters           — `[{ name, type }]` for top-level `set name (Type)`
  const result = {};
  const inner = manifestStr.trim().replace(/^\{/, '').replace(/\}$/, '');
  for (const e of parseEntries(inner)) {
    if (e.kind === 'type') {
      result.__typeDecls = result.__typeDecls || {};
      result.__typeDecls[e.name] = { fields: e.fields };
    } else if (e.kind === 'constructor') {
      result.__types = result.__types || {};
      if (result.__types[e.name]) throw new Error(`Interface declares constructor '${e.name}' more than once`);
      const { supertypes, initParams, functions, setters } = e;
      result.__types[e.name] = { supertypes, initParams, functions, setters };
    } else if (e.kind === 'function') {
      result[e.name] = result[e.name] || [];
      result[e.name].push({ params: e.params, returns: e.returns });
    } else if (e.kind === 'field') {
      result[e.name] = result[e.name] || [];
      result[e.name].push({ params: [], returns: [{ name: null, type: e.type, positional: true }] });
      result.__fields = result.__fields || {};
      result.__fields[e.name] = { type: e.type, readOnly: e.readOnly };
    } else if (e.kind === 'setter') {
      result.__setters = result.__setters || [];
      result.__setters.push({ name: e.name, type: e.type });
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
