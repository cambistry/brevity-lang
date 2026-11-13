import { inferExprType } from '../../inference.js';
import { fieldAcrossReturns } from '../../return_shapes.js';

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
  if (/[-=~]>/.test(typeName)) return null;
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
      throw new Error(`Reply/return expression requires a type annotation — use 'expr as Type'`);
    }
    if (f.key !== undefined && f.value && NEEDS_TYPE.has(f.value.type) && f.type === null) {
      const hasInferred = structured && structured.named.has(f.key);
      if (hasInferred) continue;
      if (inferExprType(f.value, typeEnv)) continue;
      throw new Error(`Reply/return field '${f.key}: ...' requires a type annotation — use '${f.key}: expr as Type'`);
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
//   type Point (x Integer, y Integer)     type declaration
//   my_func (Type) -> (Type)              function; one line per overload
//   log! (Text) => .                      silent function
//   Counter (start: Integer) -> *{ … }    constructor; body always written
//   Text (Node++) -> *{}                  constructor with a supertype
//   C (A ++ B ++ c: Integer) -> *{ … }    two supertypes, then params
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
    if ('-=~'.includes(ch) && str[i + 1] === '>') { i++; continue; }
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
    if ('-=~'.includes(ch) && str[i + 1] === '>') { i++; continue; }
    if (isOpenBracket(ch)) depth++;
    else if (isCloseBracket(ch)) depth--;
    else if (ch === sep && depth === 0) { out.push(str.slice(last, i)); last = i + 1; }
  }
  out.push(str.slice(last));
  return out;
}

// Splits a constructor's `(...)` inner at its top-level `++` parent list
// (notes/class-extends-plusplus-2026-11-10.md): every segment before a `++` is
// a parent (`B` or wrapped `sup B`); the last segment is a parent too when it is a
// bare name, else it is the param list. Null when there is no `++`.
const PARENT_SEG_RE = /^(?:([A-Za-z_][A-Za-z0-9_]*)\s+)?(@?[A-Za-z_][A-Za-z0-9_]*!?)$/;
const BARE_PARENT_RE = /^@?[A-Za-z_][A-Za-z0-9_]*!?$/;
function trySplitSupertypes(name, inner) {
  const segs = [];
  let depth = 0, last = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if ('-=~'.includes(ch) && inner[i + 1] === '>') { i++; continue; }
    if (isOpenBracket(ch)) depth++;
    else if (isCloseBracket(ch)) depth--;
    else if (ch === '+' && inner[i + 1] === '+' && depth === 0) { segs.push(inner.slice(last, i)); last = i + 2; i++; }
  }
  if (segs.length === 0) { rejectRetiredBar(name, inner); return null; }
  const supertypes = segs.map(seg => {
    const m = seg.trim().match(PARENT_SEG_RE);
    if (!m) throw new Error(`Interface entry '${name}': '${seg.trim()}' is not a parent — write 'Parent ++' or 'sup Parent ++'`);
    return { supertype: m[2], ...(m[1] && { wrappedAs: m[1] }) };
  });
  const rest = inner.slice(last).trim();
  if (BARE_PARENT_RE.test(rest)) return { supertypes: [...supertypes, { supertype: rest }], paramStr: '' };
  return { supertypes, paramStr: rest };
}

// The retired subclass bar: `(T |)`, `(T, U | …)`, `(T *sup | …)`. A bar after
// a single name with something on its right is a union param (`(Integer | Text)`).
function rejectRetiredBar(name, inner) {
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if ('-=~'.includes(ch) && inner[i + 1] === '>') { i++; continue; }
    if (isOpenBracket(ch)) depth++;
    else if (isCloseBracket(ch)) depth--;
    else if (ch === '|' && depth === 0) {
      const lhs = inner.slice(0, i).trim();
      const rhs = inner.slice(i + 1).trim();
      if (/^[A-Za-z_][\w!]*(\s*\*\s*\w*)?(\s*,\s*[A-Za-z_][\w!]*(\s*\*\s*\w*)?)*$/.test(lhs) && (rhs === '' || /[,*]/.test(lhs))) {
        throw new Error(`Interface entry '${name}': the subclass bar '|' is retired — extend with '++': '(Parent++)', '(A ++ B ++ params)'`);
      }
      return;
    }
  }
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
    const silentType = /=>\s*\.\s*$/.test(paramType);
    if (name.endsWith('.') && !silentType) {
      throw new Error(`Field '${name}' is silent by its name — its type is a silent function '(…) => .'`);
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

// A name may end in `?`, `!`, or the silent `.` (`notify. (Text) => .`).
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
  // The arrow states the effect: `->` reads, `=>` writes, `~>` purports to read.
  const hasArrow = /^[-=~]>/.test(rest);
  const arrow = hasArrow ? rest.slice(0, 2) : (rest === '.' ? '=>' : '->');
  if (hasArrow) rest = rest.slice(2).trim();
  const effect = { '->': 'read', '=>': 'write', '~>': 'purported' }[arrow];
  if (rest.startsWith('*{')) {
    const bEnd = groupEnd(rest, 1);
    if (bEnd === -1) throw new Error(`Interface entry '${name}': unbalanced constructor body`);
    if (rest.slice(bEnd).trim()) {
      throw new Error(`Interface entry '${name}': unexpected text after constructor body: '${rest.slice(bEnd).trim()}'`);
    }
    return { kind: 'constructor', effect, paramsInner, bodyInner: rest.slice(2, bEnd - 1) };
  }
  const params = paramsInner ? parseFieldList(paramsInner) : [];
  // A trailing `.` on the name means silent. A foreign function can be silent
  // without one, since its name is never interpreted.
  if (rest !== '.' && name.endsWith('.')) {
    throw new Error(`Interface entry '${name}' is silent by its name — its return is '=> .'`);
  }
  if (rest === '.') {
    if (arrow !== '=>') throw new Error(`Interface entry '${name}': '${arrow} .' has nothing to read — a silent function is '=> .'`);
    // A name without the mark can't say it's silent, so the entry does.
    return { kind: 'function', params, returns: null, effect, ...(name.endsWith('.') || name.endsWith('!') ? {} : { silent: true }) };
  }
  if (rest === 'self') {
    if (arrow === '~>') throw new Error(`Interface entry '${name}': '~> self' has nothing to read — write '=> self', or '-> self' if it's the identity function`);
    return { kind: 'function', params, returns: null, returnsSelf: true, effect };
  }
  if (rest === '(self)') throw new Error(`Interface entry '${name}': a self-return takes no parens — write '=> self'`);
  if (/^self\s*\|/.test(rest)) throw new Error(`Interface entry '${name}': 'self' goes last — write '=> (Type) | self'`);
  if (rest.startsWith('(')) {
    // `(A) | (B) | self`: what comes back depends on the path. Each shape prints once.
    const shapes = [];
    let tail = rest;
    let orSelf = false;
    for (;;) {
      const rEnd = groupEnd(tail, 0);
      if (rEnd === -1) break;
      shapes.push(tail.slice(1, rEnd - 1).trim());
      tail = tail.slice(rEnd).trim();
      if (/^\|\s*self$/.test(tail)) { orSelf = true; tail = ''; break; }
      if (!/^\|\s*\(/.test(tail)) break;
      tail = tail.slice(1).trim();
    }
    if (tail) {
      throw new Error(
        `Interface entry '${name}': unexpected text after return: '${tail}'` +
        (tail.startsWith('|') || /^[-=~]>/.test(tail) ? ' (overloads go on separate lines, repeating the name)' : ''),
      );
    }
    const parsedShapes = shapes.map(inner => (inner ? parseFieldList(inner) : []));
    const sole = shapes.length === 1 && !shapes[0] && !orSelf ? null : parsedShapes[0];
    return {
      kind: 'function', params, returns: sole, effect,
      ...(orSelf ? { returnsSelf: true } : {}),
      ...(parsedShapes.length > 1 ? { returnAlternatives: parsedShapes } : {}),
    };
  }
  if (!rest) {
    throw new Error(
      `Interface entry '${name}': missing return — write '-> (Type)', '=> .', '=> self', or '-> *{ … }' ` +
      `(a constructor with no members of its own is '-> *{}')`,
    );
  }
  throw new Error(`Interface entry '${name}': return must be parenthesized — write '-> (${rest})'`);
}

// `([A ++ B ++] params)` + constructor-body members → actor-shaped record:
//   { supertypes, initParams, functions, setters }
// `supertypes` is an array of `{ supertype, wrappedAs? }` matching the AST.
function parseConstructor(name, paramsInner, bodyInner) {
  const split = trySplitSupertypes(name, paramsInner);
  const supertypes = split ? split.supertypes : [];
  const paramStr = split ? split.paramStr : paramsInner;
  const initParams = paramStr ? parseFieldList(paramStr) : [];
  const functions = [];
  const setters = [];
  const services = {};
  const fields = {};
  for (const e of parseEntries(bodyInner)) {
    if (e.kind === 'function') {
      functions.push({ name: e.name, effect: e.effect, params: e.params, returns: e.returns, ...(e.returnsSelf ? { returnsSelf: true } : {}), ...(e.returnAlternatives ? { returnAlternatives: e.returnAlternatives } : {}) });
    } else if (e.kind === 'field') {
      // A field reads as a zero-arg getter; a `*` cell is also settable.
      functions.push({ name: e.name, params: [], returns: [{ name: null, type: e.type, positional: true }] });
      if (!e.readOnly) setters.push({ name: e.name, type: e.type });
      fields[e.name] = fieldRecord(e);
    } else if (e.kind === 'setter') {
      setters.push({ name: e.name, type: e.type });
      fields[e.name] = { type: e.type, cell: true, writeOnly: true };
    } else if (e.kind === 'service') {
      services[e.name] = e.service;
    } else if (e.kind !== 'spread') {
      throw new Error(`Interface entry '${e.name}': a ${e.kind} cannot be declared inside constructor '${name}'`);
    }
  }
  return { supertypes, initParams, functions, setters, ...(Object.keys(services).length ? { services } : {}), ...(Object.keys(fields).length ? { fields } : {}) };
}

function parseEntry(text) {
  // `untracked name …`: callers don't count this entry's writes. `untracked (…)` is
  // a function named `untracked`, which `@untracked` can declare.
  const prefixed = text.match(/^untracked\s+([A-Za-z_][\s\S]*)$/);
  if (prefixed) return { ...parseEntry(prefixed[1]), untracked: true };
  if (text.startsWith('...')) return { kind: 'spread', name: text.slice(3).trim() };
  const typeDecl = text.match(/^type\s+([A-Za-z_][A-Za-z0-9_]*)\s*([\s\S]*)$/);
  if (typeDecl) {
    const [, name, rest] = typeDecl;
    if (!rest.startsWith('(') || groupEnd(rest, 0) !== rest.length) {
      throw new Error(`Type declaration 'type ${name}' expects a parenthesized field list: 'type ${name} (fields)'`);
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
  // `name { members }`: a member that is an actor, a sub-service (a public
  // singleton). Its members read as a service document of their own.
  if (rest.startsWith('{')) {
    if (groupEnd(rest, 0) !== rest.length) throw new Error(`Interface entry '${name}': a sub-service is '${name} { members }', with nothing after its '}'`);
    return { kind: 'service', name, service: parseInterface(rest) };
  }
  if (rest.startsWith('(')) {
    const sig = parseSignature(name, rest);
    if (sig.kind === 'constructor') {
      return { kind: 'constructor', name, effect: sig.effect, ...parseConstructor(name, sig.paramsInner, sig.bodyInner) };
    }
    return { kind: 'function', name, effect: sig.effect, params: sig.params, returns: sig.returns, ...(sig.returnsSelf ? { returnsSelf: true } : {}), ...(sig.returnAlternatives ? { returnAlternatives: sig.returnAlternatives } : {}), ...(sig.silent ? { silent: true } : {}) };
  }
  if (!rest) throw new Error(`Interface entry '${name}' has no definition`);
  // `name Type` is a prop: an attribute, read as `{op: 'name'}`, not an address.
  // `name &Type` is a read-only cell and `name *Type` a writable one: addresses
  // that answer `$get` / `$subscribe` (and `$set`, for `*`).
  const sigil = rest[0] === '*' || rest[0] === '&' ? rest[0] : null;
  const type = sigil ? rest.slice(1).trim() : rest;
  if (!FIELD_TYPE_RE.test(type)) throw new Error(`Interface entry '${name}': malformed definition '${rest}'`);
  return { kind: 'field', name, type, cell: !!sigil, readOnly: sigil !== '*' };
}

// What a field record says about a member, for the wire: `prop`, a read-only
// `cell` (`&`), a writable one (`*`), or a write-only cell (`set name (Type)`).
export const fieldRecord = (e) => ({ type: e.type, cell: e.cell, readOnly: e.readOnly });

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
  //                                a field contributes a zero-arg getter.
  //                                `returnsSelf` alone is `=> self`; with a non-null
  //                                `returns` it's `=> (Type) | self`
  //   result.__types[Name]       — constructors `{ effect, supertypes, initParams, functions, setters }`
  //   result.__typeDecls[Name]   — `{ fields: [TypeField…] }`
  //   result.__fields[name]      — `{ type, cell, readOnly }`: a prop `name Type`
  //                                (cell false), a cell `name &Type` / `name *Type`;
  //                                `{ type, cell, writeOnly }` for `set name (Type)`
  //   result.__setters           — `[{ name, type }]` for top-level `set name (Type)`
  //   result.__services[name]    — a sub-service `name { … }`: its own parsed document
  const result = {};
  const inner = manifestStr.trim().replace(/^\{/, '').replace(/\}$/, '');
  for (const e of parseEntries(inner)) {
    if (e.untracked) (result.__untracked = result.__untracked || []).push(e.name);
    if (e.kind === 'type') {
      result.__typeDecls = result.__typeDecls || {};
      result.__typeDecls[e.name] = { fields: e.fields };
    } else if (e.kind === 'constructor') {
      result.__types = result.__types || {};
      if (result.__types[e.name]) throw new Error(`Interface declares constructor '${e.name}' more than once`);
      const { effect, supertypes, initParams, functions, setters, services, fields } = e;
      result.__types[e.name] = { effect, supertypes, initParams, functions, setters, ...(services ? { services } : {}), ...(fields ? { fields } : {}) };
    } else if (e.kind === 'function') {
      result[e.name] = result[e.name] || [];
      result[e.name].push({ params: e.params, returns: e.returns, effect: e.effect, ...(e.returnsSelf ? { returnsSelf: true } : {}), ...(e.returnAlternatives ? { returnAlternatives: e.returnAlternatives } : {}), ...(e.silent ? { silent: true } : {}) });
    } else if (e.kind === 'field') {
      result[e.name] = result[e.name] || [];
      result[e.name].push({ params: [], returns: [{ name: null, type: e.type, positional: true }] });
      result.__fields = result.__fields || {};
      result.__fields[e.name] = fieldRecord(e);
    } else if (e.kind === 'setter') {
      result.__setters = result.__setters || [];
      result.__setters.push({ name: e.name, type: e.type });
      result.__fields = result.__fields || {};
      result.__fields[e.name] = { type: e.type, cell: true, writeOnly: true };
    } else if (e.kind === 'service') {
      result.__services = result.__services || {};
      result.__services[e.name] = e.service;
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
            const sig = parsed?.[methodName]?.[0]
              || parsed?.__types?.[actorName]?.functions?.find(f => f.name === methodName);
            if (sig) {
              const match = fieldAcrossReturns(sig, item.name);
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
