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
      acc = Structure.one(r, 'reduce');
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

let _actorNames = new Set();
let _actorFnNames = new Set();
let _stateVarNames = new Set();
let _childActorVars = new Map(); // name → boolean (true = ref, false = plain assign)

function collectFreeVars(funcNode) {
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
    if (expr.type === 'ListLiteral') { expr.elements.forEach(walkExpr); return; }
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
      collectFreeVars(expr).forEach(v => ids.add(v));
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
      } else if (s.type === 'PutStatement') {
        ids.add(s.name);
        walkExpr(s.value);
      } else if (s.type === 'ActorPutStatement') {
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
  return [...ids].filter(v => !paramNames.has(v) && !localDefs.has(v) && !_actorFnNames.has(v) && !_stateVarNames.has(v));
}

function wrapWithCapture(code, funcNode, selfName) {
  const freeVars = collectFreeVars(funcNode).filter(v => v !== selfName);
  if (freeVars.length === 0) return code;
  return `((${freeVars.join(', ')}) => ${code})(${freeVars.join(', ')})`;
}

function genExpr(expr) {
  if (expr.type === 'StringLiteral')  return JSON.stringify(expr.value);
  if (expr.type === 'Identifier')     return _stateVarNames.has(expr.name) ? `this.#${expr.name}` : expr.name;
  if (expr.type === 'RefRead')       return _stateVarNames.has(expr.name) ? `this.#${expr.name}` : `${expr.name}.value`;
  if (expr.type === 'RefArg')        return expr.name;
  if (expr.type === 'IntLiteral')     return String(expr.value);
  if (expr.type === 'DecimalLiteral') return String(expr.value);
  if (expr.type === 'FloatLiteral')   return String(expr.value);
  if (expr.type === 'NullLiteral')    return 'null';
  if (expr.type === 'BoolLiteral')    return expr.value ? 'true' : 'false';
  if (expr.type === 'FnRef') {
    if (_actorFnNames.has(expr.name)) return `((_s) => this.#${expr.name}Fn(_s))`;
    return expr.name;
  }
  if (expr.type === 'StateVar')  return `this.#${expr.name}`;
  if (expr.type === 'OverExpr') {
    return `await _List.mapAsync(${genExpr(expr.collection)}, ${genExpr(expr.fn)})`;
  }
  if (expr.type === 'ReduceExpr') {
    const init = expr.initial ? genExpr(expr.initial) : 'null';
    return `await _List.foldAsync(${genExpr(expr.collection)}, ${init}, ${genExpr(expr.fn)})`;
  }
  if (expr.type === 'BinaryExpr') {
    const left = CALL_LIKE.has(expr.left.type) ? `Structure.one(${genExpr(expr.left)}, '_')` : genExpr(expr.left);
    const right = CALL_LIKE.has(expr.right.type) ? `Structure.one(${genExpr(expr.right)}, '_')` : genExpr(expr.right);
    return `${left} ${expr.op} ${right}`;
  }
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
  if (expr.type === 'FunctionCallExpr') {
    if (expr.callee?.type === 'Identifier') {
      const name = expr.callee.name;
      // __tick__ intrinsic
      if (name === '__tick__') return 'await new Promise(r => setTimeout(r, 0))';
      // Actor instantiation — constructor args passed directly
      if (_actorNames.has(name)) {
        const binding = `{post: (msg) => this.receive(msg)}`;
        if (expr.args.length > 0) {
          const genArg = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(arg)}, '_')` : genExpr(arg);
          const vals = expr.args.map(genArg).join(', ');
          return `new ${name}(${binding}, ${vals})`;
        }
        return `new ${name}(${binding})`;
      }
      // Private function call
      if (_actorFnNames.has(name)) {
        const genArg = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(arg)}, '_')` : genExpr(arg);
        const payload = expr.args.length === 0
          ? 'Structure.pack(null)'
          : `Structure.pack([${expr.args.map(genArg).join(', ')}])`;
        return `await this.#${name}Fn(${payload})`;
      }
    }
    const genArg = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(arg)}, '_')` : genExpr(arg);
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
      const namedVals = namedBag ? genExpr(namedBag) : '{}';
      payload = `{positional: [${posVals}], named: ${namedVals}, positional_types: null, named_types: null}`;
    } else {
      payload = `Structure.pack([${expr.args.map(genArg).join(', ')}])`;
    }
    return `await (${genExpr(expr.callee)})(${payload})`;
  }
  if (expr.type === 'NamedArgsBag') {
    const fields = Object.entries(expr.fields)
      .map(([k, v]) => `${JSON.stringify(k)}: ${genExpr(v)}`).join(', ');
    return `{ ${fields} }`;
  }
  if (expr.type === 'Function') {
    const destr = genDestructure(expr.params, '  ');
    if (expr.body) {
      return wrapWithCapture(genFunctionBodyCode(expr.params, expr.body, null, expr.returnType), expr);
    }
    if (expr.returnType === '.') {
      return wrapWithCapture(`async (_s) => {${destr}\n  ${genExpr(expr.expr)};\n}`, expr);
    }
    return wrapWithCapture(`async (_s) => {${destr}\n  return Structure.pack([${genExpr(expr.expr)}]);\n}`, expr);
  }
  if (expr.type === 'DotCallExpr') {
    const isChild = expr.object.type === 'RefRead' ||
      (expr.object.type === 'FunctionCallExpr' && expr.object.callee?.type === 'Identifier' && _actorNames.has(expr.object.callee.name)) ||
      (expr.object.type === 'Identifier' && _childActorVars.has(expr.object.name));
    if (isChild) {
      const target = expr.object.type === 'RefRead'
        ? `${expr.object.name}.value`
        : genExpr(expr.object);
      const positional = expr.args.filter(a => a.positional);
      const named = expr.args.filter(a => !a.positional);
      let op;
      if (positional.length === 0 && named.length === 0) {
        op = JSON.stringify(expr.method);
      } else if (positional.length > 0) {
        const vals = positional.map(a => genExpr(a.expr)).join(', ');
        op = `[[${vals}], ${JSON.stringify(expr.method)}]`;
      } else {
        const fields = named.map(a => `${a.name}`).join(', ');
        op = `[{${fields}}, ${JSON.stringify(expr.method)}]`;
      }
      return `this.#childSend(${target}, ${op})`;
    }
    const named = expr.args.filter(a => !a.positional);
    const opFields = named.map(a => a.name).join(', ');
    const bvaFields = named.map(a => `${a.name}: ${JSON.stringify(a.typeName)}`).join(', ');
    const to = JSON.stringify(expr.object.name);
    return `this.#send([{${opFields}}, ${JSON.stringify(expr.method)}], ${to}, [{${bvaFields}}])`;
  }
  throw new Error(`Unknown expression type: ${expr.type}`);
}

function genDestructureAssign({ pattern, source }, overrideSrc, indent = '        ') {
  const src = overrideSrc !== undefined ? overrideSrc : genExpr(source);
  return pattern.map(item => {
    if (item.discard) return '';
    if (item.named)
      return `\n${indent}const ${item.name} = ${src}.named[${JSON.stringify(item.name)}];`;
    if (item.key !== undefined)
      return `\n${indent}const ${item.name} = ${src}.named[${JSON.stringify(item.key)}];`;
    if (item.positional)
      return `\n${indent}const ${item.name} = ${src}.positional[${item.idx}];`;
    return '';
  }).join('');
}

function genListDestructureAssign({ pattern, source }, ldIdx = 0, indent = '        ') {
  const srcCode = genExpr(source);
  const lines = [];
  let cur = srcCode;
  let hasRest = false;
  for (let i = 0; i < pattern.length; i++) {
    const item = pattern[i];
    if (item.rest) {
      hasRest = true;
      if (!item.discard && item.name)
        lines.push(`\n${indent}const ${item.name} = ${cur};`);
      break;
    }
    if (!item.discard && item.name)
      lines.push(`\n${indent}const ${item.name} = (${cur}).head;`);
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

function genReplyField(field, typeEnv) {
  const isList = t => typeof t === 'string' && t.startsWith('List');
  if ('sigil' in field) {
    const name = field.sigil;
    const t = field.type || typeEnv?.get(name);
    let val = field.ref ? `${name}.value` : (_stateVarNames.has(name) ? `this.#${name}` : name);
    if (isList(t)) val = `_List.toArray(${val})`;
    return `${name}: ${val}`;
  }
  const valueCode = genExpr(field.value);
  const t = field.type || (typeEnv && field.value?.type === 'Identifier' ? typeEnv.get(field.value.name) : null);
  const finalCode = isList(t) ? `_List.toArray(${valueCode})` : valueCode;
  return `${field.key}: ${finalCode}`;
}

function genDestructure(params, indent = '        ') {
  if (params.length === 0) return '';
  const rest = params.find(p => p.rest);
  if (rest) return `\n${indent}const ${rest.name} = _s;`;
  const pos = params.filter(p => p.positional);
  const named = params.filter(p => !p.positional);
  const namedPart = p => p.key ? `${p.key}: ${p.name}` : p.name;
  const isListType = t => typeof t === 'string' && t.startsWith('List');

  let code = '';
  if (pos.length > 0) {
    code += `\n${indent}const [${pos.map(p => p.name).join(', ')}] = _s.positional;`;
  }
  const listNamed = named.filter(p => isListType(p.type));
  const plainNamed = named.filter(p => !isListType(p.type));
  if (plainNamed.length > 0) {
    code += `\n${indent}const { ${plainNamed.map(namedPart).join(', ')} } = _s.named;`;
  }
  for (const p of listNamed) {
    const key = p.key || p.name;
    code += `\n${indent}const ${p.name} = _List.from(_s.named[${JSON.stringify(key)}]);`;
  }
  return code;
}

function inferLiteralType(expr) {
  if (!expr) return null;
  if (expr.type === 'IntLiteral')     return 'Integer';
  if (expr.type === 'StringLiteral')  return 'Text';
  if (expr.type === 'DecimalLiteral') return 'Decimal';
  if (expr.type === 'FloatLiteral')   return 'Float';
  if (expr.type === 'BoolLiteral')    return 'Boolean';
  if (expr.type === 'NullLiteral')    return 'null';
  return null;
}

const NEEDS_TYPE = new Set(['BinaryExpr']);

function parseStructuredType(typeName) {
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

function checkReplyFieldTypes(fields, declaredReturnType = null) {
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

function parseFieldList(str) {
  // Parses "name: Type, name2: Type2" or "Type" (positional) entries
  const fields = [];
  for (const part of str.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      fields.push({ name: null, type: trimmed, positional: true });
    } else {
      const name = trimmed.slice(0, colonIdx).trim();
      const type = trimmed.slice(colonIdx + 1).trim();
      fields.push({ name, type, positional: false });
    }
  }
  return fields;
}

function parseServiceManifest(manifestStr) {
  // Parses the service manifest string format into a lookup map:
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

function buildTypeEnv(params, body, stateVarEnv = null, remotes = null) {
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
        // Infer type from remote service manifest when LHS has no annotation
        if (!typeName && remotes && src.type === 'DotCallExpr') {
          const actorName = src.object?.name;
          const methodName = src.method;
          const manifest = remotes?.[actorName];
          if (manifest) {
            const parsed = typeof manifest === 'string' ? parseServiceManifest(manifest) : manifest;
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

function genBvaBody(fields, typeEnv) {
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional);
  const isListOfAny = t => t === 'List of Anything' || t === 'List';
  const isFunctionType = t => t === 'Function' || (typeof t === 'string' && t.includes('->'));
  const posTypes = [];
  for (const f of pos) {
    const t = f.type || (f.name ? typeEnv.get(f.name) : undefined) || inferLiteralType(f.expr);
    if (!t) return null;
    if (isFunctionType(t)) return null;
    if (isListOfAny(t)) {
      const varName = f.name ||
        (f.expr?.type === 'Identifier' ? f.expr.name : null);
      if (!varName) return null;
      const resolvedVar = _stateVarNames.has(varName) ? `this.#${varName}` : varName;
      posTypes.push(`_List.typesOf(${resolvedVar})`);
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
      t = f.type || ((f.value?.type === 'Identifier' || f.value?.type === 'RefRead') ? typeEnv.get(f.value.name) : undefined) || inferLiteralType(f.value);
      varName = (f.value?.type === 'Identifier' || f.value?.type === 'RefRead') ? f.value.name : null;
    }
    if (!t) return null;
    if (isFunctionType(t)) return null;
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

function genReBody(fields, typeEnv, declaredReturnType = null) {
  checkReplyFieldTypes(fields, declaredReturnType);
  const spread = fields.find(f => f.spread);
  if (spread) return `Structure.splat(${spread.name})`;
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional);
  const isList = t => typeof t === 'string' && t.startsWith('List');
  const posVal = f => {
    const raw = f.expr ? genExpr(f.expr) : (_stateVarNames.has(f.name) ? `this.#${f.name}` : f.name);
    const name = f.name || (f.expr?.type === 'Identifier' ? f.expr.name : null);
    const t = f.type || (typeEnv && name ? typeEnv.get(name) : null);
    if (isList(t)) return `_List.toArray(${raw})`;
    if (f.expr && CALL_LIKE.has(f.expr.type)) return `Structure.one(${raw}, ${JSON.stringify(name ?? 'value')})`;
    return raw;
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

const CALL_LIKE = new Set(['FunctionCallExpr']);

function makeBindingContext(body, initialDeclared, indent) {
  const assignCounts = new Map();
  for (const s of body) {
    if (s.type === 'Assign' || s.type === 'TypedAssign') {
      assignCounts.set(s.name, (assignCounts.get(s.name) || 0) + 1);
    }
  }
  const declared = new Set(initialDeclared);
  for (const s of body) {
    if (s.type === 'TypedAssign' || s.type === 'BareTypeDecl') {
      declared.add(s.name);
    } else if (s.type === 'DestructureAssign') {
      for (const item of s.pattern) {
        if (!item.discard && item.name) declared.add(item.name);
      }
    } else if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (!item.discard && item.name) declared.add(item.name);
      }
    }
  }
  const initialized = new Set();
  const emitBinding = (name, rhs) => {
    if (initialized.has(name)) return `\n${indent}${name} = ${rhs};`;
    initialized.add(name);
    if (declared.has(name) && assignCounts.get(name) == null) return `\n${indent}let ${name} = ${rhs};`;
    const kind = assignCounts.get(name) > 1 ? 'let' : 'const';
    return `\n${indent}${kind} ${name} = ${rhs};`;
  };
  return { assignCounts, declared, initialized, emitBinding };
}

function genFunctionBodyCode(params, body, outerEnv = null, declaredReturnType = null) {
  const { env: typeEnv } = buildTypeEnv(params, body);
  const destr = genDestructure(params, '  ');
  const { assignCounts, declared, initialized, emitBinding } = makeBindingContext(
    body, params.map(p => p.name).filter(Boolean), '  '
  );
  let code = '';
  let _tmpIdx = 0;
  let _ldIdx = 0;
  const counters = { ifIdx: 0 };
  let _lastTypedName = null;
  let _lastIsWhile = false;
  let _lastPutName = null;
  for (const s of body) {
    if (s.type === 'BareTypeDecl') {
      continue; // no JS output — type annotation only
    } else if (s.type === 'RefDecl') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastPutName = null;
      const rhs = s.value ? genExpr(s.value) : 'undefined';
      code += `\n  const ${s.name} = {value: ${rhs}};`;
    } else if (s.type === 'PutStatement') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastPutName = s.name;
      if (_childActorVars.has(s.name)) {
        code += `\n  await this.#childSend(${s.name}.value, [[${genExpr(s.value)}], "<-"]);`;
      } else if (_stateVarNames.has(s.name)) {
        code += `\n  this.#${s.name} = ${genExpr(s.value)};`;
      } else {
        code += `\n  ${s.name}.value = ${genExpr(s.value)};`;
      }
    } else if (s.type === 'ListDestructure') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastPutName = null;
      code += genListDestructureAssign(s, _ldIdx++, '  ');
    } else if (s.type === 'Assign') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastPutName = null;
      if (s.value.type === 'StructureLiteral') {
        code += emitBinding(s.name, genExpr(s.value));
      } else if (s.value.type === 'ListLiteral') {
        code += emitBinding(s.name, genExpr(s.value));
      } else if (s.value.type === 'StructureConstructor') {
        code += emitBinding(s.name, `(${genExpr(s.value)}).positional[0]`);
      } else if (CALL_LIKE.has(s.value.type)) {
        code += emitBinding(s.name, `Structure.one(${genExpr(s.value)}, ${JSON.stringify(s.name)})`);
      } else {
        code += emitBinding(s.name, genExpr(s.value));
      }
    } else if (s.type === 'TypedAssign') {
      _lastTypedName = s.name;
      _lastIsWhile = false;
      _lastPutName = null;
      code += genTypedAssignStmt(s, emitBinding, typeEnv, '  ', counters);
    } else if (s.type === 'DestructureAssign') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastPutName = null;
      if (CALL_LIKE.has(s.source.type) || s.source.type === 'StructureConstructor') {
        const tmp = `_r${_tmpIdx++}`;
        code += `\n  const ${tmp} = ${genExpr(s.source)};`;
        code += genDestructureAssign(s, tmp, '  ');
      } else {
        code += genDestructureAssign(s, undefined, '  ');
      }
    } else if (s.type === 'StateAssign') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastPutName = null;
      code += `\n  this.#${s.name} = ${genExpr(s.value)};`;
    } else if (s.type === 'WhileStatement') {
      _lastTypedName = null;
      _lastIsWhile = true;
      _lastPutName = null;
      code += genWhileStatement(s, '  ', outerEnv);
    } else if (s.type === 'Return') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastPutName = null;
      code += `\n  return Structure.pack(${genReBody(s.fields, typeEnv, declaredReturnType)});`;
    } else if (s.type === 'ImplicitReturn') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastPutName = null;
      if (declaredReturnType === '.') {
        code += `\n  ${genExpr(s.expr)};`;
      } else {
        code += `\n  return Structure.pack([${genExpr(s.expr)}]);`;
      }
    }
  }
  if (declaredReturnType !== '.') {
    if (_lastTypedName !== null) {
      code += `\n  return Structure.pack([${_lastTypedName}]);`;
    } else if (_lastPutName !== null) {
      code += `\n  return Structure.pack([${_lastPutName}.value]);`;
    } else if (_lastIsWhile) {
      code += `\n  return Structure.pack([null]);`;
    }
  }
  return `async (_s) => {${destr}${code}\n}`;
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
      if (CALL_LIKE.has(s.value.type)) {
        code += `\n        const ${s.name} = Structure.one(${genExpr(s.value)}, ${JSON.stringify(s.name)});`;
      } else {
        code += `\n        const ${s.name} = ${genExpr(s.value)};`;
      }
    } else if (s.type === 'DestructureAssign') {
      lastTypedName = null;
      if (CALL_LIKE.has(s.source.type) || s.source.type === 'StructureConstructor') {
        const tmp = `_r${_rIdx++}`;
        code += `\n        const ${tmp} = ${genExpr(s.source)};`;
        code += genDestructureAssign(s, tmp);
      } else {
        code += genDestructureAssign(s);
      }
    } else if (s.type === 'StateAssign') {
      lastTypedName = null;
      code += `\n        this.#${s.name} = ${genExpr(s.value)};`;
    } else if (s.type === 'PutStatement') {
      lastTypedName = null;
      code += _stateVarNames.has(s.name)
        ? `\n        this.#${s.name} = ${genExpr(s.value)};`
        : `\n        ${s.name}.value = ${genExpr(s.value)};`;
    } else if (s.type === 'RefDecl') {
      lastTypedName = null;
      const rhs = s.value ? genExpr(s.value) : 'undefined';
      code += `\n        const ${s.name} = {value: ${rhs}};`;
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
    const raw = genExpr(branch.expr);
    const val = CALL_LIKE.has(branch.expr.type) ? `Structure.one(${raw}, '_')` : raw;
    return `\n        ${tmpVar} = ${val};`;
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

function genWhileStatement(node, indent, outerEnv) {
  const condCode = genExpr(node.cond);
  const inner = indent + '  ';
  let code;
  if (node.negated) {
    code = `\n${indent}while ((${condCode}) === false || (${condCode}) === null) {`;
  } else {
    code = `\n${indent}while ((${condCode}) !== false && (${condCode}) !== null) {`;
  }
  for (const s of node.body) {
    if (s.type === 'StateAssign') {
      code += `\n${inner}this.#${s.name} = ${genExpr(s.value)};`;
    } else if (s.type === 'TypedAssign') {
      if (CALL_LIKE.has(s.value.type)) {
        code += `\n${inner}const ${s.name} = Structure.one(${genExpr(s.value)}, ${JSON.stringify(s.name)});`;
      } else {
        code += `\n${inner}const ${s.name} = ${genExpr(s.value)};`;
      }
    } else if (s.type === 'Assign') {
      if (CALL_LIKE.has(s.value.type)) {
        code += `\n${inner}const ${s.name} = Structure.one(${genExpr(s.value)}, ${JSON.stringify(s.name)});`;
      } else {
        code += `\n${inner}const ${s.name} = ${genExpr(s.value)};`;
      }
    } else if (s.type === 'PutStatement') {
      if (_childActorVars.has(s.name)) {
        code += `\n${inner}await this.#childSend(${s.name}.value, [[${genExpr(s.value)}], "<-"]);`;
      } else if (_stateVarNames.has(s.name)) {
        code += `\n${inner}this.#${s.name} = ${genExpr(s.value)};`;
      } else {
        code += `\n${inner}${s.name}.value = ${genExpr(s.value)};`;
      }
    } else if (s.type === 'WhileStatement') {
      code += genWhileStatement(s, inner, outerEnv);
    } else if (s.type === 'ExprStatement') {
      code += `\n${inner}${genExpr(s.expr)};`;
    }
  }
  code += `\n${indent}}`;
  return code;
}

function findAsClauseMatch(targetType, actorName) {
  if (!_actorNames.has(actorName)) return null;
  const info = _actorNames.get(actorName);
  if (!info.asClauses || info.asClauses.length === 0) return null;
  if (targetType === actorName) return null; // identity — no cast
  for (const clause of info.asClauses) {
    if (!clause.negated && clause.targetType === targetType) return clause;
    if (clause.negated && clause.targetType !== targetType) return clause;
  }
  return null; // validation should have caught this
}

function genTypedAssignStmt(s, emitBinding, outerEnv, indent, counters) {
  // as-clause interception: TypedAssign + FunctionCallExpr naming an actor with as clauses
  if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && _actorNames.has(s.value.callee.name)) {
    const clause = findAsClauseMatch(s.typeName, s.value.callee.name);
    if (clause) return emitBinding(s.name, genExpr(clause.expr));
  }
  if (s.value.type === 'IfExpr') {
    const tmpVar = `_if${counters.ifIdx++}`;
    return (
      `\n${indent}let ${tmpVar} = null;` +
      `\n${indent}` + genIfChain(s.value, tmpVar, outerEnv).replace(/\n {8}/g, `\n${indent}`) +
      emitBinding(s.name, tmpVar)
    );
  }
  if (s.typeName === 'Structure') return emitBinding(s.name, genExpr(s.value));
  if (CALL_LIKE.has(s.value.type))
    return emitBinding(s.name, `Structure.one(${genExpr(s.value)}, ${JSON.stringify(s.name)})`);
  if (s.value.type === 'StructureConstructor')
    return emitBinding(s.name, `(${genExpr(s.value)}).positional[0]`);
  return emitBinding(s.name, genExpr(s.value));
}

function genLocals(body, outerEnv) {
  const { assignCounts, declared, initialized, emitBinding } = makeBindingContext(
    body, outerEnv.keys(), '        '
  );
  let _tmpIdx = 0;
  let _ldIdx = 0;
  const counters = { ifIdx: 0 };
  _childActorVars = new Map();
  const refVars = new Set();
  for (const s of body) {
    if (s.type === 'RefDecl') {
      refVars.add(s.name);
      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && _actorNames.has(s.value.callee.name))
        _childActorVars.set(s.name, true);
    }
    if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && _actorNames.has(s.value.callee.name))
      _childActorVars.set(s.name, false);
  }
  const stmts = body.filter(s => s.type === 'Assign' || s.type === 'DestructureAssign' || s.type === 'TypedAssign' || s.type === 'ListDestructure' || s.type === 'StateAssign' || s.type === 'WhileStatement' || s.type === 'RefDecl' || s.type === 'PutStatement' || s.type === 'ActorPutStatement' || s.type === 'IfStatement' || s.type === 'ExprStatement' || s.type === 'SpawnStatement');
  return stmts.map(s => {
    if (s.type === 'RefDecl') {
      const rhs = s.value ? genExpr(s.value) : 'undefined';
      return `\n        const ${s.name} = {value: ${rhs}};`;
    }
    if (s.type === 'PutStatement') {
      if (_childActorVars.has(s.name)) {
        const target = _childActorVars.get(s.name) ? `${s.name}.value` : s.name;
        return `\n        await this.#childSend(${target}, [[${genExpr(s.value)}], "<-"]);`;
      }
      if (_stateVarNames.has(s.name)) {
        return `\n        this.#${s.name} = ${genExpr(s.value)};`;
      }
      if (!refVars.has(s.name)) {
        throw new Error(`Cannot put to '${s.name}' — only 'ref' variables and actor instances support '<-'`);
      }
      return `\n        ${s.name}.value = ${genExpr(s.value)};`;
    }
    if (s.type === 'ActorPutStatement') {
      const target = _childActorVars.get(s.name) ? `${s.name}.value` : s.name;
      const pos = s.args.filter(a => a.positional).map(a => genExpr(a.expr));
      const named = s.args.filter(a => !a.positional);
      let payload;
      if (named.length > 0) {
        const obj = named.map(a => `${a.name}: ${genExpr(a.expr)}`).join(', ');
        payload = `[${pos.join(', ')}, {${obj}}]`;
      } else {
        payload = `[${pos.join(', ')}]`;
      }
      return `\n        await this.#childSend(${target}, [${payload}, "<-"]);`;
    }
    if (s.type === 'IfStatement') {
      const condCode = genExpr(s.cond);
      const truthy = `(${condCode}) !== false && (${condCode}) !== null`;
      let code = `\n        if (${truthy}) {`;
      for (const stmt of s.body) {
        if (stmt.type === 'PutStatement') {
          if (_childActorVars.has(stmt.name)) {
            code += `\n          await this.#childSend(${stmt.name}.value, [[${genExpr(stmt.value)}], "<-"]);`;
          } else {
            code += `\n          ${stmt.name}.value = ${genExpr(stmt.value)};`;
          }
        }
      }
      code += `\n        }`;
      return code;
    }
    if (s.type === 'ExprStatement') {
      return `\n        ${genExpr(s.expr)};`;
    }
    if (s.type === 'SpawnStatement') {
      const call = s.call;
      if (call.type === 'DotCallExpr') {
        return `\n        ${genExpr(call)};`;
      }
      const genArg = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(arg)}, '_')` : genExpr(arg);
      const payload = call.args.length === 0
        ? 'Structure.pack(null)'
        : `Structure.pack([${call.args.map(genArg).join(', ')}])`;
      return `\n        this.#${call.callee.name}Fn(${payload});`;
    }
    if (s.type === 'WhileStatement') {
      return genWhileStatement(s, '        ', outerEnv);
    }
    if (s.type === 'StateAssign') {
      return `\n        this.#${s.name} = ${genExpr(s.value)};`;
    }
    if (s.type === 'ListDestructure') {
      return genListDestructureAssign(s, _ldIdx++);
    }
    if (s.type === 'DestructureAssign') {
      if (CALL_LIKE.has(s.source.type) || s.source.type === 'StructureConstructor') {
        const tmp = `_r${_tmpIdx++}`;
        return `\n        const ${tmp} = ${genExpr(s.source)};` + genDestructureAssign(s, tmp);
      }
      if (s.source.type === 'DotCallExpr') {
        const tmp = `_r${_tmpIdx++}`;
        return `\n        const ${tmp} = Structure.pack(await ${genExpr(s.source)});` + genDestructureAssign(s, tmp);
      }
      return genDestructureAssign(s);
    }
    if (s.type === 'TypedAssign') {
      return genTypedAssignStmt(s, emitBinding, outerEnv, '        ', counters);
    }
    // Plain assign
    if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && _actorNames.has(s.value.callee.name)) {
      return emitBinding(s.name, genExpr(s.value));
    }
    if (initialized.has(s.name) || (declared.has(s.name) && assignCounts.has(s.name))) {
      if (s.value.type === 'StructureConstructor') {
        return emitBinding(s.name, `(${genExpr(s.value)}).positional[0]`);
      }
      if (CALL_LIKE.has(s.value.type)) {
        return emitBinding(s.name, `Structure.one(${genExpr(s.value)}, ${JSON.stringify(s.name)})`);
      }
      return emitBinding(s.name, genExpr(s.value));
    }
    if (s.value.type === 'StructureLiteral') {
      return emitBinding(s.name, genExpr(s.value));
    }
    if (s.value.type === 'ListLiteral') {
      return emitBinding(s.name, genExpr(s.value));
    }
    if (s.value.type === 'StructureConstructor') {
      throw new Error(`Variable '${s.name}' requires a type annotation — use '${s.name} : Type = ...'`);
    }
    if (s.value.type === 'Function') {
      if (s.value.body) {
        const fnCode = genFunctionBodyCode(s.value.params, s.value.body, outerEnv, s.value.returnType);
        return emitBinding(s.name, wrapWithCapture(fnCode, s.value, s.name));
      }
      return emitBinding(s.name, genExpr(s.value));
    }
    if (s.value.type === 'IndexExpr') {
      return emitBinding(s.name, genExpr(s.value));
    }
    if (s.value.type === 'DotCallExpr') {
      return emitBinding(s.name, `Structure.one(Structure.pack(await ${genExpr(s.value)}), ${JSON.stringify(s.name)})`);
    }
    if (CALL_LIKE.has(s.value.type)) {
      return emitBinding(s.name, `Structure.one(${genExpr(s.value)}, ${JSON.stringify(s.name)})`);
    }
    if (inferLiteralType(s.value) !== null) {
      return emitBinding(s.name, genExpr(s.value));
    }
    if (s.value.type === 'FnRef') {
      return emitBinding(s.name, genExpr(s.value));
    }
    throw new Error(`Variable '${s.name}' requires a type annotation — use '${s.name} : Type = ...'`);
  }).join('');
}

function genPublicFn({ name, params, body }, stateVarEnv = null, remotes = null) {
  const reply = body.find(s => s.type === 'Reply');
  const destructure = genDestructure(params);
  const { env: typeEnv, remoteInferred } = buildTypeEnv(params, body, stateVarEnv, remotes);
  // Reply grounding check: reject reply fields whose type depends on remote inference
  if (reply && remoteInferred.size > 0) {
    for (const field of reply.fields) {
      if ('sigil' in field && !field.type && remoteInferred.has(field.sigil)) {
        throw new Error(`Reply type for ':${field.sigil}' cannot be inferred from local declarations — annotate explicitly`);
      }
      if (field.key !== undefined && !field.type) {
        const expr = field.value;
        if (expr?.type === 'Identifier' && remoteInferred.has(expr.name)) {
          throw new Error(`Reply type for ':${expr.name}' cannot be inferred from local declarations — annotate explicitly`);
        }
      }
    }
  }
  const locals = genLocals(body, typeEnv);
  let reLine = reply ? `\n        re = ${genReBody(reply.fields, typeEnv)};` : '';
  // @ <- handler with no reply — still needs to send ack so parent's #childSend resolves
  if (name === '<-' && !reply) {
    reLine = "\n        re = 'ok';";
  }
  let bvaLine = '';
  if (reply) {
    if (reply.fields.some(f => f.spread)) {
      bvaLine = `\n        _bva_re = _bva != null ? _bva[0] : undefined;`;
    } else {
      const bvaBody = genBvaBody(reply.fields, typeEnv);
      if (bvaBody !== null) {
        bvaLine = `\n        _bva_re = ${bvaBody};`;
      }
    }
  }
  const typeCondition = genTypeCondition(params);
  const condition = typeCondition
    ? `opName === "${name}" && (from === '__parent' || ${typeCondition})`
    : `opName === "${name}"`;
  return { condition, block: `${destructure}${locals}${reLine}${bvaLine}\n        _handled = true;` };
}

function genFnMethod({ name, params, body }, stateVarEnv = null) {
  const reply = body.find(s => s.type === 'Reply');
  const implicitReturn = !reply ? body.filter(s => s.type === 'ImplicitReturn').pop() : null;
  const destructure = genDestructure(params);
  const { env: typeEnv } = buildTypeEnv(params, body, stateVarEnv);
  const locals = genLocals(body, typeEnv);
  const reLine = reply
    ? `\n        re = ${genReBody(reply.fields)};`
    : implicitReturn
      ? `\n        re = [${genExpr(implicitReturn.expr)}];`
      : '\n        re = null;';
  return `  async #${name}Fn(_s) {${destructure}${locals}
    let re;${reLine}
    return Structure.pack(re);
  }`;
}

function genInitMethod(stateVarDecls, initBody, initParams = []) {
  const stateVarEnv = new Map(stateVarDecls.map(d => ['$' + d.name, d.typeName]));
  const { env: typeEnv } = buildTypeEnv(initParams, initBody, stateVarEnv);
  const locals = genLocals(initBody, typeEnv);

  if (initParams.length > 0) {
    const destructure = genDestructure(initParams, '    ');
    return `  async #cam_init(message) {
    const { id, from } = message;
    const _rawPayload = Array.isArray(message.cam) ? message.cam[0] : null;
    const payload = _rawPayload ?? {};
    const _s = Structure.pack(payload);${destructure}${locals}
    this.#initialized = true;
    this.#binding.post({ id, re: 'init', to: from });
  }`;
  }

  return `  async #cam_init(message) {
    const { id, from } = message;${locals}
    this.#initialized = true;
    this.#binding.post({ id, re: 'init', to: from });
  }`;
}

function genClass(actor, exportKw, remotes = null) {
  const name = actor.name ? ` ${actor.name}` : '';

  const publicFns = actor.functions.filter(f => f.public);
  const privateFns = actor.functions.filter(f => !f.public);

  _actorFnNames = new Set(privateFns.map(f => f.name));
  const usesStructure = publicFns.some(h => h.params.length > 0) || privateFns.length > 0;
  const usesTypeMatching = publicFns.some(h => h.params.some(p => !p.rest));

  const stateVarDecls = actor.stateVarDecls || [];
  const initBody = actor.initBody || [];
  const constructorParams = actor.initParams || [];
  // Constructor params are also state — accessible from handlers
  const allStateNames = [
    ...stateVarDecls.map(v => v.name),
    ...constructorParams.map(p => p.name),
  ];
  const isStateful = allStateNames.length > 0;
  _stateVarNames = new Set(allStateNames);
  const stateVarEnv = new Map([
    ...stateVarDecls.map(v => [v.name, v.typeName]),
    ...constructorParams.map(p => [p.name, p.type || 'Anything']),
  ]);

  const publicFnParts = publicFns.map(h => genPublicFn(h, stateVarEnv, remotes));
  const ifChain = publicFnParts.map(({ condition, block }, i) => {
    const kw = i === 0 ? '    if' : '    } else if';
    return `${kw} (${condition}) {${block}`;
  }).join('\n') + '\n    }';

  const structureLine = usesStructure
    ? '\n    const _s = Structure.pack(payload);'
    : '';
  const bvaDecl = "\n    const _bva = message['bv-a'];";
  const typesLines = usesTypeMatching
    ? "\n    const _types = _bva != null ? Structure.pack(_bva[0] ?? null) : null;"
    : '';

  const fnMethods = privateFns.map(f => genFnMethod(f, stateVarEnv)).join('\n\n');
  const fnSection = fnMethods ? '\n\n' + fnMethods : '';

  // Private field declarations — values set in constructor
  const allFieldNames = new Set([
    ...stateVarDecls.map(v => v.name),
    ...constructorParams.map(p => p.name),
  ]);
  const stateFields = [...allFieldNames].map(n => `  #${n}`).join('\n');
  const fieldSection = stateFields;

  // Constructor: initialize state from params and constructor body
  const ctorParamNames = constructorParams.map(p => p.name);
  const constructorArgs = ['binding', ...ctorParamNames].join(', ');
  const paramInitLines = ctorParamNames.map(n => `    this.#${n} = ${n};`);
  const bodyInitLines = initBody.map(s => `    this.#${s.name} = ${genExpr(s.value)};`);
  const allInitLines = [...paramInitLines, ...bodyInitLines];
  const constructorBody = allInitLines.length > 0
    ? `\n${allInitLines.join('\n')}\n  `
    : ' ';

  return `${exportKw}class${name} {
  #binding
  #pending = new Map()
  #nextId = 0
${fieldSection ? fieldSection + '\n' : ''}
  constructor(${constructorArgs}) { this.#binding = binding;${constructorBody}}

  async #send(op, to, bva) {
    const id = String(++this.#nextId);
    return new Promise(resolve => {
      this.#pending.set(id, resolve);
      const _msg = { id, op, to };
      if (bva !== undefined) _msg['bv-a'] = bva;
      this.#binding.post(_msg);
    });
  }${!actor.name && _actorNames.size > 0 ? `

  async #childSend(child, op) {
    const id = String(++this.#nextId);
    return new Promise(resolve => {
      this.#pending.set(id, resolve);
      child.receive({ id, op, from: '__parent' });
    });
  }` : ''}${fnSection}

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
    const opName = typeof message.op === 'string' ? message.op : message.op[message.op.length - 1];
    const _rawPayload = Array.isArray(message.op) ? message.op[0] : null;
    const _hasPayload = _rawPayload !== null && _rawPayload !== undefined &&
      (Array.isArray(_rawPayload) ? _rawPayload.length > 0 : Object.keys(_rawPayload).length > 0);
    if (_hasPayload && !('bv-a' in message) && from !== '__parent') {
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
      const _post = { id, re, to: from };
      if (_bva_re !== undefined) _post['bv-a'] = _bva_re;
      this.#binding.post(_post);
    }
  }
}`;
}

export function codegen(ast, options = {}) {
  const _remotes = options.remotes || null;
  const active = ast.actors.filter(a => a.functions.length > 0);
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
    const iterExpr = t => t === 'OverExpr' || t === 'ReduceExpr';
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
    a.functions.some(f => f.public ? (f.params.length > 0 || bodyUsesStructure(f.body)) : true) ||
    (a.initBody && bodyUsesStructure(a.initBody)) ||
    (a.initParams && a.initParams.length > 0)
  );
  const needsListPreamble = active.some(a =>
    a.functions.some(f =>
      f.params.some(p => typeof p.type === 'string' && p.type.startsWith('List')) ||
      bodyUsesList(f.body)
    ) ||
    (a.initBody && bodyUsesList(a.initBody))
  );
  _actorNames = new Map(active.filter(a => a.name).map(a => [a.name, { asClauses: a.asClauses || [] }]));
  const classes = active.map(a => genClass(a, a.name ? '' : 'export default ', _remotes) + '\n').join('\n');
  return (needsPreamble ? STRUCTURE_PREAMBLE + '\n\n' : '') +
         (needsListPreamble ? LIST_PREAMBLE + '\n\n' : '') +
         classes;
}
