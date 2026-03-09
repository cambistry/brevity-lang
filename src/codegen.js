const LIST_PREAMBLE = `const _List = {
  empty: null,
  cons(head, tail) { return { head, tail }; },
  from(arr) { if (arr === null) return null; return arr.reduceRight((tail, head) => ({ head, tail }), null); },
  toArray(list) { if (list === null) return null; const a = []; while (list !== null) { a.push(list.head); list = list.tail; } return a; },
  _typeOf(v) { if (typeof v === 'number') return 'Integer'; if (typeof v === 'string') return 'Text'; if (typeof v === 'boolean') return 'Boolean'; return 'Anything'; },
  typesOf(list) { const a = []; let l = list; while (l !== null) { a.push(_List._typeOf(l.head)); l = l.tail; } return a; },
  async mapAsync(list, fn) {
    if (list === null) return null;
    const results = [];
    let cur = list;
    while (cur !== null) {
      const r = await fn(Structure.pack([cur.head]));
      results.push(Structure.one(r, 'over'));
      cur = cur.tail;
    }
    return _List.from(results);
  },
  async foldAsync(list, initial, fn) {
    if (list === null) return null;
    let acc = initial;
    let cur = list;
    if (acc === null) {
      acc = cur.head;
      cur = cur.tail;
      if (cur === null) return acc;
    }
    while (cur !== null) {
      const r = await fn(Structure.pack([acc, cur.head]));
      acc = Structure.one(r, 'fold');
      cur = cur.tail;
    }
    return acc;
  },
};`;

const STRUCTURE_PREAMBLE = `const Structure = {
  pack(payload) {
    if (payload == null) return { positional: [], named: {}, positional_types: null, named_types: null };
    if (Array.isArray(payload)) {
      const last = payload[payload.length - 1];
      if (last !== null && typeof last === 'object' && !Array.isArray(last)) {
        return { positional: payload.slice(0, -1), named: last, positional_types: null, named_types: null };
      }
      return { positional: payload, named: {}, positional_types: null, named_types: null };
    }
    return { positional: [], named: payload, positional_types: null, named_types: null };
  },
  one(s, name) {
    if (s.positional.length !== 1)
      throw new Error("'" + name + "' requires exactly 1 positional return value, got " + s.positional.length);
    return s.positional[0];
  },
  splat({ positional, named }) {
    const hasPos = positional.length > 0;
    const hasNamed = Object.keys(named).length > 0;
    if (hasPos && hasNamed) return [...positional, named];
    if (hasPos) return positional;
    return named;
  },
};
function _matchTypes(types, named, positional) {
  if (types === null) return named.length === 0 && positional.length === 0;
  if (types.positional.length !== positional.length) return false;
  for (let i = 0; i < positional.length; i++) {
    if (types.positional[i] !== positional[i]) return false;
  }
  for (const [name, type] of named) {
    if (!(name in types.named)) return false;
    if (types.named[name] !== type) return false;
  }
  return true;
}`;

function genExpr(expr) {
  if (expr.type === 'StringLiteral') return JSON.stringify(expr.value);
  if (expr.type === 'Identifier')    return expr.name;
  if (expr.type === 'IntLiteral')    return String(expr.value);
  if (expr.type === 'NullLiteral')   return 'null';
  if (expr.type === 'BoolLiteral')   return expr.value ? 'true' : 'false';
  if (expr.type === 'OverExpr') {
    return `await _List.mapAsync(${genExpr(expr.collection)}, ${genExpr(expr.fn)})`;
  }
  if (expr.type === 'FoldExpr') {
    const init = expr.initial ? genExpr(expr.initial) : 'null';
    return `await _List.foldAsync(${genExpr(expr.collection)}, ${init}, ${genExpr(expr.fn)})`;
  }
  if (expr.type === 'BinaryExpr')    return `${genExpr(expr.left)} ${expr.op} ${genExpr(expr.right)}`;
  if (expr.type === 'IndexExpr') {
    const obj = genExpr(expr.object);
    if (expr.key !== null) return `${obj}.named[${JSON.stringify(expr.key)}]`;
    return `${obj}.positional[${expr.index}]`;
  }
  if (expr.type === 'ListLiteral') {
    if (expr.elements.length === 0) return '_List.empty';
    return `_List.from([${expr.elements.map(genExpr).join(', ')}])`;
  }
  if (expr.type === 'StructureLiteral') {
    return genExpr({ ...expr, type: 'StructureConstructor' });
  }
  if (expr.type === 'StructureConstructor') {
    const positional = expr.args.filter(a => a.positional);
    const named = expr.args.filter(a => a.key !== undefined);
    const posVals = positional.map(a => genExpr(a.expr)).join(', ');
    const posTypes = positional.length > 0
      ? `[${positional.map(a => JSON.stringify(a.type)).join(', ')}]`
      : 'null';
    const namedVals = named.map(a => `${JSON.stringify(a.key)}: ${genExpr(a.expr)}`).join(', ');
    const namedTypes = named.length > 0
      ? `{${named.map(a => `${JSON.stringify(a.key)}: ${JSON.stringify(a.type)}`).join(', ')}}`
      : 'null';
    return `{ positional: [${posVals}], named: {${namedVals}}, positional_types: ${posTypes}, named_types: ${namedTypes} }`;
  }
  if (expr.type === 'ProcCallExpr') {
    const payload = expr.args.length === 0
      ? 'Structure.pack(null)'
      : `Structure.pack([${expr.args.map(genExpr).join(', ')}])`;
    return `await this.#${expr.name}Proc(${payload})`;
  }
  if (expr.type === 'FunctionCallExpr') {
    const payload = expr.args.length === 0
      ? 'Structure.pack(null)'
      : `Structure.pack([${expr.args.map(genExpr).join(', ')}])`;
    return `await ${expr.name}(${payload})`;
  }
  if (expr.type === 'NamedArgsBag') {
    const fields = Object.entries(expr.fields)
      .map(([k, v]) => `${JSON.stringify(k)}: ${genExpr(v)}`).join(', ');
    return `{ ${fields} }`;
  }
  if (expr.type === 'Function') {
    const destr = genDestructure(expr.params).replace(/\n {8}/g, '\n  ');
    if (expr.body) {
      return genFunctionBodyCode(expr.params, expr.body);
    }
    return `async (_s) => {${destr}\n  return Structure.pack([${genExpr(expr.expr)}]);\n}`;
  }
  throw new Error(`Unknown expression type: ${expr.type}`);
}

function genDestructureAssign({ pattern, source }, overrideSrc) {
  const src = overrideSrc !== undefined ? overrideSrc : genExpr(source);
  return pattern.map(item => {
    if (item.discard) return '';
    if (item.named)
      return `\n        const ${item.name} = ${src}.named[${JSON.stringify(item.name)}];`;
    if (item.key !== undefined)
      return `\n        const ${item.name} = ${src}.named[${JSON.stringify(item.key)}];`;
    if (item.positional)
      return `\n        const ${item.name} = ${src}.positional[${item.idx}];`;
    return '';
  }).join('');
}

function genListDestructureAssign({ pattern, source }, ldIdx = 0) {
  const srcCode = genExpr(source);
  const lines = [];
  let cur = srcCode;
  let hasRest = false;
  for (let i = 0; i < pattern.length; i++) {
    const item = pattern[i];
    if (item.rest) {
      hasRest = true;
      if (!item.discard && item.name)
        lines.push(`\n        const ${item.name} = ${cur};`);
      break;
    }
    if (!item.discard && item.name)
      lines.push(`\n        const ${item.name} = (${cur}).head;`);
    if (i < pattern.length - 1) {
      const tmp = `_ld${ldIdx}_${i}`;
      lines.push(`\n        const ${tmp} = (${cur}).tail;`);
      cur = tmp;
    }
  }
  if (!hasRest && pattern.length > 0) {
    lines.push(`\n        if ((${cur}).tail !== null) throw new Error('List destructure arity mismatch');`);
  }
  return lines.join('');
}

function genReplyField(field, typeEnv) {
  const isList = t => typeof t === 'string' && t.startsWith('List');
  if ('sigil' in field) {
    const name = field.sigil;
    const t = field.type || typeEnv?.get(name);
    const val = isList(t) ? `_List.toArray(${name})` : name;
    return `${name}: ${val}`;
  }
  const valueCode = genExpr(field.value);
  const t = field.type || (typeEnv && field.value?.type === 'Identifier' ? typeEnv.get(field.value.name) : null);
  const finalCode = isList(t) ? `_List.toArray(${valueCode})` : valueCode;
  return `${field.key}: ${finalCode}`;
}

function genDestructure(params) {
  if (params.length === 0) return '';
  const rest = params.find(p => p.rest);
  if (rest) return `\n        const ${rest.name} = _s;`;
  const pos = params.filter(p => p.positional);
  const named = params.filter(p => !p.positional);
  const namedPart = p => p.key ? `${p.key}: ${p.name}` : p.name;
  const isListType = t => typeof t === 'string' && t.startsWith('List');

  let code = '';
  if (pos.length > 0) {
    code += `\n        const [${pos.map(p => p.name).join(', ')}] = _s.positional;`;
  }
  const listNamed = named.filter(p => isListType(p.type));
  const plainNamed = named.filter(p => !isListType(p.type));
  if (plainNamed.length > 0) {
    code += `\n        const { ${plainNamed.map(namedPart).join(', ')} } = _s.named;`;
  }
  for (const p of listNamed) {
    const key = p.key || p.name;
    code += `\n        const ${p.name} = _List.from(_s.named[${JSON.stringify(key)}]);`;
  }
  return code;
}

const NEEDS_TYPE = new Set(['IntLiteral', 'StringLiteral', 'BinaryExpr']);

function checkReplyFieldTypes(fields) {
  for (const f of fields) {
    if (f.positional && f.expr && NEEDS_TYPE.has(f.expr.type) && f.type === null) {
      throw new Error(`Reply/return expression requires a type annotation — use 'expr : Type'`);
    }
    if (f.key !== undefined && f.value && NEEDS_TYPE.has(f.value.type) && f.type === null) {
      throw new Error(`Reply/return field '${f.key}: ...' requires a type annotation — use '${f.key}: expr : Type'`);
    }
  }
}

function buildTypeEnv(params, body) {
  const env = new Map();
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
        if (typeName) env.set(item.name, typeName);
      }
    } else if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (item.discard || !item.name) continue;
        if (item.type) env.set(item.name, item.type);
      }
    }
  }
  return env;
}

function genBvaBody(fields, typeEnv) {
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional);
  const isListOfAny = t => t === 'List of Anything' || t === 'List';
  const posTypes = [];
  for (const f of pos) {
    const t = f.type || (f.name ? typeEnv.get(f.name) : undefined);
    if (!t) return null;
    if (isListOfAny(t)) {
      const varName = f.name || (f.expr?.type === 'Identifier' ? f.expr.name : null);
      if (!varName) return null;
      posTypes.push(`_List.typesOf(${varName})`);
    } else {
      posTypes.push(JSON.stringify(t));
    }
  }
  const namedTypes = [];
  for (const f of named) {
    let key, t, varName;
    if ('sigil' in f) {
      key = f.sigil; t = f.type || typeEnv.get(f.sigil); varName = f.sigil;
    } else if (f.key !== undefined) {
      key = f.key;
      t = f.type || (f.value?.type === 'Identifier' ? typeEnv.get(f.value.name) : undefined);
      varName = f.value?.type === 'Identifier' ? f.value.name : null;
    }
    if (!t) return null;
    if (isListOfAny(t)) {
      if (!varName) return null;
      namedTypes.push(`${JSON.stringify(key)}: _List.typesOf(${varName})`);
    } else {
      namedTypes.push(`${JSON.stringify(key)}: ${JSON.stringify(t)}`);
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

function genReBody(fields, typeEnv) {
  checkReplyFieldTypes(fields);
  const spread = fields.find(f => f.spread);
  if (spread) return `Structure.splat(${spread.name})`;
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional);
  const isList = t => typeof t === 'string' && t.startsWith('List');
  const posVal = f => {
    const raw = f.expr ? genExpr(f.expr) : f.name;
    const name = f.name || (f.expr?.type === 'Identifier' ? f.expr.name : null);
    const t = f.type || (typeEnv && name ? typeEnv.get(name) : null);
    return isList(t) ? `_List.toArray(${raw})` : raw;
  };
  if (pos.length > 0 && named.length > 0) {
    return `[${pos.map(posVal).join(', ')}, { ${named.map(f => genReplyField(f, typeEnv)).join(', ')} }]`;
  } else if (pos.length > 0) {
    return `[${pos.map(posVal).join(', ')}]`;
  } else {
    return `{ ${named.map(f => genReplyField(f, typeEnv)).join(', ')} }`;
  }
}

function genTypeCondition(params) {
  if (params.length === 0) return null;
  if (params.find(p => p.rest)) return null; // rest is the universal matcher
  const isListOfAny = t => t === 'List of Anything' || t === 'List';
  const named = params.filter(p => !p.positional && !isListOfAny(p.type))
    .map(p => `[${JSON.stringify(p.key || p.name)},${JSON.stringify(p.type)}]`);
  const pos = params.filter(p => p.positional && !isListOfAny(p.type))
    .map(p => JSON.stringify(p.type));
  if (named.length === 0 && pos.length === 0) return null;
  return `_matchTypes(_types, [${named.join(',')}], [${pos.join(',')}])`;
}

function genFunctionBodyCode(params, body, outerEnv = null) {
  checkTypeConsistency(body);
  const typeEnv = buildTypeEnv(params, body);
  const destr = genDestructure(params).replace(/\n {8}/g, '\n  ');
  let code = '';
  let _tmpIdx = 0;
  let _ldIdx = 0;
  let _ifIdx = 0;
  let _lastTypedName = null;
  for (const s of body) {
    if (s.type === 'BareTypeDecl') {
      continue; // no JS output — type annotation only
    } else if (s.type === 'ListDestructure') {
      _lastTypedName = null;
      code += genListDestructureAssign(s, _ldIdx++).replace(/\n {8}/g, '\n  ');
    } else if (s.type === 'Assign') {
      _lastTypedName = null;
      if (outerEnv?.has(s.name)) {
        throw new Error(`Cannot re-bind '${s.name}' from inside a function — use '${s.name} : Type = ...' to shadow it`);
      }
      if (s.value.type === 'StructureLiteral') {
        code += `\n  const ${s.name} = ${genExpr(s.value)};`;
      } else if (s.value.type === 'ListLiteral') {
        code += `\n  const ${s.name} = ${genExpr(s.value)};`;
      } else if (s.value.type === 'StructureConstructor') {
        const positionals = s.value.args.filter(a => a.positional);
        if (positionals.length > 1) {
          throw new Error(`Cannot assign ${positionals.length}-arity Structure to '${s.name}' — use ': Structure' type annotation`);
        }
        code += `\n  const ${s.name} = (${genExpr(s.value)}).positional[0];`;
      } else if (CALL_LIKE.has(s.value.type)) {
        code += `\n  const ${s.name} = Structure.one(${genExpr(s.value)}, ${JSON.stringify(s.name)});`;
      } else {
        code += `\n  const ${s.name} = ${genExpr(s.value)};`;
      }
    } else if (s.type === 'TypedAssign') {
      _lastTypedName = s.name;
      if (s.value.type === 'IfExpr') {
        const tmpVar = `_if${_ifIdx++}`;
        code += `\n  let ${tmpVar} = null;`;
        code += `\n  ` + genIfChain(s.value, tmpVar, typeEnv).replace(/\n {8}/g, '\n  ');
        code += `\n  const ${s.name} = ${tmpVar};`;
      } else if (s.typeName === 'Structure') {
        code += `\n  const ${s.name} = ${genExpr(s.value)};`;
      } else if (CALL_LIKE.has(s.value.type)) {
        code += `\n  const ${s.name} = Structure.one(${genExpr(s.value)}, ${JSON.stringify(s.name)});`;
      } else if (s.value.type === 'StructureConstructor') {
        code += `\n  const ${s.name} = (${genExpr(s.value)}).positional[0];`;
      } else {
        code += `\n  const ${s.name} = ${genExpr(s.value)};`;
      }
    } else if (s.type === 'DestructureAssign') {
      _lastTypedName = null;
      checkNamedFields(s.pattern, s.source);
      if (CALL_LIKE.has(s.source.type) || s.source.type === 'StructureConstructor') {
        const tmp = `_r${_tmpIdx++}`;
        code += `\n  const ${tmp} = ${genExpr(s.source)};`;
        code += genDestructureAssign(s, tmp).replace(/\n {8}/g, '\n  ');
      } else {
        code += genDestructureAssign(s).replace(/\n {8}/g, '\n  ');
      }
    } else if (s.type === 'Return') {
      _lastTypedName = null;
      code += `\n  return Structure.pack(${genReBody(s.fields, typeEnv)});`;
    } else if (s.type === 'ImplicitReturn') {
      _lastTypedName = null;
      code += `\n  return Structure.pack([${genExpr(s.expr)}]);`;
    }
  }
  if (_lastTypedName !== null) {
    code += `\n  return Structure.pack([${_lastTypedName}]);`;
  }
  return `async (_s) => {${destr}${code}\n}`;
}

const CALL_LIKE = new Set(['FunctionCallExpr', 'ProcCallExpr']);

function checkTypeConsistency(body) {
  const typeMap = new Map();
  function checkAndSet(name, typeName) {
    if (typeMap.has(name) && typeMap.get(name) !== typeName) {
      throw new Error(`Conflicting type declarations for '${name}': '${typeMap.get(name)}' vs '${typeName}'`);
    }
    typeMap.set(name, typeName);
  }
  for (const s of body) {
    if (s.type === 'BareTypeDecl') {
      checkAndSet(s.name, s.typeName);
    } else if (s.type === 'TypedAssign') {
      checkAndSet(s.name, s.typeName);
    } else if (s.type === 'DestructureAssign') {
      for (const item of s.pattern) {
        if (!item.discard && item.name && item.type) checkAndSet(item.name, item.type);
      }
    } else if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (!item.discard && !item.rest && item.name && item.type) checkAndSet(item.name, item.type);
      }
    }
  }
}

function checkNamedFields(pattern, source) {
  // Compile-time check: named pattern items must exist in StructureConstructor literal
  if (source.type !== 'StructureConstructor') return;
  const literalKeys = new Set(source.args.filter(a => a.key !== undefined).map(a => a.key));
  for (const item of pattern) {
    const key = item.key !== undefined ? item.key : item.named ? item.name : null;
    if (key !== null && !literalKeys.has(key)) {
      throw new Error(`Field '${key}' not found in Structure literal`);
    }
  }
}

function genIfBlockBody(body, tmpVar, outerEnv) {
  let code = '';
  let _rIdx = 0;
  let lastTypedName = null;
  for (const s of body) {
    if (s.type === 'BareTypeDecl') continue;
    if (s.type === 'TypedAssign') {
      lastTypedName = s.name;
      if (CALL_LIKE.has(s.value.type)) {
        code += `\n        const ${s.name} = Structure.one(${genExpr(s.value)}, ${JSON.stringify(s.name)});`;
      } else {
        code += `\n        const ${s.name} = ${genExpr(s.value)};`;
      }
    } else if (s.type === 'Assign') {
      lastTypedName = null;
      // Compile-time check: plain assignment (no LHS type) to an outer-scope variable is
      // a mutation attempt — use 'x : Type = ...' to explicitly shadow instead
      if (outerEnv?.has(s.name)) {
        throw new Error(`Cannot re-bind '${s.name}' from inside an if block — use '${s.name} : Type = ...' to shadow it`);
      }
      if (CALL_LIKE.has(s.value.type)) {
        code += `\n        const ${s.name} = Structure.one(${genExpr(s.value)}, ${JSON.stringify(s.name)});`;
      } else {
        code += `\n        const ${s.name} = ${genExpr(s.value)};`;
      }
    } else if (s.type === 'DestructureAssign') {
      lastTypedName = null;
      checkNamedFields(s.pattern, s.source);
      if (CALL_LIKE.has(s.source.type) || s.source.type === 'StructureConstructor') {
        const tmp = `_r${_rIdx++}`;
        code += `\n        const ${tmp} = ${genExpr(s.source)};`;
        code += genDestructureAssign(s, tmp);
      } else {
        code += genDestructureAssign(s);
      }
    } else if (s.type === 'ImplicitReturn') {
      lastTypedName = null;
      code += `\n        ${tmpVar} = ${genExpr(s.expr)};`;
    }
  }
  if (lastTypedName !== null) {
    code += `\n        ${tmpVar} = ${lastTypedName};`;
  }
  return code;
}

function genIfChain(ifExpr, tmpVar, outerEnv) {
  const condCode = genExpr(ifExpr.cond);
  const truthy = `(${condCode}) !== false && (${condCode}) !== null`;

  const genBranch = (branch) => {
    if (!branch) return `\n        ${tmpVar} = null;`;
    if (branch.type === 'IfExpr') return `\n        ` + genIfChain(branch, tmpVar, outerEnv);
    if (branch.body)              return genIfBlockBody(branch.body, tmpVar, outerEnv);
    return `\n        ${tmpVar} = ${genExpr(branch.expr)};`;
  };

  let code = `if (${truthy}) {`;
  code += genBranch(ifExpr.then);
  if (ifExpr.else) {
    if (ifExpr.else.type === 'IfExpr') {
      code += `\n        } else ` + genIfChain(ifExpr.else, tmpVar, outerEnv);
    } else {
      code += `\n        } else {`;
      code += genBranch(ifExpr.else);
      code += `\n        }`;
    }
  } else {
    code += `\n        }`;
  }
  return code;
}

function genLocals(body, outerEnv) {
  checkTypeConsistency(body);
  let _tmpIdx = 0;
  let _ldIdx = 0;
  let _ifIdx = 0;
  const stmts = body.filter(s => s.type === 'Assign' || s.type === 'DestructureAssign' || s.type === 'TypedAssign' || s.type === 'ListDestructure');
  return stmts.map(s => {
    if (s.type === 'ListDestructure') {
      return genListDestructureAssign(s, _ldIdx++);
    }
    if (s.type === 'DestructureAssign') {
      checkNamedFields(s.pattern, s.source);
      if (CALL_LIKE.has(s.source.type) || s.source.type === 'StructureConstructor') {
        const tmp = `_r${_tmpIdx++}`;
        return `\n        const ${tmp} = ${genExpr(s.source)};` + genDestructureAssign(s, tmp);
      }
      return genDestructureAssign(s);
    }
    if (s.type === 'TypedAssign') {
      // IfExpr: generate let tmpVar + if/else chain + const name = tmpVar
      if (s.value.type === 'IfExpr') {
        const tmpVar = `_if${_ifIdx++}`;
        return (
          `\n        let ${tmpVar} = null;` +
          `\n        ` + genIfChain(s.value, tmpVar, outerEnv) +
          `\n        const ${s.name} = ${tmpVar};`
        );
      }
      // s : Structure = expr → keep whole structure
      if (s.typeName === 'Structure') return `\n        const ${s.name} = ${genExpr(s.value)};`;
      // call RHS: runtime 1-arity check
      if (CALL_LIKE.has(s.value.type))
        return `\n        const ${s.name} = Structure.one(${genExpr(s.value)}, ${JSON.stringify(s.name)});`;
      // StructureConstructor: unwrap single positional
      if (s.value.type === 'StructureConstructor')
        return `\n        const ${s.name} = (${genExpr(s.value)}).positional[0];`;
      // primitive expression: use value directly
      return `\n        const ${s.name} = ${genExpr(s.value)};`;
    }
    // Plain assign
    if (s.value.type === 'StructureLiteral') {
      return `\n        const ${s.name} = ${genExpr(s.value)};`;
    }
    if (s.value.type === 'ListLiteral') {
      return `\n        const ${s.name} = ${genExpr(s.value)};`;
    }
    if (s.value.type === 'StructureConstructor') {
      const positionals = s.value.args.filter(a => a.positional);
      if (positionals.length > 1) {
        throw new Error(`Cannot assign ${positionals.length}-arity Structure to '${s.name}' — use ': Structure' type annotation`);
      }
      throw new Error(`Variable '${s.name}' requires a type annotation — use '${s.name} : Type = ...'`);
    }
    if (s.value.type === 'Function') {
      const fnCode = s.value.body
        ? genFunctionBodyCode(s.value.params, s.value.body, outerEnv)
        : genExpr(s.value);
      return `\n        const ${s.name} = ${fnCode};`;
    }
    if (s.value.type === 'IndexExpr') {
      return `\n        const ${s.name} = ${genExpr(s.value)};`;
    }
    throw new Error(`Variable '${s.name}' requires a type annotation — use '${s.name} : Type = ...'`);
  }).join('');
}

function genHandler({ op, params, body }) {
  const reply = body.find(s => s.type === 'Reply');
  const destructure = genDestructure(params);
  const typeEnv = buildTypeEnv(params, body);
  const locals = genLocals(body, typeEnv);
  const reLine = reply ? `\n        re = { ${op}: ${genReBody(reply.fields, typeEnv)} };` : '';
  let bvaLine = '';
  if (reply) {
    if (reply.fields.some(f => f.spread)) {
      bvaLine = `\n        _bva_re = { ${JSON.stringify(op)}: _bva != null ? _bva[${JSON.stringify(op)}] : undefined };`;
    } else {
      const bvaBody = genBvaBody(reply.fields, typeEnv);
      if (bvaBody !== null) {
        bvaLine = `\n        _bva_re = { ${JSON.stringify(op)}: ${bvaBody} };`;
      }
    }
  }
  const typeCondition = genTypeCondition(params);
  const condition = typeCondition
    ? `opName === "${op}" && ${typeCondition}`
    : `opName === "${op}"`;
  return { condition, block: `${destructure}${locals}${reLine}${bvaLine}\n        _handled = true;` };
}

function genProcMethod({ op, params, body }) {
  const reply = body.find(s => s.type === 'Reply');
  const destructure = genDestructure(params);
  const typeEnv = buildTypeEnv(params, body);
  const locals = genLocals(body, typeEnv);
  const reLine = reply ? `\n        re = ${genReBody(reply.fields)};` : '\n        re = null;';
  return `  async #${op}Proc(_s) {${destructure}${locals}
    let re;${reLine}
    return Structure.pack(re);
  }`;
}

function genClass(actor, exportKw) {
  const name = actor.name ? ` ${actor.name}` : '';

  // Namespace conflict check
  const handlerOps = new Set(actor.handlers.map(h => h.op));
  for (const proc of actor.procs) {
    if (handlerOps.has(proc.op)) {
      throw new Error(`'${proc.op}' is declared as both an 'on' handler and a 'proc'`);
    }
  }

  const usesStructure = actor.handlers.some(h => h.params.length > 0) || actor.procs.length > 0;
  const usesTypeMatching = actor.handlers.some(h => h.params.some(p => !p.rest));

  const handlerParts = actor.handlers.map(genHandler);
  const ifChain = handlerParts.map(({ condition, block }, i) => {
    const kw = i === 0 ? '    if' : '    } else if';
    return `${kw} (${condition}) {${block}`;
  }).join('\n') + '\n    }';

  const structureLine = usesStructure
    ? '\n    const _s = Structure.pack(payload);'
    : '';
  const bvaDecl = "\n    const _bva = message['bv-a'];";
  const typesLines = usesTypeMatching
    ? "\n    const _types = _bva != null ? Structure.pack(_bva[opName] ?? null) : null;"
    : '';

  const procMethods = actor.procs.map(genProcMethod).join('\n\n');
  const procSection = procMethods ? '\n\n' + procMethods : '';

  return `${exportKw}class${name} {
  #binding
  #pending = new Map()
  #nextId = 0

  constructor(binding) { this.#binding = binding; }

  async #send(op, to) {
    const id = String(++this.#nextId);
    return new Promise(resolve => {
      this.#pending.set(id, resolve);
      this.#binding.post({ id, op, to });
    });
  }${procSection}

  receive(message) {
    if ('re' in message) {
      const resolve = this.#pending.get(message.id);
      if (resolve) { this.#pending.delete(message.id); resolve(message.re); }
      return;
    }
    this.#dispatch(message);
  }

  async #dispatch(message) {
    const { id, from } = message;
    const opName = typeof message.op === 'string' ? message.op : Object.keys(message.op)[0];
    const _rawPayload = typeof message.op === 'object' && message.op !== null ? message.op[opName] : null;
    const _hasPayload = _rawPayload !== null && _rawPayload !== undefined &&
      (Array.isArray(_rawPayload) ? _rawPayload.length > 0 : Object.keys(_rawPayload).length > 0);
    if (_hasPayload && !('bv-a' in message)) {
      this.#binding.post({ id, ex: { [opName]: 'schema_required' }, to: from });
      return;
    }
    const payload = _rawPayload ?? {};${structureLine}${bvaDecl}${typesLines}
    let re;
    let _bva_re;
    let _handled = false;
    try {
${ifChain}
    } catch (err) {
      this.#binding.post({ id, ex: { [opName]: 'error' }, to: from });
      return;
    }
    if (!_handled) {
      this.#binding.post({ id, ex: { [opName]: 'unhandled' }, to: from });
    } else if (re !== undefined) {
      const _bva_val = _bva_re != null ? _bva_re[opName] : undefined;
      const _post = { id, re, to: from };
      if (_bva_val !== undefined) _post['bv-a'] = _bva_re;
      this.#binding.post(_post);
    }
  }
}`;
}

export function codegen(ast) {
  const active = ast.actors.filter(a => a.handlers.length > 0 || a.procs.length > 0);
  if (active.length === 0) return '';

  function bodyUsesStructure(body) {
    return body.some(s =>
      s.type === 'DestructureAssign' ||
      s.type === 'TypedAssign' ||
      (s.type === 'Assign' && (
        s.value.type === 'Function' ||
        s.value.type === 'StructureLiteral' ||
        s.value.type === 'StructureConstructor' ||
        CALL_LIKE.has(s.value.type)
      ))
    );
  }
  function bodyUsesList(body) {
    const iterExpr = t => t === 'OverExpr' || t === 'FoldExpr';
    return body.some(s =>
      s.type === 'ListDestructure' ||
      (s.type === 'Assign' && (s.value?.type === 'ListLiteral' || iterExpr(s.value?.type))) ||
      (s.type === 'TypedAssign' && (
        (typeof s.typeName === 'string' && s.typeName.startsWith('List')) ||
        iterExpr(s.value?.type)
      )) ||
      (s.type === 'BareTypeDecl' && typeof s.typeName === 'string' && s.typeName.startsWith('List'))
    );
  }
  const needsPreamble = active.some(a =>
    a.handlers.some(h => h.params.length > 0 || bodyUsesStructure(h.body)) ||
    a.procs.length > 0
  );
  const needsListPreamble = active.some(a =>
    a.handlers.some(h =>
      h.params.some(p => typeof p.type === 'string' && p.type.startsWith('List')) ||
      bodyUsesList(h.body)
    ) || a.procs.some(p =>
      p.params.some(param => typeof param.type === 'string' && param.type.startsWith('List')) ||
      bodyUsesList(p.body)
    )
  );
  const classes = active.map(a => genClass(a, a.name ? 'export ' : 'export default ') + '\n').join('\n');
  return (needsPreamble ? STRUCTURE_PREAMBLE + '\n\n' : '') +
         (needsListPreamble ? LIST_PREAMBLE + '\n\n' : '') +
         classes;
}
