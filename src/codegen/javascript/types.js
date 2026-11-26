import { inferType } from '../../type_infer.js';
import { fieldAcrossReturns } from '../../return_shapes.js';
import { genericName } from '../../type_enc.js';
import { envTypeOf } from '../enc_names.js';

// The JavaScript generator reads encoded types (src/type_enc.js): a type env maps a
// name to its encoded type, and `typeDecls` keys a declared type by its address.


// A literal's encoded type; undefined for anything else.
export function inferLiteralType(expr) {
  switch (expr?.type) {
    case 'IntLiteral': return 'Integer';
    case 'StringLiteral': return 'Text';
    case 'DecimalLiteral': return 'Decimal';
    case 'FloatLiteral': return 'Float';
    case 'BoolLiteral': return 'Boolean';
    case 'NullLiteral': return null;
    case 'TypeConstruction': return expr.typeNameEnc;
    default: return undefined;
  }
}

export const NEEDS_TYPE = new Set(['BinaryExpr']);

// A declared reply shape `(Integer, n: Text)`, an encoded `Object`: its positional
// slots and named ones. Null for any other type.
function replyShape(t) {
  if (genericName(t) !== 'Object') return null;
  const tag = t[t.length - 1];
  return {
    positional: t.slice(0, -1),
    named: new Map(Object.entries(tag).filter(([k]) => !k.startsWith('%'))),
  };
}

// `declaredReturnType` is encoded.
export function checkReplyFieldTypes(ctx, fields, declaredReturnType = undefined) {
  const structured = replyShape(declaredReturnType);
  const typeEnv = ctx?.currentTypeEnv;
  let posIdx = 0;
  for (const f of fields) {
    if (f.positional && f.expr && NEEDS_TYPE.has(f.expr.type) && f.typeEnc === undefined) {
      const hasInferred = structured && structured.positional[posIdx] !== undefined;
      posIdx += 1;
      if (hasInferred) continue;
      if (inferType(f.expr, typeEnv) !== undefined) continue;
      throw new Error(`Reply/return expression requires a type annotation — use 'expr as Type'`);
    }
    if (f.key !== undefined && f.value && NEEDS_TYPE.has(f.value.type) && f.typeEnc === undefined) {
      const hasInferred = structured && structured.named.has(f.key);
      if (hasInferred) continue;
      if (inferType(f.value, typeEnv) !== undefined) continue;
      throw new Error(`Reply/return field '${f.key}: ...' requires a type annotation — use '${f.key}: expr as Type'`);
    }
    if (f.positional) posIdx += 1;
  }
}

// A scope's names and their encoded types. `remotes`, the documents of this file's
// dependencies by alias, as the compiler reads them; `typeDecls`, by address.
export function buildTypeEnv(params, body, stateVarEnv = null, remotes = null, typeDecls = null) {
  const env = new Map(stateVarEnv ?? []);
  const remoteInferred = new Set();
  const known = (t) => t !== undefined;
  for (const p of params) {
    if (p.rest) continue;
    if (p.name && known(envTypeOf(p))) env.set(p.name, envTypeOf(p));
  }
  for (const s of body) {
    if (s.type === 'TypedAssign' || s.type === 'BareTypeDecl') {
      // An unannotated one is in scope with no type, as its text was.
      env.set(s.name, s.typeNameEnc);
    } else if (s.type === 'DestructureAssign') {
      const src = s.source;
      // Typed-value source: propagate each field's declared type to the
      // destructured local so downstream emission (`as`-less returns,
      // arithmetic, etc.) sees the right type without explicit annotation.
      const srcType = src.type === 'TypeConstruction' ? src.typeNameEnc
        : src.type === 'Identifier' ? env.get(src.name) : undefined;
      const srcDecl = typeDecls && known(srcType) ? typeDecls.get(srcType) ?? null : null;
      for (const item of s.pattern) {
        if (item.discard || !item.name) continue;
        let t = item.typeEnc;
        if (!known(t) && srcDecl) {
          const fields = srcDecl.fields || [];
          let field;
          if (item.named) field = fields.find(f => f.name === item.name);
          else if (item.key !== undefined) field = fields.find(f => f.name === item.key);
          else if (item.positional) field = fields[item.idx];
          // Skip propagation for optional fields — the local must stay
          // polymorphic so `??` and `(expr)?` see the absent state.
          if (known(field?.paramTypeEnc) && !field.optional) t = field.paramTypeEnc;
        }
        // Propagate explicit types from ObjectConstructor RHS when LHS has no annotation
        if (!known(t) && src.type === 'ObjectConstructor') {
          if (item.positional) t = src.args.filter(a => a.positional)[item.idx]?.typeEnc;
          else if (item.named) t = src.args.find(a => a.key === item.name)?.typeEnc;
          else if (item.key !== undefined) t = src.args.find(a => a.key === item.key)?.typeEnc;
        }
        // Infer type from remote interface when LHS has no annotation
        if (!known(t) && remotes && src.type === 'DotCallExpr') {
          const actorName = src.object?.name;
          const parsed = remotes?.[actorName];
          // Op-form: parsed[method] = [{ params, returns }, ...]. Type-form:
          // parsed.__types[actorName].functions, where the dep alias names a typed
          // singleton (e.g. document).
          const sig = parsed?.[src.method]?.[0]
            || parsed?.__types?.[actorName]?.functions?.find(f => f.name === src.method);
          const match = sig ? fieldAcrossReturns(sig, item.name) : null;
          if (match && known(match.typeEnc) && match.typeEnc !== 'Anything') {
            t = match.typeEnc;
            remoteInferred.add(item.name);
          }
        }
        if (known(t)) env.set(item.name, t);
      }
    } else if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (item.discard || !item.name) continue;
        if (known(item.typeEnc)) env.set(item.name, item.typeEnc);
      }
    } else if (s.type === 'Assign') {
      const inferred = inferLiteralType(s.value);
      if (known(inferred)) env.set(s.name, inferred);
    } else if (s.type === 'RefDecl' && known(s.typeNameEnc)) {
      env.set(s.name, s.typeNameEnc);
    }
  }
  return { env, remoteInferred };
}
