// ── Preamble constants and pure utilities for Erlang codegen ─────────────────

const PREAMBLE = `
%% ── Slice 12+13 wire format helpers ──────────────────────────────────────
%% Outbound: strip __type from a tagged structure and reshape to wire form.
%% Inbound: reconstruct a tagged structure from a positional list or named
%% map given the type tag (::Name) and declared fields.
bv_to_wire(V, _Fields, _AllRequired) when not is_map(V) -> V;
bv_to_wire(V, Fields, AllRequired) ->
    case maps:is_key(<<"__type">>, V) of
        false -> V;
        true ->
            case AllRequired of
                true -> [maps:get(F, V, null) || F <- Fields];
                false ->
                    lists:foldl(fun(F, Acc) ->
                        case maps:get(F, V, undefined) of
                            undefined -> Acc;
                            null -> Acc;
                            Val -> Acc#{F => Val}
                        end
                    end, #{}, Fields)
            end
    end.

bv_from_wire(<<"::", Name/binary>>, Payload, Fields) when is_list(Payload) ->
    PLen = length(Payload),
    FLen = length(Fields),
    N = if PLen < FLen -> PLen; true -> FLen end,
    Pairs = lists:zip(lists:sublist(Fields, N), lists:sublist(Payload, N)),
    Base = #{<<"__type">> => Name},
    lists:foldl(fun({F, V}, Acc) -> Acc#{F => V} end, Base, Pairs);
bv_from_wire(<<"::", Name/binary>>, Payload, Fields) when is_map(Payload) ->
    Base = #{<<"__type">> => Name},
    lists:foldl(fun(F, Acc) ->
        case maps:get(F, Payload, undefined) of
            undefined -> Acc;
            V -> Acc#{F => V}
        end
    end, Base, Fields);
bv_from_wire(_Tag, Payload, _Fields) -> Payload.

%% ── Integer exponentiation ──────────────────────────────────────────────────
bv_pow(_, 0) -> 1;
bv_pow(Base, Exp) when Exp > 0 ->
    bv_pow(Base, Exp, 1).
bv_pow(_, 0, Acc) -> Acc;
bv_pow(Base, Exp, Acc) when Exp rem 2 =:= 0 ->
    bv_pow(Base * Base, Exp div 2, Acc);
bv_pow(Base, Exp, Acc) ->
    bv_pow(Base, Exp - 1, Acc * Base).

%% ── Float helpers ──────────────────────────────────────────────────────
bv_to_float(V) when is_float(V) -> V;
bv_to_float(V) when is_integer(V) -> float(V).

bv_float_rem(A, B) ->
    math:fmod(A, B).

%% Generic / — types unknown at codegen, dispatch by runtime tag using the
%% same promotion rule as the static path: Float > Decimal > Integer.
bv_div(A, B) when is_float(A); is_float(B) -> bv_to_float(A) / bv_to_float(B);
bv_div({bv_decimal, _, _} = A, B) -> bv_dec_op(A, '/', B);
bv_div(A, {bv_decimal, _, _} = B) -> bv_dec_op(A, '/', B);
bv_div(A, B) when is_integer(A), is_integer(B) -> A div B.

bv_dec_to_float({bv_decimal, C, S}) ->
    C / math:pow(10, S).

bv_dec_to_int({bv_decimal, C, 0}) -> C;
bv_dec_to_int({bv_decimal, C, S}) ->
    D = bv_pow(10, S),
    case C >= 0 of true -> C div D; false -> -((-C) div D) end.

%% ── Math helpers ───────────────────────────────────────────────────────
bv_math_ceil(X) ->
    T = trunc(X),
    case X > 0 andalso X > float(T) of true -> T + 1; false -> T end.

bv_math_floor(X) ->
    T = trunc(X),
    case X < 0 andalso X < float(T) of true -> T - 1; false -> T end.

bv_sign(X) when X > 0 -> 1;
bv_sign(X) when X < 0 -> -1;
bv_sign(_) -> 0.

bv_dec_abs({bv_decimal, C, S}) -> {bv_decimal, abs(C), S}.
bv_dec_sign({bv_decimal, C, _S}) when C > 0 -> 1;
bv_dec_sign({bv_decimal, C, _S}) when C < 0 -> -1;
bv_dec_sign({bv_decimal, _, _}) -> 0.
bv_dec_min(A, B) -> case bv_dec_op(A, '<', B) of true -> A; false -> B end.
bv_dec_max(A, B) -> case bv_dec_op(A, '>', B) of true -> A; false -> B end.

bv_dec_divide({bv_decimal, AC, AS}, {bv_decimal, _BC, BS}, Prec) ->
    Needed = Prec + BS - AS,
    Num = if Needed > 0 -> AC * bv_pow(10, Needed); Needed < 0 -> AC div bv_pow(10, -Needed); true -> AC end,
    RC = Num div _BC,
    {bv_decimal, RC, Prec}.

%% ── Decimal arithmetic ──────────────────────────────────────────────────
%% Representation: {bv_decimal, Coefficient :: integer(), Scale :: non_neg_integer()}
%% e.g. 3.14 = {bv_decimal, 314, 2}

bv_dec_from_number(V) when is_integer(V) -> {bv_decimal, V, 0};
bv_dec_from_number(V) when is_float(V) ->
    S = float_to_binary(V, [short]),
    case binary:match(S, <<".">>) of
        nomatch -> {bv_decimal, round(V), 0};
        {Pos, _} ->
            Frac = byte_size(S) - Pos - 1,
            IntPart = binary:part(S, 0, Pos),
            FracPart = binary:part(S, Pos + 1, Frac),
            Coeff = binary_to_integer(<<IntPart/binary, FracPart/binary>>),
            {bv_decimal, Coeff, Frac}
    end;
bv_dec_from_number({bv_decimal, C, S}) -> {bv_decimal, C, S}.

bv_dec_to_number({bv_decimal, C, 0}) -> C;
bv_dec_to_number({bv_decimal, C, S}) ->
    %% Strip trailing zeros first
    {C2, S2} = bv_dec_strip_zeros(C, S),
    case S2 of
        0 -> C2;
        _ ->
            Sign = case C2 < 0 of true -> <<"-">>; false -> <<>> end,
            Abs = abs(C2),
            AbsStr = integer_to_binary(Abs),
            Len = byte_size(AbsStr),
            FloatStr = if
                S2 >= Len ->
                    Zeros = binary:copy(<<"0">>, S2 - Len),
                    <<Sign/binary, "0.", Zeros/binary, AbsStr/binary>>;
                true ->
                    IntPart = binary:part(AbsStr, 0, Len - S2),
                    FracPart = binary:part(AbsStr, Len - S2, S2),
                    <<Sign/binary, IntPart/binary, ".", FracPart/binary>>
            end,
            binary_to_float(FloatStr)
    end.

bv_dec_to_iodata(C, 0) -> integer_to_binary(C);
bv_dec_to_iodata(C, S) ->
    Sign = case C < 0 of true -> <<"-">>; false -> <<>> end,
    Abs = abs(C),
    AbsStr = integer_to_binary(Abs),
    Len = byte_size(AbsStr),
    if
        S >= Len ->
            Zeros = binary:copy(<<"0">>, S - Len),
            <<Sign/binary, "0.", Zeros/binary, AbsStr/binary>>;
        true ->
            IntPart = binary:part(AbsStr, 0, Len - S),
            FracPart = binary:part(AbsStr, Len - S, S),
            <<Sign/binary, IntPart/binary, ".", FracPart/binary>>
    end.

bv_dec_align({bv_decimal, C1, S1}, {bv_decimal, C2, S2}) when S1 =:= S2 -> {C1, C2, S1};
bv_dec_align({bv_decimal, C1, S1}, {bv_decimal, C2, S2}) when S1 > S2 ->
    {C1, C2 * bv_pow(10, S1 - S2), S1};
bv_dec_align({bv_decimal, C1, S1}, {bv_decimal, C2, S2}) ->
    {C1 * bv_pow(10, S2 - S1), C2, S2}.

bv_dec_add(A, B) ->
    {C1, C2, S} = bv_dec_align(bv_dec_ensure(A), bv_dec_ensure(B)),
    {bv_decimal, C1 + C2, S}.
bv_dec_sub(A, B) ->
    {C1, C2, S} = bv_dec_align(bv_dec_ensure(A), bv_dec_ensure(B)),
    {bv_decimal, C1 - C2, S}.
bv_dec_mul(A0, B0) ->
    {bv_decimal, C1, S1} = bv_dec_ensure(A0),
    {bv_decimal, C2, S2} = bv_dec_ensure(B0),
    {bv_decimal, C1 * C2, S1 + S2}.
bv_dec_rem(A, B) ->
    {C1, C2, S} = bv_dec_align(bv_dec_ensure(A), bv_dec_ensure(B)),
    {bv_decimal, C1 - (C1 div C2) * C2, S}.

bv_dec_div_exact(A0, B0) ->
    {bv_decimal, Num, NS} = bv_dec_ensure(A0),
    {bv_decimal, Den, DS} = bv_dec_ensure(B0),
    case Den of
        0 -> error(decimal_division_by_zero);
        _ -> ok
    end,
    case Num of
        0 -> {bv_decimal, 0, 0};
        _ ->
            AbsNum = abs(Num), AbsDen = abs(Den),
            G = bv_gcd(AbsNum, AbsDen),
            ReducedDen = AbsDen div G,
            %% Check termination: reduced denominator must have only factors 2 and 5
            D1 = bv_remove_factor(ReducedDen, 2),
            D2 = bv_remove_factor(D1, 5),
            case D2 of
                1 ->
                    Sign = case (Num < 0) xor (Den < 0) of true -> -1; false -> 1 end,
                    bv_dec_long_div(AbsNum, AbsDen, NS, DS, Sign);
                _ -> error(non_terminating_decimal_division)
            end
    end.

bv_dec_long_div(Num, Den, NS, DS, Sign) ->
    {RC, Extra} = bv_dec_extend(Num, Den, 0),
    RS0 = NS + Extra - DS,
    {RC2, RS2} = if RS0 < 0 -> {RC * bv_pow(10, -RS0), 0}; true -> {RC, RS0} end,
    {RC3, RS3} = bv_dec_strip_zeros(RC2, RS2),
    {bv_decimal, Sign * RC3, RS3}.

bv_dec_extend(Num, Den, Extra) ->
    case Num rem Den of
        0 -> {Num div Den, Extra};
        _ -> bv_dec_extend(Num * 10, Den, Extra + 1)
    end.

bv_dec_strip_zeros(C, 0) -> {C, 0};
bv_dec_strip_zeros(C, S) when C rem 10 =:= 0 -> bv_dec_strip_zeros(C div 10, S - 1);
bv_dec_strip_zeros(C, S) -> {C, S}.

bv_gcd(A, 0) -> A;
bv_gcd(A, B) -> bv_gcd(B, A rem B).

bv_remove_factor(N, _) when N =:= 1 -> 1;
bv_remove_factor(N, F) ->
    case N rem F of
        0 -> bv_remove_factor(N div F, F);
        _ -> N
    end.

bv_dec_pow(_, 0) -> {bv_decimal, 1, 0};
bv_dec_pow(A, Exp) when Exp > 0 ->
    bv_dec_pow_pos(bv_dec_ensure(A), Exp);
bv_dec_pow(A, Exp) when Exp < 0 ->
    Base = bv_dec_pow_pos(bv_dec_ensure(A), -Exp),
    bv_dec_div_exact({bv_decimal, 1, 0}, Base).

bv_dec_pow_pos(Base, 1) -> Base;
bv_dec_pow_pos(Base, Exp) ->
    R = bv_dec_pow_pos(Base, Exp - 1),
    bv_dec_mul(R, Base).

bv_dec_cmp(A, B) ->
    {C1, C2, _} = bv_dec_align(bv_dec_ensure(A), bv_dec_ensure(B)),
    if C1 < C2 -> -1; C1 > C2 -> 1; true -> 0 end.

bv_dec_ensure({bv_decimal, C, S}) -> {bv_decimal, C, S};
bv_dec_ensure(V) when is_integer(V) -> {bv_decimal, V, 0};
bv_dec_ensure(V) when is_float(V) -> bv_dec_from_number(V).

bv_dec_op(A, '+', B) -> bv_dec_add(A, B);
bv_dec_op(A, '-', B) -> bv_dec_sub(A, B);
bv_dec_op(A, '*', B) -> bv_dec_mul(A, B);
bv_dec_op(A, '/', B) -> bv_dec_div_exact(A, B);
bv_dec_op(A, '%', B) -> bv_dec_rem(A, B);
bv_dec_op(A, '**', B) -> bv_dec_pow(A, B);
bv_dec_op(A, '===', B) -> bv_dec_cmp(A, B) =:= 0;
bv_dec_op(A, '!==', B) -> bv_dec_cmp(A, B) =/= 0;
bv_dec_op(A, '>', B) -> bv_dec_cmp(A, B) > 0;
bv_dec_op(A, '<', B) -> bv_dec_cmp(A, B) < 0;
bv_dec_op(A, '>=', B) -> bv_dec_cmp(A, B) >= 0;
bv_dec_op(A, '<=', B) -> bv_dec_cmp(A, B) =< 0.

%% ── Stringification for interpolated strings ("...#{v}...") ────────────────
%% Integer → decimal digits; Decimal → decimal with preserved scale;
%% Float → mantissa (required decimal point, shortest round-trippable, no
%% truncation) + "e" + signed exponent; Boolean → "true"/"false"; Text → self.
bv_str(V) when is_binary(V) -> V;
bv_str(true) -> <<"true">>;
bv_str(false) -> <<"false">>;
bv_str(V) when is_integer(V) -> integer_to_binary(V);
bv_str({bv_decimal, C, S}) -> bv_str_decimal(C, S);
bv_str(V) when is_float(V) -> bv_str_float(V);
bv_str(null) -> <<"null">>;
bv_str(V) -> list_to_binary(io_lib:format("~p", [V])).

bv_str_decimal(C, 0) -> integer_to_binary(C);
bv_str_decimal(C, S) when C < 0 ->
    Abs = bv_str_decimal_pos(-C, S),
    <<"-", Abs/binary>>;
bv_str_decimal(C, S) -> bv_str_decimal_pos(C, S).

bv_str_decimal_pos(Abs, S) ->
    AbsS = integer_to_binary(Abs),
    Len = byte_size(AbsS),
    if
        S >= Len ->
            Pad = binary:copy(<<"0">>, S - Len),
            <<"0.", Pad/binary, AbsS/binary>>;
        true ->
            Split = Len - S,
            <<IntPart:Split/binary, FracPart/binary>> = AbsS,
            <<IntPart/binary, ".", FracPart/binary>>
    end.

bv_str_float(V) when V =:= 0.0 -> <<"0.0e+0">>;
bv_str_float(V) ->
    %% Use shortest round-trippable representation (OTP 25+) then normalise
    %% into mantissa + 'e' + signed-exponent form. The 'short' option may
    %% return either "D.DDDD" or "D.DDDDeNN" depending on magnitude; the
    %% code below handles both by re-deriving the exponent from the
    %% decimal point position.
    Raw = float_to_binary(V, [short]),
    bv_format_float(Raw).

bv_format_float(Raw) ->
    {Sign, Rest1} = case Raw of
        <<"-", R/binary>> -> {<<"-">>, R};
        _ -> {<<"">>, Raw}
    end,
    {M0, E0} = case binary:split(Rest1, <<"e">>) of
        [M] -> {M, 0};
        [M, E] -> {M, binary_to_integer(E)}
    end,
    {IntPart, FracPart} = case binary:split(M0, <<".">>) of
        [I] -> {I, <<"">>};
        [I, F] -> {I, F}
    end,
    AllDigits = <<IntPart/binary, FracPart/binary>>,
    IntLen = byte_size(IntPart),
    case bv_find_first_nonzero(AllDigits, 0) of
        -1 -> <<Sign/binary, "0.0e+0">>;
        NonZero ->
            NewExp = E0 + (IntLen - 1) - NonZero,
            DigitsFromStart = binary:part(AllDigits, NonZero, byte_size(AllDigits) - NonZero),
            Trimmed = bv_trim_right_zero(DigitsFromStart),
            <<FirstDigit:1/binary, RestDigits/binary>> = Trimmed,
            Mantissa = case RestDigits of
                <<>> -> <<FirstDigit/binary, ".0">>;
                _ -> <<FirstDigit/binary, ".", RestDigits/binary>>
            end,
            ExpSign = if NewExp < 0 -> <<"-">>; true -> <<"+">> end,
            ExpAbs = abs(NewExp),
            ExpBin = integer_to_binary(ExpAbs),
            <<Sign/binary, Mantissa/binary, "e", ExpSign/binary, ExpBin/binary>>
    end.

bv_find_first_nonzero(B, I) when I >= byte_size(B) -> -1;
bv_find_first_nonzero(B, I) ->
    case binary:at(B, I) of
        $0 -> bv_find_first_nonzero(B, I + 1);
        _ -> I
    end.

bv_trim_right_zero(<<>>) -> <<>>;
bv_trim_right_zero(B) ->
    L = byte_size(B),
    case binary:at(B, L - 1) of
        $0 -> bv_trim_right_zero(binary:part(B, 0, L - 1));
        _ -> B
    end.

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
json_parse_number(Rest, Acc, true) ->
    S = lists:reverse(Acc),
    %% Erlang list_to_float requires a decimal point; JSON may omit it (e.g. "1e10")
    S2 = case {lists:member($., S), lists:member($e, S) orelse lists:member($E, S)} of
        {false, true} ->
            %% Insert ".0" before the 'e'/'E'
            {Pre, [ExpChar|Post]} = lists:splitwith(fun(C) -> C =/= $e andalso C =/= $E end, S),
            Pre ++ [$., $0, ExpChar | Post];
        _ -> S
    end,
    {list_to_float(S2), Rest}.

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
json_encode({bv_decimal, C, S}) -> bv_dec_to_iodata(C, S);
json_encode(I) when is_integer(I) -> integer_to_binary(I);
json_encode(F) when is_float(F) ->
    %% Ensure integers-as-floats render without decimal (match JS)
    case trunc(F) == F andalso abs(F) < 1.0e15 of
        true -> integer_to_binary(trunc(F));
        false -> float_to_binary(F, [short])
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
type_member_of(Actual, Expected) when Actual =:= Expected -> true;
%% Slice 13: ::Name on the wire matches a parameter declared as Name.
type_member_of(<<"::", Rest/binary>>, Expected) when Rest =:= Expected -> true;
type_member_of(Actual, Expected) when is_binary(Expected) ->
    case binary:match(Expected, <<"|">>) of
        nomatch -> false;
        _ ->
            Parts = binary:split(Expected, <<"|">>, [global]),
            lists:any(fun(P) ->
                T = string:trim(P),
                T =:= Actual orelse
                    case Actual of
                        <<"::", R/binary>> -> R =:= T;
                        _ -> false
                    end
            end, Parts)
    end;
type_member_of(_, _) -> false.

match_types(Message, Pairs) ->
    case maps:find(<<"bv-a">>, Message) of
        {ok, BvA} when is_list(BvA), length(BvA) > 0 ->
            TypesObj = hd(BvA),
            lists:all(fun({Name, TypeName}) ->
                case maps:find(Name, TypesObj) of
                    {ok, V} when is_binary(V) -> type_member_of(V, TypeName);
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
                                            {ok, V} when is_binary(V) -> type_member_of(V, T);
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
            Actual = lists:nth(I+1, Arr),
            case is_binary(Actual) andalso type_member_of(Actual, T) of
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

brevity_typeof({bv_decimal, _, _}) -> <<"Decimal">>;
brevity_typeof(V) when is_integer(V) -> <<"Integer">>;
brevity_typeof(V) when is_float(V) -> <<"Float">>;
brevity_typeof(V) when is_binary(V) -> <<"Text">>;
brevity_typeof(true) -> <<"Boolean">>;
brevity_typeof(false) -> <<"Boolean">>;
brevity_typeof(_) -> <<"Anything">>.

brevity_scalar_size(Bin) when is_binary(Bin) ->
    length(unicode:characters_to_list(Bin)).

brevity_grapheme_first(<<>>) -> <<>>;
brevity_grapheme_first(Bin) ->
    case string:next_grapheme(Bin) of
        [GC|_] -> unicode:characters_to_binary([GC]);
        _ -> <<>>
    end.

brevity_grapheme_last(<<>>) -> <<>>;
brevity_grapheme_last(Bin) ->
    Graphemes = brevity_grapheme_list(Bin),
    unicode:characters_to_binary([lists:last(Graphemes)]).

brevity_grapheme_list(Bin) ->
    brevity_grapheme_list(string:next_grapheme(Bin), []).
brevity_grapheme_list([], Acc) -> lists:reverse(Acc);
brevity_grapheme_list([GC|Rest], Acc) ->
    brevity_grapheme_list(string:next_grapheme(Rest), [GC|Acc]).

brevity_grapheme_slice(Bin, Start) ->
    Gs = brevity_grapheme_list(Bin),
    Sliced = lists:nthtail(Start, Gs),
    unicode:characters_to_binary(Sliced).
brevity_grapheme_slice(Bin, Start, End) ->
    Gs = brevity_grapheme_list(Bin),
    Sliced = lists:sublist(Gs, Start + 1, End - Start),
    unicode:characters_to_binary(Sliced).

brevity_grapheme_index_of(Bin, Sub) ->
    case binary:match(Bin, Sub) of
        {Pos, _} -> string:length(binary:part(Bin, 0, Pos));
        nomatch -> -1
    end.

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

%% take/from: clamp at receiver length. lists:sublist clamps naturally;
%% lists:nthtail does not, so the suffix variant clamps explicitly.
brevity_text_take(Bin, N) ->
    L = unicode:characters_to_list(Bin),
    Sz = length(L),
    Take = if N < 0 -> 0; N > Sz -> Sz; true -> N end,
    unicode:characters_to_binary(lists:sublist(L, Take)).
brevity_text_from(Bin, N) ->
    L = unicode:characters_to_list(Bin),
    Sz = length(L),
    Skip = if N < 0 -> 0; N > Sz -> Sz; true -> N end,
    unicode:characters_to_binary(lists:nthtail(Skip, L)).

brevity_blob_take(Bin, N) ->
    Sz = byte_size(Bin),
    Take = if N < 0 -> 0; N > Sz -> Sz; true -> N end,
    binary:part(Bin, 0, Take).
brevity_blob_from(Bin, N) ->
    Sz = byte_size(Bin),
    Skip = if N < 0 -> 0; N > Sz -> Sz; true -> N end,
    binary:part(Bin, Skip, Sz - Skip).

brevity_grapheme_take(Bin, N) ->
    Gs = brevity_grapheme_list(Bin),
    Sz = length(Gs),
    Take = if N < 0 -> 0; N > Sz -> Sz; true -> N end,
    unicode:characters_to_binary(lists:sublist(Gs, Take)).
brevity_grapheme_from(Bin, N) ->
    Gs = brevity_grapheme_list(Bin),
    Sz = length(Gs),
    Skip = if N < 0 -> 0; N > Sz -> Sz; true -> N end,
    unicode:characters_to_binary(lists:nthtail(Skip, Gs)).

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

brevity_re_blob_index_of(Bin, Re) ->
    case re:run(Bin, Re) of
        {match, [{Pos, _}|_]} -> Pos;
        nomatch -> -1
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
                        <<"#<", Rest/binary>> ->
                            Len = byte_size(Rest) - 1,
                            <<Addr:Len/binary, ">">> = Rest,
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

%% ── Wire-format helpers ─────────────────────────────────────────────────────
%% Given a to-field binary, extract the trailing @name/#name selector if
%% present. Handles both bare selectors ("@name") and the hash-angle delimited
%% alias+selector form ("#<alias selector>").
%% Returns the selector binary (with leading sigil) or nomatch.
extract_to_selector_(Bin) when is_binary(Bin) ->
    Sz = byte_size(Bin),
    Inner = case Bin of
        <<"#<", Rest:(Sz - 3)/binary, ">">> -> Rest;
        _ -> Bin
    end,
    Parts = binary:split(Inner, <<" ">>, [global]),
    Last = lists:last(Parts),
    case Last of
        <<"@", _/binary>> -> Last;
        <<"#", _/binary>> -> Last;
        _ -> nomatch
    end;
extract_to_selector_(_) -> nomatch.

brevity_text_at(Bin, Idx) ->
    L = unicode:characters_to_list(Bin),
    unicode:characters_to_binary([lists:nth(Idx + 1, L)]).

brevity_grapheme_at(Bin, Idx) ->
    Gs = brevity_grapheme_list(Bin),
    unicode:characters_to_binary([lists:nth(Idx + 1, Gs)]).

brevity_blob_to_hex(Bin) ->
    << <<(brevity_hex_byte(B))/binary>> || <<B>> <= Bin >>.
brevity_hex_byte(B) when B < 16 ->
    <<"0", (integer_to_binary(B, 16))/binary>>;
brevity_hex_byte(B) ->
    list_to_binary(string:lowercase(binary_to_list(integer_to_binary(B, 16)))).
brevity_blob_from_hex(Hex) ->
    brevity_blob_from_hex(Hex, <<>>).
brevity_blob_from_hex(<<>>, Acc) -> Acc;
brevity_blob_from_hex(<<H:2/binary, Rest/binary>>, Acc) ->
    B = binary_to_integer(H, 16),
    brevity_blob_from_hex(Rest, <<Acc/binary, B>>).

%% List method helpers. Equality (brevity_eq) handles cross-type Integer/Float
%% and value-equal Decimals; for everything else falls back to =:=.
brevity_eq(A, B) when is_integer(A), is_integer(B) -> A =:= B;
brevity_eq(A, B) when is_integer(A), is_float(B) -> float(A) == B;
brevity_eq(A, B) when is_float(A), is_integer(B) -> A == float(B);
brevity_eq(A, B) -> A =:= B.

brevity_list_first([]) -> null;
brevity_list_first([H|_]) -> H.
brevity_list_last([]) -> null;
brevity_list_last([X]) -> X;
brevity_list_last([_|T]) -> brevity_list_last(T).

brevity_list_at(L, N) when N < 0 -> null;
brevity_list_at(L, N) ->
    case length(L) > N of
        true -> lists:nth(N + 1, L);
        false -> null
    end.

brevity_list_take(_, N) when N =< 0 -> [];
brevity_list_take(L, N) ->
    Sz = length(L),
    Take = if N > Sz -> Sz; true -> N end,
    lists:sublist(L, Take).

brevity_list_from(L, N) when N =< 0 -> L;
brevity_list_from(L, N) ->
    Sz = length(L),
    Skip = if N > Sz -> Sz; true -> N end,
    lists:nthtail(Skip, L).

brevity_list_slice(L, Start) -> brevity_list_from(L, Start).
brevity_list_slice(L, Start, End) ->
    brevity_list_take(brevity_list_from(L, Start), End - Start).

brevity_list_index_of(L, V) -> brevity_list_index_of(L, V, 0).
brevity_list_index_of([], _, _) -> -1;
brevity_list_index_of([H|T], V, I) ->
    case brevity_eq(H, V) of
        true -> I;
        false -> brevity_list_index_of(T, V, I + 1)
    end.

brevity_list_contains([], _) -> false;
brevity_list_contains([H|T], V) ->
    case brevity_eq(H, V) of
        true -> true;
        false -> brevity_list_contains(T, V)
    end.

brevity_list_starts_with(_, []) -> true;
brevity_list_starts_with([], _) -> false;
brevity_list_starts_with([H1|T1], [H2|T2]) ->
    case brevity_eq(H1, H2) of
        true -> brevity_list_starts_with(T1, T2);
        false -> false
    end.

brevity_list_ends_with(L, S) ->
    Ls = length(L),
    Ss = length(S),
    case Ss > Ls of
        true -> false;
        false -> brevity_list_starts_with(lists:nthtail(Ls - Ss, L), S)
    end.

brevity_list_before(L, V) -> brevity_list_before(L, V, []).
brevity_list_before([], _, Acc) -> lists:reverse(Acc);
brevity_list_before([H|T], V, Acc) ->
    case brevity_eq(H, V) of
        true -> lists:reverse(Acc);
        false -> brevity_list_before(T, V, [H|Acc])
    end.

brevity_list_after([], _) -> [];
brevity_list_after([H|T], V) ->
    case brevity_eq(H, V) of
        true -> T;
        false -> brevity_list_after(T, V)
    end.

brevity_list_replace(L, Needle, Repl, All) ->
    brevity_list_replace(L, Needle, Repl, All, false, []).
brevity_list_replace([], _, _, _, _, Acc) -> lists:reverse(Acc);
brevity_list_replace([H|T], N, R, All, Replaced, Acc) ->
    Match = (not Replaced orelse All) andalso brevity_eq(H, N),
    case Match of
        true -> brevity_list_replace(T, N, R, All, true, [R|Acc]);
        false -> brevity_list_replace(T, N, R, All, Replaced, [H|Acc])
    end.

brevity_list_unique(L) -> brevity_list_unique(L, []).
brevity_list_unique([], Acc) -> lists:reverse(Acc);
brevity_list_unique([H|T], Acc) ->
    case lists:any(fun(X) -> brevity_eq(X, H) end, Acc) of
        true -> brevity_list_unique(T, Acc);
        false -> brevity_list_unique(T, [H|Acc])
    end.
`;

// Reserved names used in generated Erlang dispatch code — user vars must not collide
const RESERVED_ERL_VARS = new Set([
  'Message', 'Payload', 'Id', 'From', 'OpVal', 'OpName', 'OpName0', 'HasPayload',
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
  // Three disjoint user namespaces: bare → b_, @ → a_, # → h_.
  // Codegen-internal names use the __ prefix and bypass this function.
  let prefix, bare;
  if (typeof name === 'string' && name.startsWith('@')) {
    prefix = 'a_'; bare = name.slice(1);
  } else if (typeof name === 'string' && name.startsWith('#')) {
    prefix = 'h_'; bare = name.slice(1);
  } else {
    prefix = 'b_'; bare = name;
  }
  if (!ctx.childStatePrefix) return `state_${prefix}${bare}`;
  if (ctx.childConstructorParams && ctx.childConstructorParams.has(name)) return `state_${prefix}${bare}`;
  return `state_${ctx.childStatePrefix}_${prefix}${bare}`;
}

export { PREAMBLE, RESERVED_ERL_VARS, erlVarName, erlString, isListOfAnythingType, erlStateKey };
