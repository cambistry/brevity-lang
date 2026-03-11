const MATCH_TYPES_FN = `fn match_types(message: &Value, pairs: &[(&str, &str)]) -> bool {
    let bva = match message.get("bv-a") {
        Some(v) => v,
        None => return pairs.is_empty(),
    };
    let arr = match bva.as_array() {
        Some(a) => a,
        None => return pairs.is_empty(),
    };
    if arr.is_empty() {
        return pairs.is_empty();
    }
    let types_obj = &arr[0];
    for &(name, type_name) in pairs {
        match types_obj.get(name) {
            Some(v) if v.as_str() == Some(type_name) => {}
            _ => return false,
        }
    }
    true
}`;

function buildTypeEnv(params, body) {
  const env = new Map();
  for (const p of params) {
    if (p.name && p.type) env.set(p.name, p.type);
  }
  for (const s of body) {
    if (s.type === 'TypedAssign') env.set(s.name, s.typeName);
  }
  return env;
}

function rustType(brevityType) {
  if (brevityType === 'Integer') return 'i64';
  if (brevityType === 'Text') return 'String';
  if (brevityType === 'Float') return 'f64';
  if (brevityType === 'Boolean') return 'bool';
  return 'Value';
}

function genRustExpr(expr, typeEnv) {
  if (expr.type === 'StringLiteral') return JSON.stringify(expr.value);
  if (expr.type === 'IntLiteral') return String(expr.value);
  if (expr.type === 'FloatLiteral') return String(expr.value);
  if (expr.type === 'BoolLiteral') return expr.value ? 'true' : 'false';
  if (expr.type === 'Identifier') return expr.name;
  if (expr.type === 'BinaryExpr') {
    return `${genRustExpr(expr.left, typeEnv)} ${expr.op} ${genRustExpr(expr.right, typeEnv)}`;
  }
  throw new Error(`Unsupported Rust expression: ${expr.type}`);
}

function genRustDestructure(params) {
  const lines = [];
  for (const p of params) {
    const key = p.key || p.name;
    if (p.type === 'Integer') {
      lines.push(`                let ${p.name} = payload.get("${key}").and_then(|v| v.as_i64()).unwrap_or(0);`);
    } else if (p.type === 'Text') {
      lines.push(`                let ${p.name} = payload.get("${key}").and_then(|v| v.as_str()).unwrap_or("").to_string();`);
    } else if (p.type === 'Float') {
      lines.push(`                let ${p.name} = payload.get("${key}").and_then(|v| v.as_f64()).unwrap_or(0.0);`);
    } else if (p.type === 'Boolean') {
      lines.push(`                let ${p.name} = payload.get("${key}").and_then(|v| v.as_bool()).unwrap_or(false);`);
    }
  }
  return lines.join('\n');
}

function genRustLocals(body, typeEnv) {
  const lines = [];
  for (const s of body) {
    if (s.type === 'TypedAssign') {
      const rt = rustType(s.typeName);
      lines.push(`                let ${s.name}: ${rt} = ${genRustExpr(s.value, typeEnv)};`);
    }
  }
  return lines.join('\n');
}

function genRustReBody(fields, typeEnv) {
  const entries = [];
  for (const f of fields) {
    if ('sigil' in f) {
      entries.push(`"${f.sigil}": ${f.sigil}`);
    } else if (f.key !== undefined) {
      entries.push(`"${f.key}": ${genRustExpr(f.value, typeEnv)}`);
    }
  }
  return `json!({${entries.join(', ')}})`;
}

function genRustBvaBody(fields, typeEnv) {
  const entries = [];
  for (const f of fields) {
    let key, type;
    if ('sigil' in f) {
      key = f.sigil;
      type = f.type || typeEnv.get(f.sigil);
    } else if (f.key !== undefined) {
      key = f.key;
      type = f.type || (f.value?.type === 'Identifier' ? typeEnv.get(f.value.name) : null);
    }
    if (!key || !type) return null;
    entries.push(`"${key}": "${type}"`);
  }
  return `json!({${entries.join(', ')}})`;
}

function genRustHandler({ op, params, body }) {
  const reply = body.find(s => s.type === 'Reply');
  const typeEnv = buildTypeEnv(params, body);

  const typedParams = params.filter(p => p.type && !p.rest);
  const guard = typedParams.length > 0
    ? ` if match_types(message, &[${typedParams.map(p => `("${p.key || p.name}", "${p.type}")`).join(', ')}])`
    : '';

  const lines = [];

  const destructure = genRustDestructure(params);
  if (destructure) lines.push(destructure);

  const locals = genRustLocals(body, typeEnv);
  if (locals) lines.push(locals);

  if (reply) {
    lines.push(`                re = Some(${genRustReBody(reply.fields, typeEnv)});`);
    const bva = genRustBvaBody(reply.fields, typeEnv);
    if (bva) {
      lines.push(`                bva_re = Some(${bva});`);
    }
  }
  lines.push('                handled = true;');

  return `            "${op}"${guard} => {\n${lines.join('\n')}\n            }`;
}

function genRustDispatch(handlers) {
  const arms = handlers.map(h => genRustHandler(h));
  arms.push('            _ => {}');
  return arms.join('\n');
}

function genRustProgram(actor) {
  const needsMatchTypes = actor.handlers.some(h => h.params.length > 0);
  const matchTypesFn = needsMatchTypes ? '\n' + MATCH_TYPES_FN + '\n' : '';
  const matchArms = genRustDispatch(actor.handlers);

  return `use serde_json::{json, Value, Map};
use std::io::{self, BufRead, Write};
use std::sync::mpsc;
${matchTypesFn}
struct Actor {
    binding: mpsc::Sender<Value>,
}

impl Actor {
    fn new(binding: mpsc::Sender<Value>) -> Self {
        Actor { binding }
    }

    fn receive(&self, message: &Value) {
        if message.get("re").is_some() {
            return;
        }
        self.dispatch(message);
    }

    fn dispatch(&self, message: &Value) {
        let id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let from = message.get("from").and_then(|v| v.as_str()).unwrap_or("");
        let op_val = message.get("op").unwrap();
        let (op_name, raw_payload): (String, Option<Value>) = if let Some(s) = op_val.as_str() {
            (s.to_string(), None)
        } else if let Some(arr) = op_val.as_array() {
            let name = arr.last().and_then(|v| v.as_str()).unwrap_or("").to_string();
            let payload = if arr.len() > 1 { Some(arr[0].clone()) } else { None };
            (name, payload)
        } else {
            return;
        };
        let has_payload = match &raw_payload {
            Some(Value::Object(m)) => !m.is_empty(),
            Some(Value::Array(a)) => !a.is_empty(),
            _ => false,
        };
        if has_payload && message.get("bv-a").is_none() {
            let mut ex = Map::new();
            ex.insert(op_name.clone(), json!("schema_required"));
            let mut resp = Map::new();
            resp.insert("id".to_string(), json!(id));
            resp.insert("ex".to_string(), Value::Object(ex));
            resp.insert("to".to_string(), json!(from));
            let _ = self.binding.send(Value::Object(resp));
            return;
        }
        let payload = raw_payload.unwrap_or(json!({}));
        let mut re: Option<Value> = None;
        let mut bva_re: Option<Value> = None;
        let mut handled = false;
        match op_name.as_str() {
${matchArms}
        }
        if !handled {
            let mut ex = Map::new();
            ex.insert(op_name.clone(), json!("unhandled"));
            let mut resp = Map::new();
            resp.insert("id".to_string(), json!(id));
            resp.insert("ex".to_string(), Value::Object(ex));
            resp.insert("to".to_string(), json!(from));
            let _ = self.binding.send(Value::Object(resp));
        } else if let Some(re_val) = re {
            let mut resp = Map::new();
            resp.insert("id".to_string(), json!(id));
            resp.insert("re".to_string(), re_val);
            resp.insert("to".to_string(), json!(from));
            if let Some(bva) = bva_re {
                resp.insert("bv-a".to_string(), bva);
            }
            let _ = self.binding.send(Value::Object(resp));
        }
    }
}

fn main() {
    let (tx, rx) = mpsc::channel::<Value>();
    let handle = std::thread::spawn(move || {
        let stdout = io::stdout();
        let mut out = stdout.lock();
        for msg in rx {
            serde_json::to_writer(&mut out, &msg).unwrap();
            out.write_all(b"\\n").unwrap();
            out.flush().unwrap();
        }
    });
    let actor = Actor::new(tx);
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        if line.trim().is_empty() { continue; }
        let message: Value = serde_json::from_str(&line).unwrap();
        actor.receive(&message);
    }
    drop(actor);
    handle.join().unwrap();
}
`;
}

export function codegenRust(ast) {
  const active = ast.actors.filter(a => a.handlers.length > 0);
  if (active.length === 0) return '';
  return genRustProgram(active[0]);
}
