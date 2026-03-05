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
};`;

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

function genHandler({ op, params, body }) {
  const reply = body.find(s => s.type === 'Reply');
  const assigns = body.filter(s => s.type === 'Assign');
  const destructure = genDestructure(params);
  const locals = assigns.map(s => `\n        const ${s.name} = ${genExpr(s.value)};`).join('');
  const reBody = genReBody(reply.fields);
  return `      case "${op}": {${destructure}${locals}
        re = { ${op}: ${reBody} };
        break;
      }`;
}

function genClass(actor, exportKw) {
  const name = actor.name ? ` ${actor.name}` : '';
  const usesStructure = actor.handlers.some(h => h.params.length > 0);
  const cases = actor.handlers.map(genHandler).join('\n');
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
    const payload = typeof message.op === 'object' && message.op !== null ? message.op[opName] : {};${usesStructure ? '\n    const _s = Structure.pack(payload);' : ''}
    let re;
    switch (opName) {
${cases}
    }
    if (re !== undefined) {
      this.#binding.post({ id, re, to: from });
    } else {
      this.#binding.post({ id, ex: { [opName]: 'unhandled' }, to: from });
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
