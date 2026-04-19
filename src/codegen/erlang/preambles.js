// ── Preamble constants and pure utilities for Erlang codegen ─────────────────

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
json_escape(<<C/utf8, R/binary>>, Acc) when C > 127 ->
    json_escape(R, [unicode:characters_to_binary([C])|Acc]);
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
    match_types_positional(Message, PosTypes, NamedTypes, length(PosTypes)).

match_types_positional(Message, PosTypes, NamedTypes, MinPos) ->
    case maps:find(<<"bv-a">>, Message) of
        {ok, BvA} when is_list(BvA), length(BvA) > 0 ->
            TypesArr = hd(BvA),
            case is_list(TypesArr) of
                true ->
                    PosCount = length([X || X <- TypesArr, not is_map(X)]),
                    PosOk = PosCount >= MinPos andalso PosCount =< length(PosTypes) andalso match_pos_types(TypesArr, lists:sublist(PosTypes, PosCount), 0),
                    NamedOk = case NamedTypes of
                        [] -> true;
                        _ ->
                            case lists:last(TypesArr) of
                                M when is_map(M) ->
                                    lists:all(fun({N, T}) ->
                                        case maps:find(N, M) of
                                            {ok, T} -> true;
                                            error -> true;
                                            _ -> false
                                        end
                                    end, NamedTypes);
                                _ -> true
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

brevity_scalar_size(Bin) when is_binary(Bin) ->
    length(unicode:characters_to_list(Bin)).

brevity_blob_first(<<>>) -> <<>>;
brevity_blob_first(<<B, _/binary>>) -> <<B>>.

brevity_blob_last(<<>>) -> <<>>;
brevity_blob_last(Bin) -> <<(binary:last(Bin))>>.

brevity_blob_reverse(Bin) ->
    brevity_blob_reverse(Bin, <<>>).
brevity_blob_reverse(<<>>, Acc) -> Acc;
brevity_blob_reverse(<<B, Rest/binary>>, Acc) ->
    brevity_blob_reverse(Rest, <<B, Acc/binary>>).

brevity_blob_index_of(Bin, Sub) ->
    case binary:match(Bin, Sub) of
        {Pos, _} -> Pos;
        nomatch -> -1
    end.

brevity_blob_trim(Bin) ->
    brevity_blob_trim_end(brevity_blob_trim_start(Bin)).
brevity_blob_trim_start(<<C, Rest/binary>>) when C =:= $\\s; C =:= $\\t; C =:= $\\n; C =:= $\\r ->
    brevity_blob_trim_start(Rest);
brevity_blob_trim_start(Bin) -> Bin.
brevity_blob_trim_end(<<>>) -> <<>>;
brevity_blob_trim_end(Bin) ->
    case binary:last(Bin) of
        C when C =:= $\\s; C =:= $\\t; C =:= $\\n; C =:= $\\r ->
            brevity_blob_trim_end(binary:part(Bin, 0, byte_size(Bin) - 1));
        _ -> Bin
    end.

brevity_text_first(<<>>) -> <<>>;
brevity_text_first(Bin) ->
    [H|_] = unicode:characters_to_list(Bin),
    unicode:characters_to_binary([H]).

brevity_text_last(<<>>) -> <<>>;
brevity_text_last(Bin) ->
    L = unicode:characters_to_list(Bin),
    unicode:characters_to_binary([lists:last(L)]).

brevity_text_slice(Bin, Start) ->
    L = unicode:characters_to_list(Bin),
    unicode:characters_to_binary(lists:nthtail(Start, L)).
brevity_text_slice(Bin, Start, End) ->
    L = unicode:characters_to_list(Bin),
    unicode:characters_to_binary(lists:sublist(L, Start + 1, End - Start)).

brevity_text_contains(Bin, Sub) ->
    binary:match(Bin, Sub) =/= nomatch.

brevity_text_starts_with(Bin, Prefix) ->
    N = byte_size(Prefix),
    case Bin of <<Prefix:N/binary, _/binary>> -> true; _ -> false end.

brevity_text_ends_with(Bin, Suffix) ->
    N = byte_size(Suffix),
    S = byte_size(Bin) - N,
    case S >= 0 of true -> binary:part(Bin, S, N) =:= Suffix; false -> false end.

brevity_text_index_of(Bin, Sub) ->
    case binary:match(Bin, Sub) of
        {Pos, _} -> length(unicode:characters_to_list(binary:part(Bin, 0, Pos)));
        nomatch -> -1
    end.

brevity_text_before(Bin, Sub) ->
    case binary:match(Bin, Sub) of
        {Pos, _} -> binary:part(Bin, 0, Pos);
        nomatch -> Bin
    end.

brevity_text_after(Bin, Sub) ->
    case binary:match(Bin, Sub) of
        {Pos, Len} -> binary:part(Bin, Pos + Len, byte_size(Bin) - Pos - Len);
        nomatch -> <<>>
    end.

brevity_re_match(Bin, Re) ->
    case re:run(Bin, Re) of {match, _} -> true; nomatch -> false end.

brevity_re_starts_with(Bin, Re) ->
    case re:run(Bin, Re, [{offset, 0}]) of
        {match, [{0, _}|_]} -> true;
        _ -> false
    end.

brevity_re_ends_with(Bin, Re) ->
    case re:run(Bin, Re) of
        {match, [{Pos, Len}|_]} -> Pos + Len =:= byte_size(Bin);
        nomatch -> false
    end.

brevity_re_index_of(Bin, Re) ->
    case re:run(Bin, Re) of
        {match, [{Pos, _}|_]} -> length(unicode:characters_to_list(binary:part(Bin, 0, Pos)));
        nomatch -> -1
    end.

brevity_re_before(Bin, Re) ->
    case re:run(Bin, Re) of
        {match, [{Pos, _}|_]} -> binary:part(Bin, 0, Pos);
        nomatch -> Bin
    end.

brevity_re_after(Bin, Re) ->
    case re:run(Bin, Re) of
        {match, [{Pos, Len}|_]} -> binary:part(Bin, Pos + Len, byte_size(Bin) - Pos - Len);
        nomatch -> <<>>
    end.

await_response_(Id) ->
    case io:get_line("") of
        eof -> null;
        {error, _} -> null;
        Line ->
            Bin = unicode:characters_to_binary(string:trim(Line)),
            Message = json_decode(Bin),
            MsgId = maps:get(<<"id">>, Message, <<>>),
            case maps:find(<<"re">>, Message) of
                {ok, Re} when MsgId =:= Id -> Re;
                {ok, _} -> await_response_(Id);
                error ->
                    case maps:find(<<"ex">>, Message) of
                        {ok, _Ex} when MsgId =:= Id -> error({ex_response, Message});
                        _ ->
                            dispatch(Message),
                            await_response_(Id)
                    end
            end
    end.

await_new_response_(Id) ->
    case io:get_line("") of
        eof -> null;
        {error, _} -> null;
        Line ->
            Bin = unicode:characters_to_binary(string:trim(Line)),
            Message = json_decode(Bin),
            MsgId = maps:get(<<"id">>, Message, <<>>),
            case maps:find(<<"re">>, Message) of
                {ok, Re} when MsgId =:= Id ->
                    case Re of
                        <<$\`, Rest/binary>> ->
                            Len = byte_size(Rest) - 1,
                            <<Addr:Len/binary, $\`>> = Rest,
                            Addr;
                        _ -> maps:get(<<"from">>, Message, null)
                    end;
                {ok, _} -> await_new_response_(Id);
                error ->
                    case maps:find(<<"ex">>, Message) of
                        {ok, _} when MsgId =:= Id -> null;
                        _ ->
                            dispatch(Message),
                            await_new_response_(Id)
                    end
            end
    end.
`;

// Reserved names used in generated Erlang dispatch code — user vars must not collide
const RESERVED_ERL_VARS = new Set([
  'Message', 'Payload', 'Id', 'From', 'OpVal', 'OpName', 'HasPayload',
  'Result', 'Re', 'Resp', 'Resp0', 'Ex', 'BvaRe', 'BvaFirst',
  'S_pos', 'S_named', 'Args_pos', 'Args_named',
]);

function erlVarName(name) {
  // Erlang vars must start uppercase. camelCase → CamelCase, snake_case → Snake_case
  if (!name) return '_';
  // Private function names (#name) → Pv_name (# is not valid in Erlang identifiers)
  if (name.startsWith('#')) name = 'pv_' + name.slice(1);
  const base = name.charAt(0).toUpperCase() + name.slice(1);
  if (RESERVED_ERL_VARS.has(base)) return 'V_' + base;
  return base;
}

function erlString(s) {
  // Erlang binary string literal with UTF-8 encoding
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `<<"${escaped}"/utf8>>`;
}

function isListOfAnythingType(t) {
  return t === 'List' || t === 'List of Anything';
}

function erlStateKey(ctx, name) {
  if (!ctx.childStatePrefix) return `state_${name}`;
  if (ctx.childConstructorParams && ctx.childConstructorParams.has(name)) return `state_${name}`;
  return `state_${ctx.childStatePrefix}_${name}`;
}

export { PREAMBLE, RESERVED_ERL_VARS, erlVarName, erlString, isListOfAnythingType, erlStateKey };
