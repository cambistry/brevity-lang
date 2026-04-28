import { inferLiteralType, checkReplyFieldTypes } from './types.js';
import { inferExprType } from '../../inference.js';
import { parseDecimalLiteral } from '../decimal_utils.js';
import { JS_BLOB_METHODS, JS_TEXT_METHODS, JS_GRAPHEME_METHODS, JS_LIST_METHODS, dispatchMethod } from './method_tables.js';

// Map Brevity identifiers to valid JS identifiers
export function jsIdent(name) {
  if (name.startsWith('#')) return `_pv_${name.slice(1)}`;
  return name;
}

export const CALL_LIKE = new Set(['FunctionCallExpr']);

export function collectFreeVars(ctx, funcNode) {
  const paramNames = new Set(funcNode.params.map(p => p.name).filter(Boolean));
  const ids = new Set();
  const localDefs = new Set();

  function walkExpr(expr) {
    if (!expr) return;
    if (expr.type === 'Identifier' || expr.type === 'FnRef' || expr.type === 'RefRead' || expr.type === 'RefArg') { ids.add(expr.name); return; }
    if (expr.type === 'BinaryExpr') { walkExpr(expr.left); walkExpr(expr.right); return; }
    if (expr.type === 'FunctionCallExpr') { walkExpr(expr.callee); expr.args.forEach(walkExpr); return; }
    if (expr.type === 'IndexExpr') { walkExpr(expr.object); return; }
    if (expr.type === 'StructureConstructor' || expr.type === 'StructureLiteral') {
      expr.args.forEach(a => { if (a.expr) walkExpr(a.expr); });
      return;
    }
    if (expr.type === 'TypeConstruction') {
      expr.args.forEach(walkExpr);
      return;
    }
    if (expr.type === 'ListLiteral') { expr.elements.forEach(walkExpr); return; }
    if (expr.type === 'SizeExpr') { walkExpr(expr.arg); return; }
    if (expr.type === 'TextMethodExpr') { expr.args.forEach(walkExpr); return; }
    if (expr.type === 'BlobMethodExpr') { expr.args.forEach(walkExpr); return; }
    if (expr.type === 'GraphemeTextMethodExpr') { expr.args.forEach(walkExpr); return; }
    if (expr.type === 'ListMethodExpr') { expr.args.forEach(walkExpr); return; }
    if (expr.type === 'MathMethodExpr') { expr.args.forEach(walkExpr); return; }
    if (expr.type === 'RegexLiteral') return;
    if (expr.type === 'OverExpr') { walkExpr(expr.collection); walkExpr(expr.fn); return; }
    if (expr.type === 'ReduceExpr') { if (expr.initial) walkExpr(expr.initial); walkExpr(expr.collection); walkExpr(expr.fn); return; }
    if (expr.type === 'DotCallExpr') {
      expr.args.forEach(a => { if (a.name) ids.add(a.name); if (a.expr) walkExpr(a.expr); });
      return;
    }
    if (expr.type === 'NamedArgsBag') { Object.values(expr.fields).forEach(walkExpr); return; }
    if (expr.type === 'IfExpr') {
      walkExpr(expr.cond);
      if (expr.then) { if (expr.then.expr) walkExpr(expr.then.expr); if (expr.then.body) walkBody(expr.then.body); }
      if (expr.else) {
        if (expr.else.type === 'IfExpr') walkExpr(expr.else);
        else { if (expr.else.expr) walkExpr(expr.else.expr); if (expr.else.body) walkBody(expr.else.body); }
      }
      return;
    }
    if (expr.type === 'Function') {
      collectFreeVars(ctx, expr).forEach(v => ids.add(v));
      return;
    }
  }

  function walkBody(body) {
    for (const s of body) {
      if (s.type === 'TypedAssign' || s.type === 'Assign') {
        walkExpr(s.value);
        localDefs.add(s.name);
      } else if (s.type === 'ImplicitReturn') {
        walkExpr(s.expr);
      } else if (s.type === 'Reply' || s.type === 'Return') {
        for (const f of s.fields) {
          if (f.value) walkExpr(f.value);
          if ('sigil' in f) ids.add(f.sigil);
        }
      } else if (s.type === 'DestructureAssign') {
        walkExpr(s.source);
        s.pattern.forEach(item => { if (!item.discard && item.name) localDefs.add(item.name); });
      } else if (s.type === 'ListDestructure') {
        walkExpr(s.source);
        s.pattern.forEach(item => { if (!item.discard && item.name) localDefs.add(item.name); });
      } else if (s.type === 'StateAssign') {
        walkExpr(s.value);
      } else if (s.type === 'SetStatement') {
        ids.add(s.name);
        walkExpr(s.value);
      } else if (s.type === 'ActorSetStatement') {
        ids.add(s.name);
        for (const a of s.args) walkExpr(a.expr);
      } else if (s.type === 'RefDecl') {
        if (s.value) walkExpr(s.value);
        localDefs.add(s.name);
      }
    }
  }

  if (funcNode.expr) walkExpr(funcNode.expr);
  if (funcNode.body) walkBody(funcNode.body);
  return [...ids].filter(v => !paramNames.has(v) && !localDefs.has(v) && !ctx.actorFnNames.has(v) && !ctx.stateVarNames.has(v));
}

export function wrapWithCapture(ctx, code, funcNode, selfName) {
  const freeVars = collectFreeVars(ctx, funcNode).filter(v => v !== selfName);
  if (freeVars.length === 0) return code;
  return `((${freeVars.join(', ')}) => ${code})(${freeVars.join(', ')})`;
}

// Check if a lambda references outer refs (read or write) — these can't be lifted to dispatch handlers
// because refs need live cell access (for mutation visibility)
export function lambdaUsesOuterRefs(ctx, funcNode) {
  collectFreeVars(ctx, funcNode);
  // Check if any free vars are ref-declared in outer scope
  // We detect this by checking if the AST uses RefRead/SetStatement on free vars
  const body = funcNode.body || [];
  const localRefs = new Set();
  for (const s of body) {
    if (s.type === 'RefDecl') localRefs.add(s.name);
  }
  // Check body for SetStatement on outer refs or child actors
  for (const s of body) {
    if (s.type === 'SetStatement' && !localRefs.has(s.name) && !ctx.stateVarNames.has(s.name)) {
      return true;
    }
    if (s.type === 'ActorSetStatement') {
      return true;
    }
  }
  // Check for RefRead on free vars (reading outer refs)
  function hasRefRead(expr) {
    if (!expr) return false;
    if (expr.type === 'RefRead' && !localRefs.has(expr.name) && !ctx.stateVarNames.has(expr.name)) return true;
    if (expr.type === 'RefArg') return true;
    if (expr.type === 'BinaryExpr') return hasRefRead(expr.left) || hasRefRead(expr.right);
    if (expr.type === 'FunctionCallExpr') {
      if (hasRefRead(expr.callee)) return true;
      return expr.args.some(a => hasRefRead(a));
    }
    if (expr.type === 'SizeExpr') return hasRefRead(expr.arg);
    if (expr.type === 'TextMethodExpr') return expr.args.some(a => hasRefRead(a));
    if (expr.type === 'BlobMethodExpr') return expr.args.some(a => hasRefRead(a));
    if (expr.type === 'GraphemeTextMethodExpr') return expr.args.some(a => hasRefRead(a));
    if (expr.type === 'ListMethodExpr') return expr.args.some(a => hasRefRead(a));
    if (expr.type === 'MathMethodExpr') return expr.args.some(a => hasRefRead(a));
    if (expr.type === 'OverExpr') return hasRefRead(expr.collection) || hasRefRead(expr.fn);
    if (expr.type === 'ReduceExpr') return (expr.initial && hasRefRead(expr.initial)) || hasRefRead(expr.collection) || hasRefRead(expr.fn);
    if (expr.type === 'IfExpr') {
      if (hasRefRead(expr.cond)) return true;
      if (expr.then?.expr && hasRefRead(expr.then.expr)) return true;
      if (expr.else?.expr && hasRefRead(expr.else.expr)) return true;
      if (expr.else?.type === 'IfExpr' && hasRefRead(expr.else)) return true;
      return false;
    }
    if (expr.type === 'StructureConstructor' || expr.type === 'StructureLiteral') {
      return expr.args.some(a => a.expr && hasRefRead(a.expr));
    }
    if (expr.type === 'TypeConstruction') {
      return expr.args.some(hasRefRead);
    }
    if (expr.type === 'ListLiteral') return expr.elements.some(hasRefRead);
    if (expr.type === 'Function') return lambdaUsesOuterRefs(ctx, expr);
    return false;
  }
  for (const s of body) {
    if (s.type === 'Assign' || s.type === 'TypedAssign') {
      if (hasRefRead(s.value)) return true;
    }
    if (s.type === 'ImplicitReturn' && hasRefRead(s.expr)) return true;
    if (s.type === 'Reply' || s.type === 'Return') {
      for (const f of s.fields) {
        if (f.ref) return true; // sigil ref
        if (f.value && hasRefRead(f.value)) return true;
      }
    }
  }
  // Also check single-expression body
  if (funcNode.expr && hasRefRead(funcNode.expr)) return true;
  return false;
}

// Register a Function node as a lambda dispatch handler, return its label string expression
export function genLambdaArgLabel(ctx, funcNode) {
  const lambdaName = `_lambda_${ctx.lambdaCounter++}`;
  const freeVars = collectFreeVars(ctx, funcNode).filter(v => !ctx.actorFnNames.has(v));
  const captures = freeVars.map(v => ({ name: v, lambdaName }));
  for (const v of freeVars) {
    const fieldName = `_cap_${lambdaName}_${v}`;
    ctx.lambdaCaptureFields.push(fieldName);
  }
  ctx.lambdaHandlers.push({ name: lambdaName, fn: funcNode, captures });
  // If there are captures, emit an IIFE that stores them and returns the label.
  // The free var names are resolved through ctx.ssaScope (the OUTER scope at
  // the moment of lambda creation).
  if (freeVars.length > 0) {
    const stores = freeVars.map(v => {
      const src = ctx.stateVarNames.has(v) ? `this.#${v}` : ssaResolve(ctx, v);
      return `this.#_cap_${lambdaName}_${v} = ${src}`;
    }).join(', ');
    return `(${stores}, "${lambdaName}")`;
  }
  return `"${lambdaName}"`;
}

// For over/reduce fn args: wrap lambda labels in self-send closures for _List.mapAsync/foldAsync
export function genLambdaAwareFnArg(ctx, fnExpr) {
  if (fnExpr.type === 'FnRef' && ctx.lambdaVarNames.has(fnExpr.name)) {
    return `(async (_s) => Structure.pack(await this.#selfSend([Structure.splat(_s), ${ssaResolve(ctx, fnExpr.name)}])))`;
  }
  if (fnExpr.type === 'Function') {
    if (lambdaUsesOuterRefs(ctx, fnExpr)) return genExpr(ctx, fnExpr);
    // Register as lambda handler and wrap in self-send closure
    const label = genLambdaArgLabel(ctx, fnExpr);
    return `(async (_s) => Structure.pack(await this.#selfSend([Structure.splat(_s), ${label}])))`;
  }
  return genExpr(ctx, fnExpr);
}

// Resolve a source-level identifier to its current SSA-suffixed name via
// ctx.ssaScope. Falls back to the raw js-quoted identifier when the name is
// not in scope (e.g. function parameters, free vars from outside the body).
export function ssaResolve(ctx, name) {
  if (ctx.ssaScope?.has(name)) return ctx.ssaScope.get(name);
  return jsIdent(name);
}

// Mint a fresh SSA name in the given scope and counts maps. Used by both
// makeBindingContext.emitBinding (in statements.js) and by destructure
// codegen sites that create new bindings outside the statement walker.
export function mintSsaNameIn(scope, counts, name) {
  const n = (counts.get(name) || 0) + 1;
  counts.set(name, n);
  const ssaName = `${jsIdent(name)}__${n}`;
  scope.set(name, ssaName);
  return ssaName;
}

// Convenience: mint via ctx.ssaScope/ssaCounts (assumes a body walk is in
// progress). Falls back to plain jsIdent if no scope is set.
export function mintSsaName(ctx, name) {
  if (!ctx.ssaScope || !ctx.ssaCounts) return jsIdent(name);
  return mintSsaNameIn(ctx.ssaScope, ctx.ssaCounts, name);
}

export function genExpr(ctx, expr) {
  if (expr.type === 'StringLiteral')  return JSON.stringify(expr.value);
  if (expr.type === 'InterpolatedString') {
    const pieces = expr.parts.map(p => {
      if (p.kind === 'text') return JSON.stringify(p.value);
      return `_bv_str(${genExpr(ctx, p.expr)})`;
    });
    return '(' + pieces.join(' + ') + ')';
  }
  if (expr.type === 'HtmlLiteral')   return JSON.stringify(expr.value);
  if (expr.type === 'DomConstructor') {
    // Structured-children wire shape: `new` op carries `{children: [...]}`
    // — an ordered array matching XML Infoset's [children] property. Text
    // children are bare strings; closure children (`{ expr }` interpolations
    // that synthesizeTemplateClosures replaced with `closure_ref`) are bare
    // `#<@N>` address strings; nested `DomConstructor` children are
    // pre-dispatched by `await this.#send(...)`, whose return value is an
    // already-wrapped `#<HTML @tag/N>` address string (see classes.js:941 —
    // #send resolves to message.re which handleDomNew sends wrapped).
    //
    // `#{ expr }` interpolations (strinterp) are pure textual splices — they
    // merge with adjacent literal text into a single concatenated string
    // child, so they do not impose child-node boundaries. Reactive `{expr}`
    // (closure_ref) and nested elements DO break a run.
    const renderAttrs = (attrs) => {
      if (!attrs || attrs.length === 0) return null;
      const pairs = attrs.map(a => {
        const key = JSON.stringify(a.name);
        const v = a.value;
        if (v.type === 'text') return `${key}: ${JSON.stringify(v.value)}`;
        if (v.type === 'strinterp') return `${key}: _bv_str(${genExpr(ctx, v.expr)})`;
        if (v.type === 'closure_ref') return `${key}: ${JSON.stringify('#<' + v.name + '>')}`;
        throw new Error('Unexpected attr value type: ' + v.type);
      });
      return pairs.join(', ');
    };
    const renderChildren = (children) => {
      const entries = [];
      let run = null;
      const pushText = (piece) => {
        if (!run) { run = []; entries.push({ run }); }
        run.push(piece);
      };
      const breakRun = () => { run = null; };
      for (const c of children) {
        if (c.type === 'text') { pushText(JSON.stringify(c.value)); continue; }
        if (c.type === 'strinterp') { pushText(`_bv_str(${genExpr(ctx, c.expr)})`); continue; }
        breakRun();
        if (c.type === 'closure_ref') { entries.push({ str: JSON.stringify('#<' + c.name + '>') }); continue; }
        if (c.type === 'DomConstructor') {
          const childrenInner = renderChildren(c.children);
          const attrsInner = renderAttrs(c.attrs);
          const fields = [`children: [${childrenInner}]`];
          if (attrsInner) fields.push(attrsInner);
          entries.push({ str: `(await this.#send([{${fields.join(', ')}}, "new"], ${JSON.stringify('HTML @' + c.tag)}))` });
          continue;
        }
        throw new Error('Unexpected DomConstructor child: ' + (c && c.type));
      }
      return entries.map(e => {
        if (e.run) return e.run.length === 1 ? e.run[0] : '(' + e.run.join(' + ') + ')';
        return e.str;
      }).join(', ');
    };
    const childrenJs = renderChildren(expr.children);
    const attrsJs = renderAttrs(expr.attrs);
    const topFields = [`children: [${childrenJs}]`];
    if (attrsJs) topFields.push(attrsJs);
    return `await this.#send([{${topFields.join(', ')}}, "new"], ${JSON.stringify('HTML @' + expr.tag)})`;
  }
  if (expr.type === 'Identifier')     return ctx.stateVarNames.has(expr.name) ? `this.#${expr.name}` : ssaResolve(ctx, expr.name);
  if (expr.type === 'RefRead') { const _f = expr.name.replace(/^@/, ''); return ctx.stateVarNames.has(_f) ? `this.#${_f}` : `${expr.name}.value`; }
  if (expr.type === 'RefArg')        return expr.name;
  if (expr.type === 'IntLiteral')     return `${expr.value}n`;
  if (expr.type === 'DecimalLiteral') {
    const { coeff, scale } = parseDecimalLiteral(expr.value);
    return `new BvDecimal(${coeff}n, ${scale})`;
  }
  if (expr.type === 'FloatLiteral')   return String(expr.value);
  if (expr.type === 'NullLiteral')    return 'null';
  if (expr.type === 'BoolLiteral')    return expr.value ? 'true' : 'false';
  if (expr.type === 'FnRef') {
    if (ctx.actorFnNames.has(expr.name)) return `(async (_s) => Structure.pack(await this.#selfSend([Structure.splat(_s), "${expr.name}"])))`;
    if (ctx.lambdaVarNames.has(expr.name)) return `(async (_s) => Structure.pack(await this.#selfSend([Structure.splat(_s), ${ssaResolve(ctx, expr.name)}])))`;

    return ssaResolve(ctx, expr.name);
  }
  if (expr.type === 'StateVar')  return `this.#${expr.name}`;
  if (expr.type === 'SizeExpr') {
    return `BigInt([...${genExpr(ctx, expr.arg)}].length)`;
  }
  if (expr.type === 'RegexLiteral') {
    return `/${expr.pattern}/${expr.flags}`;
  }

  if (expr.type === 'BlobMethodExpr') {
    const s = genExpr(ctx, expr.args[0]);
    return dispatchMethod(JS_BLOB_METHODS, 'Blob', expr, s, (i) => genExpr(ctx, expr.args[i]));
  }
  if (expr.type === 'TextMethodExpr') {
    const s = genExpr(ctx, expr.args[0]);
    return dispatchMethod(JS_TEXT_METHODS, 'Text', expr, s, (i) => genExpr(ctx, expr.args[i]));
  }
  if (expr.type === 'GraphemeTextMethodExpr') {
    const s = genExpr(ctx, expr.args[0]);
    return dispatchMethod(JS_GRAPHEME_METHODS, 'GraphemeText', expr, s, (i) => genExpr(ctx, expr.args[i]));
  }
  if (expr.type === 'ListMethodExpr') {
    const s = genExpr(ctx, expr.args[0]);
    return dispatchMethod(JS_LIST_METHODS, 'List', expr, s, (i) => genExpr(ctx, expr.args[i]));
  }
  if (expr.type === 'MathMethodExpr') {
    const args = expr.args.map(a => genExpr(ctx, a));
    const argTypes = expr.args.map(a => inferExprType(a, ctx.currentTypeEnv));
    // Coerce to Number for Math.* functions
    const toNum = (code, type) => {
      if (type === 'Integer') return `Number(${code})`;
      if (type === 'Decimal') return `(${code}).toNumber()`;
      return code;
    };
    const m = expr.method;
    // 0-arity constants — return early before arg access
    if (m === 'pi') return `Math.PI`;
    if (m === 'e') return `Math.E`;
    const a0 = args[0], a1 = args[1], a2 = args[2];
    const t0 = argTypes[0], t1 = argTypes[1];
    const n0 = toNum(a0, t0), n1 = a1 ? toNum(a1, t1) : undefined;
    switch (m) {
      // Rounding — always returns Integer (BigInt)
      case 'ceil':  return `BigInt(Math.ceil(${n0}))`;
      case 'floor': return `BigInt(Math.floor(${n0}))`;
      case 'trunc': return `BigInt(Math.trunc(${n0}))`;
      case 'round': return `_bv_round(${n0})`;

      // Utility
      case 'abs':
        if (t0 === 'Integer') return `((${a0}) < 0n ? -(${a0}) : (${a0}))`;
        if (t0 === 'Decimal') return `(${a0}).abs()`;
        return `Math.abs(${n0})`;
      case 'sign':
        if (t0 === 'Integer') return `((${a0}) > 0n ? 1n : (${a0}) < 0n ? -1n : 0n)`;
        if (t0 === 'Decimal') return `BigInt(Math.sign((${a0}).toNumber()))`;
        return `BigInt(Math.sign(${n0}))`;
      case 'min': {
        if (args.length === 1) return a0;
        // Fold pairwise for variadic
        const allTypes = argTypes.every(t => t === 'Integer');
        const allDec = argTypes.every(t => t === 'Decimal');
        if (allTypes) return args.reduce((acc, v) => `((${acc}) < (${v}) ? (${acc}) : (${v}))`);
        if (allDec) return args.reduce((acc, v) => `_bv_dec_op(${acc}, '<', ${v}) ? ${acc} : ${v}`);
        const nums = args.map((a, i) => toNum(a, argTypes[i]));
        return `Math.min(${nums.join(', ')})`;
      }
      case 'max': {
        if (args.length === 1) return a0;
        const allTypes = argTypes.every(t => t === 'Integer');
        const allDec = argTypes.every(t => t === 'Decimal');
        if (allTypes) return args.reduce((acc, v) => `((${acc}) > (${v}) ? (${acc}) : (${v}))`);
        if (allDec) return args.reduce((acc, v) => `_bv_dec_op(${acc}, '>', ${v}) ? ${acc} : ${v}`);
        const nums = args.map((a, i) => toNum(a, argTypes[i]));
        return `Math.max(${nums.join(', ')})`;
      }

      // pow — same as ** for Int^Int and Dec^Int, Float otherwise
      case 'pow':
        if (t0 === 'Integer' && t1 === 'Integer') return `_bv_int_op(${a0}, '**', ${a1})`;
        if (t0 === 'Decimal' && t1 === 'Integer') return `_bv_dec_op(${a0}, '**', ${a1})`;
        return `Math.pow(${n0}, ${n1})`;

      // Constants
      case 'pi': return `Math.PI`;
      case 'e':  return `Math.E`;

      // Powers & roots — always returns Float
      case 'sqrt': return `Math.sqrt(${n0})`;
      case 'exp':  return `Math.exp(${n0})`;
      case 'log':
        if (n1) return `(Math.log(${n0}) / Math.log(${n1}))`;
        return `Math.log(${n0})`;

      // Trigonometry — always returns Float
      case 'sin':   return `Math.sin(${n0})`;
      case 'cos':   return `Math.cos(${n0})`;
      case 'tan':   return `Math.tan(${n0})`;
      case 'asin':  return `Math.asin(${n0})`;
      case 'acos':  return `Math.acos(${n0})`;
      case 'atan':  return `Math.atan(${n0})`;
      case 'atan2': return `Math.atan2(${n0}, ${n1})`;

      // Hyperbolic — always returns Float
      case 'sinh':  return `Math.sinh(${n0})`;
      case 'cosh':  return `Math.cosh(${n0})`;
      case 'tanh':  return `Math.tanh(${n0})`;
      case 'asinh': return `Math.asinh(${n0})`;
      case 'acosh': return `Math.acosh(${n0})`;
      case 'atanh': return `Math.atanh(${n0})`;

      // Decimal-specific
      case 'divide': return `_bv_dec_divide(${a0}, ${a1}, ${a2})`;

      // Type conversions
      case 'to_integer':
        if (t0 === 'Integer') return a0;
        if (t0 === 'Decimal') return `(${a0}).c / (10n ** BigInt((${a0}).s))`;
        return `BigInt(Math.trunc(${a0}))`;
      case 'to_float':
        if (t0 === 'Float') return a0;
        if (t0 === 'Decimal') return `(${a0}).toNumber()`;
        return `Number(${a0})`;
      case 'to_decimal':
        if (t0 === 'Decimal') return a0;
        if (t0 === 'Integer') return `BvDecimal.fromInt(${a0})`;
        return `BvDecimal.from(${a0})`;

      default: throw new Error(`Unknown Math method: ${m}`);
    }
  }
  if (expr.type === 'OverExpr') {
    const fnCode = genLambdaAwareFnArg(ctx, expr.fn);
    return `await _List.mapAsync(${genExpr(ctx, expr.collection)}, ${fnCode})`;
  }
  if (expr.type === 'ReduceExpr') {
    const init = expr.initial ? genExpr(ctx, expr.initial) : 'null';
    const fnCode = genLambdaAwareFnArg(ctx, expr.fn);
    return `await _List.foldAsync(${genExpr(ctx, expr.collection)}, ${init}, ${fnCode})`;
  }
  if (expr.type === 'BinaryExpr') {
    const left = CALL_LIKE.has(expr.left.type) ? `Structure.one(${genExpr(ctx, expr.left)}, '_')` : genExpr(ctx, expr.left);
    const right = CALL_LIKE.has(expr.right.type) ? `Structure.one(${genExpr(ctx, expr.right)}, '_')` : genExpr(ctx, expr.right);
    // Use _bv_int_op for integer arithmetic to handle Number/BigInt coercion
    const lType = inferExprType(expr.left, ctx.currentTypeEnv);
    const rType = inferExprType(expr.right, ctx.currentTypeEnv);
    const isFloatOp = lType === 'Float' || rType === 'Float'
      || expr.left.type === 'FloatLiteral' || expr.right.type === 'FloatLiteral';
    const isIntOp = lType === 'Integer' || rType === 'Integer'
      || expr.left.type === 'IntLiteral' || expr.right.type === 'IntLiteral';
    const isDecOp = lType === 'Decimal' || rType === 'Decimal'
      || expr.left.type === 'DecimalLiteral' || expr.right.type === 'DecimalLiteral';
    // `??` short-circuits before numeric routing — its falsiness check is
    // null/undefined-only, not value-typed. Route through native JS `??`.
    if (expr.op === '??') return `(${left} ?? ${right})`;
    // Float promotion wins: use native JS operators (coerce BigInt/Decimal to Number)
    if (isFloatOp) return `_bv_float_op(${left}, '${expr.op}', ${right})`;
    if (isDecOp) return `_bv_dec_op(${left}, '${expr.op}', ${right})`;
    if (isIntOp) return `_bv_int_op(${left}, '${expr.op}', ${right})`;
    if (expr.op === '/') return `_bv_div(${left}, ${right})`;
    // List + List → concat (pure, returns new list).
    if (expr.op === '+' && typeof lType === 'string' && typeof rType === 'string'
        && lType.startsWith('List') && rType.startsWith('List')) {
      return `_bv_list_concat(${left}, ${right})`;
    }
    // Slice 4 of types-implementation-plan-2026-04-27: tag-aware equality.
    // Route `==`/`!=` through `_bv_eq` when either operand is a Brevity Type
    // (TypeConstruction directly or a typed identifier whose declared type
    // is a user-declared `::Name`). `_bv_eq` enforces strict tag-matching:
    // `Point(0,0) == (0,0)` and `Point(0,0) == Pair(0,0)` are both false.
    // Note: parser maps `==`/`!=` to `===`/`!==` per CMP_OPS in parser.js.
    if (expr.op === '===' || expr.op === '!==') {
      const isTyped = (e, t) => e?.type === 'TypeConstruction'
        || (typeof t === 'string' && ctx.typeDecls?.has(t));
      if (isTyped(expr.left, lType) || isTyped(expr.right, rType)) {
        return expr.op === '===' ? `_bv_eq(${left}, ${right})` : `!_bv_eq(${left}, ${right})`;
      }
    }
    return `(${left} ${expr.op} ${right})`;
  }
  if (expr.type === 'IndexExpr') {
    const obj = genExpr(ctx, expr.object);
    if (expr.key !== null) return `${obj}.named[${JSON.stringify(expr.key)}]`;
    return `${obj}.positional[${expr.index}]`;
  }
  if (expr.type === 'ListLiteral') {
    if (expr.elements.length === 0) return '_List.empty';
    return `_List.from([${expr.elements.map(e => genExpr(ctx, e)).join(', ')}])`;
  }
  if (expr.type === 'StructureLiteral') {
    return genExpr(ctx, { ...expr, type: 'StructureConstructor' });
  }
  if (expr.type === 'StructureConstructor') {
    const positional = expr.args.filter(a => a.positional);
    const named = expr.args.filter(a => a.key !== undefined);
    const posVals = positional.map(a => genExpr(ctx, a.expr)).join(', ');
    const posTypes = positional.length > 0
      ? `[${positional.map(a => JSON.stringify(a.type)).join(', ')}]`
      : 'null';
    const namedVals = named.map(a => `${JSON.stringify(a.key)}: ${genExpr(ctx, a.expr)}`).join(', ');
    const namedTypes = named.length > 0
      ? `{${named.map(a => `${JSON.stringify(a.key)}: ${JSON.stringify(a.type)}`).join(', ')}}`
      : 'null';
    return `{ positional: [${posVals}], named: {${namedVals}}, positional_types: ${posTypes}, named_types: ${namedTypes} }`;
  }
  if (expr.type === 'PresenceCheck') {
    // Slice 11: `(expr)?` returns Boolean. Present means "not null and not
    // undefined" — JS optional chaining short-circuit produces undefined
    // for absent intermediate hops, and JSON-decoded payloads use null for
    // explicitly-null fields.
    const inner = genExpr(ctx, expr.expr);
    return `(${inner} != null)`;
  }
  if (expr.type === 'TypeConstruction') {
    // Slice 3 of types-implementation-plan-2026-04-27: emit a tagged
    // structure carrying the type identity plus per-field values keyed by
    // the type's declared field names. Wire serialization (slice 12) will
    // strip/translate this for transmission. Args follow FunctionCallExpr's
    // calling convention: bare expressions for positional, plus an optional
    // trailing `NamedArgsBag` for `name: expr` arguments. Slice 11: omit
    // fields whose value was not provided so absent optionals read as
    // `undefined`.
    const decl = ctx.typeDecls?.get(expr.typeName);
    const fields = decl?.fields ?? [];
    const positional = expr.args.filter(a => a?.type !== 'NamedArgsBag');
    const namedBag = expr.args.find(a => a?.type === 'NamedArgsBag');
    const named = namedBag?.fields || {};
    const seen = new Set();
    const pairs = [];
    fields.slice(0, positional.length).forEach((f, i) => {
      seen.add(f.name);
      pairs.push(`${JSON.stringify(f.name)}: ${genExpr(ctx, positional[i])}`);
    });
    for (const f of fields) {
      if (seen.has(f.name)) continue;
      if (Object.prototype.hasOwnProperty.call(named, f.name)) {
        pairs.push(`${JSON.stringify(f.name)}: ${genExpr(ctx, named[f.name])}`);
      }
    }
    return `{ __type: ${JSON.stringify(expr.typeName)}${pairs.length ? ', ' + pairs.join(', ') : ''} }`;
  }
  if (expr.type === 'FunctionCallExpr') {
    if (expr.callee?.type === 'Identifier') {
      const name = expr.callee.name;
      // __tick__ intrinsic
      if (name === '__tick__') return 'await new Promise(r => setTimeout(r, 0))';
      // Emit invocation — route to subscribers
      if (ctx.emitNames.has(name)) {
        const emitDecl = ctx.emitNames.get(name);
        const genArg = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
        let payload = '{}';
        if (expr.args.length > 0) {
          // Build named payload matching emit declaration params
          const fields = emitDecl.params.map((p, i) => {
            const val = i < expr.args.length ? genArg(expr.args[i]) : 'null';
            return `${JSON.stringify(p.name)}: ${val}`;
          }).join(', ');
          payload = `{${fields}}`;
        }
        const method = emitDecl.silent ? '#emit' : '#emitAwait';
        return `await this.${method}(${JSON.stringify(name)}, ${payload})`;
      }
      // Primitive type constructors — unwrap to the inner value
      const _primitiveTypes = new Set(['Integer', 'Float', 'Text', 'Boolean']);
      if (_primitiveTypes.has(name) && expr.args.length === 1) {
        return genExpr(ctx, expr.args[0]);
      }
      // Actor instantiation — constructor args passed directly
      if (ctx.actorNames.has(name)) {
        const binding = `{post: (msg) => this.receive(msg)}`;
        const genArg = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
        // Overloaded constructor: dispatch based on arity + types
        if (ctx.constructorOverloads?.has(name)) {
          const overloads = ctx.constructorOverloads.get(name);
          const primaryInfo = ctx.actorNames.get(name);
          const primaryParams = (primaryInfo?.initParams || []).filter(p => p.positional);
          const argCount = expr.args.length;
          // Infer argument types from AST literals
          const inferArgType = arg => {
            if (arg.type === 'IntLiteral') return 'Integer';
            if (arg.type === 'StringLiteral') return 'Text';
            if (arg.type === 'DecimalLiteral') return 'Decimal';
            if (arg.type === 'BoolLiteral') return 'Boolean';
            return null; // unknown
          };
          const argTypes = expr.args.map(inferArgType);
          // Build list: [{className, params}] — primary first, then overloads
          // Use actorNames for merged params (includes inherited from supertypes)
          const candidates = [
            { className: name, params: primaryParams },
            ...overloads.map(ov => {
              const ovInfo = ctx.actorNames.get(ov.mangledName);
              const mergedParams = ovInfo ? (ovInfo.initParams || []).filter(p => p.positional) : ov.params.filter(p => p.positional);
              return { className: ov.mangledName, params: mergedParams };
            }),
          ];
          // Find matching candidate: arity first, then types
          const match = candidates.find(c => {
            if (c.params.length !== argCount) return false;
            // If arg types are known, check they match param types
            for (let i = 0; i < argCount; i++) {
              if (argTypes[i] && c.params[i]?.type && c.params[i].type !== 'Anything' && argTypes[i] !== c.params[i].type) return false;
            }
            return true;
          });
          if (match) {
            const vals = expr.args.length > 0 ? expr.args.map(genArg).join(', ') : '';
            return vals ? `await ${match.className}.create(${binding}, ${vals})` : `await ${match.className}.create(${binding})`;
          }
          // Fallback: pass all args to primary (let it fail at runtime if wrong)
          const vals = expr.args.length > 0 ? expr.args.map(genArg).join(', ') : '';
          return vals ? `await ${name}.create(${binding}, ${vals})` : `await ${name}.create(${binding})`;
        }
        if (expr.args.length > 0) {
          // If the call uses named args, reorder to match constructor param order
          const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
          if (namedBag) {
            const info = ctx.actorNames.get(name);
            const initParams = info.initParams || [];
            const namedFields = namedBag.fields; // object: { key: valueExpr }
            const positionalArgs = expr.args.filter(a => a.type !== 'NamedArgsBag');
            const orderedArgs = [];
            for (const p of initParams) {
              // For aliased params (key: alias), the call uses the key; otherwise the name
              const lookupKey = p.key || p.name;
              if (namedFields[lookupKey]) orderedArgs.push(genArg(namedFields[lookupKey]));
              else if (p.positional && positionalArgs.length > 0) orderedArgs.push(genArg(positionalArgs.shift()));
              else if (p.defaultValue) orderedArgs.push('undefined'); // skip — JS default param fills in
              else if (positionalArgs.length > 0) orderedArgs.push(genArg(positionalArgs.shift()));
            }
            for (const a of positionalArgs) orderedArgs.push(genArg(a));
            const vals = orderedArgs.join(', ');
            return `await ${name}.create(${binding}, ${vals})`;
          }
          const vals = expr.args.map(genArg).join(', ');
          return `await ${name}.create(${binding}, ${vals})`;
        }
        return `await ${name}.create(${binding})`;
      }
      // Self-send: private function call goes through dispatch
      if (ctx.actorFnNames.has(name)) {
        const genArg = arg => {
          if (arg.type === 'Function') return genLambdaArgLabel(ctx, arg);
          return CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
        };
        const op = expr.args.length === 0
          ? `"${name}"`
          : `[[${expr.args.map(genArg).join(', ')}], "${name}"]`;
        return `Structure.pack(await this.#selfSend(${op}))`;
      }
      // Lambda var call → self-send through dispatch
      if (ctx.lambdaVarNames.has(name)) {
        const genArg = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
        const jsName = ssaResolve(ctx, name);
        const op = expr.args.length === 0
          ? jsName
          : `[[${expr.args.map(genArg).join(', ')}], ${jsName}]`;
        return `Structure.pack(await this.#selfSend(${op}))`;
      }
      // Destructured member call → route to source service
      if (ctx.destructuredMembers?.has(name)) {
        const { service, remote } = ctx.destructuredMembers.get(name);
        const to = JSON.stringify(service);
        const method = JSON.stringify('@' + remote);
        if (expr.args.length === 0) {
          return `this.#send(${method}, ${to})`;
        }
        const argExprs = expr.args.filter(a => a.type !== 'NamedArgsBag');
        const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
        if (namedBag) {
          const fields = Object.entries(namedBag.fields).map(([k, v]) => `${k}: ${genExpr(ctx, v)}`).join(', ');
          return `this.#send([{${fields}}, ${method}], ${to})`;
        }
        const vals = argExprs.map(a => genExpr(ctx, a)).join(', ');
        return `this.#send([[${vals}], ${method}], ${to})`;
      }
    }
    // Check if callee is function-typed (parameter or variable) — route through self-send
    if (expr.callee?.type === 'Identifier') {
      const calleeName = expr.callee.name;
      const calleeExpr = genExpr(ctx, expr.callee);
      const calleeType = ctx.currentTypeEnv?.get(calleeName);
      const isFnTyped = calleeType && (calleeType === 'Function' || (typeof calleeType === 'string' && calleeType.includes('->')));
      if (isFnTyped) {
        const genArg = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
        const op = expr.args.length === 0
          ? calleeExpr
          : `[[${expr.args.map(genArg).join(', ')}], ${calleeExpr}]`;
        return `Structure.pack(await this.#selfSend(${op}))`;
      }
    }
    const genArg = arg => {
      if (arg.type === 'Function') return genLambdaArgLabel(ctx, arg);
      return CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
    };
    // If callee is a local variable, it may hold a string label (lambda) or closure at runtime
    if (expr.callee?.type === 'Identifier') {
      const calleeName = expr.callee.name;
      const calleeExpr = ctx.stateVarNames.has(calleeName) ? `this.#${calleeName}` : ssaResolve(ctx, calleeName);
      const genArgSS = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
      const hasRefArg = expr.args.some(a => a.type === 'RefArg') ||
        expr.args.some(a => a.type === 'NamedArgsBag' && Object.values(a.fields).some(v => v.type === 'RefArg'));
      // Build payload for the closure path (handles ref args)
      let closurePayload;
      if (expr.args.length === 0) {
        closurePayload = 'Structure.pack(null)';
      } else if (hasRefArg) {
        const pos = expr.args.filter(a => a.type !== 'NamedArgsBag');
        const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
        const posVals = pos.map(genArgSS).join(', ');
        const namedVals = namedBag ? genExpr(ctx, namedBag) : '{}';
        closurePayload = `{positional: [${posVals}], named: ${namedVals}, positional_types: null, named_types: null}`;
      } else {
        closurePayload = `Structure.pack([${expr.args.map(genArgSS).join(', ')}])`;
      }
      const op = expr.args.length === 0
        ? calleeExpr
        : `[[${expr.args.map(genArgSS).join(', ')}], ${calleeExpr}]`;
      return `(typeof ${calleeExpr} === 'string' ? Structure.pack(await this.#selfSend(${op})) : await (${calleeExpr})(${closurePayload}))`;
    }
    const hasRefArg = expr.args.some(a => a.type === 'RefArg') ||
      expr.args.some(a => a.type === 'NamedArgsBag' && Object.values(a.fields).some(v => v.type === 'RefArg'));
    let payload;
    if (expr.args.length === 0) {
      payload = 'Structure.pack(null)';
    } else if (hasRefArg) {
      // Bypass Structure.pack to prevent ref cell objects from being treated as named args
      const pos = expr.args.filter(a => a.type !== 'NamedArgsBag');
      const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
      const posVals = pos.map(genArg).join(', ');
      const namedVals = namedBag ? genExpr(ctx, namedBag) : '{}';
      payload = `{positional: [${posVals}], named: ${namedVals}, positional_types: null, named_types: null}`;
    } else {
      payload = `Structure.pack([${expr.args.map(genArg).join(', ')}])`;
    }
    return `await (${genExpr(ctx, expr.callee)})(${payload})`;
  }
  if (expr.type === 'NamedArgsBag') {
    const fields = Object.entries(expr.fields)
      .map(([k, v]) => `${JSON.stringify(k)}: ${genExpr(ctx, v)}`).join(', ');
    return `{ ${fields} }`;
  }
  if (expr.type === 'Function') {
    // Lambdas with outer ref sets remain closures
    if (lambdaUsesOuterRefs(ctx, expr)) {
      const destr = genDestructure(ctx, expr.params, '  ');
      if (expr.body) {
        return wrapWithCapture(ctx, ctx.genFunctionBodyCode(ctx, expr.params, expr.body, null, expr.returnType), expr);
      }
      if (expr.returnType === '.') {
        return wrapWithCapture(ctx, `async (_s) => {${destr}\n  ${genExpr(ctx, expr.expr)};\n}`, expr);
      }
      return wrapWithCapture(ctx, `async (_s) => {${destr}\n  return Structure.pack([${genExpr(ctx, expr.expr)}]);\n}`, expr);
    }
    return genLambdaArgLabel(ctx, expr);
  }
  if (expr.type === 'DotCallExpr') {
    const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : (expr.object.type === 'Identifier' ? expr.object.name : null);
    const isRemote = dotObjName && ctx.remoteInstanceVars.has(dotObjName);
    const isChild = !isRemote && (expr.object.type === 'RefRead' ||
      (expr.object.type === 'FunctionCallExpr' && expr.object.callee?.type === 'Identifier' && ctx.actorNames.has(expr.object.callee.name)) ||
      (expr.object.type === 'Identifier' && (ctx.childActorVars.has(expr.object.name) || ctx.wrappedChildParams.has(expr.object.name))));
    if (isChild) {
      const target = expr.object.type === 'RefRead'
        ? (ctx.stateVarNames.has(expr.object.name) ? `this.#${expr.object.name}` : `${expr.object.name}.value`)
        : genExpr(ctx, expr.object);
      const positional = expr.args.filter(a => a.positional);
      const named = expr.args.filter(a => !a.positional);
      let op;
      const wireMethod = '@' + expr.method;
      if (positional.length === 0 && named.length === 0) {
        op = JSON.stringify(wireMethod);
      } else if (positional.length > 0) {
        const vals = positional.map(a => genExpr(ctx, a.expr)).join(', ');
        op = `[[${vals}], ${JSON.stringify(wireMethod)}]`;
      } else {
        const fields = named.map(a => {
          const val = a.expr ? genExpr(ctx, a.expr) : (ctx.stateVarNames.has(a.name) ? `this.#${a.name}` : a.name);
          return `${a.name}: ${val}`;
        }).join(', ');
        op = `[{${fields}}, ${JSON.stringify(wireMethod)}]`;
      }
      return `this.#childSend(${target}, ${op})`;
    }
    const objName = expr.object.type === 'Identifier' ? expr.object.name : (expr.object.type === 'RefRead' ? expr.object.name : null);
    const isRemoteInstance = objName && ctx.remoteInstanceVars.has(objName);
    // Local instance vars are bound by `t = Thing(args)` inside a handler
    // body — they hold the instance address directly (no this.# prefix).
    const isLocalInstance = objName && ctx.localInstanceVars?.has(objName);
    const named = expr.args.filter(a => !a.positional);
    const positional = expr.args.filter(a => a.positional);
    if (isRemoteInstance || isLocalInstance) {
      // Local instance vars resolve through SSA scope (the assignment may
      // have renamed `t` to `t__1`, etc.); state-var instances use this.#name.
      const to = isLocalInstance ? (ctx.ssaScope?.get(objName) || objName) : `this.#${objName}`;
      const method = '@' + expr.method;
      let op;
      if (positional.length === 0 && named.length === 0) {
        op = JSON.stringify(method);
      } else {
        const genArgVal = a => a.expr ? genExpr(ctx, a.expr) : (ctx.stateVarNames.has(a.name) ? `this.#${a.name}` : a.name);
        const posVals = positional.map(genArgVal).join(', ');
        const namedFields = named.map(a => `${a.name}: ${genArgVal(a)}`).join(', ');
        if (positional.length > 0 && named.length > 0) {
          op = `[${posVals}, {${namedFields}}, ${JSON.stringify(method)}]`;
        } else if (named.length > 0) {
          op = `[{${namedFields}}, ${JSON.stringify(method)}]`;
        } else {
          op = `[[${posVals}], ${JSON.stringify(method)}]`;
        }
      }
      return `this.#send(${op}, ${to})`;
    }
    const to = JSON.stringify(expr.object.name);
    const method = JSON.stringify('@' + expr.method);
    if (positional.length === 0 && named.length === 0) {
      return `this.#send(${method}, ${to})`;
    }
    const genArgVal = a => a.expr ? genExpr(ctx, a.expr) : (ctx.stateVarNames.has(a.name) ? `this.#${a.name}` : a.name);
    const posVals = positional.map(genArgVal).join(', ');
    const namedFields = named.map(a => `${a.name}: ${genArgVal(a)}`).join(', ');
    const posBva = positional.map(a => JSON.stringify(a.typeName || (a.expr ? inferLiteralType(a.expr) : null) || null)).join(', ');
    const namedBva = named.map(a => `${a.name}: ${JSON.stringify(a.typeName || (a.expr ? inferLiteralType(a.expr) : null) || null)}`).join(', ');
    if (positional.length > 0 && named.length > 0) {
      return `this.#send([${posVals}, {${namedFields}}, ${method}], ${to}, [${posBva}, {${namedBva}}])`;
    } else if (named.length > 0) {
      return `this.#send([{${namedFields}}, ${method}], ${to}, [{${namedBva}}])`;
    } else {
      return `this.#send([[${posVals}], ${method}], ${to}, [[${posBva}]])`;
    }
  }
  if (expr.type === 'DotAccessExpr') {
    // Bare field read on a child actor: c.val → this.#childSend(c, "@val")
    // Mirrors the no-args DotCallExpr path — the generated send is awaited
    // by the caller (DestructureAssign/Assign/ExprStatement check for
    // #childSend in the emitted code and insert an await).
    if (expr.object.type === 'Identifier' && ctx.childActorVars?.has(expr.object.name)) {
      const resolved = ctx.ssaScope?.get(expr.object.name) || expr.object.name;
      const target = ctx.childActorVars.get(expr.object.name) ? `${resolved}.value` : resolved;
      return `this.#childSend(${target}, ${JSON.stringify('@' + expr.property)})`;
    }
    const obj = genExpr(ctx, expr.object);
    return `${obj}.${expr.property}`;
  }
  throw new Error(`Unknown expression type: ${expr.type}`);
}

export function genDestructureAssign(ctx, { pattern, source }, overrideSrc, indent = '        ') {
  const src = overrideSrc !== undefined ? overrideSrc : genExpr(ctx, source);
  // Typed-value source: tagged structure `{ __type, x, y }` — read fields by
  // name. Positional pattern items resolve to the type's declared field at
  // that index. Validation in src/validate.js rejects over-arity and
  // undeclared-field references before reaching codegen.
  const sourceType = inferExprType(source, ctx.currentTypeEnv);
  const typeDecl = (typeof sourceType === 'string' && ctx.typeDecls?.has(sourceType))
    ? ctx.typeDecls.get(sourceType) : null;
  if (typeDecl) {
    const fields = typeDecl.fields || [];
    return pattern.map(item => {
      if (item.discard) return '';
      const ssaName = mintSsaName(ctx, item.name);
      if (item.named)
        return `\n${indent}const ${ssaName} = ${src}.${item.name};`;
      if (item.key !== undefined)
        return `\n${indent}const ${ssaName} = ${src}.${item.key};`;
      if (item.positional)
        return `\n${indent}const ${ssaName} = ${src}.${fields[item.idx].name};`;
      return '';
    }).join('');
  }
  return pattern.map(item => {
    if (item.discard) return '';
    const ssaName = mintSsaName(ctx, item.name);
    if (item.named)
      return `\n${indent}const ${ssaName} = ${src}.named[${JSON.stringify(item.name)}];`;
    if (item.key !== undefined)
      return `\n${indent}const ${ssaName} = ${src}.named[${JSON.stringify(item.key)}];`;
    if (item.positional)
      return `\n${indent}const ${ssaName} = ${src}.positional[${item.idx}];`;
    return '';
  }).join('');
}

export function genListDestructureAssign(ctx, { pattern, source }, ldIdx = 0, indent = '        ') {
  const srcCode = genExpr(ctx, source);
  const lines = [];
  let cur = srcCode;
  let hasRest = false;
  for (let i = 0; i < pattern.length; i++) {
    const item = pattern[i];
    if (item.rest) {
      hasRest = true;
      if (!item.discard && item.name) {
        const ssaName = mintSsaName(ctx, item.name);
        lines.push(`\n${indent}const ${ssaName} = ${cur};`);
      }
      break;
    }
    if (!item.discard && item.name) {
      const ssaName = mintSsaName(ctx, item.name);
      lines.push(`\n${indent}const ${ssaName} = (${cur}).head;`);
    }
    if (i < pattern.length - 1) {
      const tmp = `_ld${ldIdx}_${i}`;
      lines.push(`\n${indent}const ${tmp} = (${cur}).tail;`);
      cur = tmp;
    }
  }
  if (!hasRest && pattern.length > 0) {
    lines.push(`\n${indent}if ((${cur}).tail !== null) throw new Error('List destructure arity mismatch');`);
  }
  return lines.join('');
}

export function genReplyField(ctx, field, typeEnv) {
  const isList = t => typeof t === 'string' && t.startsWith('List');
  const isShape = t => typeof t === 'string' && ctx.typeDecls?.has(t);
  const wrapForReply = (expr, t) => {
    if (isList(t)) return `_List.toArray(${expr})`;
    if (t === 'Decimal') return `(${expr} instanceof BvDecimal ? ${expr}.toNumber() : ${expr})`;
    // Slice 12: typed reply slot — strip the runtime tag and reshape to wire
    // form (positional list when all fields are required, named map when any
    // optional). The bv-a `::Tag` annotation tells the receiver how to read.
    if (isShape(t)) return `_bv_to_wire(${expr})`;
    return expr;
  };
  if ('sigil' in field) {
    const name = field.sigil;
    const t = field.type || typeEnv?.get(name);
    let val = ctx.stateVarNames.has(name) ? `this.#${name}` : (field.ref ? `${name}.value` : ssaResolve(ctx, name));
    val = wrapForReply(val, t);
    return `${name}: ${val}`;
  }
  const valueCode = genExpr(ctx, field.value);
  const t = field.type
    || (typeEnv && field.value?.type === 'Identifier' ? typeEnv.get(field.value.name) : null)
    || inferExprType(field.value, typeEnv);
  const finalCode = wrapForReply(valueCode, t);
  return `${field.key}: ${finalCode}`;
}

export function genDestructure(ctx, params, indent = '        ') {
  if (params.length === 0) return '';
  const rest = params.find(p => p.rest);
  if (rest) return `\n${indent}const ${rest.name} = _s;`;
  const pos = params.filter(p => p.positional);
  const named = params.filter(p => !p.positional);
  const namedPart = p => p.key ? `${p.key}: ${p.name}` : p.name;
  const isListType = t => typeof t === 'string' && t.startsWith('List');
  const hasDefaults = params.some(p => p.defaultValue);
  const hasIntParams = params.some(p => p.type === 'Integer' && !p.ref);
  const hasDecParams = params.some(p => p.type === 'Decimal' && !p.ref);
  const wrapParam = (expr, p) => {
    if (p.ref) return expr;
    if (p.type === 'Integer') return `BigInt(${expr})`;
    if (p.type === 'Decimal') return `BvDecimal.from(${expr})`;
    return expr;
  };

  let code = '';
  if (pos.length > 0) {
    if (hasDefaults || hasIntParams || hasDecParams) {
      // Per-element access (required for type-aware wrapping or default fallback)
      for (let i = 0; i < pos.length; i++) {
        const p = pos[i];
        if (p.defaultValue) {
          const dv = genDefaultValue(p.defaultValue);
          code += `\n${indent}const ${p.name} = _s.positional.length > ${i} ? ${wrapParam(`_s.positional[${i}]`, p)} : ${dv};`;
        } else {
          code += `\n${indent}const ${p.name} = ${wrapParam(`_s.positional[${i}]`, p)};`;
        }
      }
    } else {
      code += `\n${indent}const [${pos.map(p => p.name).join(', ')}] = _s.positional;`;
    }
  }
  const listNamed = named.filter(p => isListType(p.type));
  const plainNamed = named.filter(p => !isListType(p.type));
  if (plainNamed.length > 0) {
    if (hasDefaults || hasIntParams || hasDecParams) {
      // Per-field access (required for type-aware wrapping or default fallback)
      for (const p of plainNamed) {
        const key = p.key || p.name;
        if (p.defaultValue) {
          const dv = genDefaultValue(p.defaultValue);
          code += `\n${indent}const ${p.name} = ${JSON.stringify(key)} in _s.named ? ${wrapParam(`_s.named[${JSON.stringify(key)}]`, p)} : ${dv};`;
        } else {
          code += `\n${indent}const ${p.name} = ${wrapParam(`_s.named[${JSON.stringify(key)}]`, p)};`;
        }
      }
    } else {
      code += `\n${indent}const { ${plainNamed.map(namedPart).join(', ')} } = _s.named;`;
    }
  }
  for (const p of listNamed) {
    const key = p.key || p.name;
    code += `\n${indent}const ${p.name} = _List.from(_s.named[${JSON.stringify(key)}]);`;
  }
  return code;
}

export function genDefaultValue(node) {
  if (node.type === 'IntLiteral') return `${node.value}n`;
  if (node.type === 'DecimalLiteral') {
    const { coeff, scale } = parseDecimalLiteral(node.value);
    return `new BvDecimal(${coeff}n, ${scale})`;
  }
  if (node.type === 'FloatLiteral') return String(node.value);
  if (node.type === 'StringLiteral') return JSON.stringify(node.value);
  if (node.type === 'BoolLiteral') return String(node.value);
  if (node.type === 'NullLiteral') return 'null';
  if (node.type === 'StructureLiteral') return '{}';
  return 'undefined';
}

export function genBvaBody(ctx, fields, typeEnv) {
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional);
  const isListOfAny = t => t === 'List of Anything' || t === 'List';
  const isFunctionType = t => t === 'Function' || (typeof t === 'string' && t.includes('->'));
  // Slice 13: shape-typed slots emit `::Name` so the receiving end can route
  // the parallel payload through `_bv_from_wire` for reconstruction. Bare
  // primitive tags (`'Integer'`, `'Boolean'`) stay unprefixed.
  const tagFor = t => (typeof t === 'string' && ctx.typeDecls?.has(t)) ? `::${t}` : t;
  const posTypes = [];
  for (const f of pos) {
    const t = f.type || (f.name ? typeEnv.get(f.name) : undefined) || inferExprType(f.expr, typeEnv);
    if (!t) return null;
    if (isFunctionType(t)) return null;
    if (isListOfAny(t)) {
      const varName = f.name ||
        (f.expr?.type === 'Identifier' ? f.expr.name : null);
      if (!varName) return null;
      const resolvedVar = ctx.stateVarNames.has(varName) ? `this.#${varName}` : ssaResolve(ctx, varName);
      posTypes.push(`_List.typesOf(${resolvedVar})`);
    } else {
      posTypes.push(JSON.stringify(tagFor(t)));
    }
  }
  const namedTypes = [];
  for (const f of named) {
    let key, t, varName;
    if ('sigil' in f) {
      key = f.sigil; t = f.type || typeEnv.get(f.sigil); varName = f.sigil;
    } else if (f.key !== undefined) {
      key = f.key;
      t = f.type || ((f.value?.type === 'Identifier' || f.value?.type === 'RefRead') ? typeEnv.get(f.value.name) : undefined) || inferExprType(f.value, typeEnv);
      varName = (f.value?.type === 'Identifier' || f.value?.type === 'RefRead') ? f.value.name : null;
    }
    if (!t) return null;
    if (isFunctionType(t)) return null;
    if (isListOfAny(t)) {
      if (!varName) return null;
      const resolvedVar = ctx.stateVarNames.has(varName) ? `this.#${varName}` : ssaResolve(ctx, varName);
      namedTypes.push(`${JSON.stringify(key)}: _List.typesOf(${resolvedVar})`);
    } else {
      namedTypes.push(`${JSON.stringify(key)}: ${JSON.stringify(tagFor(t))}`);
    }
  }
  if (pos.length > 0 && named.length > 0) {
    return `[${posTypes.join(', ')}, { ${namedTypes.join(', ')} }]`;
  } else if (pos.length > 0) {
    return `[${posTypes.join(', ')}]`;
  } else {
    return `{ ${namedTypes.join(', ')} }`;
  }
}

export function genReBody(ctx, fields, typeEnv, declaredReturnType = null, { skipTypeCheck = false } = {}) {
  if (!skipTypeCheck) checkReplyFieldTypes(ctx, fields, declaredReturnType);
  const spread = fields.find(f => f.spread);
  if (spread) return `Structure.splat(${ssaResolve(ctx, spread.name)})`;
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional);
  const isList = t => typeof t === 'string' && t.startsWith('List');
  const isShape = t => typeof t === 'string' && ctx.typeDecls?.has(t);
  const posVal = f => {
    const raw = f.expr ? genExpr(ctx, f.expr) : (ctx.stateVarNames.has(f.name) ? `this.#${f.name}` : ssaResolve(ctx, f.name));
    const name = f.name || (f.expr?.type === 'Identifier' ? f.expr.name : null);
    const t = f.type || (typeEnv && name ? typeEnv.get(name) : null) || inferExprType(f.expr, typeEnv);
    if (isList(t)) return `_List.toArray(${raw})`;
    if (t === 'Structure') return `Structure.splat(${raw})`;
    if (t === 'Decimal') {
      const base = f.expr && CALL_LIKE.has(f.expr.type) ? `Structure.one(${raw}, ${JSON.stringify(name ?? 'value')})` : raw;
      return `(${base} instanceof BvDecimal ? ${base}.toNumber() : ${base})`;
    }
    // Slice 12: shape-typed positional reply slot — wire-form before send.
    if (isShape(t)) return `_bv_to_wire(${raw})`;
    if (f.expr && CALL_LIKE.has(f.expr.type)) return `Structure.one(${raw}, ${JSON.stringify(name ?? 'value')})`;
    return raw;
  };
  if (pos.length > 0 && named.length > 0) {
    return `[${pos.map(posVal).join(', ')}, { ${named.map(f => genReplyField(ctx, f, typeEnv)).join(', ')} }]`;
  } else if (pos.length > 0) {
    return `[${pos.map(posVal).join(', ')}]`;
  } else {
    return `{ ${named.map(f => genReplyField(ctx, f, typeEnv)).join(', ')} }`;
  }
}

export function genTypeCondition(ctx, params) {
  if (params.length === 0) return null;
  if (params.find(p => p.rest)) return null; // rest is the universal matcher
  const isListOfAny = t => t === 'List of Anything' || t === 'List';
  const namedParams = params.filter(p => !p.positional && !isListOfAny(p.type));
  const named = namedParams.map(p => `[${JSON.stringify(p.key || p.name)},${JSON.stringify(p.type)}]`);
  const posParams = params.filter(p => p.positional && !isListOfAny(p.type));
  const pos = posParams.map(p => JSON.stringify(p.type));
  if (named.length === 0 && pos.length === 0) return null;
  // Count required positional params (no default value)
  const requiredPosCount = posParams.filter(p => !p.defaultValue).length;
  const hasOptional = requiredPosCount < posParams.length || namedParams.some(p => p.defaultValue);
  if (hasOptional) {
    return `_matchTypes(_types, [${named.filter((_, i) => !namedParams[i].defaultValue).join(',')}], [${pos.join(',')}], ${requiredPosCount})`;
  }
  return `_matchTypes(_types, [${named.join(',')}], [${pos.join(',')}])`;
}
