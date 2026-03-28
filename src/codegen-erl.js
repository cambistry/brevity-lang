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
structure_one({Pos, _}) when is_list(Pos) -> error({arity, length(Pos)});
structure_one(V) -> V.

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
                    %% Count non-map positional elements
                    PosCount = length([X || X <- TypesArr, not is_map(X)]),
                    PosOk = PosCount =:= length(PosTypes) andalso match_pos_types(TypesArr, PosTypes, 0),
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

%% Convert internal list to JSON-safe value ([] for empty)
list_to_json(null) -> [];
list_to_json([]) -> [];
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

await_response_(Id) ->
    case io:get_line("") of
        eof -> null;
        {error, _} -> null;
        Line ->
            Bin = unicode:characters_to_binary(string:trim(Line)),
            Message = json_decode(Bin),
            case maps:find(<<"re">>, Message) of
                {ok, Re} ->
                    case maps:get(<<"id">>, Message, <<>>) of
                        Id -> Re;
                        _ -> await_response_(Id)
                    end;
                error ->
                    dispatch(Message),
                    await_response_(Id)
            end
    end.

await_new_response_(Id) ->
    case io:get_line("") of
        eof -> null;
        {error, _} -> null;
        Line ->
            Bin = unicode:characters_to_binary(string:trim(Line)),
            Message = json_decode(Bin),
            case maps:find(<<"re">>, Message) of
                {ok, _} ->
                    case maps:get(<<"id">>, Message, <<>>) of
                        Id -> maps:get(<<"from">>, Message, null);
                        _ -> await_new_response_(Id)
                    end;
                error ->
                    dispatch(Message),
                    await_new_response_(Id)
            end
    end.
`;

// ── Helpers ─────────────────────────────────────────────────────────────────

// Reserved names used in generated Erlang dispatch code — user vars must not collide
const RESERVED_ERL_VARS = new Set([
  'Message', 'Payload', 'Id', 'From', 'OpVal', 'OpName', 'HasPayload',
  'Result', 'Re', 'Resp', 'Resp0', 'Ex', 'BvaRe', 'BvaFirst',
  'S_pos', 'S_named', 'Args_pos', 'Args_named',
]);

function createErlContext() {
  return {
    actorInfo: new Map(),           // name -> { asClauses: [] }
    actorFnNames: new Set(),
    stateVarNames: new Set(),
    usesNames: new Set(),
    remoteInstanceVars: new Set(),
    constructsMap: new Map(),       // factory name → ConstructsDecl
    constructsProxyVars: new Set(), // state vars holding constructs proxy instances
    constructsVarToProxy: new Map(),// proxy var name → proxy type name (lowercase)
    sendCounter: 0,
    ephCounter: 0,
    lambdaCounter: 0,
    lambdaHandlers: [],             // { name, varName, fn, captures }
    lambdaVarNames: new Set(),      // variable names holding lambda label binaries
    lambdaCaptureKeys: [],          // process dictionary keys for captures
    currentTypeEnv: null,           // set during handler codegen for function-typed param detection
    stateVarTypeEnv: new Map(),     // state var name → type, for function-typed detection
    emitNames: new Map(),           // emit declarations: name → EmitDecl
    fnWhileCounter: 0,
    fnScopeCounter: 0,
    ifScopeCounter: 0,
    whileCounter: 0,
  };
}

function erlSendVars(ctx) {
  const n = ctx.sendCounter++;
  return { seq: `Send_seq_${n}`, n: `Send_n_${n}`, id: `Send_id_${n}`, op: `Send_op_${n}`, bva: `Send_bva_${n}`, msg: `Send_msg_${n}` };
}

// Helper: resolve set target — state vars use state_ prefix, local refs use ref_ prefix
function erlSetTarget(ctx, name) {
  return ctx.stateVarNames.has(name) ? `state_${name}` : `ref_${name}`;
}

// Collect free variables from a Function AST node (same logic as JS codegen)
function erlCollectFreeVars(ctx, funcNode) {
  const paramNames = new Set((funcNode.params || []).map(p => p.name).filter(Boolean));
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
      erlCollectFreeVars(ctx, expr).forEach(v => ids.add(v));
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
      } else if (s.type === 'WhileStatement') {
        walkExpr(s.cond);
        if (s.body) walkBody(s.body);
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

// Check if a lambda references outer refs — these can't be lifted to dispatch handlers
function erlLambdaUsesOuterRefs(ctx, funcNode) {
  const body = funcNode.body || [];
  const localRefs = new Set();
  for (const s of body) {
    if (s.type === 'RefDecl') localRefs.add(s.name);
  }
  for (const s of body) {
    if (s.type === 'SetStatement' && !localRefs.has(s.name) && !ctx.stateVarNames.has(s.name)) {
      return true;
    }
    if (s.type === 'ActorSetStatement') {
      return true;
    }
  }
  function hasRefRead(expr) {
    if (!expr) return false;
    if (expr.type === 'RefRead' && !localRefs.has(expr.name) && !ctx.stateVarNames.has(expr.name)) return true;
    if (expr.type === 'RefArg') return true;
    if (expr.type === 'BinaryExpr') return hasRefRead(expr.left) || hasRefRead(expr.right);
    if (expr.type === 'FunctionCallExpr') {
      if (hasRefRead(expr.callee)) return true;
      return expr.args.some(a => hasRefRead(a));
    }
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
    if (expr.type === 'ListLiteral') return expr.elements.some(hasRefRead);
    if (expr.type === 'Function') return erlLambdaUsesOuterRefs(ctx, expr);
    return false;
  }
  for (const s of body) {
    if (s.type === 'Assign' || s.type === 'TypedAssign') {
      if (hasRefRead(s.value)) return true;
    }
    if (s.type === 'ImplicitReturn' && hasRefRead(s.expr)) return true;
    if (s.type === 'Reply' || s.type === 'Return') {
      for (const f of s.fields) {
        if (f.ref) return true;
        if (f.value && hasRefRead(f.value)) return true;
      }
    }
  }
  if (funcNode.expr && hasRefRead(funcNode.expr)) return true;
  return false;
}

// Register a Function node as a lambda dispatch handler, return its label expression
function erlGenLambdaArgLabel(ctx, funcNode, typeEnv, sCtx) {
  const lambdaName = `_lambda_${ctx.lambdaCounter++}`;
  const freeVars = erlCollectFreeVars(ctx, funcNode).filter(v => !ctx.actorFnNames.has(v));
  const captures = freeVars.map(v => ({ name: v, lambdaName }));
  for (const v of freeVars) {
    ctx.lambdaCaptureKeys.push(`_cap_${lambdaName}_${v}`);
  }
  ctx.lambdaHandlers.push({ name: lambdaName, fn: funcNode, captures });
  // If there are captures, emit put() calls as side effects before returning the label
  if (freeVars.length > 0) {
    const stores = freeVars.map(v => {
      const src = ctx.stateVarNames.has(v) ? `get(state_${v})` : genExpr(ctx, { type: 'Identifier', name: v }, typeEnv, sCtx);
      return `put('_cap_${lambdaName}_${v}', ${src})`;
    }).join(', ');
    return `begin ${stores}, <<"${lambdaName}">> end`;
  }
  return `<<"${lambdaName}">>`;
}

function findErlAsClauseMatch(ctx, targetType, actorName) {
  if (!ctx.actorInfo.has(actorName)) return null;
  const info = ctx.actorInfo.get(actorName);
  if (!info.asClauses || info.asClauses.length === 0) return null;
  if (targetType === actorName) return null;
  for (const clause of info.asClauses) {
    if (!clause.negated && clause.targetType === targetType) return clause;
    if (clause.negated && clause.targetType !== targetType) return clause;
  }
  return null;
}

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
  if (expr.type === 'DecimalLiteral') return 'Decimal';
  if (expr.type === 'BoolLiteral') return 'Boolean';
  if (expr.type === 'NullLiteral') return 'null';
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
      // Infer types from StructureConstructor args when pattern items lack types
      if (s.source?.type === 'StructureConstructor') {
        const posArgs = (s.source.args || []).filter(a => a.positional);
        const namedArgs = (s.source.args || []).filter(a => !a.positional);
        for (const item of s.pattern) {
          if (item.discard || !item.name || env.has(item.name)) continue;
          if (item.positional && posArgs[item.idx]?.type) {
            env.set(item.name, posArgs[item.idx].type);
          } else if (item.named) {
            const match = namedArgs.find(a => a.key === item.name);
            if (match?.type) env.set(item.name, match.type);
          }
        }
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
    if (s.type === 'RefDecl' && s.typeName) env.set(s.name, s.typeName);
    if (s.type === 'BareTypeDecl' && s.typeName) env.set(s.name, s.typeName);
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

function genExpr(ctx, expr, typeEnv, sCtx) {
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
    if (ctx.stateVarNames.has(name)) return `get(state_${name})`;
    // Resolve SSA if context has ssaEnv
    if (sCtx?.ssaEnv && sCtx.stmtIdx !== undefined) {
      return erlVarName(resolveSSAName(name, sCtx.stmtIdx, sCtx.ssaEnv));
    }
    return erlVarName(name);
  }

  if (expr.type === 'BinaryExpr') {
    let left = genExprScalar(ctx, expr.left, typeEnv, sCtx);
    let right = genExprScalar(ctx, expr.right, typeEnv, sCtx);
    // Check if this is string concatenation
    const leftType = exprType(expr.left, typeEnv, ctx);
    const rightType = exprType(expr.right, typeEnv, ctx);
    if (expr.op === '+' && (leftType === 'Text' || rightType === 'Text')) {
      return `<<${left}/binary, ${right}/binary>>`;
    }
    if (expr.op === '/') return `(${left} div ${right})`;
    if (expr.op === '===') return `(${left} =:= ${right})`;
    if (expr.op === '!==') return `(${left} =/= ${right})`;
    if (expr.op === '<=') return `(${left} =< ${right})`;
    return `(${left} ${expr.op} ${right})`;
  }

  if (expr.type === 'IndexExpr') {
    const obj = genExpr(ctx, expr.object, typeEnv, sCtx);
    if (expr.key !== null) {
      return `maps:get(${erlString(expr.key)}, ${obj}_named, null)`;
    }
    return `lists:nth(${expr.index + 1}, ${obj}_pos)`;
  }

  if (expr.type === 'StructureConstructor') {
    return genStructureConstructor(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && expr.callee.name === '__tick__') {
    return 'timer:sleep(0)';
  }

  // Emit invocation
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && ctx.emitNames.has(expr.callee.name)) {
    const emitDecl = ctx.emitNames.get(expr.callee.name);
    const eventName = erlString(expr.callee.name);
    if (expr.args.length > 0) {
      const fields = emitDecl.params.map((p, i) => {
        const val = i < expr.args.length ? genExpr(ctx, expr.args[i], typeEnv, sCtx) : 'null';
        return `${erlString(p.name)} => ${val}`;
      }).join(', ');
      return `emit_(${eventName}, #{${fields}})`;
    }
    return `emit_(${eventName}, #{})`;
  }

  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && ctx.actorFnNames.has(expr.callee.name)) {
    return genActorFnCallExpr(ctx, expr, typeEnv, sCtx);
  }

  // Lambda var call → self_send through dispatch
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && ctx.lambdaVarNames.has(expr.callee.name)) {
    return genErlLambdaVarCall(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'FunctionCallExpr') {
    // Check if callee is function-typed — route through self_send
    if (expr.callee?.type === 'Identifier') {
      const calleeType = ctx.currentTypeEnv?.get(expr.callee.name);
      const isFnTyped = calleeType && (calleeType === 'Function' || (typeof calleeType === 'string' && calleeType.includes('->')));
      if (isFnTyped) {
        return genErlLambdaVarCall(ctx, expr, typeEnv, sCtx);
      }
    }
    return genFunctionCallExpr(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'Function') {
    if (erlLambdaUsesOuterRefs(ctx, expr)) {
      return genFunctionLiteral(ctx, expr, typeEnv, sCtx);
    }
    return erlGenLambdaArgLabel(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'ListLiteral') {
    if (expr.elements.length === 0) return '[]';
    const elems = expr.elements.map(e => genExpr(ctx, e, typeEnv, sCtx));
    return `[${elems.join(', ')}]`;
  }

  if (expr.type === 'OverExpr') {
    return genOverExpr(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'ReduceExpr') {
    return genReduceExpr(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'IfExpr') {
    return genIfExpr(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'FnRef') {
    if (ctx.actorFnNames.has(expr.name)) {
      return `fun(Item_) -> structure_one(self_send(${erlString(expr.name)}, [Item_])) end`;
    }
    if (ctx.lambdaVarNames.has(expr.name)) {
      const varRef = genExpr(ctx, { type: 'Identifier', name: expr.name }, typeEnv, sCtx);
      return `fun(Item_) -> structure_one(self_send(${varRef}, [Item_])) end`;
    }
    return erlVarName(expr.name);
  }

  if (expr.type === 'RefRead') {
    if (ctx.stateVarNames.has(expr.name)) return `get(state_${expr.name})`;
    return `get(ref_${expr.name})`;
  }

  if (expr.type === 'StateVar') {
    return `get(state_${expr.name})`;
  }

  if (expr.type === 'StructureLiteral') {
    return genStructureConstructor(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'DecimalLiteral') {
    return String(expr.value);
  }

  if (expr.type === 'RefArg') {
    return `ref_${expr.name}`;
  }

  if (expr.type === 'DotCallExpr') {
    const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : (expr.object.type === 'Identifier' ? expr.object.name : null);
    const isRemote = dotObjName && ctx.remoteInstanceVars.has(dotObjName);
    const isChild = !isRemote && ((expr.object.type === 'FunctionCallExpr' && expr.object.callee?.type === 'Identifier' && ctx.actorInfo.has(expr.object.callee.name)) ||
      (expr.object.type === 'RefRead' && sCtx?.childActorRefs?.has(expr.object.name)) ||
      (expr.object.type === 'Identifier' && sCtx?.childActorRefs?.has(expr.object.name)));
    if (isChild) return genChildDotCallAwait(ctx, expr, typeEnv, sCtx);
    // Wrapped child param: state var holding a child actor name atom
    const isWrappedChild = !isRemote && dotObjName && ctx.stateVarNames.has(dotObjName) && ctx.stateVarTypeEnv.get(dotObjName) === 'Anything';
    if (isWrappedChild) {
      const childRef = `get(state_${dotObjName})`;
      const method = erlString('@' + expr.method);
      const named = expr.args.filter(a => !a.positional);
      const positional = expr.args.filter(a => a.positional);
      let payload;
      if (positional.length === 0 && named.length === 0) {
        payload = '#{}';
      } else if (named.length > 0) {
        const fields = named.map(a => {
          const val = a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
          return `${erlString(a.name)} => ${val}`;
        }).join(', ');
        payload = `#{${fields}}`;
      } else {
        const vals = positional.map(a => {
          const val = a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
          return val;
        }).join(', ');
        payload = `[${vals}]`;
      }
      return `begin
        {ok, _Wr_re, _} = child_dispatch(${childRef}, ${method}, #{}, ${payload}, <<"0">>, <<"__parent">>),
        structure_pack(_Wr_re)
    end`;
    }
    // Constructs proxy var: dispatch through child_dispatch (fire-and-forget)
    const isConstructsProxy = dotObjName && ctx.constructsProxyVars.has(dotObjName);
    if (isConstructsProxy) {
      const childRef = erlString(ctx.constructsVarToProxy.get(dotObjName));
      const method = erlString('@' + expr.method);
      const named = expr.args.filter(a => !a.positional);
      const positional = expr.args.filter(a => a.positional);
      let payload;
      if (positional.length === 0 && named.length === 0) {
        payload = '#{}';
      } else if (named.length > 0) {
        const fields = named.map(a => {
          const val = a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
          return `${erlString(a.name)} => ${val}`;
        }).join(', ');
        payload = `#{${fields}}`;
      } else {
        const vals = positional.map(a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name)).join(', ');
        payload = `[${vals}]`;
      }
      return `begin
        {ok, _Cp_re, _} = child_dispatch(${childRef}, ${method}, #{}, ${payload}, <<"0">>, <<"__parent">>),
        structure_pack(_Cp_re)
    end`;
    }
    if (isRemote) {
      const to = `get(state_${dotObjName})`;
      const method = erlString(expr.method);
      const named = expr.args.filter(a => !a.positional);
      const positional = expr.args.filter(a => a.positional);
      let opExpr;
      if (positional.length === 0 && named.length === 0) {
        opExpr = method;
      } else if (named.length > 0) {
        const genArgVal = a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVar(a.name);
        const fields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
        opExpr = `[#{${fields}}, ${method}]`;
      } else {
        const genArgVal = a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVar(a.name);
        const vals = positional.map(genArgVal).join(', ');
        opExpr = `[[${vals}], ${method}]`;
      }
      const v = erlSendVars(ctx);
      return `begin
        ${v.seq} = case get(send_seq_) of undefined -> 1; ${v.n} -> ${v.n} end,
        put(send_seq_, ${v.seq} + 1),
        ${v.msg} = #{<<"id">> => integer_to_binary(${v.seq}), <<"op">> => ${opExpr}, <<"to">> => ${to}},
        io:format("~s~n", [json_encode(${v.msg})]),
        null
    end`;
    }
    const named = expr.args.filter(a => !a.positional);
    const positional = expr.args.filter(a => a.positional);
    const to = erlString(expr.object.name);
    const method = erlString('@' + expr.method);
    const v2 = erlSendVars(ctx);
    if (positional.length === 0 && named.length === 0) {
      return `begin
        ${v2.seq} = case get(send_seq_) of undefined -> 1; ${v2.n} -> ${v2.n} end,
        put(send_seq_, ${v2.seq} + 1),
        ${v2.msg} = #{<<"id">> => integer_to_binary(${v2.seq}), <<"op">> => ${method}, <<"to">> => ${to}},
        io:format("~s~n", [json_encode(${v2.msg})]),
        null
    end`;
    }
    const genArgVal = a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
    let opExpr, bvaExpr;
    if (positional.length > 0 && named.length > 0) {
      const posVals = positional.map(genArgVal).join(', ');
      const namedFields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
      opExpr = `[${posVals}, #{${namedFields}}, ${method}]`;
      const posBva = positional.map(a => a.typeName ? erlString(a.typeName) : 'null').join(', ');
      const namedBva = named.map(a => `${erlString(a.name)} => ${a.typeName ? erlString(a.typeName) : 'null'}`).join(', ');
      bvaExpr = `[${posBva}, #{${namedBva}}]`;
    } else if (named.length > 0) {
      const namedFields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
      opExpr = `[#{${namedFields}}, ${method}]`;
      const namedBva = named.map(a => `${erlString(a.name)} => ${a.typeName ? erlString(a.typeName) : 'null'}`).join(', ');
      bvaExpr = `[#{${namedBva}}]`;
    } else {
      const posVals = positional.map(genArgVal).join(', ');
      opExpr = `[[${posVals}], ${method}]`;
      const posBva = positional.map(a => a.typeName ? erlString(a.typeName) : 'null').join(', ');
      bvaExpr = `[[${posBva}]]`;
    }
    return `begin
        ${v2.seq} = case get(send_seq_) of undefined -> 1; ${v2.n} -> ${v2.n} end,
        put(send_seq_, ${v2.seq} + 1),
        ${v2.op} = ${opExpr},
        ${v2.bva} = ${bvaExpr},
        ${v2.msg} = #{<<"id">> => integer_to_binary(${v2.seq}), <<"op">> => ${v2.op}, <<"to">> => ${to}, <<"bv-a">> => ${v2.bva}},
        io:format("~s~n", [json_encode(${v2.msg})]),
        null
    end`;
  }

  throw new Error(`Unsupported Erlang expression: ${expr.type}`);
}

function genDotCallAwait(ctx, expr, typeEnv, sCtx) {
  const objName = expr.object.type === 'RefRead' ? expr.object.name : (expr.object.type === 'Identifier' ? expr.object.name : null);
  const isRemote = objName && ctx.remoteInstanceVars.has(objName);
  const isChild = !isRemote && ((expr.object.type === 'FunctionCallExpr' && expr.object.callee?.type === 'Identifier' && ctx.actorInfo.has(expr.object.callee.name)) ||
    (expr.object.type === 'RefRead' && sCtx?.childActorRefs?.has(expr.object.name)) ||
    (expr.object.type === 'Identifier' && sCtx?.childActorRefs?.has(expr.object.name)));
  if (isChild) return genChildDotCallAwait(ctx, expr, typeEnv, sCtx);
  // Wrapped child param: dispatch through child_dispatch
  const isWrappedChild = !isRemote && objName && ctx.stateVarNames.has(objName) && ctx.stateVarTypeEnv.get(objName) === 'Anything';
  if (isWrappedChild) {
    const childRef = `get(state_${objName})`;
    const method = erlString('@' + expr.method);
    const named = expr.args.filter(a => !a.positional);
    const positional = expr.args.filter(a => a.positional);
    let payload;
    if (positional.length === 0 && named.length === 0) {
      payload = '#{}';
    } else if (named.length > 0) {
      const fields = named.map(a => {
        const val = a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
        return `${erlString(a.name)} => ${val}`;
      }).join(', ');
      payload = `#{${fields}}`;
    } else {
      const vals = positional.map(a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name)).join(', ');
      payload = `[${vals}]`;
    }
    return `begin
        {ok, _Wr_re, _} = child_dispatch(${childRef}, ${method}, #{}, ${payload}, <<"0">>, <<"__parent">>),
        structure_pack(_Wr_re)
    end`;
  }
  // Constructs proxy var: dispatch through child_dispatch
  const isConstructsProxy = objName && ctx.constructsProxyVars.has(objName);
  if (isConstructsProxy) {
    const childRef = erlString(ctx.constructsVarToProxy.get(objName));
    const method = erlString('@' + expr.method);
    const named = expr.args.filter(a => !a.positional);
    const positional = expr.args.filter(a => a.positional);
    let payload;
    if (positional.length === 0 && named.length === 0) {
      payload = '#{}';
    } else if (named.length > 0) {
      const fields = named.map(a => {
        const val = a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
        return `${erlString(a.name)} => ${val}`;
      }).join(', ');
      payload = `#{${fields}}`;
    } else {
      const vals = positional.map(a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name)).join(', ');
      payload = `[${vals}]`;
    }
    return `begin
        {ok, _Cp_re, _} = child_dispatch(${childRef}, ${method}, #{}, ${payload}, <<"0">>, <<"__parent">>),
        structure_pack(_Cp_re)
    end`;
  }
  if (isRemote) {
    const to = `get(state_${objName})`;
    const method = erlString(expr.method);
    const named = expr.args.filter(a => !a.positional);
    const positional = expr.args.filter(a => a.positional);
    let opExpr;
    if (positional.length === 0 && named.length === 0) {
      opExpr = method;
    } else if (named.length > 0) {
      const genArgVal = a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVar(a.name);
      const fields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
      opExpr = `[#{${fields}}, ${method}]`;
    } else {
      const genArgVal = a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVar(a.name);
      const vals = positional.map(genArgVal).join(', ');
      opExpr = `[[${vals}], ${method}]`;
    }
    const v = erlSendVars(ctx);
    return `begin
        ${v.seq} = case get(send_seq_) of undefined -> 1; ${v.n} -> ${v.n} end,
        put(send_seq_, ${v.seq} + 1),
        ${v.id} = integer_to_binary(${v.seq}),
        ${v.msg} = #{<<"id">> => ${v.id}, <<"op">> => ${opExpr}, <<"to">> => ${to}},
        io:format("~s~n", [json_encode(${v.msg})]),
        structure_pack(await_response_(${v.id}))
    end`;
  }
  const named = expr.args.filter(a => !a.positional);
  const positional = expr.args.filter(a => a.positional);
  const to = erlString(expr.object.name);
  const method = erlString('@' + expr.method);
  const v2 = erlSendVars(ctx);
  if (positional.length === 0 && named.length === 0) {
    // No args — op is just the method string, no bv-a
    return `begin
        ${v2.seq} = case get(send_seq_) of undefined -> 1; ${v2.n} -> ${v2.n} end,
        put(send_seq_, ${v2.seq} + 1),
        ${v2.id} = integer_to_binary(${v2.seq}),
        ${v2.msg} = #{<<"id">> => ${v2.id}, <<"op">> => ${method}, <<"to">> => ${to}},
        io:format("~s~n", [json_encode(${v2.msg})]),
        structure_pack(await_response_(${v2.id}))
    end`;
  }
  const genArgVal = a => a.expr ? genExpr(ctx, a.expr, null, null) : erlVarName(a.name);
  let opExpr, bvaExpr;
  if (positional.length > 0 && named.length > 0) {
    const posVals = positional.map(genArgVal).join(', ');
    const namedFields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
    opExpr = `[${posVals}, #{${namedFields}}, ${method}]`;
    const posBva = positional.map(a => a.typeName ? erlString(a.typeName) : 'null').join(', ');
    const namedBva = named.map(a => `${erlString(a.name)} => ${a.typeName ? erlString(a.typeName) : 'null'}`).join(', ');
    bvaExpr = `[${posBva}, #{${namedBva}}]`;
  } else if (named.length > 0) {
    const namedFields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
    opExpr = `[#{${namedFields}}, ${method}]`;
    const namedBva = named.map(a => `${erlString(a.name)} => ${a.typeName ? erlString(a.typeName) : 'null'}`).join(', ');
    bvaExpr = `[#{${namedBva}}]`;
  } else {
    const posVals = positional.map(genArgVal).join(', ');
    opExpr = `[[${posVals}], ${method}]`;
    const posBva = positional.map(a => a.typeName ? erlString(a.typeName) : 'null').join(', ');
    bvaExpr = `[[${posBva}]]`;
  }
  return `begin
        ${v2.seq} = case get(send_seq_) of undefined -> 1; ${v2.n} -> ${v2.n} end,
        put(send_seq_, ${v2.seq} + 1),
        ${v2.id} = integer_to_binary(${v2.seq}),
        ${v2.op} = ${opExpr},
        ${v2.bva} = ${bvaExpr},
        ${v2.msg} = #{<<"id">> => ${v2.id}, <<"op">> => ${v2.op}, <<"to">> => ${to}, <<"bv-a">> => ${v2.bva}},
        io:format("~s~n", [json_encode(${v2.msg})]),
        structure_pack(await_response_(${v2.id}))
    end`;
}

function genChildDotCallAwait(ctx, expr, typeEnv, sCtx) {
  let actorName;
  let initCall = '';
  if (expr.object.type === 'RefRead' || expr.object.type === 'Identifier') {
    // ref or non-ref variable: actor name comes from the childActorRefs mapping, init already done
    actorName = sCtx.childActorRefs.get(expr.object.name);
  } else {
    // ephemeral FunctionCallExpr: actor name is the callee name
    actorName = expr.object.callee.name;
    if (expr.object.args.length > 0) {
      const prefix = `child_${actorName.toLowerCase()}`;
      const initArgs = expr.object.args.map(a => genExpr(ctx, a, typeEnv, sCtx)).join(', ');
      initCall = `${prefix}_init([${initArgs}]),\n        `;
    }
  }
  const prefix = `child_${actorName.toLowerCase()}`;
  const method = erlString('@' + expr.method);
  const n = ctx.ephCounter++;
  const reVar = `Eph_re_${n}_`;

  // Build payload from method args
  const positional = expr.args.filter(a => a.positional);
  const named = expr.args.filter(a => !a.positional);
  let payload;
  if (positional.length > 0 && named.length > 0) {
    const posVals = positional.map(a => genExpr(ctx, a.expr, typeEnv, sCtx)).join(', ');
    const namedMap = named.map(a => `${erlString(a.name)} => ${genExpr(ctx, a.expr, typeEnv, sCtx)}`).join(', ');
    payload = `[${posVals}, #{${namedMap}}]`;
  } else if (positional.length > 0) {
    const posVals = positional.map(a => genExpr(ctx, a.expr, typeEnv, sCtx)).join(', ');
    payload = `[${posVals}]`;
  } else if (named.length > 0) {
    const namedMap = named.map(a => `${erlString(a.name)} => ${genExpr(ctx, a.expr, typeEnv, sCtx)}`).join(', ');
    payload = `#{${namedMap}}`;
  } else {
    payload = '#{}';
  }

  return `begin
        ${initCall}{ok, ${reVar}, _} = ${prefix}_handle_op(${method}, #{}, ${payload}, <<"0">>, <<"__parent">>),
        structure_pack(${reVar})
    end`;
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

function genStructureConstructor(ctx, expr, typeEnv, sCtx) {
  const positional = expr.args.filter(a => a.positional);
  const named = expr.args.filter(a => a.key !== undefined && a.type !== 'Function');
  const fnArgs = expr.args.filter(a => a.type === 'Function');

  const posVals = positional.map(a => genExpr(ctx, a.expr, typeEnv, sCtx)).join(', ');
  const namedPairs = [...named, ...fnArgs].map(a => {
    const val = genExpr(ctx, a.expr, typeEnv, sCtx);
    return `${erlString(a.key)} => ${val}`;
  }).join(', ');

  return `{[${posVals}], #{${namedPairs}}}`;
}

// Generate return expression for function Return nodes
function genFnReturnExpr(fields, genInner, innerVarName) {
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional);

  // All returns go through structure tuples for consistent structure_one() unwrapping
  const posVals = pos.map(f => {
    if (f.name) return innerVarName(f.name);
    if (f.expr) return genInner(f.expr);
    if (f.value) return genInner(f.value);
    return 'null';
  });
  const namedEntries = named.map(f => {
    if ('sigil' in f) {
      return `${erlString(f.sigil)} => ${innerVarName(f.sigil)}`;
    }
    if (f.key !== undefined) {
      const val = f.value ? genInner(f.value) : (f.name ? innerVarName(f.name) : 'null');
      return `${erlString(f.key)} => ${val}`;
    }
    return '';
  }).filter(Boolean);

  if (posVals.length > 0 && namedEntries.length > 0) {
    return `{[${posVals.join(', ')}], #{${namedEntries.join(', ')}}}`;
  } else if (posVals.length > 0) {
    return `{[${posVals.join(', ')}], #{}}`;
  } else {
    return `{[], #{${namedEntries.join(', ')}}}`;
  }
}

// Generate while loop inside a function body
function genFnWhileStatement(ctx, node, genInner, prefix) {
  const loopId = ctx.fnWhileCounter++;
  const loopName = `${prefix}Loop_${loopId}`;
  const cond = genInner(node.cond);
  const trueCase = node.negated ? 'false' : 'true';
  const falseCase = node.negated ? 'true' : 'false';

  const bodyParts = [];
  for (const s of node.body) {
    if (s.type === 'SetStatement') {
      bodyParts.push(`put(${erlSetTarget(ctx, s.name)}, ${genInner(s.value)})`);
    } else if (s.type === 'StateAssign') {
      bodyParts.push(`put(state_${s.name}, ${genInner(s.value)})`);
    }
  }
  bodyParts.push(`${loopName}_f()`);

  return `${loopName} = fun ${loopName}_f() -> case is_truthy(${cond}) of ${trueCase} -> ${bodyParts.join(', ')}; ${falseCase} -> null end end, ${loopName}()`;
}

// Generate an expression that evaluates to a scalar (not Structure)
// Wraps self_send calls with structure_one
function genExprScalar(ctx, expr, typeEnv, sCtx) {
  const raw = genExpr(ctx, expr, typeEnv, sCtx);
  if (raw.startsWith('self_send(')) return `structure_one(${raw})`;
  if (raw.startsWith('case is_binary(')) return `structure_one(${raw})`;
  return raw;
}

// Lambda var call → self_send with the label stored in the variable
function genErlLambdaVarCall(ctx, expr, typeEnv, sCtx) {
  const callee = genExpr(ctx, expr.callee, typeEnv, sCtx);
  if (expr.args.length === 0) {
    return `self_send(${callee}, #{})`;
  }
  const posArgs = expr.args.filter(a => a.type !== 'NamedArgsBag').map(a => {
    if (a.type === 'Function' && !erlLambdaUsesOuterRefs(ctx, a)) return erlGenLambdaArgLabel(ctx, a, typeEnv, sCtx);
    return genExprScalar(ctx, a, typeEnv, sCtx);
  });
  const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
  if (namedBag) {
    const namedEntries = Object.entries(namedBag.fields).map(([k, v]) =>
      `${erlString(k)} => ${genExprScalar(ctx, v, typeEnv, sCtx)}`
    );
    if (posArgs.length > 0) {
      return `self_send(${callee}, [${posArgs.join(', ')}, #{${namedEntries.join(', ')}}])`;
    }
    return `self_send(${callee}, #{${namedEntries.join(', ')}})`;
  }
  return `self_send(${callee}, [${posArgs.join(', ')}])`;
}

// Runtime dispatch: if callee is a binary (lambda label), use self_send; otherwise direct call
function genErlRuntimeFunctionCall(ctx, expr, typeEnv, sCtx) {
  // Only use runtime check if the callee could plausibly be a lambda label
  // If we know it's always a closure (not in lambda var names), use direct call
  return genFunctionCallExpr(ctx, expr, typeEnv, sCtx);
}

function genActorFnCallExpr(ctx, expr, typeEnv, sCtx) {
  const name = expr.callee.name;
  // Self-send: call through dispatch, return Structure
  if (expr.args.length === 0) {
    return `self_send(${erlString(name)}, #{})`;
  }
  const posArgs = expr.args.filter(a => a.type !== 'NamedArgsBag').map(a => {
    if (a.type === 'Function' && !erlLambdaUsesOuterRefs(ctx, a)) return erlGenLambdaArgLabel(ctx, a, typeEnv, sCtx);
    return genExpr(ctx, a, typeEnv, sCtx);
  });
  const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
  if (namedBag) {
    const namedEntries = Object.entries(namedBag.fields).map(([k, v]) =>
      `${erlString(k)} => ${genExpr(ctx, v, typeEnv, sCtx)}`
    );
    if (posArgs.length > 0) {
      return `self_send(${erlString(name)}, [${posArgs.join(', ')}, #{${namedEntries.join(', ')}}])`;
    }
    // Named-only: pass as map, not wrapped in list
    return `self_send(${erlString(name)}, #{${namedEntries.join(', ')}})`;
  }
  return `self_send(${erlString(name)}, [${posArgs.join(', ')}])`;
}


function genFunctionLiteral(ctx, expr, typeEnv, sCtx, selfName, outerRenames) {
  const params = expr.params || [];
  const scopeId = ctx.fnScopeCounter++;
  const prefix = `Fn${scopeId}_`;

  // Track ref params — reads/writes go through process dictionary key
  const refParams = new Set();

  // Build a renaming map: inner var names → prefixed names (to avoid Erlang shadowing)
  const innerRenames = new Map();
  const paramNames = params.map(p => {
    if (p.ref) {
      refParams.add(p.name);
      const renamed = prefix + 'Ref_' + erlVarName(p.name);
      innerRenames.set(p.name, renamed);
      return renamed;
    }
    const renamed = prefix + erlVarName(p.name);
    innerRenames.set(p.name, renamed);
    return renamed;
  }).join(', ');

  // For self-referencing functions, map self name to the named fun identifier
  if (selfName) {
    const selfRenamed = prefix + erlVarName(selfName);
    innerRenames.set(selfName, selfRenamed);
  }

  function innerVarName(name) {
    if (innerRenames.has(name)) return innerRenames.get(name);
    // Check outer scope renames for captured/closed-over variables
    if (outerRenames && outerRenames.has(name)) return outerRenames.get(name);
    return erlVarName(name);
  }

  // Check if body references self (for named fun generation)
  const selfReferenced = selfName && JSON.stringify(expr.body || expr.expr).includes(`"name":"${selfName}"`);

  function genInnerExpr(e) {
    if (!e) return 'null';
    // Self-reference: use named fun identifier
    if (selfReferenced && e.type === 'Identifier' && e.name === selfName) {
      return innerRenames.get(selfName) + '_f';
    }
    if (e.type === 'Identifier') return innerVarName(e.name);
    if (e.type === 'RefRead') {
      // If this ref is a ref param, read via passed key; otherwise use outer ref
      if (refParams.has(e.name)) return `get(${innerVarName(e.name)})`;
      return `get(${erlSetTarget(ctx, e.name)})`;
    }
    if (e.type === 'StringLiteral') return erlString(e.value);
    if (e.type === 'IntLiteral') return String(e.value);
    if (e.type === 'FloatLiteral') return e.value.toString().includes('.') ? String(e.value) : e.value + '.0';
    if (e.type === 'BoolLiteral') return e.value ? 'true' : 'false';
    if (e.type === 'BinaryExpr') {
      const left = genInnerExpr(e.left);
      const right = genInnerExpr(e.right);
      if (e.op === '/') return `(${left} div ${right})`;
      if (e.op === '===') return `(${left} =:= ${right})`;
      if (e.op === '!==') return `(${left} =/= ${right})`;
      if (e.op === '<=') return `(${left} =< ${right})`;
      return `(${left} ${e.op} ${right})`;
    }
    if (e.type === 'FunctionCallExpr') {
      const callee = genInnerExpr(e.callee);
      const posArgs = (e.args || []).filter(a => a.type !== 'NamedArgsBag').map(a => genInnerExpr(a));
      const namedBag = (e.args || []).find(a => a.type === 'NamedArgsBag');
      if (namedBag) {
        const namedArgs = Object.values(namedBag.fields).map(v => genInnerExpr(v));
        return `${callee}(${[...posArgs, ...namedArgs].join(', ')})`;
      }
      return `${callee}(${posArgs.join(', ')})`;
    }
    if (e.type === 'NullLiteral') return 'null';
    if (e.type === 'DecimalLiteral') return String(e.value);
    if (e.type === 'IfExpr') {
      const cond = genInnerExpr(e.cond);
      const thenCode = genInnerIfBranch(e.then);
      let elseCode;
      if (!e.else) elseCode = 'null';
      else if (e.else.type === 'IfExpr') elseCode = genInnerExpr(e.else);
      else elseCode = genInnerIfBranch(e.else);
      return `case is_truthy(${cond}) of true -> ${thenCode}; false -> ${elseCode} end`;
    }
    if (e.type === 'Function') return genFunctionLiteral(ctx, e, typeEnv, ctx, undefined, innerRenames);
    if (e.type === 'FunctionCallExpr' && e.callee?.type === 'Identifier' && ctx.actorFnNames.has(e.callee.name)) {
      const args = e.args.filter(a => a.type !== 'NamedArgsBag').map(a => genInnerExpr(a));
      const namedBag = e.args.find(a => a.type === 'NamedArgsBag');
      const namedMap = namedBag
        ? `#{${Object.entries(namedBag.fields).map(([k, v]) => `${erlString(k)} => ${genInnerExpr(v)}`).join(', ')}}`
        : '#{}';
      return `self_send(${erlString(e.callee.name)}, [${args.join(', ')}])`;
    }
    // Fallback to outer genExpr for complex expressions
    return genExpr(ctx, e, typeEnv, sCtx);
  }

  function genInnerIfBranch(branch) {
    if (!branch) return 'null';
    if (branch.expr) {
      if (branch.expr.type === 'FunctionCallExpr') return `structure_one(${genInnerExpr(branch.expr)})`;
      return genInnerExpr(branch.expr);
    }
    if (branch.body) {
      const parts = [];
      for (const s of branch.body) {
        if (s.type === 'TypedAssign' || s.type === 'Assign') {
          const renamed = prefix + erlVarName(s.name);
          innerRenames.set(s.name, renamed);
          parts.push(`${renamed} = ${genInnerExpr(s.value)}`);
        } else if (s.type === 'ImplicitReturn') {
          parts.push(genInnerExpr(s.expr));
        }
      }
      return parts.join(', ');
    }
    return 'null';
  }

  let bodyExpr;
  if (expr.body && expr.body.length > 0) {
    const implRet = expr.body.find(s => s.type === 'ImplicitReturn');
    const bodyStmts = expr.body.filter(s => s.type !== 'ImplicitReturn');

    if (bodyStmts.length > 0 || implRet) {
      const lines = [];
      let hasReturn = false;
      for (let si = 0; si < bodyStmts.length; si++) {
        const s = bodyStmts[si];
        // Early return: stop processing after a Return node
        if (s.type === 'Return') {
          lines.push(genFnReturnExpr(s.fields, genInnerExpr, innerVarName));
          hasReturn = true;
          break;
        }
        if (s.type === 'TypedAssign' || s.type === 'Assign') {
          const renamed = prefix + erlVarName(s.name);
          innerRenames.set(s.name, renamed);
          if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.value.callee.name)) {
            const args = s.value.args.map(a => genInnerExpr(a)).join(', ');
            lines.push(`${renamed} = structure_one(self_send(${erlString(s.value.callee.name)}, [${args}]))`);
          } else {
            lines.push(`${renamed} = ${genInnerExpr(s.value)}`);
          }
        }
        if (s.type === 'DestructureAssign') {
          const tmpName = `${prefix}Dtmp_${si}`;
          const isActorFnCall = s.source.type === 'FunctionCallExpr' && s.source.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.source.callee.name);
          if (isActorFnCall) {
            const args = s.source.args.map(a => genInnerExpr(a)).join(', ');
            lines.push(`${tmpName} = self_send(${erlString(s.source.callee.name)}, [${args}])`);
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
        if (s.type === 'SetStatement') {
          if (sCtx?.childActorRefs?.has(s.name)) {
            const actorName = sCtx.childActorRefs.get(s.name);
            const wireOp = s.updateOp === '<|' ? '::update' : '::set';
            lines.push(`child_${actorName.toLowerCase()}_handle_op(<<"${wireOp}">>, #{}, [${genInnerExpr(s.value)}], _Id, _From)`);
          } else if (refParams.has(s.name)) {
            lines.push(`put(${innerVarName(s.name)}, ${genInnerExpr(s.value)})`);
          } else {
            lines.push(`put(${erlSetTarget(ctx, s.name)}, ${genInnerExpr(s.value)})`);
          }
        }
        if (s.type === 'StateAssign') {
          lines.push(`put(state_${s.name}, ${genInnerExpr(s.value)})`);
        }
        if (s.type === 'WhileStatement') {
          lines.push(genFnWhileStatement(ctx, s, genInnerExpr, prefix));
        }
        if (s.type === 'ExprStatement') {
          lines.push(genInnerExpr(s.expr));
        }
        if (s.type === 'IfStatement') {
          const ifLines = [];
          for (const bs of s.body) {
            if (bs.type === 'SetStatement') {
              if (refParams.has(bs.name)) {
                ifLines.push(`put(${innerVarName(bs.name)}, ${genInnerExpr(bs.value)})`);
              } else {
                ifLines.push(`put(${erlSetTarget(ctx, bs.name)}, ${genInnerExpr(bs.value)})`);
              }
            } else if (bs.type === 'StateAssign') {
              ifLines.push(`put(state_${bs.name}, ${genInnerExpr(bs.value)})`);
            }
          }
          lines.push(`case is_truthy(${genInnerExpr(s.cond)}) of true -> ${ifLines.join(', ')}; false -> null end`);
        }
      }
      if (expr.returnType === '.') {
        // No-return function: just execute side effects, return ok
        lines.push('ok');
      } else if (!hasReturn && implRet) {
        lines.push(genInnerExpr(implRet.expr));
      } else if (bodyStmts.length > 0) {
        const last = bodyStmts[bodyStmts.length - 1];
        if (last.type === 'SetStatement') {
          // Set returns the new value — read back
          if (refParams.has(last.name)) {
            lines.push(`get(${innerVarName(last.name)})`);
          } else {
            lines.push(`get(${erlSetTarget(ctx, last.name)})`);
          }
        } else if (last.name) {
          lines.push(innerVarName(last.name));
        }
      }
      bodyExpr = lines.join(', ');
    } else {
      bodyExpr = 'null';
    }
  } else if (expr.expr) {
    if (expr.returnType === '.') {
      bodyExpr = `${genInnerExpr(expr.expr)}, ok`;
    } else {
      bodyExpr = genInnerExpr(expr.expr);
    }
  } else {
    bodyExpr = 'null';
  }

  // Self-referencing function: use a named fun
  if (selfReferenced) {
    const innerSelfName = innerRenames.get(selfName);
    return `fun ${innerSelfName}_f(${paramNames}) -> ${bodyExpr} end`;
  }
  return `fun(${paramNames}) -> ${bodyExpr} end`;
}

function genFunctionCallExpr(ctx, expr, typeEnv, sCtx) {
  const callee = genExpr(ctx, expr.callee, typeEnv, sCtx);
  const posArgs = (expr.args || []).filter(a => a.type !== 'NamedArgsBag').map(a => genExpr(ctx, a, typeEnv, sCtx));
  const namedBag = (expr.args || []).find(a => a.type === 'NamedArgsBag');
  // Runtime dispatch: when callee is an Identifier that could hold a lambda label binary
  // Only apply when lambda handlers exist (meaning lambdas are being lifted)
  if (ctx.lambdaHandlers.length > 0 && expr.callee?.type === 'Identifier' && !ctx.actorFnNames.has(expr.callee.name) && !ctx.lambdaVarNames.has(expr.callee.name) && !ctx.stateVarNames.has(expr.callee.name)) {
    let selfSendPayload;
    if (posArgs.length === 0 && !namedBag) {
      selfSendPayload = '#{}';
    } else if (namedBag) {
      const namedEntries = Object.entries(namedBag.fields).map(([k, v]) =>
        `${erlString(k)} => ${genExpr(ctx, v, typeEnv, sCtx)}`
      );
      if (posArgs.length > 0) {
        selfSendPayload = `[${posArgs.join(', ')}, #{${namedEntries.join(', ')}}]`;
      } else {
        selfSendPayload = `#{${namedEntries.join(', ')}}`;
      }
    } else {
      selfSendPayload = `[${posArgs.join(', ')}]`;
    }
    const directCall = namedBag
      ? `${callee}(${[...posArgs, ...Object.values(namedBag.fields).map(v => genExpr(ctx, v, typeEnv, sCtx))].join(', ')})`
      : `${callee}(${posArgs.join(', ')})`;
    return `case is_binary(${callee}) of true -> structure_one(self_send(${callee}, ${selfSendPayload})); false -> ${directCall} end`;
  }
  if (namedBag) {
    const namedArgs = Object.values(namedBag.fields).map(v => genExpr(ctx, v, typeEnv, sCtx));
    const allArgs = [...posArgs, ...namedArgs];
    return `${callee}(${allArgs.join(', ')})`;
  }
  return `${callee}(${posArgs.join(', ')})`;
}

function genOverExpr(ctx, expr, typeEnv, sCtx) {
  const list = genExpr(ctx, expr.collection, typeEnv, sCtx);
  let fn;
  if (expr.fn.type === 'FnRef' && ctx.actorFnNames.has(expr.fn.name)) {
    fn = `fun(Item_) -> structure_one(self_send(${erlString(expr.fn.name)}, [Item_])) end`;
  } else if (expr.fn.type === 'FnRef' && ctx.lambdaVarNames.has(expr.fn.name)) {
    const varRef = genExpr(ctx, { type: 'Identifier', name: expr.fn.name }, typeEnv, sCtx);
    fn = `fun(Item_) -> structure_one(self_send(${varRef}, [Item_])) end`;
  } else if (expr.fn.type === 'FnRef') {
    fn = erlVarName(expr.fn.name);
  } else if (expr.fn.type === 'Function' && !erlLambdaUsesOuterRefs(ctx, expr.fn)) {
    const label = erlGenLambdaArgLabel(ctx, expr.fn, typeEnv, sCtx);
    fn = `fun(Item_) -> structure_one(self_send(${label}, [Item_])) end`;
  } else {
    fn = genExpr(ctx, expr.fn, typeEnv, sCtx);
  }
  return `brevity_map(${list}, ${fn})`;
}

function genReduceExpr(ctx, expr, typeEnv, sCtx) {
  const list = genExpr(ctx, expr.collection, typeEnv, sCtx);
  let fn;
  if (expr.fn.type === 'FnRef' && ctx.actorFnNames.has(expr.fn.name)) {
    fn = `fun(Item_, Acc_) -> structure_one(self_send(${erlString(expr.fn.name)}, [Acc_, Item_])) end`;
  } else if (expr.fn.type === 'FnRef' && ctx.lambdaVarNames.has(expr.fn.name)) {
    const varRef = genExpr(ctx, { type: 'Identifier', name: expr.fn.name }, typeEnv, sCtx);
    fn = `fun(Item_, Acc_) -> structure_one(self_send(${varRef}, [Acc_, Item_])) end`;
  } else if (expr.fn.type === 'FnRef') {
    fn = erlVarName(expr.fn.name);
  } else if (expr.fn.type === 'Function' && !erlLambdaUsesOuterRefs(ctx, expr.fn)) {
    const label = erlGenLambdaArgLabel(ctx, expr.fn, typeEnv, sCtx);
    fn = `fun(Item_, Acc_) -> structure_one(self_send(${label}, [Acc_, Item_])) end`;
  } else {
    fn = genExpr(ctx, expr.fn, typeEnv, sCtx);
  }
  if (expr.initial) {
    const init = genExpr(ctx, expr.initial, typeEnv, sCtx);
    return `brevity_foldl(${list}, ${init}, ${fn})`;
  }
  return `brevity_foldl1(${fn}, ${list})`;
}


function genIfExpr(ctx, expr, typeEnv, sCtx) {
  const cond = genExpr(ctx, expr.cond, typeEnv, sCtx);
  const thenCode = genIfBranch(ctx, expr.then, typeEnv, sCtx);
  let elseCode;
  if (!expr.else) {
    elseCode = 'null';
  } else if (expr.else.type === 'IfExpr') {
    elseCode = genIfExpr(ctx, expr.else, typeEnv, sCtx);
  } else {
    elseCode = genIfBranch(ctx, expr.else, typeEnv, sCtx);
  }
  return `case is_truthy(${cond}) of true -> ${thenCode}; false -> ${elseCode} end`;
}

function genIfBranch(ctx, branch, typeEnv, sCtx) {
  if (!branch) return 'null';
  // Simple expression form
  if (branch.expr) {
    // Function calls return structures; unwrap when used as value
    // Function calls may return structures from Return nodes
    if (branch.expr.type === 'FunctionCallExpr') {
      return `structure_one(${genExpr(ctx, branch.expr, typeEnv, sCtx)})`;
    }
    return genExpr(ctx, branch.expr, typeEnv, sCtx);
  }
  // Block form with body
  if (branch.body) return genIfBlockBody(ctx, branch.body, typeEnv, sCtx);
  return 'null';
}

function genIfBlockBody(ctx, body, typeEnv, sCtx) {
  const scopeId = ctx.ifScopeCounter++;
  const prefix = `If${scopeId}_`;
  const innerRenames = new Map();

  function innerVarName(name) {
    if (innerRenames.has(name)) return innerRenames.get(name);
    // Fall back to outer SSA resolution
    if (sCtx?.ssaEnv && sCtx.stmtIdx !== undefined) {
      return erlVarName(resolveSSAName(name, sCtx.stmtIdx, sCtx.ssaEnv));
    }
    return erlVarName(name);
  }

  function genInner(e) {
    if (!e) return 'null';
    if (e.type === 'Identifier') return innerVarName(e.name);
    if (e.type === 'RefRead') return `get(${erlSetTarget(ctx, e.name)})`;
    if (e.type === 'StringLiteral') return erlString(e.value);
    if (e.type === 'IntLiteral') return String(e.value);
    if (e.type === 'FloatLiteral') return e.value.toString().includes('.') ? String(e.value) : e.value + '.0';
    if (e.type === 'BoolLiteral') return e.value ? 'true' : 'false';
    if (e.type === 'NullLiteral') return 'null';
    if (e.type === 'BinaryExpr') {
      const left = genInner(e.left);
      const right = genInner(e.right);
      if (e.op === '/') return `(${left} div ${right})`;
      if (e.op === '===') return `(${left} =:= ${right})`;
      if (e.op === '!==') return `(${left} =/= ${right})`;
      if (e.op === '<=') return `(${left} =< ${right})`;
      return `(${left} ${e.op} ${right})`;
    }
    if (e.type === 'FunctionCallExpr' && e.callee?.type === 'Identifier' && ctx.actorFnNames.has(e.callee.name)) {
      const args = e.args.map(a => genInner(a)).join(', ');
      return `self_send(${erlString(e.callee.name)}, [${args}])`;
    }
    // Fall back to outer genExpr for complex expressions
    return genExpr(ctx, e, typeEnv, sCtx);
  }

  const lines = [];
  let lastAssignVar = null;

  for (let si = 0; si < body.length; si++) {
    const s = body[si];
    if (s.type === 'ImplicitReturn') {
      lines.push(genInner(s.expr));
      lastAssignVar = null;
      continue;
    }
    if (s.type === 'TypedAssign' || s.type === 'Assign') {
      const renamed = prefix + erlVarName(s.name);
      innerRenames.set(s.name, renamed);
      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.value.callee.name)) {
        const args = s.value.args.map(a => genInner(a)).join(', ');
        lines.push(`${renamed} = structure_one(self_send(${erlString(s.value.callee.name)}, [${args}]))`);
      } else {
        lines.push(`${renamed} = ${genInner(s.value)}`);
      }
      lastAssignVar = renamed;
      continue;
    }
    if (s.type === 'DestructureAssign') {
      const tmpName = `${prefix}Dtmp_${si}`;
      if (s.source.type === 'FunctionCallExpr' && s.source.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.source.callee.name)) {
        const args = s.source.args.map(a => genInner(a)).join(', ');
        lines.push(`${tmpName} = self_send(${erlString(s.source.callee.name)}, [${args}])`);
      } else {
        lines.push(`${tmpName} = ${genInner(s.source)}`);
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
      lastAssignVar = null;
      continue;
    }
    if (s.type === 'StateAssign') {
      lines.push(`put(state_${s.name}, ${genInner(s.value)})`);
      lastAssignVar = null;
      continue;
    }
    if (s.type === 'SetStatement') {
      lines.push(`put(${erlSetTarget(ctx, s.name)}, ${genInner(s.value)})`);
      lastAssignVar = null;
      continue;
    }
  }

  // If body had no ImplicitReturn, use last assigned var
  if (lastAssignVar && (lines.length === 0 || !body.some(s => s.type === 'ImplicitReturn'))) {
    lines.push(lastAssignVar);
  }

  return lines.join(', ');
}

// ── Reply field codegen ─────────────────────────────────────────────────────

function genReplyBody(ctx, fields, typeEnv, sCtx) {
  const spread = fields.find(f => f.spread);
  if (spread) {
    if (sCtx?.restVars?.has(spread.name)) {
      return `structure_splat({${erlVarName(spread.name)}_pos, ${erlVarName(spread.name)}_named})`;
    }
    return `structure_splat(${erlVarName(spread.name)})`;
  }

  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  if (pos.length > 0 && named.length > 0) {
    const posVals = pos.map(f => genReplyFieldVal(ctx, f, typeEnv, sCtx)).join(', ');
    const namedMap = genReplyNamedMap(ctx, named, typeEnv, sCtx);
    return `[${posVals}, ${namedMap}]`;
  } else if (pos.length > 0) {
    const posVals = pos.map(f => genReplyFieldVal(ctx, f, typeEnv, sCtx)).join(', ');
    return `[${posVals}]`;
  } else {
    return genReplyNamedMap(ctx, named, typeEnv, sCtx);
  }
}

function genReplyFieldVal(ctx, f, typeEnv, sCtx) {
  if (f.name) {
    if (f.name && f.name.startsWith('$')) return `get(state_${f.name.slice(1)})`;
    if (ctx.stateVarNames.has(f.name)) return `get(state_${f.name})`;
    if (sCtx?.ssaEnv && sCtx.stmtIdx !== undefined) return erlVarName(resolveSSAName(f.name, sCtx.stmtIdx, sCtx.ssaEnv));
    return erlVarName(f.name);
  }
  if (f.expr) {
    const raw = genExpr(ctx, f.expr, typeEnv, sCtx);
    // Wrap self_send calls in structure_one to unwrap Structure to scalar
    if (raw.startsWith('self_send(')) return `structure_one(${raw})`;
    return raw;
  }
  return 'null';
}

function genReplyNamedMap(ctx, named, typeEnv, sCtx) {
  const entries = named.map(f => {
    if ('sigil' in f) {
      let val;
      if (f.sigil.startsWith('$')) val = `get(state_${f.sigil.slice(1)})`;
      else if (ctx.stateVarNames.has(f.sigil)) val = `get(state_${f.sigil})`;
      else if (sCtx?.refVars?.has(f.sigil)) val = `get(ref_${f.sigil})`;
      else if (sCtx?.ssaEnv && sCtx.stmtIdx !== undefined) val = erlVarName(resolveSSAName(f.sigil, sCtx.stmtIdx, sCtx.ssaEnv));
      else val = erlVarName(f.sigil);
      return `${erlString(f.sigil)} => ${val}`;
    }
    if (f.key !== undefined) {
      const val = f.value ? genExpr(ctx, f.value, typeEnv, sCtx) : erlVarName(f.key);
      return `${erlString(f.key)} => ${val}`;
    }
    return '';
  }).filter(Boolean);
  return `#{${entries.join(', ')}}`;
}

function isListOfAnythingType(t) {
  return t === 'List' || t === 'List of Anything';
}

function genBvaBody(ctx, fields, typeEnv) {
  const spread = fields.find(f => f.spread);
  if (spread) return null; // handled separately

  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  const posTypes = [];
  for (const f of pos) {
    const t = f.type || (f.name ? typeEnv.get(f.name) : null) || inferLiteralType(f.expr || f.value);
    if (!t) return null;
    posTypes.push(erlString(t));
  }

  const namedTypes = [];
  for (const f of named) {
    let key, t, varExpr;
    if ('sigil' in f) {
      key = f.sigil;
      t = f.type || typeEnv.get(f.sigil);
      varExpr = ctx.stateVarNames.has(f.sigil) ? `get(state_${f.sigil})` : erlVarName(f.sigil);
    } else if (f.key !== undefined) {
      key = f.key;
      const valName = f.value?.type === 'Identifier' ? f.value.name : (f.value?.type === 'RefRead' ? f.value.name : null);
      t = f.type || (valName ? typeEnv.get(valName) : null) || inferLiteralType(f.value);
      varExpr = valName ? erlVarName(valName) : null;
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

// ── Public function param destructuring ──────────────────────────────────────

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

function genLocals(ctx, body, typeEnv, sCtx, indent) {
  const I = indent;
  const lines = [];
  const ssaEnv = sCtx.ssaEnv || buildSSAEnv(body);

  for (let i = 0; i < body.length; i++) {
    const s = body[i];
    const stmtCtx = { ...sCtx, stmtIdx: i, ssaEnv };

    if (s.type === 'Reply' || s.type === 'ImplicitReturn' || s.type === 'Return') continue;

    if (s.type === 'TypedAssign' || s.type === 'Assign') {
      const ssaName = getSSANameForAssignment(s.name, i, ssaEnv);
      const varName = erlVarName(ssaName);

      if (s.type === 'TypedAssign' && s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorInfo.has(s.value.callee.name)) {
        const asClause = findErlAsClauseMatch(ctx, s.typeName, s.value.callee.name);
        if (asClause) {
          lines.push(`${I}${varName} = ${genExpr(ctx, asClause.expr, typeEnv, stmtCtx)},`);
          continue;
        }
      }

      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorInfo.has(s.value.callee.name)) {
        // Non-ref actor instantiation — assign actor name atom to variable
        const actorName = s.value.callee.name;
        if (sCtx.childActorRefs) sCtx.childActorRefs.set(s.name, actorName);
        const childActor = ctx.actorInfo.get(actorName)?.actor || actors?.find(a => a.name === actorName);
        const hasInit = (childActor?.initParams?.length > 0) || (childActor?.initBody?.length > 0) || s.value.args.length > 0;
        if (hasInit) {
          const initArgs = s.value.args.map(a => genExpr(ctx, a, typeEnv, stmtCtx)).join(', ');
          lines.push(`${I}child_${actorName.toLowerCase()}_init([${initArgs}]),`);
        }
        lines.push(`${I}${varName} = ${erlString(actorName.toLowerCase())},`);
      } else if (s.type === 'TypedAssign' && s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.value.callee.name)) {
        if (s.typeName === 'Structure') {
          lines.push(`${I}${varName} = ${genActorFnCallExpr(ctx, s.value, typeEnv, stmtCtx)},`);
        } else {
          lines.push(`${I}${varName} = structure_one(${genActorFnCallExpr(ctx, s.value, typeEnv, stmtCtx)}),`);
        }
      } else if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.value.callee.name)) {
        lines.push(`${I}${varName} = structure_one(${genActorFnCallExpr(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.type === 'TypedAssign' && s.typeName === 'Structure' && s.value?.type === 'StructureConstructor') {
        lines.push(`${I}${varName} = ${genExpr(ctx, s.value, typeEnv, stmtCtx)},`);
      } else if (s.type === 'TypedAssign' && s.value?.type === 'StructureConstructor') {
        lines.push(`${I}${varName} = structure_one(${genExpr(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.lambdaVarNames.has(s.value.callee.name)) {
        lines.push(`${I}${varName} = structure_one(${genErlLambdaVarCall(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && (() => {
        const ct = ctx.currentTypeEnv?.get(s.value.callee.name);
        return ct && (ct === 'Function' || (typeof ct === 'string' && ct.includes('->')));
      })()) {
        lines.push(`${I}${varName} = structure_one(${genErlLambdaVarCall(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'FunctionCallExpr') {
        lines.push(`${I}${varName} = structure_one(${genFunctionCallExpr(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'Function') {
        if (erlLambdaUsesOuterRefs(ctx, s.value)) {
          lines.push(`${I}${varName} = ${genFunctionLiteral(ctx, s.value, typeEnv, stmtCtx, s.name)},`);
        } else {
          const lambdaName = `_lambda_${ctx.lambdaCounter++}`;
          ctx.lambdaVarNames.add(s.name);
          const freeVars = erlCollectFreeVars(ctx, s.value).filter(v => v !== s.name && !ctx.actorFnNames.has(v));
          for (const v of freeVars) {
            const capKey = `_cap_${lambdaName}_${v}`;
            ctx.lambdaCaptureKeys.push(capKey);
            const src = ctx.stateVarNames.has(v) ? `get(state_${v})` : genExpr(ctx, { type: 'Identifier', name: v }, typeEnv, stmtCtx);
            lines.push(`${I}put('${capKey}', ${src}),`);
          }
          ctx.lambdaHandlers.push({ name: lambdaName, varName: s.name, fn: s.value, captures: freeVars.map(v => ({ name: v, lambdaName })) });
          lines.push(`${I}${varName} = <<"${lambdaName}">>,`);
        }
      } else if (s.value?.type === 'DotCallExpr' && (
        (s.value.object.type === 'FunctionCallExpr' && s.value.object.callee?.type === 'Identifier' && ctx.actorInfo.has(s.value.object.callee.name)) ||
        (s.value.object.type === 'RefRead' && stmtCtx.childActorRefs?.has(s.value.object.name)) ||
        (s.value.object.type === 'Identifier' && stmtCtx.childActorRefs?.has(s.value.object.name))
      )) {
        lines.push(`${I}${varName} = structure_one(${genChildDotCallAwait(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'DotCallExpr') {
        // Use genDotCallAwait for remote/constructs calls that return values
        const dotObj = s.value.object;
        const dotObjName = dotObj.type === 'RefRead' ? dotObj.name : (dotObj.type === 'Identifier' ? dotObj.name : null);
        const needsAwait = dotObjName && (ctx.remoteInstanceVars.has(dotObjName) || ctx.constructsProxyVars.has(dotObjName));
        if (needsAwait) {
          const tmpVar = `Tmp_${i}`;
          const awaitExpr = genDotCallAwait(ctx, s.value, typeEnv, stmtCtx);
          lines.push(`${I}${tmpVar} = ${awaitExpr},`);
          lines.push(`${I}{${tmpVar}_pos, ${tmpVar}_named} = ${tmpVar},`);
          lines.push(`${I}${varName} = maps:get(${erlString(s.name)}, ${tmpVar}_named, null),`);
        } else {
          lines.push(`${I}${varName} = ${genExpr(ctx, s.value, typeEnv, stmtCtx)},`);
        }
      } else {
        lines.push(`${I}${varName} = ${genExpr(ctx, s.value, typeEnv, stmtCtx)},`);
      }
    }

    if (s.type === 'DestructureAssign') {
      genDestructureAssign(ctx, s, typeEnv, stmtCtx, ssaEnv, I, lines, i);
    }

    if (s.type === 'ExprStatement') {
      lines.push(`${I}${genExpr(ctx, s.expr, typeEnv, stmtCtx)},`);
    }

    if (s.type === 'SpawnStatement') {
      if (s.call.type === 'DotCallExpr') {
        lines.push(`${I}${genExpr(ctx, s.call, typeEnv, stmtCtx)},`);
      } else {
        lines.push(`${I}${genActorFnCallExpr(ctx, s.call, typeEnv, stmtCtx)},`);
      }
    }

    if (s.type === 'ListDestructure') {
      genListDestructure(ctx, s, typeEnv, stmtCtx, ssaEnv, I, lines, i);
    }

    if (s.type === 'RefDecl') {
      if (sCtx.refVars) sCtx.refVars.add(s.name);
      // Detect child actor instantiation: ref name = ActorName(args)
      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorInfo.has(s.value.callee.name)) {
        const actorName = s.value.callee.name;
        if (sCtx.childActorRefs) sCtx.childActorRefs.set(s.name, actorName);
        const info = ctx.actorInfo.get(actorName);
        if (s.value.args.length > 0) {
          const initArgs = s.value.args.map(a => genExpr(ctx, a, typeEnv, stmtCtx)).join(', ');
          lines.push(`${I}child_${actorName.toLowerCase()}_init([${initArgs}]),`);
        }
      } else {
        const val = s.value ? genExpr(ctx, s.value, typeEnv, stmtCtx) : 'null';
        lines.push(`${I}put(${erlSetTarget(ctx, s.name)}, ${val}),`);
      }
    }

    if (s.type === 'SetStatement') {
      if (sCtx.childActorRefs && sCtx.childActorRefs.has(s.name)) {
        const actorName = sCtx.childActorRefs.get(s.name);
        const wireOp = s.updateOp === '<|' ? '::update' : '::set';
        const val = genExpr(ctx, s.value, typeEnv, stmtCtx);
        lines.push(`${I}child_${actorName.toLowerCase()}_handle_op(<<"${wireOp}">>, #{}, [${val}], _Id, _From),`);
      } else {
        const val = genExpr(ctx, s.value, typeEnv, stmtCtx);
        lines.push(`${I}put(${erlSetTarget(ctx, s.name)}, ${val}),`);
      }
    }

    if (s.type === 'ActorSetStatement') {
      if (sCtx.childActorRefs && sCtx.childActorRefs.has(s.name)) {
        const actorName = sCtx.childActorRefs.get(s.name);
        const wireOp = s.updateOp === '<|' ? '::update' : '::set';
        const posArgs = s.args.filter(a => a.positional).map(a => genExpr(ctx, a.expr, typeEnv, stmtCtx));
        const namedArgs = s.args.filter(a => !a.positional);
        let payload;
        if (namedArgs.length > 0) {
          const namedMap = namedArgs.map(a => `${erlString(a.name)} => ${genExpr(ctx, a.expr, typeEnv, stmtCtx)}`).join(', ');
          if (posArgs.length > 0) {
            payload = `[${posArgs.join(', ')}, #{${namedMap}}]`;
          } else {
            payload = `#{${namedMap}}`;
          }
        } else {
          payload = `[${posArgs.join(', ')}]`;
        }
        lines.push(`${I}child_${actorName.toLowerCase()}_handle_op(<<"${wireOp}">>, #{}, ${payload}, _Id, _From),`);
      }
    }

    if (s.type === 'StateAssign') {
      const val = genExpr(ctx, s.value, typeEnv, stmtCtx);
      lines.push(`${I}put(state_${s.name}, ${val}),`);
    }

    if (s.type === 'WhileStatement') {
      lines.push(genWhileStatement(ctx, s, typeEnv, stmtCtx, I));
    }

    if (s.type === 'BareTypeDecl') {
      // Type annotation only — no Erlang code needed
    }

    if (s.type === 'IfStatement') {
      lines.push(genIfStatement(ctx, s, typeEnv, stmtCtx, I));
    }
  }

  return lines;
}


function genWhileStatement(ctx, node, typeEnv, sCtx, indent) {
  const I = indent;
  const loopId = ctx.whileCounter++;
  const loopName = `Loop_${loopId}`;

  const cond = genExpr(ctx, node.cond, typeEnv, sCtx);
  const trueCase = node.negated ? 'false' : 'true';
  const falseCase = node.negated ? 'true' : 'false';

  const bodyLines = [];
  for (const s of node.body) {
    if (s.type === 'SetStatement') {
      bodyLines.push(`${I}            put(${erlSetTarget(ctx, s.name)}, ${genExpr(ctx, s.value, typeEnv, sCtx)})`);
    } else if (s.type === 'StateAssign') {
      bodyLines.push(`${I}            put(state_${s.name}, ${genExpr(ctx, s.value, typeEnv, sCtx)})`);
    } else if (s.type === 'TypedAssign') {
      bodyLines.push(`${I}            ${erlVarName(s.name)} = ${genExpr(ctx, s.value, typeEnv, sCtx)}`);
    } else if (s.type === 'ExprStatement') {
      bodyLines.push(`${I}            ${genExpr(ctx, s.expr, typeEnv, sCtx)}`);
    }
  }
  bodyLines.push(`${I}            ${loopName}_f()`);

  return `${I}${loopName} = fun ${loopName}_f() ->\n` +
    `${I}    case is_truthy(${cond}) of\n` +
    `${I}        ${trueCase} ->\n` +
    bodyLines.join(',\n') + `;\n` +
    `${I}        ${falseCase} -> null\n` +
    `${I}    end\n` +
    `${I}end,\n` +
    `${I}${loopName}(),`;
}

function genIfStatement(ctx, node, typeEnv, sCtx, indent) {
  const I = indent;
  const cond = genExpr(ctx, node.cond, typeEnv, sCtx);
  const bodyLines = [];
  for (const s of node.body) {
    if (s.type === 'SetStatement') {
      if (sCtx?.childActorRefs?.has(s.name)) {
        const actorName = sCtx.childActorRefs.get(s.name);
        const wireOp = s.updateOp === '<|' ? '::update' : '::set';
        bodyLines.push(`child_${actorName.toLowerCase()}_handle_op(<<"${wireOp}">>, #{}, [${genExpr(ctx, s.value, typeEnv, sCtx)}], _Id, _From)`);
      } else {
        bodyLines.push(`put(${erlSetTarget(ctx, s.name)}, ${genExpr(ctx, s.value, typeEnv, sCtx)})`);
      }
    } else if (s.type === 'StateAssign') {
      bodyLines.push(`put(state_${s.name}, ${genExpr(ctx, s.value, typeEnv, sCtx)})`);
    }
  }
  return `${I}case is_truthy(${cond}) of true -> ${bodyLines.join(', ')}; false -> null end,`;
}

function genListDestructure(ctx, s, typeEnv, sCtx, ssaEnv, I, lines, stmtIdx) {
  const srcExpr = genExpr(ctx, s.source, typeEnv, sCtx);
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
        lines.push(`${I}${varName} = case ${cur} of [] -> null; _ -> ${cur} end,`);
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

function genDestructureAssign(ctx, s, typeEnv, sCtx, ssaEnv, I, lines, stmtIdx) {
  const isDotCall = s.source.type === 'DotCallExpr';
  const srcExpr = isDotCall ? genDotCallAwait(ctx, s.source, typeEnv, sCtx) : genExpr(ctx, s.source, typeEnv, sCtx);
  const isActorFnCall = s.source.type === 'FunctionCallExpr' && s.source.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.source.callee.name);

  if (isDotCall || isActorFnCall) {
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
        sCtx.restVars?.has(s.source.name)
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

// ── Public function codegen ──────────────────────────────────────────────────

function genPublicFn(ctx, fn) {
  // Simple public function — no type check needed, used when single function per op with no typed params
  const inner = genPublicFnInner(ctx, fn);
  return `handle_op(${erlString(fn.name)}, Message, Payload, _Id, _From) ->\n${inner}`;
}

// ── Function codegen ────────────────────────────────────────────────────────

function genFn(ctx, fn) {
  const { name: op, params, body: rawBody } = fn;
  const typeEnv = buildTypeEnv(params, rawBody);
  const reply = rawBody.find(s => s.type === 'Reply');
  let implicitReturn = !reply ? rawBody.filter(s => s.type === 'ImplicitReturn').pop() : null;
  let body = rawBody;
  const hasSilentFn = rawBody.some(s => s.type === 'SilentTerminator');
  if (!reply && !implicitReturn && !hasSilentFn && rawBody.length > 0 && rawBody[rawBody.length - 1].type === 'ExprStatement') {
    implicitReturn = { type: 'ImplicitReturn', expr: rawBody[rawBody.length - 1].expr, typeName: null };
    body = rawBody.slice(0, -1);
  }
  const I = '    ';

  const restVars = new Set();
  const refVars = new Set();
  const childActorRefs = new Map();
  const sCtx = { restVars, refVars, childActorRefs, ssaEnv: buildSSAEnv(body) };

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

  const localLines = genLocals(ctx, body, typeEnv, sCtx, I);

  // Reply as Structure
  let retExpr;
  if (reply) {
    const fnReplyCtx = { ...sCtx, stmtIdx: body.length };
    const pos = reply.fields.filter(f => f.positional);
    const named = reply.fields.filter(f => !f.positional && !f.spread);
    const posVals = pos.map(f => genReplyFieldVal(ctx, f, typeEnv, fnReplyCtx)).join(', ');
    const namedPairs = named.map(f => {
      if ('sigil' in f) {
        if (ctx.stateVarNames.has(f.sigil)) return `${erlString(f.sigil)} => get(state_${f.sigil})`;
        const ssaResolved = fnReplyCtx.ssaEnv ? erlVarName(resolveSSAName(f.sigil, fnReplyCtx.stmtIdx, fnReplyCtx.ssaEnv)) : erlVarName(f.sigil);
        return `${erlString(f.sigil)} => ${ssaResolved}`;
      }
      if (f.key !== undefined) {
        const val = f.value ? genExpr(ctx, f.value, typeEnv, fnReplyCtx) : erlVarName(f.key);
        return `${erlString(f.key)} => ${val}`;
      }
      return '';
    }).filter(Boolean).join(', ');
    retExpr = `{[${posVals}], #{${namedPairs}}}`;
  } else if (implicitReturn) {
    const fnReplyCtx = { ...sCtx, stmtIdx: body.length };
    const raw = genExpr(ctx, implicitReturn.expr, typeEnv, fnReplyCtx);
    const isCall = implicitReturn.expr.type === 'FunctionCallExpr';
    const val = isCall ? `structure_one(${raw})` : raw;
    retExpr = `{[${val}], #{}}`;
  } else {
    retExpr = '{[], #{}}';
  }

  const allLines = [];
  if (paramLines.length > 0) allLines.push(paramLines.join('\n'));
  if (localLines.length > 0) allLines.push(localLines.join('\n'));
  allLines.push(`${I}${retExpr}`);

  return `${op}_fn({S_pos, S_named}) ->\n${allLines.join('\n')}.`;
}

// ── Program codegen ─────────────────────────────────────────────────────────

function genDispatch(ctx, publicFns) {
  // Group public functions by op name
  const grouped = new Map();
  for (const h of publicFns) {
    if (!grouped.has(h.name)) grouped.set(h.name, []);
    grouped.get(h.name).push(h);
  }

  const clauses = [];
  for (const [op, variants] of grouped) {
    if (variants.length === 1 && !variants[0].params.some(p => p.type && !p.rest)) {
      // Single function, no type check needed — simple clause
      clauses.push(genPublicFn(ctx, variants[0], false));
    } else {
      // Multiple variants or type-checked — generate pub_/priv_ helper functions
      const prefix = op.startsWith('::') ? 'self' : op.startsWith('@') ? 'pub' : 'priv';
      const baseName = op.startsWith('::') ? op.slice(2) : op.startsWith('@') ? op.slice(1) : op;
      const tryFns = [];
      for (let i = 0; i < variants.length; i++) {
        const h = variants[i];
        const fnName = `${prefix}_${baseName}_${i}`;
        const innerBody = genPublicFnInner(ctx, h);
        tryFns.push({ fnName, body: innerBody });
      }

      // Chain: try first, if nomatch try next, etc.
      let chainExpr = '    {error, ' + erlString(op) + '}';
      for (let i = tryFns.length - 1; i >= 0; i--) {
        const fn = tryFns[i];
        chainExpr = `    case ${fn.fnName}(Message, Payload, _From) of\n        nomatch ->\n    ${chainExpr};\n        Result -> Result\n    end`;
      }

      clauses.push(`handle_op(${erlString(op)}, Message, Payload, _Id, _From) ->\n${chainExpr}`);

      // Add the try functions as separate top-level functions
      for (let i = 0; i < variants.length; i++) {
        const h = variants[i];
        const fnName = `${prefix}_${baseName}_${i}`;
        const inner = genPublicFnInner(ctx, h);
        clauses.push(`${fnName}(Message, Payload, From) ->\n${inner}`);
      }
    }
  }

  // Catch-all clause
  clauses.push(`handle_op(Op, _Message, _Payload, _Id, _From) ->\n    {error, Op}`);

  return clauses;
}

function genPublicFnInner(ctx, fn, { skipTypeCheck = false } = {}) {
  const { name: op, params, body: rawBody } = fn;
  const typeEnv = buildTypeEnv(params, rawBody);
  const reply = rawBody.find(s => s.type === 'Reply');
  let implicitReturn = !reply ? rawBody.filter(s => s.type === 'ImplicitReturn').pop() : null;
  let body = rawBody;
  // Trailing ExprStatement in braced body acts as implicit return (unless explicitly silent)
  const hasSilent = rawBody.some(s => s.type === 'SilentTerminator');
  if (!reply && !implicitReturn && !hasSilent && rawBody.length > 0 && rawBody[rawBody.length - 1].type === 'ExprStatement') {
    const lastExpr = rawBody[rawBody.length - 1].expr;
    const isSilentEmit = lastExpr.type === 'FunctionCallExpr' && lastExpr.callee?.type === 'Identifier' && ctx.emitNames.has(lastExpr.callee.name) && ctx.emitNames.get(lastExpr.callee.name).silent;
    if (!isSilentEmit) {
      implicitReturn = { type: 'ImplicitReturn', expr: lastExpr, typeName: null };
      body = rawBody.slice(0, -1);
    }
  }

  // Build type check expression
  const typedParams = params.filter(p => p.type && !p.rest);
  const positionalTyped = typedParams.filter(p => p.positional);
  const namedTyped = typedParams.filter(p => !p.positional);

  let typeCheck = '';
  if (!skipTypeCheck) {
    if (positionalTyped.length > 0) {
      const posTypes = positionalTyped.map(p => erlString(p.type)).join(', ');
      const namedTypes = namedTyped.map(p => `{${erlString(p.key || p.name)}, ${erlString(p.type)}}`).join(', ');
      typeCheck = `(From =:= <<"__self">> orelse From =:= <<"__test">> orelse match_types_positional(Message, [${posTypes}], [${namedTypes}]))`;
    } else if (namedTyped.length > 0) {
      const pairs = namedTyped.map(p => `{${erlString(p.key || p.name)}, ${erlString(p.type)}}`).join(', ');
      typeCheck = `(From =:= <<"__self">> orelse From =:= <<"__test">> orelse match_types(Message, [${pairs}]))`;
    }
  }

  const I = '    ';
  const lines = [];
  const restVars = new Set();
  const refVars = new Set();
  for (const p of params) {
    if (p.rest) restVars.add(p.name);
  }
  const childActorRefs = new Map();
  const sCtx = { restVars, refVars, childActorRefs, ssaEnv: buildSSAEnv(body) };

  const paramLines = genParamDestructure(params, I);
  lines.push(...paramLines);
  const savedTypeEnv = ctx.currentTypeEnv;
  // Merge state var types so function-typed state vars are detected
  for (const [k, v] of ctx.stateVarTypeEnv) typeEnv.set(k, v);
  ctx.currentTypeEnv = typeEnv;
  const localLines = genLocals(ctx, body, typeEnv, sCtx, I);
  lines.push(...localLines);

  let replyExpr, bvaExpr;
  if (reply) {
    // Set stmtIdx to body length so SSA resolves to the latest binding
    const replyCtx = { ...sCtx, stmtIdx: body.length };
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
      replyExpr = genReplyBody(ctx, reply.fields, typeEnv, replyCtx);
      bvaExpr = genBvaBody(ctx, reply.fields, typeEnv);
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
  } else if (implicitReturn) {
    const replyCtx = { ...sCtx, stmtIdx: body.length };
    const raw = genExpr(ctx, implicitReturn.expr, typeEnv, replyCtx);
    const isCall = implicitReturn.expr.type === 'FunctionCallExpr';
    const val = isCall ? `structure_one(${raw})` : raw;
    replyBlock = `${I}{ok, [${val}], null}`;
  } else {
    replyBlock = `${I}{ok, null, null}`;
  }

  ctx.currentTypeEnv = savedTypeEnv;
  const innerBody = lines.length > 0 ? lines.join('\n') + '\n' + replyBlock : replyBlock;

  if (typeCheck) {
    return `${I}case ${typeCheck} of\n${I}    true ->\n${innerBody.split('\n').map(l => '        ' + l).join('\n')};\n${I}    false ->\n${I}        nomatch\n${I}end`;
  }
  return innerBody;
}

function genCamInit(ctx, actor) {
  const initBody = actor.initBody || [];
  const initParams = actor.initParams || [];
  const stateVarDecls = actor.stateVarDecls || [];

  const stateVarEnv = new Map(stateVarDecls.map(d => ['$' + d.name, d.typeName]));
  const typeEnv = buildTypeEnv(initParams, initBody);
  // Merge state var types into typeEnv
  for (const [k, v] of stateVarEnv) typeEnv.set(k, v);

  const I = '    ';
  const lines = [];
  lines.push(`handle_cam_init(Message) ->`);
  lines.push(`${I}Id = maps:get(<<"id">>, Message, <<>>),`);
  lines.push(`${I}From = maps:get(<<"from">>, Message, <<>>),`);

  if (initParams.length > 0) {
    lines.push(`${I}CamVal = maps:get(<<"cam">>, Message, null),`);
    lines.push(`${I}Payload = case CamVal of`);
    lines.push(`${I}    L when is_list(L), length(L) > 1 -> hd(L);`);
    lines.push(`${I}    _ -> #{}`);
    lines.push(`${I}end,`);
    const paramLines = genParamDestructure(initParams, I);
    lines.push(...paramLines);
  }

  // Generate init body statements (StateAssign, TypedAssign, etc.)
  const sCtx = { restVars: new Set(), refVars: new Set(), ssaEnv: buildSSAEnv(initBody) };
  const localLines = genLocals(ctx, initBody, typeEnv, sCtx, I);
  lines.push(...localLines);

  lines.push(`${I}put(bv_initialized_, true),`);
  lines.push(`${I}Resp = #{<<"id">> => Id, <<"re">> => <<"init">>, <<"to">> => From},`);
  lines.push(`${I}io:format("~s~n", [json_encode(Resp)]).`);

  return lines.join('\n');
}

function genChildHandleOp(ctx, actor) {
  const name = actor.name.toLowerCase();
  const prefix = `child_${name}`;
  const clauses = [];

  // Set emit names for this child actor
  const savedEmitNames = ctx.emitNames;
  ctx.emitNames = new Map();
  for (const s of (actor.constructorBody || [])) {
    if (s.type === 'EmitDecl') ctx.emitNames.set(s.name, s);
  }

  const childPublicFns = actor.functions.filter(f => f.name && (f.name.startsWith('@') || f.name.startsWith('::')));
  for (const h of childPublicFns) {
    const inner = genPublicFnInner(ctx, h, { skipTypeCheck: true });
    clauses.push(`${prefix}_handle_op(${erlString(h.name)}, _Message, Payload, _Id, _From) ->\n${inner}`);
  }

  // On-handler clauses
  const childOnHandlers = actor.functions.filter(f => f.type === 'OnHandler');
  for (const h of childOnHandlers) {
    const typeEnv = buildTypeEnv(h.params, h.body);
    const I = '    ';
    const hLines = [];
    const restVars = new Set();
    const refVars = new Set();
    const childActorRefs = new Map();
    const sCtx = { restVars, refVars, childActorRefs, ssaEnv: buildSSAEnv(h.body) };
    const paramLines = genParamDestructure(h.params, I);
    hLines.push(...paramLines);
    const localLines = genLocals(ctx, h.body, typeEnv, sCtx, I);
    hLines.push(...localLines);
    hLines.push(`${I}{ok, null, null}`);
    const innerBody = hLines.join('\n');
    // For constructs proxies, match from against the remote address stored in state
    const sourceIsRemote = ctx.remoteInstanceVars.has(h.source);
    if (sourceIsRemote) {
      clauses.push(`${prefix}_handle_op(${erlString(h.eventName)}, _Message, Payload, _Id, From) when From =:= get(state_${h.source}) ->\n${innerBody}`);
    } else {
      clauses.push(`${prefix}_handle_op(${erlString(h.eventName)}, _Message, Payload, _Id, <<"__emit">>) ->\n${innerBody}`);
    }
  }

  // Catch-all clause
  clauses.push(`${prefix}_handle_op(Op, _Message, _Payload, _Id, _From) ->\n    {error, Op}`);

  ctx.emitNames = savedEmitNames;
  return clauses.join(';\n') + '.';
}

function genChildInit(ctx, actor) {
  const name = actor.name.toLowerCase();
  const constructorParams = actor.initParams || [];
  const initBody = actor.initBody || [];

  const hasOnHandlers = actor.functions.some(f => f.type === 'OnHandler');
  if (constructorParams.length === 0 && initBody.length === 0 && !hasOnHandlers) return '';

  const I = '    ';
  const lines = [];
  lines.push(`child_${name}_init(Payload) ->`);

  // Destructure constructor params from Payload
  const paramLines = genParamDestructure(constructorParams, I);
  lines.push(...paramLines);

  // Store constructor params as state
  for (const p of constructorParams) {
    lines.push(`${I}put(state_${p.name}, ${erlVarName(p.name)}),`);
  }

  // Constructor body statements (state initialization)
  const typeEnv = buildTypeEnv(constructorParams, initBody);
  const sCtx = { restVars: new Set(), refVars: new Set(), ssaEnv: buildSSAEnv(initBody) };
  const localLines = genLocals(ctx, initBody, typeEnv, sCtx, I);
  lines.push(...localLines);

  // Subscribe to emits from wrapped children (on handlers)
  const onHandlers = actor.functions.filter(f => f.type === 'OnHandler');
  for (const h of onHandlers) {
    lines.push(`${I}subscribe_(${erlString(h.eventName)}, fun(_EvName, _EvPayload) -> child_${name}_handle_op(_EvName, #{}, _EvPayload, <<"0">>, <<"__emit">>) end),`);
  }

  lines.push(`${I}ok.`);

  return lines.join('\n');
}

function genChildActorCode(ctx, actors) {
  const sections = [];
  const savedStateVarNames = ctx.stateVarNames;
  let savedTypeEnv = ctx.stateVarTypeEnv;
  const savedRemoteInstanceVars = ctx.remoteInstanceVars;
  for (const [name, info] of ctx.actorInfo) {
    const actor = actors.find(a => a.name === name);
    if (!actor) continue;

    // Set state var names and type env for this child actor
    const childStateDecls = actor.stateVarDecls || [];
    const childParams = actor.initParams || [];
    ctx.stateVarNames = new Set([
      ...childStateDecls.map(v => v.name),
      ...childParams.map(p => p.name),
    ]);
    savedTypeEnv = ctx.stateVarTypeEnv;
    ctx.stateVarTypeEnv = new Map([
      ...childStateDecls.map(v => [v.name, v.typeName]),
      ...childParams.map(p => [p.name, p.type || 'Anything']),
    ]);
    // For constructs proxy children, bare params are remote instance refs
    ctx.remoteInstanceVars = new Set();
    const isConstructsProxy = [...ctx.constructsMap.values()].some(c => c.proxyName === name);
    if (isConstructsProxy) {
      for (const p of childParams) {
        if (p.type === 'Anything') ctx.remoteInstanceVars.add(p.name);
      }
    }

    // Generate private functions for child actor
    const childPrivateFns = actor.functions.filter(f => f.name && !f.name.startsWith('@') && !f.name.startsWith('::'));
    if (childPrivateFns.length > 0) {
      for (const f of childPrivateFns) {
        sections.push(genFn(ctx, f));
      }
    }

    // Generate init function
    const initFn = genChildInit(ctx, actor);
    if (initFn) sections.push(initFn);

    // Generate public function dispatch
    sections.push(genChildHandleOp(ctx, actor));
  }
  ctx.stateVarNames = savedStateVarNames;
  ctx.stateVarTypeEnv = savedTypeEnv;
  ctx.remoteInstanceVars = savedRemoteInstanceVars;

  // Generate child_dispatch routing function
  if (ctx.actorInfo.size > 0) {
    const dispatchClauses = [...ctx.actorInfo.keys()].map(name =>
      `child_dispatch(${erlString(name.toLowerCase())}, Op, Message, Payload, Id, From) ->\n    child_${name.toLowerCase()}_handle_op(Op, Message, Payload, Id, From)`
    );
    dispatchClauses.push('child_dispatch(_, Op, _Message, _Payload, _Id, _From) ->\n    {error, Op}');
    sections.push(dispatchClauses.join(';\n') + '.');
  }

  return sections.length > 0 ? '\n' + sections.join('\n\n') + '\n' : '';
}

function genLambdaHandlerInner(ctx, lName, lVarName, fnNode, captures) {
  const params = fnNode.params || [];
  const I = '    ';
  const lines = [];

  // Destructure params from Structure
  if (params.length > 0) {
    const hasPositional = params.some(p => p.positional && !p.rest);
    if (hasPositional) {
      lines.push(`${I}{S_pos, S_named} = structure_pack(Payload),`);
    }
    let posIdx = 0;
    for (const p of params) {
      if (p.positional) {
        lines.push(`${I}${erlVarName(p.name)} = lists:nth(${posIdx + 1}, S_pos),`);
        posIdx++;
      } else {
        const key = p.key || p.name;
        if (hasPositional) {
          lines.push(`${I}${erlVarName(p.name)} = maps:get(${erlString(key)}, S_named, null),`);
        } else {
          lines.push(`${I}${erlVarName(p.name)} = maps:get(${erlString(key)}, Payload, null),`);
        }
      }
    }
  }

  // Self-reference constant for recursive lambdas
  if (lVarName) {
    lines.push(`${I}${erlVarName(lVarName)} = <<"${lName}">>,`);
  }

  // Load captures from process dictionary
  if (captures && captures.length > 0) {
    for (const cap of captures) {
      lines.push(`${I}${erlVarName(cap.name)} = get('_cap_${cap.lambdaName}_${cap.name}'),`);
    }
  }

  // Generate body using genFn-style codegen
  const body = fnNode.body || [];
  const typeEnv = buildTypeEnv(params, body);
  const savedTypeEnv = ctx.currentTypeEnv;
  ctx.currentTypeEnv = typeEnv;

  if (body.length > 0) {
    const reply = body.find(s => s.type === 'Reply');
    const returnNode = body.find(s => s.type === 'Return');
    const implicitReturn = body.find(s => s.type === 'ImplicitReturn');
    const ssaEnv = buildSSAEnv(body);
    const sCtx = { restVars: new Set(), refVars: new Set(), childActorRefs: new Map(), ssaEnv };
    const localLines = genLocals(ctx, body, typeEnv, sCtx, I);
    lines.push(...localLines);

    if (reply) {
      const replyCtx = { ...sCtx, stmtIdx: body.length };
      const replyExpr = genReplyBody(ctx, reply.fields, typeEnv, replyCtx);
      const bvaExpr = genBvaBody(ctx, reply.fields, typeEnv);
      lines.push(`${I}Re = ${replyExpr},`);
      lines.push(`${I}{ok, Re, ${bvaExpr || 'null'}}`);
    } else if (returnNode) {
      const retCtx = { ...sCtx, stmtIdx: body.length };
      const replyExpr = genReplyBody(ctx, returnNode.fields, typeEnv, retCtx);
      const bvaExpr = genBvaBody(ctx, returnNode.fields, typeEnv);
      lines.push(`${I}Re = ${replyExpr},`);
      lines.push(`${I}{ok, Re, ${bvaExpr || 'null'}}`);
    } else if (implicitReturn) {
      const retCtx = { ...sCtx, stmtIdx: body.length };
      const retExpr = genExpr(ctx, implicitReturn.expr, typeEnv, retCtx);
      lines.push(`${I}{ok, [${retExpr}], null}`);
    } else if (fnNode.returnType === '.') {
      lines.push(`${I}{ok, null, null}`);
    } else {
      // Last typed assign as return value
      const bodyStmts = body.filter(s => s.type !== 'ImplicitReturn' && s.type !== 'Reply');
      if (bodyStmts.length > 0) {
        const last = bodyStmts[bodyStmts.length - 1];
        if (last.type === 'TypedAssign' || last.type === 'Assign') {
          const lastSSA = resolveSSAName(last.name, body.length, ssaEnv);
          lines.push(`${I}{ok, [${erlVarName(lastSSA)}], null}`);
        } else if (last.type === 'WhileStatement') {
          lines.push(`${I}{ok, [null], null}`);
        } else {
          lines.push(`${I}{ok, null, null}`);
        }
      } else {
        lines.push(`${I}{ok, null, null}`);
      }
    }
  } else if (fnNode.expr) {
    const retExpr = genExpr(ctx, fnNode.expr, typeEnv, { stmtIdx: 0 });
    if (fnNode.returnType === '.') {
      lines.push(`${I}${retExpr},`);
      lines.push(`${I}{ok, null, null}`);
    } else {
      lines.push(`${I}{ok, [${retExpr}], null}`);
    }
  } else {
    lines.push(`${I}{ok, null, null}`);
  }

  ctx.currentTypeEnv = savedTypeEnv;
  return lines.join('\n');
}

function genProgram(ctx, actor, allActors) {
  // Reset state for this program
  ctx.lambdaCounter = 0;
  ctx.sendCounter = 0;
  ctx.lambdaHandlers = [];
  ctx.lambdaVarNames = new Set();
  ctx.lambdaCaptureKeys = [];

  const _isPublic = f => f.name && (f.name.startsWith('@') || f.name.startsWith('::'));
  const isFnDecl = f => f.type === 'FunctionDecl';
  const privateFns = actor.functions.filter(f => isFnDecl(f) && !_isPublic(f));
  const publicFns = actor.functions.filter(f => isFnDecl(f) && _isPublic(f));
  const onHandlers = actor.functions.filter(f => f.type === 'OnHandler');

  // Collect emit declarations from constructorBody
  const emitDecls = new Map();
  for (const s of (actor.constructorBody || [])) {
    if (s.type === 'EmitDecl') emitDecls.set(s.name, s);
  }
  ctx.emitNames = emitDecls;
  const hasFns = privateFns.length > 0;
  const stateVarDecls = actor.stateVarDecls || [];
  const constructorParams = actor.initParams || [];
  const allStateNames = [
    ...stateVarDecls.map(v => v.name),
    ...constructorParams.map(p => p.name),
  ];
  const isStateful = allStateNames.length > 0;
  ctx.stateVarNames = new Set(allStateNames);
  ctx.remoteInstanceVars = new Set();
  ctx.constructsProxyVars = new Set();
  ctx.constructsVarToProxy = new Map();
  const initBody = actor.initBody || [];
  for (const s of initBody) {
    if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.usesNames.has(s.value.callee.name)) {
      const cDecl = ctx.constructsMap.get(s.value.callee.name);
      if (!cDecl) {
        ctx.remoteInstanceVars.add(s.name);
      } else {
        ctx.constructsProxyVars.add(s.name);
        ctx.constructsVarToProxy.set(s.name, cDecl.proxyName.toLowerCase());
      }
    }
  }
  // Constructs proxy: bare params in proxy child actor are remote instance refs
  const isConstructsProxy = [...ctx.constructsMap.values()].some(c => c.proxyName === actor.name);
  if (isConstructsProxy) {
    for (const p of (actor.initParams || [])) {
      if (p.type === 'Anything') ctx.remoteInstanceVars.add(p.name);
    }
  }
  ctx.stateVarTypeEnv = new Map([
    ...stateVarDecls.map(v => [v.name, v.typeName]),
    ...constructorParams.map(p => [p.name, p.type || 'Anything']),
  ]);

  // Generate child actor code
  const childActorSection = genChildActorCode(ctx, allActors);

  // Generate all function dispatch clauses (public + private via self-send)
  const allClauses = genDispatch(ctx, [...publicFns, ...privateFns]);

  // Generate lambda handler clauses (registered during codegen above)
  // Use index loop since nested lambdas may add new handlers during iteration
  for (let li = 0; li < ctx.lambdaHandlers.length; li++) {
    const lh = ctx.lambdaHandlers[li];
    const { name: lName, varName: lVarName, fn: fnNode, captures } = lh;
    const inner = genLambdaHandlerInner(ctx, lName, lVarName, fnNode, captures);
    // Insert before the catch-all clause (last element)
    allClauses.splice(allClauses.length - 1, 0,
      `handle_op(<<"${lName}">>, _Message, Payload, _Id, _From) ->\n${inner}`
    );
  }

  // Generate on-handler dispatch clauses
  for (const h of onHandlers) {
    const typeEnv = buildTypeEnv(h.params, h.body);
    const I = '    ';
    const lines = [];
    const restVars = new Set();
    const refVars = new Set();
    const childActorRefs = new Map();
    const sCtx = { restVars, refVars, childActorRefs, ssaEnv: buildSSAEnv(h.body) };
    const paramLines = genParamDestructure(h.params, I);
    lines.push(...paramLines);
    const localLines = genLocals(ctx, h.body, typeEnv, sCtx, I);
    lines.push(...localLines);
    const hasSilent = h.body.some(s => s.type === 'SilentTerminator');
    let replyBlock;
    if (!hasSilent) {
      const reply = h.body.find(s => s.type === 'Reply');
      if (reply) {
        const replyCtx = { ...sCtx, stmtIdx: h.body.length };
        replyBlock = `${I}Re = ${genReplyBody(ctx, reply.fields, typeEnv, replyCtx)},\n${I}{ok, Re, null}`;
      } else {
        replyBlock = `${I}{ok, null, null}`;
      }
    } else {
      replyBlock = `${I}{ok, null, null}`;
    }
    const innerBody = lines.length > 0 ? lines.join('\n') + '\n' + replyBlock : replyBlock;
    allClauses.splice(allClauses.length - 1, 0,
      `handle_op(${erlString(h.eventName)}, Message, Payload, _Id, <<"__emit">>) ->\n${innerBody}`
    );
  }

  // Generate private function defs
  const fnDefs = hasFns ? privateFns.map(f => genFn(ctx, f)) : [];

  // Generate state initialization lines (run at startup before read_loop)
  const stateInitLines = [];
  for (const v of stateVarDecls) {
    if (v.isRef && actor.initBody) {
      const initStmt = actor.initBody.find(s => s.name === v.name);
      if (initStmt) {
        if (ctx.remoteInstanceVars.has(v.name) || ctx.constructsProxyVars.has(v.name)) {
          // Remote construction: send ::new, read reply, extract from
          const callee = initStmt.value.callee.name;
          const positionalArgs = initStmt.value.args.filter(a => a.type !== 'NamedArgsBag');
          const namedBag = initStmt.value.args.find(a => a.type === 'NamedArgsBag');
          let argsExpr;
          if (positionalArgs.length === 0 && !namedBag) {
            argsExpr = '#{}';
          } else if (namedBag) {
            const fields = Object.entries(namedBag.fields).map(([k, v]) => `${erlString(k)} => ${genExpr(ctx, v, new Map(), {})}`).join(', ');
            if (positionalArgs.length > 0) {
              argsExpr = `[${positionalArgs.map(a => genExpr(ctx, a, new Map(), {})).join(', ')}, #{${fields}}]`;
            } else {
              argsExpr = `#{${fields}}`;
            }
          } else {
            argsExpr = `[${positionalArgs.map(a => genExpr(ctx, a, new Map(), {})).join(', ')}]`;
          }
          stateInitLines.push(`    New_seq_${v.name} = case get(send_seq_) of undefined -> 1; New_n_${v.name} -> New_n_${v.name} end`);
          stateInitLines.push(`    put(send_seq_, New_seq_${v.name} + 1)`);
          stateInitLines.push(`    New_id_${v.name} = integer_to_binary(New_seq_${v.name})`);
          stateInitLines.push(`    New_msg_${v.name} = #{<<"id">> => New_id_${v.name}, <<"op">> => [${argsExpr}, <<"::new">>], <<"to">> => ${erlString(callee)}}`);
          stateInitLines.push(`    io:format("~s~n", [json_encode(New_msg_${v.name})])`);
          stateInitLines.push(`    put(pending_new_${v.name}, New_id_${v.name})`);
          stateInitLines.push(`    put(state_${v.name}, null)`);
        } else {
          const val = genExpr(ctx, initStmt.value, new Map(), {});
          stateInitLines.push(`    put(state_${v.name}, ${val})`);
        }
      }
    }
  }
  for (const p of constructorParams) {
    stateInitLines.push(`    put(state_${p.name}, null)`);
  }

  // Capture function — serializes actor state
  const captureFields = allStateNames.map(n => `${erlString(n)} => get(state_${n})`).join(', ');
  const captureFn = `capture() ->
    #{${captureFields}}.`;

  // Hydrate function — restores actor state from captured data
  const hydrateLines = allStateNames.map(n =>
    `    case maps:find(${erlString(n)}, State) of {ok, V_${n}} -> put(state_${n}, V_${n}); error -> ok end`
  );
  const hydrateFn = allStateNames.length > 0
    ? `hydrate(State) ->\n${hydrateLines.join(',\n')}.`
    : `hydrate(_State) ->\n    ok.`;

  // Test harness function — get/set/update/op
  const stateTypeMap = new Map([
    ...stateVarDecls.map(v => [v.name, v.typeName]),
    ...constructorParams.map(p => [p.name, p.type || 'Anything']),
  ]);
  const testGetClauses = allStateNames.map(n =>
    `        ${erlString(n)} -> get(state_${n})`
  ).join(';\n');
  const testTypeClauses = allStateNames.map(n =>
    `        ${erlString(n)} -> ${erlString(stateTypeMap.get(n) || 'Anything')}`
  ).join(';\n');
  const testFn = `handle_test(Test, Message) ->
    Id = maps:get(<<"id">>, Message, <<>>),
    From = maps:get(<<"from">>, Message, <<>>),
    case maps:find(<<"get">>, Test) of
        {ok, Name} ->
            RawVal = case Name of
${testGetClauses || '                _ -> null'};
                _ -> null
            end,
            Val = RawVal,
            BvType = case Name of
${testTypeClauses || '                _ -> null'};
                _ -> null
            end,
            Resp0 = #{<<"id">> => Id, <<"re">> => Val, <<"to">> => From},
            Resp = case BvType of null -> Resp0; _ -> Resp0#{<<"bv-a">> => BvType} end,
            io:format("~s~n", [json_encode(Resp)]);
        error ->
    case maps:find(<<"set">>, Test) of
        {ok, SetVal} ->
            SetPayload = case SetVal of
                L when is_list(L) -> L;
                M when is_map(M) -> M;
                _ -> [SetVal]
            end,
            handle_op(<<"::set">>, #{}, SetPayload, Id, <<"__test">>),
            ok;
        error ->
    case maps:find(<<"update">>, Test) of
        {ok, UpdVal} ->
            UpdPayload = case is_list(UpdVal) of true -> UpdVal; false -> case is_map(UpdVal) of true -> UpdVal; false -> [UpdVal] end end,
            handle_op(<<"::update">>, #{}, UpdPayload, Id, <<"__test">>),
            ok;
        error ->
    case maps:find(<<"op">>, Test) of
        {ok, Op} ->
            {OpName, Payload} = case Op of
                S when is_binary(S) -> {S, #{}};
                L when is_list(L) -> {lists:last(L), if length(L) > 1 -> hd(L); true -> #{} end}
            end,
            Result3 = handle_op(OpName, #{}, Payload, Id, <<"__test">>),
            handle_result(Result3, Id, From, OpName);
        error -> ok
    end end end end.`;

  // Op dispatch function
  const opDispatchName = 'dispatch';
  // Remote route check for constructs proxies
  const remoteRouteCheck = ctx.constructsProxyVars.size > 0
    ? `    case get({remote_route, From}) of
        undefined -> ok;
        ChildName ->
            child_dispatch(ChildName, OpName, Message, Payload, Id, From),
            done
    end`
    : null;

  const dispatchInner = remoteRouteCheck
    ? `    case get({remote_route, From}) of
        undefined ->
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
            end;
        ChildName ->
            child_dispatch(ChildName, OpName, Message, Payload, Id, From)
    end`
    : `    HasPayload = case Payload of
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
    end`;

  const dispatchBody = `${opDispatchName}(Message) ->
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
${dispatchInner}.

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

  const statefulDispatch = '';

  // Generate and add on-handler subscription init lines
  const onInitLines = onHandlers.map(h => {
    return `    subscribe_(${erlString(h.eventName)}, fun(_EvName, _EvPayload) -> handle_op(_EvName, #{}, _EvPayload, <<"0">>, <<"__emit">>) end)`;
  });
  stateInitLines.push(...onInitLines);
  const stateInitSection = stateInitLines.length > 0
    ? stateInitLines.join(',\n') + ',\n'
    : '';
  // Generate ::new reply handling for remote instance vars and constructs proxy vars
  const allNewVars = new Set([...ctx.remoteInstanceVars, ...ctx.constructsProxyVars]);
  let newReplyHandler = '{ok, _} -> ok';
  if (allNewVars.size > 0) {
    const checks = [...allNewVars].map(name => {
      if (ctx.constructsProxyVars.has(name)) {
        // Constructs proxy: store address, init child, register remote route
        const cDecl = [...ctx.constructsMap.values()].find(c => {
          // Find the constructs decl whose factory was used to init this var
          const initStmt = initBody.find(s => s.name === name);
          return initStmt && c.factory === initStmt.value?.callee?.name;
        });
        const proxyName = cDecl ? cDecl.proxyName : name;
        const childPrefix = `child_${proxyName.toLowerCase()}`;
        return `case get(pending_new_${name}) of
                                ReplyId_${name} when ReplyId_${name} =:= Re_msg_id_ ->
                                    Addr_${name} = maps:get(<<"from">>, Message, null),
                                    put(state_${name}, Addr_${name}),
                                    ${childPrefix}_init([Addr_${name}]),
                                    put({remote_route, Addr_${name}}, ${erlString(proxyName.toLowerCase())}),
                                    erase(pending_new_${name});
                                _ -> ok
                            end`;
      }
      return `case get(pending_new_${name}) of
                                ReplyId_${name} when ReplyId_${name} =:= Re_msg_id_ ->
                                    put(state_${name}, maps:get(<<"from">>, Message, null)),
                                    erase(pending_new_${name});
                                _ -> ok
                            end`;
    });
    newReplyHandler = `{ok, _} ->\n                            Re_msg_id_ = maps:get(<<"id">>, Message, <<>>),\n                            ${checks.join(',\n                            ')}`;
  }
  const mainLoop = `main() ->
${stateInitSection}    read_loop().

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
                        ${newReplyHandler};
                        error ->
                            case maps:get(<<"cam">>, Message, null) of
                                <<"capture">> ->
                                    Id = maps:get(<<"id">>, Message, <<>>),
                                    From = maps:get(<<"from">>, Message, <<>>),
                                    Resp = #{<<"id">> => Id, <<"re">> => capture(), <<"to">> => From},
                                    io:format("~s~n", [json_encode(Resp)]);
                                CamList when is_list(CamList) ->
                                    case lists:last(CamList) of
                                        <<"hydrate">> ->
                                            Id = maps:get(<<"id">>, Message, <<>>),
                                            From = maps:get(<<"from">>, Message, <<>>),
                                            State = hd(CamList),
                                            hydrate(State),
                                            Resp = #{<<"id">> => Id, <<"re">> => <<"hydrate">>, <<"to">> => From},
                                            io:format("~s~n", [json_encode(Resp)]);
                                        _ -> dispatch(Message)
                                    end;
                                _ ->
                            case maps:get(<<"test">>, Message, null) of
                                null -> dispatch(Message);
                                Test -> handle_test(Test, Message)
                            end
                            end
                    end,
                    read_loop()
            end
    end.`;

  const fnSection = fnDefs.length > 0 ? '\n' + fnDefs.join('\n\n') + '\n' : '';

  // Separate handle_op clauses from pub_*/priv_* helper functions
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

  // self_send helper — routes through dispatch, returns Structure
  const needsSelfSend = privateFns.length > 0 || ctx.lambdaHandlers.length > 0;
  const selfSendFn = needsSelfSend ? `
self_send(OpName, Payload) ->
    {ok, Re, _Bva} = handle_op(OpName, #{}, Payload, <<"0">>, <<"__self">>),
    structure_pack(Re).
` : '';

  const hasEmits = emitDecls.size > 0 || allActors.some(a => (a.constructorBody || []).some(s => s.type === 'EmitDecl'));
  const emitFns = hasEmits ? `
subscribe_(Event, Callback) ->
    Subs = case get({emit_subs, Event}) of undefined -> []; S -> S end,
    put({emit_subs, Event}, [Callback|Subs]).

emit_(Event, Payload) ->
    Subs = case get({emit_subs, Event}) of undefined -> []; S -> S end,
    lists:foreach(fun(Cb) -> Cb(Event, Payload) end, Subs),
    null.
` : '';


  return `-module(brevity_actor).
-export([main/0]).
${PREAMBLE}
${fnSection}${childActorSection}${helperSection}
${handleOpClauses.join(';\n')}.

${selfSendFn}${emitFns}
${captureFn}

${hydrateFn}

${testFn}

${statefulDispatch}${dispatchFinal}

${mainLoop}
`;
}

export function codegenErlang(ast) {
  const active = ast.actors.filter(a => a.functions.some(f => f.name && (f.name.startsWith('@') || f.name.startsWith('::'))));
  if (active.length === 0) return '';

  const ctx = createErlContext();
  // Set up child actor info
  ctx.actorInfo = new Map();
  ctx.ephCounter = 0;
  for (const a of active) {
    if (a.name) {
      ctx.actorInfo.set(a.name, { actor: a, asClauses: a.asClauses || [] });
    }
  }

  ctx.usesNames = new Set((ast.useDecls || []).map(u => u.name));
  // Build constructs map: factory name → ConstructsDecl
  ctx.constructsMap = new Map();
  for (const c of (ast.constructsDecls || [])) {
    ctx.constructsMap.set(c.factory, c);
  }
  const mainActor = active.find(a => !a.name) || active[0];
  const _isPrivate = f => f.name && !f.name.startsWith('@') && !f.name.startsWith('::');
  ctx.actorFnNames = new Set(mainActor.functions.filter(_isPrivate).map(f => f.name));
  for (const a of active) {
    a.functions.filter(_isPrivate).forEach(f => ctx.actorFnNames.add(f.name));
  }
  return genProgram(ctx, mainActor, active);
}
