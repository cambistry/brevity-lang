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
  splat({ positional, named }) {
    const hasPos = positional.length > 0;
    const hasNamed = Object.keys(named).length > 0;
    if (hasPos && hasNamed) return [...positional, named];
    if (hasPos) return positional;
    return named;
  },
};
function _matchTypes(s, types, named, positional) {
  if (types === null && (named.length > 0 || positional.length > 0)) return false;
  if (s.positional.length !== positional.length) return false;
  for (let i = 0; i < positional.length; i++) {
    if (types.positional[i] !== positional[i]) return false;
  }
  for (const [name, type] of named) {
    if (!(name in s.named)) return false;
    if (types.named[name] !== type) return false;
  }
  return true;
}`;

function genExpr(expr) {
  if (expr.type === 'StringLiteral') return JSON.stringify(expr.value);
  if (expr.type === 'Identifier')    return expr.name;
  if (expr.type === 'IntLiteral')    return String(expr.value);
  if (expr.type === 'BinaryExpr')    return `${genExpr(expr.left)} ${expr.op} ${genExpr(expr.right)}`;
  if (expr.type === 'IndexExpr') {
    const obj = genExpr(expr.object);
    if (expr.key !== null) return `${obj}.named[${JSON.stringify(expr.key)}]`;
    return `${obj}.positional[${expr.index}]`;
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
  throw new Error(`Unknown expression type: ${expr.type}`);
}

function genDestructureAssign({ pattern, source }, overrideSrc) {
  const src = overrideSrc !== undefined ? overrideSrc : genExpr(source);
  return pattern.map(item => {
    if (item.named)
      return `\n        const ${item.name} = ${src}.named[${JSON.stringify(item.name)}];`;
    if (item.key !== undefined)
      return `\n        const ${item.name} = ${src}.named[${JSON.stringify(item.key)}];`;
    if (item.positional)
      return `\n        const ${item.name} = ${src}.positional[${item.idx}];`;
    return '';
  }).join('');
}

function genReplyField(field) {
  if ('sigil' in field) return field.sigil; // JS shorthand property
  return `${field.key}: ${genExpr(field.value)}`;
}

function genDestructure(params) {
  if (params.length === 0) return '';
  const rest = params.find(p => p.rest);
  if (rest) return `\n        const ${rest.name} = _s;`;
  const pos = params.filter(p => p.positional);
  const named = params.filter(p => !p.positional);
  const namedPart = p => p.key ? `${p.key}: ${p.name}` : p.name;
  if (pos.length > 0 && named.length > 0) {
    return `\n        const [${pos.map(p => p.name).join(', ')}] = _s.positional;\n        const { ${named.map(namedPart).join(', ')} } = _s.named;`;
  } else if (pos.length > 0) {
    return `\n        const [${pos.map(p => p.name).join(', ')}] = _s.positional;`;
  } else {
    return `\n        const { ${named.map(namedPart).join(', ')} } = _s.named;`;
  }
}

function genReBody(fields) {
  const spread = fields.find(f => f.spread);
  if (spread) return `Structure.splat(${spread.name})`;
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional);
  const posVal = f => f.expr ? genExpr(f.expr) : f.name;
  if (pos.length > 0 && named.length > 0) {
    return `[${pos.map(posVal).join(', ')}, { ${named.map(genReplyField).join(', ')} }]`;
  } else if (pos.length > 0) {
    return `[${pos.map(posVal).join(', ')}]`;
  } else {
    return `{ ${named.map(genReplyField).join(', ')} }`;
  }
}

function genTypeCondition(params) {
  if (params.length === 0) return null;
  if (params.find(p => p.rest)) return null; // rest is the universal matcher
  const named = params.filter(p => !p.positional)
    .map(p => `[${JSON.stringify(p.key || p.name)},${JSON.stringify(p.type)}]`);
  const pos = params.filter(p => p.positional)
    .map(p => JSON.stringify(p.type));
  return `_matchTypes(_s, _types, [${named.join(',')}], [${pos.join(',')}])`;
}

function genLocals(body) {
  let _tmpIdx = 0;
  const stmts = body.filter(s => s.type === 'Assign' || s.type === 'DestructureAssign');
  return stmts.map(s => {
    if (s.type === 'DestructureAssign') {
      if (s.source.type === 'ProcCallExpr' || s.source.type === 'StructureConstructor') {
        const tmp = `_r${_tmpIdx++}`;
        return `\n        const ${tmp} = ${genExpr(s.source)};` + genDestructureAssign(s, tmp);
      }
      return genDestructureAssign(s);
    }
    return `\n        const ${s.name} = ${genExpr(s.value)};`;
  }).join('');
}

function genHandler({ op, params, body }) {
  const reply = body.find(s => s.type === 'Reply');
  const destructure = genDestructure(params);
  const locals = genLocals(body);
  const reLine = reply ? `\n        re = { ${op}: ${genReBody(reply.fields)} };` : '';
  const typeCondition = genTypeCondition(params);
  const condition = typeCondition
    ? `opName === "${op}" && ${typeCondition}`
    : `opName === "${op}"`;
  return { condition, block: `${destructure}${locals}${reLine}\n        _handled = true;` };
}

function genProcMethod({ op, params, body }) {
  const reply = body.find(s => s.type === 'Reply');
  const destructure = genDestructure(params);
  const locals = genLocals(body);
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
  const typesLines = usesTypeMatching
    ? "\n    const _bva = message['bv-a'];\n    const _types = _bva != null ? Structure.pack(_bva[opName] ?? null) : null;"
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
    const payload = typeof message.op === 'object' && message.op !== null ? message.op[opName] : {};${structureLine}${typesLines}
    let re;
    let _handled = false;
    try {
${ifChain}
    } catch (err) {
      this.#binding.post({ id, ex: { [opName]: 'dispatch error', message: err.message }, to: from });
      return;
    }
    if (!_handled) {
      this.#binding.post({ id, ex: { [opName]: 'unhandled' }, to: from });
    } else if (re !== undefined) {
      this.#binding.post({ id, re, to: from });
    }
  }
}`;
}

export function codegen(ast) {
  const active = ast.actors.filter(a => a.handlers.length > 0 || a.procs.length > 0);
  if (active.length === 0) return '';

  const needsPreamble = active.some(a =>
    a.handlers.some(h => h.params.length > 0) || a.procs.length > 0
  );
  const classes = active.map(a => genClass(a, a.name ? 'export ' : 'export default ') + '\n').join('\n');
  return (needsPreamble ? STRUCTURE_PREAMBLE + '\n\n' : '') + classes;
}
