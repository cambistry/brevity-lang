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
  throw new Error(`Unknown expression type: ${expr.type}`);
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
  if (pos.length > 0 && named.length > 0) {
    return `[${pos.map(f => f.name).join(', ')}, { ${named.map(genReplyField).join(', ')} }]`;
  } else if (pos.length > 0) {
    return `[${pos.map(f => f.name).join(', ')}]`;
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

function genHandler({ op, params, body }) {
  const reply = body.find(s => s.type === 'Reply');
  const assigns = body.filter(s => s.type === 'Assign');
  const destructure = genDestructure(params);
  const locals = assigns.map(s => `\n        const ${s.name} = ${genExpr(s.value)};`).join('');
  const reLine = reply ? `\n        re = { ${op}: ${genReBody(reply.fields)} };` : '';
  const typeCondition = genTypeCondition(params);
  const condition = typeCondition
    ? `opName === "${op}" && ${typeCondition}`
    : `opName === "${op}"`;
  return { condition, block: `${destructure}${locals}${reLine}\n        _handled = true;` };
}

function genClass(actor, exportKw) {
  const name = actor.name ? ` ${actor.name}` : '';
  const usesStructure = actor.handlers.some(h => h.params.length > 0);
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
  }

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
${ifChain}
    if (!_handled) {
      this.#binding.post({ id, ex: { [opName]: 'unhandled' }, to: from });
    } else if (re !== undefined) {
      this.#binding.post({ id, re, to: from });
    }
  }
}`;
}

export function codegen(ast) {
  const active = ast.actors.filter(a => a.handlers.length > 0);
  if (active.length === 0) return '';

  const needsPreamble = active.some(a => a.handlers.some(h => h.params.length > 0));
  const classes = active.map(a => genClass(a, a.name ? 'export ' : 'export default ') + '\n').join('\n');
  return (needsPreamble ? STRUCTURE_PREAMBLE + '\n\n' : '') + classes;
}
