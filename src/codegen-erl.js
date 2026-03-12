// ── Erlang / BEAM codegen ────────────────────────────────────────────────────
// Emits a single .erl module per actor.  Compiled with `erlc`, run with `erl`.
// All helpers (JSON codec, structure ops, type matching) are embedded in the
// preamble — no external Erlang dependencies.

// ── Preamble: pure-Erlang JSON codec + helpers ──────────────────────────────

const PREAMBLE = `
%% ── JSON codec (subset) ─────────────────────────────────────────────────────
-define(IS_WS(C), (C =:= $\\s orelse C =:= $\\t orelse C =:= $\\n orelse C =:= $\\r)).

json_decode(Bin) ->
    {Val, _} = json_parse_value(skip_ws(Bin)),
    Val.

skip_ws(<<C, Rest/binary>>) when ?IS_WS(C) -> skip_ws(Rest);
skip_ws(Bin) -> Bin.

json_parse_value(<<"null", R/binary>>) -> {null, R};
json_parse_value(<<"true", R/binary>>) -> {true, R};
json_parse_value(<<"false", R/binary>>) -> {false, R};
json_parse_value(<<$", _/binary>> = B) -> json_parse_string(B);
json_parse_value(<<$[, R/binary>>) -> json_parse_array(skip_ws(R), []);
json_parse_value(<<\${, R/binary>>) -> json_parse_object(skip_ws(R), #{});
json_parse_value(Bin) -> json_parse_number(Bin).

json_parse_string(<<$", Rest/binary>>) -> json_parse_string_body(Rest, []).
json_parse_string_body(<<$", Rest/binary>>, Acc) -> {iolist_to_binary(lists:reverse(Acc)), Rest};
json_parse_string_body(<<$\\\\, $", Rest/binary>>, Acc) -> json_parse_string_body(Rest, [$"|Acc]);
json_parse_string_body(<<$\\\\, $\\\\, Rest/binary>>, Acc) -> json_parse_string_body(Rest, [$\\\\|Acc]);
json_parse_string_body(<<$\\\\, $/, Rest/binary>>, Acc) -> json_parse_string_body(Rest, [$/|Acc]);
json_parse_string_body(<<$\\\\, $n, Rest/binary>>, Acc) -> json_parse_string_body(Rest, [$\\n|Acc]);
json_parse_string_body(<<$\\\\, $t, Rest/binary>>, Acc) -> json_parse_string_body(Rest, [$\\t|Acc]);
json_parse_string_body(<<$\\\\, $r, Rest/binary>>, Acc) -> json_parse_string_body(Rest, [$\\r|Acc]);
json_parse_string_body(<<$\\\\, $b, Rest/binary>>, Acc) -> json_parse_string_body(Rest, [$\\b|Acc]);
json_parse_string_body(<<$\\\\, $f, Rest/binary>>, Acc) -> json_parse_string_body(Rest, [$\\f|Acc]);
json_parse_string_body(<<$\\\\, $u, A, B, C, D, Rest/binary>>, Acc) ->
    Cp = list_to_integer([A,B,C,D], 16),
    json_parse_string_body(Rest, [<<Cp/utf8>>|Acc]);
json_parse_string_body(<<C, Rest/binary>>, Acc) -> json_parse_string_body(Rest, [C|Acc]).

json_parse_number(Bin) -> json_parse_number(Bin, [], false).
json_parse_number(<<$-, R/binary>>, Acc, F) -> json_parse_number(R, [$-|Acc], F);
json_parse_number(<<$., R/binary>>, Acc, _) -> json_parse_number(R, [$.|Acc], true);
json_parse_number(<<$e, R/binary>>, Acc, _) -> json_parse_number(R, [$e|Acc], true);
json_parse_number(<<$E, R/binary>>, Acc, _) -> json_parse_number(R, [$E|Acc], true);
json_parse_number(<<$+, R/binary>>, Acc, F) -> json_parse_number(R, [$+|Acc], F);
json_parse_number(<<C, R/binary>>, Acc, F) when C >= $0, C =< $9 -> json_parse_number(R, [C|Acc], F);
json_parse_number(Rest, Acc, false) -> {list_to_integer(lists:reverse(Acc)), Rest};
json_parse_number(Rest, Acc, true) -> {list_to_float(lists:reverse(Acc)), Rest}.

json_parse_array(<<$], R/binary>>, Acc) -> {lists:reverse(Acc), R};
json_parse_array(Bin, Acc) ->
    {Val, R1} = json_parse_value(skip_ws(Bin)),
    R2 = skip_ws(R1),
    case R2 of
        <<$,, R3/binary>> -> json_parse_array(skip_ws(R3), [Val|Acc]);
        <<$], R3/binary>> -> {lists:reverse([Val|Acc]), R3}
    end.

json_parse_object(<<$}, R/binary>>, Acc) -> {Acc, R};
json_parse_object(Bin, Acc) ->
    {Key, R1} = json_parse_string(skip_ws(Bin)),
    <<$:, R2/binary>> = skip_ws(R1),
    {Val, R3} = json_parse_value(skip_ws(R2)),
    R4 = skip_ws(R3),
    case R4 of
        <<$,, R5/binary>> -> json_parse_object(skip_ws(R5), Acc#{Key => Val});
        <<$}, R5/binary>> -> {Acc#{Key => Val}, R5}
    end.

%% ── JSON encoder ────────────────────────────────────────────────────────────
json_encode(null) -> <<"null">>;
json_encode(true) -> <<"true">>;
json_encode(false) -> <<"false">>;
json_encode(I) when is_integer(I) -> integer_to_binary(I);
json_encode(F) when is_float(F) ->
    %% Ensure integers-as-floats render without decimal (match JS)
    case trunc(F) == F andalso abs(F) < 1.0e15 of
        true -> integer_to_binary(trunc(F));
        false -> float_to_binary(F, [{decimals, 10}, compact])
    end;
json_encode(B) when is_binary(B) -> json_encode_string(B);
json_encode(L) when is_list(L) ->
    Inner = lists:join($,, [json_encode(E) || E <- L]),
    iolist_to_binary([$[, Inner, $]]);
json_encode(M) when is_map(M) ->
    Pairs = maps:fold(fun(K, V, Acc) ->
        KB = if is_binary(K) -> K; is_atom(K) -> atom_to_binary(K); true -> K end,
        [[json_encode_string(KB), $:, json_encode(V)] | Acc]
    end, [], M),
    %% Sort for deterministic output
    Sorted = lists:sort(Pairs),
    iolist_to_binary([\${, lists:join($,, Sorted), $}]);
json_encode(_) -> <<"null">>.

json_encode_string(Bin) ->
    Escaped = json_escape(Bin, []),
    iolist_to_binary([$", Escaped, $"]).

json_escape(<<>>, Acc) -> lists:reverse(Acc);
json_escape(<<$", R/binary>>, Acc) -> json_escape(R, [$", $\\\\|Acc]);
json_escape(<<$\\\\, R/binary>>, Acc) -> json_escape(R, [$\\\\, $\\\\|Acc]);
json_escape(<<$\\n, R/binary>>, Acc) -> json_escape(R, [$n, $\\\\|Acc]);
json_escape(<<$\\r, R/binary>>, Acc) -> json_escape(R, [$r, $\\\\|Acc]);
json_escape(<<$\\t, R/binary>>, Acc) -> json_escape(R, [$t, $\\\\|Acc]);
json_escape(<<C, R/binary>>, Acc) -> json_escape(R, [C|Acc]).

%% ── Structure helpers ───────────────────────────────────────────────────────
structure_pack(null) -> {[], #{}};
structure_pack(L) when is_list(L) ->
    case L of
        [] -> {[], #{}};
        _ ->
            Last = lists:last(L),
            case is_map(Last) andalso map_size(Last) > 0 of
                true ->
                    Pos = lists:sublist(L, length(L) - 1),
                    {Pos, Last};
                false ->
                    {L, #{}}
            end
    end;
structure_pack(M) when is_map(M) -> {[], M};
structure_pack(_) -> {[], #{}}.

structure_one({[V], _}) -> V;
structure_one({Pos, _}) -> error({arity, length(Pos)}).

structure_splat({Pos, Named}) ->
    HasPos = length(Pos) > 0,
    HasNamed = map_size(Named) > 0,
    if
        HasPos andalso HasNamed -> Pos ++ [Named];
        HasPos -> Pos;
        true -> Named
    end.

structure_splat_bva(BvaFirst) when is_list(BvaFirst) ->
    case BvaFirst of
        [] -> [];
        _ ->
            Last = lists:last(BvaFirst),
            case is_map(Last) of
                true when length(BvaFirst) =:= 1 -> Last;
                _ -> BvaFirst
            end
    end;
structure_splat_bva(M) when is_map(M) -> M;
structure_splat_bva(_) -> null.

%% ── Type matching ───────────────────────────────────────────────────────────
match_types(Message, Pairs) ->
    case maps:find(<<"bv-a">>, Message) of
        {ok, BvA} when is_list(BvA), length(BvA) > 0 ->
            TypesObj = hd(BvA),
            lists:all(fun({Name, TypeName}) ->
                case maps:find(Name, TypesObj) of
                    {ok, TypeName} -> true;
                    {ok, V} when is_list(V) ->
                        TypeName =:= <<"List">> orelse TypeName =:= <<"List of Anything">>;
                    _ -> false
                end
            end, Pairs);
        _ -> Pairs =:= []
    end.

match_types_positional(Message, PosTypes, NamedTypes) ->
    case maps:find(<<"bv-a">>, Message) of
        {ok, BvA} when is_list(BvA), length(BvA) > 0 ->
            TypesArr = hd(BvA),
            case is_list(TypesArr) of
                true ->
                    PosOk = match_pos_types(TypesArr, PosTypes, 0),
                    NamedOk = case NamedTypes of
                        [] -> true;
                        _ ->
                            case lists:last(TypesArr) of
                                M when is_map(M) ->
                                    lists:all(fun({N, T}) ->
                                        maps:find(N, M) =:= {ok, T}
                                    end, NamedTypes);
                                _ -> false
                            end
                    end,
                    PosOk andalso NamedOk;
                false -> false
            end;
        _ -> PosTypes =:= [] andalso NamedTypes =:= []
    end.

match_pos_types(_, [], _) -> true;
match_pos_types(Arr, [T|Rest], I) ->
    case I < length(Arr) of
        true ->
            case lists:nth(I+1, Arr) =:= T of
                true -> match_pos_types(Arr, Rest, I+1);
                false -> false
            end;
        false -> false
    end.

%% ── Truthiness ──────────────────────────────────────────────────────────────
is_truthy(false) -> false;
is_truthy(null) -> false;
is_truthy(0) -> false;
is_truthy(<<>>) -> false;
is_truthy(_) -> true.

%% ── List helpers ────────────────────────────────────────────────────────────
brevity_map(null, _Fn) -> null;
brevity_map(List, Fn) -> lists:map(Fn, List).

brevity_foldl(null, _Init, _Fn) -> null;
brevity_foldl(List, Init, Fn) -> lists:foldl(Fn, Init, List).

brevity_foldl1(_Fn, null) -> null;
brevity_foldl1(_Fn, []) -> null;
brevity_foldl1(_Fn, [X]) -> X;
brevity_foldl1(Fn, [H|T]) -> lists:foldl(Fn, H, T).

%% Convert internal list to JSON-safe value (null for empty)
list_to_json(null) -> null;
list_to_json([]) -> null;
list_to_json(L) when is_list(L) -> L.

%% Compute component types for List of Anything bv-a
list_component_types(null) -> [];
list_component_types(L) when is_list(L) ->
    [brevity_typeof(E) || E <- L].

brevity_typeof(V) when is_integer(V) -> <<"Integer">>;
brevity_typeof(V) when is_float(V) -> <<"Float">>;
brevity_typeof(V) when is_binary(V) -> <<"Text">>;
brevity_typeof(true) -> <<"Boolean">>;
brevity_typeof(false) -> <<"Boolean">>;
brevity_typeof(_) -> <<"Anything">>.
`;

// ── Helpers ─────────────────────────────────────────────────────────────────

// Reserved names used in generated Erlang dispatch code — user vars must not collide
const RESERVED_ERL_VARS = new Set([
  'Message', 'Payload', 'Id', 'From', 'OpVal', 'OpName', 'HasPayload',
  'Result', 'Re', 'Resp', 'Resp0', 'Ex', 'BvaRe', 'BvaFirst',
  'S_pos', 'S_named', 'Args_pos', 'Args_named',
]);

function erlVarName(name) {
  // Erlang vars must start uppercase. camelCase → CamelCase, snake_case → Snake_case
  if (!name) return '_';
  const base = name.charAt(0).toUpperCase() + name.slice(1);
  if (RESERVED_ERL_VARS.has(base)) return 'V_' + base;
  return base;
}

function erlString(s) {
  // Erlang binary string literal
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `<<"${escaped}">>`;
}

function inferLiteralType(expr) {
  if (!expr) return null;
  if (expr.type === 'IntLiteral') return 'Integer';
  if (expr.type === 'StringLiteral') return 'Text';
  if (expr.type === 'FloatLiteral') return 'Float';
  if (expr.type === 'BoolLiteral') return 'Boolean';
  return null;
}

function buildTypeEnv(params, body) {
  const env = new Map();
  for (const p of params) {
    if (p.name && p.type && !p.rest) env.set(p.name, p.type);
  }
  for (const s of body) {
    if (s.type === 'TypedAssign') env.set(s.name, s.typeName);
    if (s.type === 'DestructureAssign') {
      for (const item of s.pattern) {
        if (!item.discard && item.name && item.type) env.set(item.name, item.type);
      }
    }
    if (s.type === 'Assign') {
      const inferred = inferLiteralType(s.value);
      if (inferred) env.set(s.name, inferred);
    }
    if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (!item.discard && item.name && item.type) env.set(item.name, item.type);
      }
    }
  }
  return env;
}

// ── SSA name mangling ───────────────────────────────────────────────────────

function buildSSAEnv(body) {
  // Track how many times each variable is assigned; generate SSA names
  const counts = new Map();
  const assignments = []; // [{stmtIdx, name, ssaName}]

  for (let i = 0; i < body.length; i++) {
    const s = body[i];
    if (s.type === 'TypedAssign' || s.type === 'Assign') {
      const n = counts.get(s.name) || 0;
      const ssaName = n === 0 ? s.name : `${s.name}__${n}`;
      counts.set(s.name, n + 1);
      assignments.push({ stmtIdx: i, name: s.name, ssaName });
    }
    if (s.type === 'DestructureAssign' || s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (item.discard) continue;
        if (item.name) {
          const n = counts.get(item.name) || 0;
          const ssaName = n === 0 ? item.name : `${item.name}__${n}`;
          counts.set(item.name, n + 1);
          assignments.push({ stmtIdx: i, name: item.name, ssaName });
        }
      }
    }
  }

  return { counts, assignments };
}

function resolveSSAName(name, stmtIdx, ssaEnv) {
  // Find the most recent SSA assignment for `name` before stmtIdx
  let best = name; // default: first assignment
  for (const a of ssaEnv.assignments) {
    if (a.name === name && a.stmtIdx <= stmtIdx) best = a.ssaName;
  }
  return best;
}

function getSSANameForAssignment(name, stmtIdx, ssaEnv) {
  for (const a of ssaEnv.assignments) {
    if (a.name === name && a.stmtIdx === stmtIdx) return a.ssaName;
  }
  return name;
}

// ── Expression codegen ──────────────────────────────────────────────────────

function genExpr(expr, typeEnv, ctx) {
  if (!expr) return 'null';

  if (expr.type === 'StringLiteral') return erlString(expr.value);
  if (expr.type === 'IntLiteral') return String(expr.value);
  if (expr.type === 'FloatLiteral') {
    const s = String(expr.value);
    return s.includes('.') ? s : s + '.0';
  }
  if (expr.type === 'BoolLiteral') return expr.value ? 'true' : 'false';
  if (expr.type === 'NullLiteral') return 'null';

  if (expr.type === 'Identifier') {
    const name = expr.name;
    // Resolve SSA if context has ssaEnv
    if (ctx?.ssaEnv && ctx.stmtIdx !== undefined) {
      return erlVarName(resolveSSAName(name, ctx.stmtIdx, ctx.ssaEnv));
    }
    return erlVarName(name);
  }

  if (expr.type === 'BinaryExpr') {
    const left = genExpr(expr.left, typeEnv, ctx);
    const right = genExpr(expr.right, typeEnv, ctx);
    // Check if this is string concatenation
    const leftType = exprType(expr.left, typeEnv, ctx);
    const rightType = exprType(expr.right, typeEnv, ctx);
    if (expr.op === '+' && (leftType === 'Text' || rightType === 'Text')) {
      return `<<${left}/binary, ${right}/binary>>`;
    }
    const op = expr.op === '/' ? '/' : expr.op;
    if (expr.op === '/') {
      return `(${left} div ${right})`;
    }
    return `(${left} ${op} ${right})`;
  }

  if (expr.type === 'IndexExpr') {
    const obj = genExpr(expr.object, typeEnv, ctx);
    if (expr.key !== null) {
      return `maps:get(${erlString(expr.key)}, ${obj}_named, null)`;
    }
    return `lists:nth(${expr.index + 1}, ${obj}_pos)`;
  }

  if (expr.type === 'StructureConstructor') {
    return genStructureConstructor(expr, typeEnv, ctx);
  }

  if (expr.type === 'ProcCallExpr') {
    return genProcCallExpr(expr, typeEnv, ctx);
  }

  if (expr.type === 'FunctionCallExpr') {
    return genFunctionCallExpr(expr, typeEnv, ctx);
  }

  if (expr.type === 'Function') {
    return genFunctionLiteral(expr, typeEnv, ctx);
  }

  if (expr.type === 'ListLiteral') {
    if (expr.elements.length === 0) return 'null';
    const elems = expr.elements.map(e => genExpr(e, typeEnv, ctx));
    return `[${elems.join(', ')}]`;
  }

  if (expr.type === 'OverExpr') {
    return genOverExpr(expr, typeEnv, ctx);
  }

  if (expr.type === 'ReduceExpr') {
    return genReduceExpr(expr, typeEnv, ctx);
  }

  if (expr.type === 'IfExpr') {
    return genIfExpr(expr, typeEnv, ctx);
  }

  if (expr.type === 'ProcRef') {
    return `fun(Item_) -> structure_one(${expr.name}_proc({[Item_], #{}})) end`;
  }

  if (expr.type === 'FnRef') {
    return erlVarName(expr.name);
  }

  if (expr.type === 'RefRead') {
    return `get(ref_${expr.name})`;
  }

  if (expr.type === 'StateVar') {
    return `maps:get(<<"${expr.name}">>, State_)`;
  }

  if (expr.type === 'StructureLiteral') {
    return genStructureConstructor(expr, typeEnv, ctx);
  }

  if (expr.type === 'DecimalLiteral') {
    return String(expr.value);
  }

  throw new Error(`Unsupported Erlang expression: ${expr.type}`);
}

function exprType(expr, typeEnv, ctx) {
  if (!expr) return null;
  if (expr.type === 'StringLiteral') return 'Text';
  if (expr.type === 'IntLiteral') return 'Integer';
  if (expr.type === 'FloatLiteral') return 'Float';
  if (expr.type === 'BoolLiteral') return 'Boolean';
  if (expr.type === 'Identifier') return typeEnv.get(expr.name) || null;
  return null;
}

function genStructureConstructor(expr, typeEnv, ctx) {
  const positional = expr.args.filter(a => a.positional);
  const named = expr.args.filter(a => a.key !== undefined && a.type !== 'Callable');
  const callable = expr.args.filter(a => a.type === 'Callable');

  const posVals = positional.map(a => genExpr(a.expr, typeEnv, ctx)).join(', ');
  const namedPairs = [...named, ...callable].map(a => {
    const val = genExpr(a.expr, typeEnv, ctx);
    return `${erlString(a.key)} => ${val}`;
  }).join(', ');

  return `{[${posVals}], #{${namedPairs}}}`;
}

function genProcCallExpr(expr, typeEnv, ctx) {
  if (expr.args.length === 0) {
    return `${expr.name}_proc({[], #{}})`;
  }
  const argVals = expr.args.map(a => genExpr(a, typeEnv, ctx));
  return `${expr.name}_proc({[${argVals.join(', ')}], #{}})`;
}

let _fnScopeCounter = 0;

function genFunctionLiteral(expr, typeEnv, ctx) {
  const params = expr.params || [];
  const scopeId = _fnScopeCounter++;
  const prefix = `Fn${scopeId}_`;

  // Build a renaming map: inner var names → prefixed names (to avoid Erlang shadowing)
  const innerRenames = new Map();
  const paramNames = params.map(p => {
    const renamed = prefix + erlVarName(p.name);
    innerRenames.set(p.name, renamed);
    return renamed;
  }).join(', ');

  function innerVarName(name) {
    if (innerRenames.has(name)) return innerRenames.get(name);
    return erlVarName(name);
  }

  function genInnerExpr(e) {
    if (!e) return 'null';
    if (e.type === 'Identifier') return innerVarName(e.name);
    if (e.type === 'StringLiteral') return erlString(e.value);
    if (e.type === 'IntLiteral') return String(e.value);
    if (e.type === 'FloatLiteral') return e.value.toString().includes('.') ? String(e.value) : e.value + '.0';
    if (e.type === 'BoolLiteral') return e.value ? 'true' : 'false';
    if (e.type === 'BinaryExpr') {
      const left = genInnerExpr(e.left);
      const right = genInnerExpr(e.right);
      if (e.op === '/') return `(${left} div ${right})`;
      return `(${left} ${e.op} ${right})`;
    }
    // Fallback to outer genExpr for complex expressions
    return genExpr(e, typeEnv, ctx);
  }

  let bodyExpr;
  if (expr.body && expr.body.length > 0) {
    const implRet = expr.body.find(s => s.type === 'ImplicitReturn');
    const bodyStmts = expr.body.filter(s => s.type !== 'ImplicitReturn');

    if (bodyStmts.length > 0 || implRet) {
      const lines = [];
      for (let si = 0; si < bodyStmts.length; si++) {
        const s = bodyStmts[si];
        if (s.type === 'TypedAssign' || s.type === 'Assign') {
          const renamed = prefix + erlVarName(s.name);
          innerRenames.set(s.name, renamed);
          if (s.value?.type === 'ProcCallExpr') {
            const args = s.value.args.map(a => genInnerExpr(a)).join(', ');
            lines.push(`${renamed} = structure_one(${s.value.name}_proc({[${args}], #{}}))`);
          } else {
            lines.push(`${renamed} = ${genInnerExpr(s.value)}`);
          }
        }
        if (s.type === 'DestructureAssign') {
          const tmpName = `${prefix}Dtmp_${si}`;
          const isProcCall = s.source.type === 'ProcCallExpr';
          if (isProcCall) {
            const args = s.source.args.map(a => genInnerExpr(a)).join(', ');
            lines.push(`${tmpName} = ${s.source.name}_proc({[${args}], #{}})`);
          } else {
            lines.push(`${tmpName} = ${genInnerExpr(s.source)}`);
          }
          const hasPosItems = s.pattern.some(p => p.positional && !p.rest);
          const hasNamedItems = s.pattern.some(p => p.named || p.key !== undefined);
          if (hasPosItems || hasNamedItems) {
            lines.push(`{${tmpName}_pos, ${tmpName}_named} = ${tmpName}`);
          }
          for (const item of s.pattern) {
            if (item.discard) continue;
            const renamed = prefix + erlVarName(item.name);
            innerRenames.set(item.name, renamed);
            if (item.named || item.key !== undefined) {
              const key = item.key || item.name;
              lines.push(`${renamed} = maps:get(${erlString(key)}, ${tmpName}_named, null)`);
            } else if (item.positional) {
              lines.push(`${renamed} = lists:nth(${(item.idx || 0) + 1}, ${tmpName}_pos)`);
            }
          }
        }
      }
      if (implRet) {
        lines.push(genInnerExpr(implRet.expr));
      } else if (bodyStmts.length > 0) {
        const last = bodyStmts[bodyStmts.length - 1];
        if (last.name) lines.push(innerVarName(last.name));
      }
      bodyExpr = lines.join(', ');
    } else {
      bodyExpr = 'null';
    }
  } else if (expr.expr) {
    bodyExpr = genInnerExpr(expr.expr);
  } else {
    bodyExpr = 'null';
  }

  return `fun(${paramNames}) -> ${bodyExpr} end`;
}

function genFunctionCallExpr(expr, typeEnv, ctx) {
  const callee = genExpr(expr.callee, typeEnv, ctx);
  const args = (expr.args || []).filter(a => a.type !== 'NamedArgsBag').map(a => genExpr(a, typeEnv, ctx));
  return `${callee}(${args.join(', ')})`;
}

function genOverExpr(expr, typeEnv, ctx) {
  const list = genExpr(expr.collection, typeEnv, ctx);
  let fn;
  if (expr.fn.type === 'ProcRef') {
    fn = `fun(Item_) -> structure_one(${expr.fn.name}_proc({[Item_], #{}})) end`;
  } else if (expr.fn.type === 'FnRef') {
    fn = erlVarName(expr.fn.name);
  } else {
    fn = genExpr(expr.fn, typeEnv, ctx);
  }
  return `brevity_map(${list}, ${fn})`;
}

function genReduceExpr(expr, typeEnv, ctx) {
  const list = genExpr(expr.collection, typeEnv, ctx);
  let fn;
  if (expr.fn.type === 'ProcRef') {
    fn = `fun(Item_, Acc_) -> structure_one(${expr.fn.name}_proc({[Acc_, Item_], #{}})) end`;
  } else if (expr.fn.type === 'FnRef') {
    fn = erlVarName(expr.fn.name);
  } else {
    fn = genExpr(expr.fn, typeEnv, ctx);
  }
  if (expr.initial) {
    const init = genExpr(expr.initial, typeEnv, ctx);
    return `brevity_foldl(${list}, ${init}, ${fn})`;
  }
  return `brevity_foldl1(${fn}, ${list})`;
}

function genIfExpr(expr, typeEnv, ctx) {
  const cond = genExpr(expr.condition, typeEnv, ctx);
  const thenExpr = genExpr(expr.then, typeEnv, ctx);
  const elseExpr = expr.else_ ? genExpr(expr.else_, typeEnv, ctx) : 'null';
  return `case is_truthy(${cond}) of true -> ${thenExpr}; false -> ${elseExpr} end`;
}

// ── Reply field codegen ─────────────────────────────────────────────────────

function genReplyBody(fields, typeEnv, ctx) {
  const spread = fields.find(f => f.spread);
  if (spread) {
    if (ctx?.restVars?.has(spread.name)) {
      return `structure_splat({${erlVarName(spread.name)}_pos, ${erlVarName(spread.name)}_named})`;
    }
    return `structure_splat(${erlVarName(spread.name)})`;
  }

  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  if (pos.length > 0 && named.length > 0) {
    const posVals = pos.map(f => genReplyFieldVal(f, typeEnv, ctx)).join(', ');
    const namedMap = genReplyNamedMap(named, typeEnv, ctx);
    return `[${posVals}, ${namedMap}]`;
  } else if (pos.length > 0) {
    const posVals = pos.map(f => genReplyFieldVal(f, typeEnv, ctx)).join(', ');
    return `[${posVals}]`;
  } else {
    return genReplyNamedMap(named, typeEnv, ctx);
  }
}

function genReplyFieldVal(f, typeEnv, ctx) {
  if (f.name) return erlVarName(f.name);
  if (f.expr) return genExpr(f.expr, typeEnv, ctx);
  return 'null';
}

function genReplyNamedMap(named, typeEnv, ctx) {
  const entries = named.map(f => {
    if ('sigil' in f) {
      return `${erlString(f.sigil)} => ${erlVarName(f.sigil)}`;
    }
    if (f.key !== undefined) {
      const val = f.value ? genExpr(f.value, typeEnv, ctx) : erlVarName(f.key);
      return `${erlString(f.key)} => ${val}`;
    }
    return '';
  }).filter(Boolean);
  return `#{${entries.join(', ')}}`;
}

function isListOfAnythingType(t) {
  return t === 'List' || t === 'List of Anything';
}

function genBvaBody(fields, typeEnv) {
  const spread = fields.find(f => f.spread);
  if (spread) return null; // handled separately

  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  const posTypes = [];
  for (const f of pos) {
    const t = f.type || (f.name ? typeEnv.get(f.name) : null);
    if (!t) return null;
    posTypes.push(erlString(t));
  }

  const namedTypes = [];
  for (const f of named) {
    let key, t, varExpr;
    if ('sigil' in f) {
      key = f.sigil;
      t = f.type || typeEnv.get(f.sigil);
      varExpr = erlVarName(f.sigil);
    } else if (f.key !== undefined) {
      key = f.key;
      t = f.type || (f.value?.type === 'Identifier' ? typeEnv.get(f.value.name) : null);
      varExpr = f.value?.type === 'Identifier' ? erlVarName(f.value.name) : null;
    }
    if (!key || !t) return null;
    if (isListOfAnythingType(t) && varExpr) {
      namedTypes.push(`${erlString(key)} => list_component_types(${varExpr})`);
    } else {
      namedTypes.push(`${erlString(key)} => ${erlString(t)}`);
    }
  }

  if (pos.length > 0 && named.length > 0) {
    return `[${posTypes.join(', ')}, #{${namedTypes.join(', ')}}]`;
  } else if (pos.length > 0) {
    return `[${posTypes.join(', ')}]`;
  } else if (named.length > 0) {
    return `#{${namedTypes.join(', ')}}`;
  }
  return null;
}

// ── Handler param destructuring ─────────────────────────────────────────────

function genParamDestructure(params, indent) {
  const I = indent;
  const lines = [];
  const hasPositional = params.some(p => p.positional && !p.rest);
  const hasRest = params.some(p => p.rest);

  if (hasRest) {
    lines.push(`${I}{Args_pos, Args_named} = structure_pack(Payload),`);
  } else if (hasPositional) {
    lines.push(`${I}{S_pos, S_named} = structure_pack(Payload),`);
  }

  let posIdx = 0;
  for (const p of params) {
    if (p.rest) continue;
    if (p.positional) {
      lines.push(`${I}${erlVarName(p.name)} = lists:nth(${posIdx + 1}, S_pos),`);
      posIdx++;
    } else if (hasPositional) {
      const key = p.key || p.name;
      lines.push(`${I}${erlVarName(p.name)} = maps:get(${erlString(key)}, S_named, null),`);
    } else {
      const key = p.key || p.name;
      lines.push(`${I}${erlVarName(p.name)} = maps:get(${erlString(key)}, Payload, null),`);
    }
  }

  return lines;
}

// ── Local statement codegen ─────────────────────────────────────────────────

function genLocals(body, typeEnv, ctx, indent) {
  const I = indent;
  const lines = [];
  const ssaEnv = ctx.ssaEnv || buildSSAEnv(body);

  for (let i = 0; i < body.length; i++) {
    const s = body[i];
    const stmtCtx = { ...ctx, stmtIdx: i, ssaEnv };

    if (s.type === 'Reply' || s.type === 'ImplicitReturn') continue;

    if (s.type === 'TypedAssign' || s.type === 'Assign') {
      const ssaName = getSSANameForAssignment(s.name, i, ssaEnv);
      const varName = erlVarName(ssaName);

      if (s.type === 'TypedAssign' && s.value?.type === 'ProcCallExpr') {
        if (s.typeName === 'Structure') {
          lines.push(`${I}${varName} = ${genProcCallExpr(s.value, typeEnv, stmtCtx)},`);
        } else {
          lines.push(`${I}${varName} = structure_one(${genProcCallExpr(s.value, typeEnv, stmtCtx)}),`);
        }
      } else if (s.value?.type === 'ProcCallExpr') {
        lines.push(`${I}${varName} = structure_one(${genProcCallExpr(s.value, typeEnv, stmtCtx)}),`);
      } else if (s.type === 'TypedAssign' && s.typeName === 'Structure' && s.value?.type === 'StructureConstructor') {
        lines.push(`${I}${varName} = ${genExpr(s.value, typeEnv, stmtCtx)},`);
      } else if (s.type === 'TypedAssign' && s.value?.type === 'StructureConstructor') {
        lines.push(`${I}${varName} = structure_one(${genExpr(s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'FunctionCallExpr') {
        lines.push(`${I}${varName} = ${genFunctionCallExpr(s.value, typeEnv, stmtCtx)},`);
      } else if (s.value?.type === 'Function') {
        lines.push(`${I}${varName} = ${genFunctionLiteral(s.value, typeEnv, stmtCtx)},`);
      } else {
        lines.push(`${I}${varName} = ${genExpr(s.value, typeEnv, stmtCtx)},`);
      }
    }

    if (s.type === 'DestructureAssign') {
      genDestructureAssign(s, typeEnv, stmtCtx, ssaEnv, I, lines, i);
    }

    if (s.type === 'ExprStatement') {
      lines.push(`${I}${genExpr(s.expr, typeEnv, stmtCtx)},`);
    }

    if (s.type === 'ListDestructure') {
      genListDestructure(s, typeEnv, stmtCtx, ssaEnv, I, lines, i);
    }
  }

  return lines;
}

function genListDestructure(s, typeEnv, ctx, ssaEnv, I, lines, stmtIdx) {
  const srcExpr = genExpr(s.source, typeEnv, ctx);
  const pattern = s.pattern;
  let hasRest = false;

  // Build an Erlang pattern match
  // [a, b, _] = List  → match against [A, B, _]
  // [h, ...t] = List  → match against [H|T]
  // [h, _, ...t] = List → head + skip + tail

  let cur = `Ld_${stmtIdx}`;
  lines.push(`${I}${cur} = ${srcExpr},`);

  for (let i = 0; i < pattern.length; i++) {
    const item = pattern[i];
    if (item.rest) {
      hasRest = true;
      if (!item.discard && item.name) {
        const ssaName = getSSANameForAssignment(item.name, stmtIdx, ssaEnv);
        const varName = erlVarName(ssaName);
        lines.push(`${I}${varName} = list_to_json(${cur}),`);
      }
      break;
    }
    if (!item.discard && item.name) {
      const ssaName = getSSANameForAssignment(item.name, stmtIdx, ssaEnv);
      const varName = erlVarName(ssaName);
      lines.push(`${I}${varName} = hd(${cur}),`);
    }
    if (i < pattern.length - 1) {
      const next = `Ld_${stmtIdx}_${i}`;
      lines.push(`${I}${next} = tl(${cur}),`);
      cur = next;
    }
  }

  // Arity check: if no rest and more than one element, check tail is empty
  if (!hasRest && pattern.length > 0) {
    lines.push(`${I}case tl(${cur}) of [] -> ok; _ -> error(list_destructure_arity) end,`);
  }
}

function genDestructureAssign(s, typeEnv, ctx, ssaEnv, I, lines, stmtIdx) {
  const srcExpr = genExpr(s.source, typeEnv, ctx);
  const isProcCall = s.source.type === 'ProcCallExpr';

  if (isProcCall) {
    const tempName = `Tmp_${stmtIdx}`;
    lines.push(`${I}${tempName} = ${srcExpr},`);
    const hasPosItems = s.pattern.some(p => p.positional && !p.rest);
    const hasNamedItems = s.pattern.some(p => p.named || p.key !== undefined);
    if (hasPosItems || hasNamedItems) {
      lines.push(`${I}{${tempName}_pos, ${tempName}_named} = ${tempName},`);
    }

    for (const item of s.pattern) {
      if (item.discard) continue;
      const ssaName = getSSANameForAssignment(item.name, stmtIdx, ssaEnv);
      const varName = erlVarName(ssaName);

      if (item.named) {
        lines.push(`${I}${varName} = maps:get(${erlString(item.name)}, ${tempName}_named, null),`);
      } else if (item.key !== undefined) {
        lines.push(`${I}${varName} = maps:get(${erlString(item.key)}, ${tempName}_named, null),`);
      } else if (item.positional) {
        lines.push(`${I}${varName} = lists:nth(${item.idx + 1}, ${tempName}_pos),`);
      }
    }
  } else {
    // Source is a structure variable
    const srcName = s.source.type === 'Identifier' ? erlVarName(s.source.name) : srcExpr;
    const hasPosItems = s.pattern.some(p => p.positional && !p.rest);
    const hasNamedItems = s.pattern.some(p => p.named || p.key !== undefined);

    if (hasPosItems || hasNamedItems) {
      // Need to check if source already has _pos/_named suffix from rest binding
      const isRestVar = s.source.type === 'Identifier' && (
        ctx.restVars?.has(s.source.name)
      );
      if (isRestVar) {
        // Already destructured: Args_pos, Args_named
        const prefix = erlVarName(s.source.name);
        for (const item of s.pattern) {
          if (item.discard) continue;
          const ssaName = getSSANameForAssignment(item.name, stmtIdx, ssaEnv);
          const varName = erlVarName(ssaName);
          if (item.named) {
            lines.push(`${I}${varName} = maps:get(${erlString(item.name)}, ${prefix}_named, null),`);
          } else if (item.key !== undefined) {
            lines.push(`${I}${varName} = maps:get(${erlString(item.key)}, ${prefix}_named, null),`);
          } else if (item.positional) {
            lines.push(`${I}${varName} = lists:nth(${item.idx + 1}, ${prefix}_pos),`);
          }
        }
      } else {
        // If source is not a simple identifier, assign to temp first
        let prefix;
        if (s.source.type === 'Identifier') {
          prefix = srcName;
          lines.push(`${I}{${prefix}_d_pos, ${prefix}_d_named} = ${srcName},`);
        } else {
          prefix = `Dtmp_${stmtIdx}`;
          lines.push(`${I}${prefix} = ${srcExpr},`);
          lines.push(`${I}{${prefix}_d_pos, ${prefix}_d_named} = ${prefix},`);
        }
        for (const item of s.pattern) {
          if (item.discard) continue;
          const ssaName = getSSANameForAssignment(item.name, stmtIdx, ssaEnv);
          const varName = erlVarName(ssaName);
          if (item.named) {
            lines.push(`${I}${varName} = maps:get(${erlString(item.name)}, ${prefix}_d_named, null),`);
          } else if (item.key !== undefined) {
            lines.push(`${I}${varName} = maps:get(${erlString(item.key)}, ${prefix}_d_named, null),`);
          } else if (item.positional) {
            lines.push(`${I}${varName} = lists:nth(${item.idx + 1}, ${prefix}_d_pos),`);
          }
        }
      }
    }
  }
}

// ── Handler codegen ─────────────────────────────────────────────────────────

function genHandler(handler) {
  // Simple handler — no type check needed, used when single handler per op with no typed params
  const inner = genHandlerInner(handler);
  return `handle_op(${erlString(handler.op)}, Message, Payload, _Id, _From) ->\n${inner}`;
}

// ── Proc codegen ────────────────────────────────────────────────────────────

function genProc(proc) {
  const { op, params, body } = proc;
  const typeEnv = buildTypeEnv(params, body);
  const reply = body.find(s => s.type === 'Reply');
  const I = '    ';

  const restVars = new Set();
  const ctx = { restVars, ssaEnv: buildSSAEnv(body) };

  // Destructure from Structure arg
  const paramLines = [];
  let posIdx = 0;
  for (const p of params) {
    if (p.positional) {
      paramLines.push(`${I}${erlVarName(p.name)} = lists:nth(${posIdx + 1}, S_pos),`);
      posIdx++;
    } else {
      const key = p.key || p.name;
      paramLines.push(`${I}${erlVarName(p.name)} = maps:get(${erlString(key)}, S_named, null),`);
    }
  }

  const localLines = genLocals(body, typeEnv, ctx, I);

  // Reply as Structure
  let retExpr;
  if (reply) {
    const pos = reply.fields.filter(f => f.positional);
    const named = reply.fields.filter(f => !f.positional && !f.spread);
    const posVals = pos.map(f => genReplyFieldVal(f, typeEnv, ctx)).join(', ');
    const namedPairs = named.map(f => {
      if ('sigil' in f) return `${erlString(f.sigil)} => ${erlVarName(f.sigil)}`;
      if (f.key !== undefined) {
        const val = f.value ? genExpr(f.value, typeEnv, ctx) : erlVarName(f.key);
        return `${erlString(f.key)} => ${val}`;
      }
      return '';
    }).filter(Boolean).join(', ');
    retExpr = `{[${posVals}], #{${namedPairs}}}`;
  } else {
    retExpr = '{[], #{}}';
  }

  const allLines = [];
  if (paramLines.length > 0) allLines.push(paramLines.join('\n'));
  if (localLines.length > 0) allLines.push(localLines.join('\n'));
  allLines.push(`${I}${retExpr}`);

  return `${op}_proc({S_pos, S_named}) ->\n${allLines.join('\n')}.`;
}

// ── Program codegen ─────────────────────────────────────────────────────────

function genHandleOp(handlers) {
  // Group handlers by op name
  const grouped = new Map();
  for (const h of handlers) {
    if (!grouped.has(h.op)) grouped.set(h.op, []);
    grouped.get(h.op).push(h);
  }

  const clauses = [];
  for (const [op, variants] of grouped) {
    if (variants.length === 1 && !variants[0].params.some(p => p.type && !p.rest)) {
      // Single handler, no type check needed — simple clause
      clauses.push(genHandler(variants[0], false));
    } else {
      // Multiple variants or type-checked — generate try_op_N functions
      const tryFns = [];
      for (let i = 0; i < variants.length; i++) {
        const h = variants[i];
        const fnName = `try_${op}_${i}`;
        const innerBody = genHandlerInner(h);
        tryFns.push({ fnName, body: innerBody });
      }

      // Chain: try first, if nomatch try next, etc.
      let chainExpr = '    {error, ' + erlString(op) + '}';
      for (let i = tryFns.length - 1; i >= 0; i--) {
        const fn = tryFns[i];
        chainExpr = `    case ${fn.fnName}(Message, Payload) of\n        nomatch ->\n    ${chainExpr};\n        Result -> Result\n    end`;
      }

      clauses.push(`handle_op(${erlString(op)}, Message, Payload, _Id, _From) ->\n${chainExpr}`);

      // Add the try functions as separate top-level functions
      for (let i = 0; i < variants.length; i++) {
        const h = variants[i];
        const fnName = `try_${op}_${i}`;
        const inner = genHandlerInner(h);
        clauses.push(`${fnName}(Message, Payload) ->\n${inner}`);
      }
    }
  }

  // Catch-all clause
  clauses.push(`handle_op(Op, _Message, _Payload, _Id, _From) ->\n    {error, Op}`);

  return clauses;
}

function genHandlerInner(handler) {
  const { op, params, body } = handler;
  const typeEnv = buildTypeEnv(params, body);
  const reply = body.find(s => s.type === 'Reply');

  // Build type check expression
  const typedParams = params.filter(p => p.type && !p.rest);
  const positionalTyped = typedParams.filter(p => p.positional);
  const namedTyped = typedParams.filter(p => !p.positional);

  let typeCheck = '';
  if (positionalTyped.length > 0) {
    const posTypes = positionalTyped.map(p => erlString(p.type)).join(', ');
    const namedTypes = namedTyped.map(p => `{${erlString(p.key || p.name)}, ${erlString(p.type)}}`).join(', ');
    typeCheck = `match_types_positional(Message, [${posTypes}], [${namedTypes}])`;
  } else if (namedTyped.length > 0) {
    const pairs = namedTyped.map(p => `{${erlString(p.key || p.name)}, ${erlString(p.type)}}`).join(', ');
    typeCheck = `match_types(Message, [${pairs}])`;
  }

  const I = '    ';
  const lines = [];
  const restVars = new Set();
  for (const p of params) {
    if (p.rest) restVars.add(p.name);
  }
  const ctx = { restVars, ssaEnv: buildSSAEnv(body) };

  const paramLines = genParamDestructure(params, I);
  lines.push(...paramLines);
  const localLines = genLocals(body, typeEnv, ctx, I);
  lines.push(...localLines);

  let replyExpr, bvaExpr;
  if (reply) {
    const isSpread = reply.fields.some(f => f.spread);
    if (isSpread) {
      const spreadField = reply.fields.find(f => f.spread);
      const sn = erlVarName(spreadField.name);
      if (restVars.has(spreadField.name)) {
        replyExpr = `structure_splat({${sn}_pos, ${sn}_named})`;
      } else {
        replyExpr = `structure_splat(${sn})`;
      }
      bvaExpr = null;
    } else {
      replyExpr = genReplyBody(reply.fields, typeEnv, ctx);
      bvaExpr = genBvaBody(reply.fields, typeEnv);
    }
  }

  let replyBlock;
  if (reply) {
    const isSpread = reply.fields.some(f => f.spread);
    if (isSpread) {
      replyBlock = `${I}Re = ${replyExpr},\n` +
        `${I}BvaRe = case maps:find(<<"bv-a">>, Message) of\n` +
        `${I}    {ok, [BvaFirst|_]} -> structure_splat_bva(BvaFirst);\n` +
        `${I}    _ -> null\n` +
        `${I}end,\n` +
        `${I}{ok, Re, BvaRe}`;
    } else if (bvaExpr) {
      replyBlock = `${I}Re = ${replyExpr},\n${I}{ok, Re, ${bvaExpr}}`;
    } else {
      replyBlock = `${I}Re = ${replyExpr},\n${I}{ok, Re, null}`;
    }
  } else {
    replyBlock = `${I}{ok, null, null}`;
  }

  const innerBody = lines.length > 0 ? lines.join('\n') + '\n' + replyBlock : replyBlock;

  if (typeCheck) {
    return `${I}case ${typeCheck} of\n${I}    true ->\n${innerBody.split('\n').map(l => '        ' + l).join('\n')};\n${I}    false ->\n${I}        nomatch\n${I}end`;
  }
  return innerBody;
}

function genProgram(actor) {
  // Namespace conflict check
  const handlerOps = new Set(actor.handlers.map(h => h.op));
  for (const proc of (actor.procs || [])) {
    if (handlerOps.has(proc.op)) {
      throw new Error(`'${proc.op}' is declared as both an 'on' handler and a 'proc'`);
    }
  }

  const hasProcs = actor.procs && actor.procs.length > 0;

  // Generate all handler clauses and helper functions
  const allClauses = genHandleOp(actor.handlers);

  // Generate proc functions
  const procFns = hasProcs ? actor.procs.map(p => genProc(p)) : [];

  // Dispatch function
  const dispatchBody = `dispatch(Message) ->
    Id = maps:get(<<"id">>, Message, <<>>),
    From = maps:get(<<"from">>, Message, <<>>),
    OpVal = maps:get(<<"op">>, Message, null),
    {OpName, Payload} = case OpVal of
        S when is_binary(S) -> {S, #{}};
        L when is_list(L) ->
            OpN = lists:last(L),
            P = if length(L) > 1 -> hd(L); true -> #{} end,
            {OpN, P};
        _ -> {<<"">>, #{}}
    end,
    HasPayload = case Payload of
        M when is_map(M), map_size(M) > 0 -> true;
        Lst when is_list(Lst), length(Lst) > 0 -> true;
        _ -> false
    end,
    case HasPayload andalso not maps:is_key(<<"bv-a">>, Message) of
        true ->
            Ex = #{OpName => <<"schema_required">>},
            Resp = #{<<"id">> => Id, <<"ex">> => Ex, <<"to">> => From},
            io:format("~s~n", [json_encode(Resp)]);
        false ->
            Result = handle_op(OpName, Message, Payload, Id, From),
            handle_result(Result, Id, From, OpName)
    end.

handle_result({ok, Re, BvaRe}, Id, From, _OpName) when Re =/= null ->
    Resp0 = #{<<"id">> => Id, <<"re">> => Re, <<"to">> => From},
    Resp = case BvaRe of
        null -> Resp0;
        _ -> Resp0#{<<"bv-a">> => BvaRe}
    end,
    io:format("~s~n", [json_encode(Resp)]);
handle_result({ok, null, _}, _Id, _From, _OpName) ->
    ok;
handle_result({error, UnhandledOp}, Id, From, _OpName) ->
    Ex = #{UnhandledOp => <<"unhandled">>},
    Resp = #{<<"id">> => Id, <<"ex">> => Ex, <<"to">> => From},
    io:format("~s~n", [json_encode(Resp)]);
handle_result(_, _Id, _From, _OpName) ->
    ok.`;

  let dispatchFinal = dispatchBody;
  {
    dispatchFinal = dispatchBody.replace(
      '            Result = handle_op(OpName, Message, Payload, Id, From),\n            handle_result(Result, Id, From, OpName)',
      '            Result = try handle_op(OpName, Message, Payload, Id, From)\n            catch _:_ ->\n                {caught_error, OpName}\n            end,\n            handle_result(Result, Id, From, OpName)'
    ).replace(
      'handle_result(_, _Id, _From, _OpName) ->\n    ok.',
      'handle_result({caught_error, Op}, Id, From, _OpName) ->\n    Ex = #{Op => <<"error">>},\n    Resp = #{<<"id">> => Id, <<"ex">> => Ex, <<"to">> => From},\n    io:format("~s~n", [json_encode(Resp)]);\nhandle_result(_, _Id, _From, _OpName) ->\n    ok.'
    );
  }

  const mainLoop = `main() ->
    read_loop().

read_loop() ->
    case io:get_line("") of
        eof -> ok;
        {error, _} -> ok;
        Line ->
            Bin = unicode:characters_to_binary(string:trim(Line)),
            case Bin of
                <<>> -> read_loop();
                _ ->
                    Message = json_decode(Bin),
                    case maps:find(<<"re">>, Message) of
                        {ok, _} -> ok;
                        error -> dispatch(Message)
                    end,
                    read_loop()
            end
    end.`;

  const procSection = procFns.length > 0 ? '\n' + procFns.join('\n\n') + '\n' : '';

  // Separate handle_op clauses from try_* helper functions
  const handleOpClauses = [];
  const helperFns = [];
  for (const c of allClauses) {
    if (c.startsWith('handle_op(')) {
      handleOpClauses.push(c);
    } else {
      helperFns.push(c);
    }
  }

  const helperSection = helperFns.length > 0 ? '\n' + helperFns.map(f => f + '.').join('\n\n') + '\n' : '';

  return `-module(brevity_actor).
-export([main/0]).
${PREAMBLE}
${procSection}${helperSection}
${handleOpClauses.join(';\n')}.

${dispatchFinal}

${mainLoop}
`;
}

export function codegenErlang(ast) {
  const active = ast.actors.filter(a => a.handlers.length > 0);
  if (active.length === 0) return '';
  return genProgram(active[0]);
}
