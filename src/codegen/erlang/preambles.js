import { wireLabel, intrinsicArm } from '../wire_labels.js';
// ── Preamble constants and pure utilities for Erlang codegen ─────────────────

// What a file actor does for its classes in every wait: answer a read of one of its
// cells, make a call to one of its dependencies, and take note of a class waiting on
// a reply from the wire. `loop` is the wait to go back to.
const serveClasses = (loop) => `{bv_outer_get, OFrom_, OKey_, ORef_} -> bv_answer_outer_(OFrom_, OKey_, ORef_), ${loop};
        {bv_outer_call, CFrom_, CMsg_, CSilent_, CRef_} -> CFrom_ ! {bv_reply, CRef_, bv_outer_send_(bv_lift_(CFrom_, CMsg_), CSilent_)}, ${loop};
        {bv_await_line, WPid_, WId_} -> bv_add_line_waiter_(WPid_, WId_), ${loop}`;

// A wait on something other than the wire. A line that comes meanwhile goes to the
// class waiting on it, or is kept for the file actor's own loop.
const asideLine = (loop) => `{io_reply, LRef_, LData_} -> bv_line_aside_(LRef_, LData_), ${loop}`;

const PREAMBLE = `
%% ── Slice 12+13 wire format helpers ──────────────────────────────────────
%% Outbound: strip __type from a tagged object and reshape to wire form.
%% Inbound: reconstruct a tagged object from a positional list or named
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

%% A type's wire tag is ::Name or authority ::Name. Returns the bare type
%% name, or undefined when the tag does not denote a type.
bv_type_name(Tag) when is_binary(Tag) ->
    case binary:matches(Tag, <<"::">>) of
        [] -> undefined;
        Ms -> {P, _} = lists:last(Ms), binary:part(Tag, P + 2, byte_size(Tag) - P - 2)
    end;
bv_type_name(_) -> undefined.

bv_from_wire(Tag, Payload, Fields) when is_binary(Tag), is_list(Payload) ->
    case bv_type_name(Tag) of
        undefined -> Payload;
        Name ->
            PLen = length(Payload),
            FLen = length(Fields),
            N = if PLen < FLen -> PLen; true -> FLen end,
            Pairs = lists:zip(lists:sublist(Fields, N), lists:sublist(Payload, N)),
            Base = #{<<"__type">> => Name},
            lists:foldl(fun({F, V}, Acc) -> Acc#{F => V} end, Base, Pairs)
    end;
bv_from_wire(Tag, Payload, Fields) when is_binary(Tag), is_map(Payload) ->
    case bv_type_name(Tag) of
        undefined -> Payload;
        Name ->
            Base = #{<<"__type">> => Name},
            lists:foldl(fun(F, Acc) ->
                case maps:get(F, Payload, undefined) of
                    undefined -> Acc;
                    V -> Acc#{F => V}
                end
            end, Base, Fields)
    end;
bv_from_wire(_Tag, Payload, _Fields) -> Payload.

%% ── Reference-field invocation: op selector for a held address ──────────────
%% An address <<"#<alias member>">> names its member by its last token, and the
%% token is the op (#<x p> → p, #<. @0> → @0); a bare address passes through.
%% Mirrors the JS/Rust bv_sel helper.
bv_sel_(Addr) when is_binary(Addr) ->
    L = byte_size(Addr),
    case Addr of
        <<"#<", _/binary>> when L >= 3 ->
            case binary:at(Addr, L - 1) of
                $> ->
                    case catch lists:last(bv_opre_split_(binary:part(Addr, 2, L - 3))) of
                        B_ when is_binary(B_) -> B_;
                        _ -> Addr
                    end;
                _ -> Addr
            end;
        _ -> Addr
    end;
bv_sel_(Addr) -> Addr.
%% An address value used as a to: the address without the #<…> that marks it.
bv_to_addr_(<<"#<", _/binary>> = A) when byte_size(A) >= 3 ->
    case binary:at(A, byte_size(A) - 1) of $> -> binary:part(A, 2, byte_size(A) - 3); _ -> A end;
bv_to_addr_(A) -> A.
%% The key an op dispatches on. An intrinsic ($set, $new, $subscribe, …) names
%% its cell, class or function as the last token of to, relative to us:
%% {<<"$set">>, <<"val">>}. One with no target, and any other op, is its name.
bv_op_key_(<<"$", _/binary>> = Op, To) ->
    case extract_to_selector_(To) of nomatch -> Op; T_ -> {Op, T_} end;
bv_op_key_(Op, _) -> Op.
%% The same, for a to that reached an actor we published at Addr: the target
%% is what follows Addr.
bv_op_key_under_(<<"$", _/binary>> = Op, To, Addr) ->
    Sz_ = byte_size(To),
    Inner_ = case To of <<"#<", R_:(Sz_ - 3)/binary, ">">> -> R_; _ -> To end,
    Toks_ = case catch bv_opre_split_(Inner_) of [self | T_] -> T_; T_ when is_list(T_) -> T_; _ -> [] end,
    N_ = length(bv_opre_split_(Addr)),
    case lists:nthtail(min(N_, length(Toks_)), Toks_) of [] -> Op; Rest_ -> {Op, lists:last(Rest_)} end;
bv_op_key_under_(Op, _, _) -> Op.
%% The op an ex names: an intrinsic by itself, without its target.
bv_ex_key_({Op, _}) -> Op;
bv_ex_key_(Op) -> Op.

%% ── Opre address tokens (mirrors src/codegen/opre_tokens.js) ───────────────
%% Tokens separated by single spaces; '…' quotes a token with a space or a
%% leading ', '' is one ' inside quotes. The head token . is self (the atom
%% self). See notes/at-sigil-internal-and-quoted-names-2026-11-12.md.
bv_opre_split_(<<>>) -> [];
bv_opre_split_(A) -> bv_opre_split_(A, true, []).
bv_opre_split_(<<$', R/binary>>, _Head, Acc) ->
    {T, R2} = bv_opre_unquote_(R, <<>>),
    bv_opre_split_next_(R2, [T | Acc]);
bv_opre_split_(A, Head, Acc) ->
    {T, R2} = case binary:match(A, <<" ">>) of
        nomatch -> {A, <<>>};
        {P, _} -> {binary:part(A, 0, P), binary:part(A, P, byte_size(A) - P)}
    end,
    T2 = case {T, Head} of {<<".">>, true} -> self; _ -> T end,
    bv_opre_split_next_(R2, [T2 | Acc]).
bv_opre_split_next_(<<>>, Acc) -> lists:reverse(Acc);
bv_opre_split_next_(<<" ", R/binary>>, Acc) when R =/= <<>> -> bv_opre_split_(R, false, Acc).
bv_opre_unquote_(<<$', $', R/binary>>, Acc) -> bv_opre_unquote_(R, <<Acc/binary, $'>>);
bv_opre_unquote_(<<$', R/binary>>, Acc) -> {Acc, R};
bv_opre_unquote_(<<C, R/binary>>, Acc) -> bv_opre_unquote_(R, <<Acc/binary, C>>).
bv_opre_quote_(self) -> <<".">>;
bv_opre_quote_(T) ->
    case T =:= <<>> orelse T =:= <<".">> orelse binary:match(T, <<" ">>) =/= nomatch orelse binary:first(T) =:= $' of
        true -> <<$', (binary:replace(T, <<"'">>, <<"''">>, [global]))/binary, $'>>;
        false -> T
    end.
bv_opre_join_(Ts) -> iolist_to_binary(lists:join(<<" ">>, [bv_opre_quote_(T) || T <- Ts])).
%% A relative address one hop up, under the child Name: . x → . Name x.
bv_opre_under_(<<".">>, Name) -> <<". ", Name/binary>>;
bv_opre_under_(<<". ", R/binary>>, Name) -> <<". ", Name/binary, " ", R/binary>>;
bv_opre_under_(A, _) -> A.
%% Every #<…> in a value, its relative addresses under the child Name.
bv_under_payload_(B, Name) when is_binary(B) -> case binary:match(B, <<"#<">>) of nomatch -> B; _ -> bv_under_bracketed_(B, Name, <<>>) end;
bv_under_payload_(L, Name) when is_list(L) -> [bv_under_payload_(X, Name) || X <- L];
bv_under_payload_(M, Name) when is_map(M) -> maps:map(fun(_, X) -> bv_under_payload_(X, Name) end, M);
bv_under_payload_(V, _) -> V.
%% Escapes stay as they are: \\> and \\\\ inside the brackets, \\#< and \\\\ outside
%% (notes/address-delimiter-change-plan-2026-04-23.md).
bv_under_bracketed_(<<>>, _, Acc) -> Acc;
bv_under_bracketed_(<<$\\\\, C, R/binary>>, Name, Acc) -> bv_under_bracketed_(R, Name, <<Acc/binary, $\\\\, C>>);
bv_under_bracketed_(<<"#<", R/binary>> = B, Name, Acc) ->
    case bv_bracket_close_(R, <<>>) of
        {Inner_, After_} -> bv_under_bracketed_(After_, Name, <<Acc/binary, "#<", (bv_opre_under_(Inner_, Name))/binary, ">">>);
        none -> <<Acc/binary, B/binary>>
    end;
bv_under_bracketed_(<<C, R/binary>>, Name, Acc) -> bv_under_bracketed_(R, Name, <<Acc/binary, C>>).
bv_bracket_close_(<<$\\\\, C, R/binary>>, Acc) -> bv_bracket_close_(R, <<Acc/binary, $\\\\, C>>);
bv_bracket_close_(<<$>, R/binary>>, Acc) -> {Acc, R};
bv_bracket_close_(<<C, R/binary>>, Acc) -> bv_bracket_close_(R, <<Acc/binary, C>>);
bv_bracket_close_(<<>>, _) -> none.

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
bv_as(V0, D, Name) ->
    V = case V0 of
        {[Only_], M0_} when is_map(M0_), map_size(M0_) =:= 0 -> Only_;
        {[], M0_} when is_map(M0_) -> M0_;
        {P0_, M0_} when is_list(P0_), is_map(M0_), map_size(M0_) =:= 0 -> P0_;
        _ -> V0
    end,
    case bv_as_try(V, D) of
        {ok, R_} -> R_;
        no -> error({bv_as, <<"as ", Name/binary, ": got ", (bv_as_kind(V))/binary>>})
    end.
bv_as_kind(null) -> <<"null">>;
bv_as_kind(true) -> <<"Boolean">>;
bv_as_kind(false) -> <<"Boolean">>;
bv_as_kind(V) when is_integer(V) -> <<"Integer">>;
bv_as_kind(V) when is_float(V) -> case V == trunc(V) of true -> <<"Integer">>; false -> <<"Float">> end;
bv_as_kind(V) when is_binary(V) -> <<"Text">>;
bv_as_kind({bv_decimal, _, _}) -> <<"Decimal">>;
bv_as_kind(V) when is_list(V) -> <<"List">>;
bv_as_kind(#{<<"__type">> := T}) -> T;
bv_as_kind(_) -> <<"Object">>.
bv_as_try(V, <<"Integer">>) when is_integer(V) -> {ok, V};
bv_as_try(V, <<"Integer">>) when is_float(V) -> case V == trunc(V) of true -> {ok, trunc(V)}; false -> no end;
bv_as_try({bv_decimal, C, S}, <<"Integer">>) ->
    F = bv_as_pow10(S),
    case C rem F of 0 -> {ok, C div F}; _ -> no end;
bv_as_try(V, <<"Float">>) when is_float(V) -> {ok, V};
bv_as_try(V, <<"Float">>) when is_integer(V) -> {ok, float(V)};
bv_as_try({bv_decimal, _, _} = V, <<"Float">>) -> {ok, bv_dec_to_float(V)};
bv_as_try({bv_decimal, _, _} = V, <<"Decimal">>) -> {ok, V};
bv_as_try(V, <<"Decimal">>) when is_number(V) -> {ok, bv_dec_from_number(V)};
bv_as_try(V, <<"Text">>) when is_binary(V) ->
    case unicode:characters_to_binary(V) of B when is_binary(B) -> {ok, V}; _ -> no end;
bv_as_try(V, <<"Blob">>) when is_binary(V) -> {ok, V};
bv_as_try(V, <<"Boolean">>) when is_boolean(V) -> {ok, V};
bv_as_try(null, <<"null">>) -> {ok, null};
bv_as_try(V, {u, Ms}) ->
    Kind = bv_as_kind(V),
    case lists:member(Kind, Ms) of
        true -> bv_as_try(V, Kind);
        false -> bv_as_first(V, Ms)
    end;
bv_as_try(V, {l, none}) when is_list(V) -> {ok, V};
bv_as_try(V, {l, E}) when is_list(V) ->
    Rs = [bv_as_try(X, E) || X <- V],
    case lists:member(no, Rs) of
        true -> no;
        false -> {ok, [R || {ok, R} <- Rs]}
    end;
bv_as_try(V, {t, Name, Fields}) when is_map(V) -> bv_as_fields(V, Name, Fields);
bv_as_try(V, {t, Name, Fields}) when is_list(V) ->
    Keys = [K || {K, _, _} <- Fields],
    bv_as_fields(maps:from_list(lists:zip(lists:sublist(Keys, length(V)), lists:sublist(V, length(Keys)))), Name, Fields);
bv_as_try(_, _) -> no.
bv_as_first(_, []) -> no;
bv_as_first(V, [M | Ms]) ->
    case bv_as_try(V, M) of
        {ok, _} = R -> R;
        no -> bv_as_first(V, Ms)
    end.
bv_as_fields(Src, Name, Fields) ->
    lists:foldl(fun
        (_, no) -> no;
        ({K, FD, Opt}, {ok, Acc}) ->
            case maps:find(K, Src) of
                {ok, null} when Opt -> {ok, Acc};
                error when Opt -> {ok, Acc};
                error -> no;
                {ok, X} when FD =:= none -> {ok, Acc#{K => X}};
                {ok, X} ->
                    case bv_as_try(X, FD) of
                        {ok, R} -> {ok, Acc#{K => R}};
                        no -> no
                    end
            end
    end, {ok, #{<<"__type">> => Name}}, Fields).
bv_as_pow10(0) -> 1;
bv_as_pow10(N) -> 10 * bv_as_pow10(N - 1).
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

%% Generic arithmetic/comparison — an operand typed Anything (an untyped param
%% of a generic function) only reveals its numeric kind at runtime.
bv_num_op({bv_decimal, _, _} = A, Op, B) -> bv_dec_op(A, Op, B);
bv_num_op(A, Op, {bv_decimal, _, _} = B) -> bv_dec_op(A, Op, B);
bv_num_op(A, '/', B) -> bv_div(A, B);
bv_num_op(A, '%', B) when is_integer(A), is_integer(B) -> A rem B;
bv_num_op(A, '%', B) -> bv_float_rem(bv_to_float(A), bv_to_float(B));
bv_num_op(A, '**', B) when is_integer(A), is_integer(B) -> bv_pow(A, B);
bv_num_op(A, '**', B) -> math:pow(bv_to_float(A), bv_to_float(B));
bv_num_op(A, '+', B) -> A + B;
bv_num_op(A, '-', B) -> A - B;
bv_num_op(A, '*', B) -> A * B;
bv_num_op(A, '===', B) -> A == B;
bv_num_op(A, '!==', B) -> A /= B;
bv_num_op(A, '>', B) -> A > B;
bv_num_op(A, '<', B) -> A < B;
bv_num_op(A, '>=', B) -> A >= B;
bv_num_op(A, '<=', B) -> A =< B.

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

%% ── Object helpers ───────────────────────────────────────────────────────
bv_object_pack({Pos_, Named_}) when is_list(Pos_), is_map(Named_) -> {Pos_, Named_};
bv_object_pack(null) -> {[], #{}};
bv_object_pack(P) when is_pid(P) -> {[P], #{}};
bv_object_pack(L) when is_list(L) ->
    case L of
        [] -> {[], #{}};
        _ ->
            Last = lists:last(L),
            %% A tagged type value (carries __type) is a positional value, not a
            %% named-args container — mirrors the JS packer, which excludes
            %% __type / actor-ref / cons-cell maps from the named-args slot.
            %% A trailing #{} is an empty named slot: [#{}] reads as [].
            case is_map(Last) andalso not maps:is_key(<<"__type">>, Last) of
                true ->
                    Pos = lists:sublist(L, length(L) - 1),
                    {Pos, Last};
                false ->
                    {L, #{}}
            end
    end;
bv_object_pack(M) when is_map(M) -> {[], M};
bv_object_pack(_) -> {[], #{}}.

%% A field read on a value nothing types (a reply, say), as JS reads one: a
%% field of a map or of an Object's named slot, and null for anything else.
bv_dot_(K, M) when is_map(M) -> maps:get(K, M, null);
bv_dot_(K, {Pos_, Named_}) when is_list(Pos_), is_map(Named_) -> maps:get(K, Named_, null);
bv_dot_(_, _) -> null.

bv_object_one({[V], _}) -> V;
bv_object_one({Pos, _}) when is_list(Pos) -> error({arity, length(Pos)});
bv_object_one(V) -> V.

%% ── Instance processes ──────────────────────────────────────────────────
%% Read a key from an instance's process dict; call one of its handlers.
bv_inst_get_(Pid, Key) when is_pid(Pid) ->
    Ref_ = make_ref(),
    Pid ! {bv_get, self(), Key, Ref_},
    receive {bv_reply, Ref_, V_} -> V_ after 5000 -> null end;
bv_inst_get_(_, _) -> null.
bv_inst_call_(Pid, Op, Payload) when is_pid(Pid) ->
    Id_ = integer_to_binary(erlang:unique_integer([positive])),
    Pid ! {bv_dispatch, self(), Op, Payload, Id_},
    R_ = bv_await_(Id_),
    bv_drain_notify_(),
    R_;
bv_inst_call_(_, _, _) -> null.
%% Run a handler in an instance's loop. A failure is reported to the caller and
%% the instance lives on: a failed \`as\` keeps its message.
bv_guard_(F) ->
    try F()
    catch error:{bv_as, Msg_} -> {bv_failed, Msg_};
          _:_ -> {bv_failed, <<"error">>}
    end.
%% A call within the actor. A failed \`as\` keeps its message only on the handler it happened in.
bv_call_self_(F) ->
    try F()
    catch error:{bv_as, _} -> error(bv_call_failed)
    end.
%% The reply to a call on an instance. A call that receives a failure fails in turn.
bv_await_(Id) ->
    receive {bv_reply, Id, Re_} -> Re_; {bv_error, Id, _} -> error(bv_call_failed);
        ${serveClasses('bv_await_(Id)')};
        ${asideLine('bv_await_(Id)')} end.
%% The file actor a class reads cells from (see src/outer_reads.js): a class has it
%% from whoever spawned it, and the file actor is its own.
bv_outer_() -> case get(bv_outer_) of undefined -> self(); O_ -> O_ end.
%% Message ids. A class's messages leave as its file actor's, so the file actor and
%% its classes share one counter, made on first use and passed down at spawn.
bv_seq_ref_() -> case get(bv_seq_ref_) of undefined -> R_ = atomics:new(1, []), put(bv_seq_ref_, R_), R_; R_ -> R_ end.
bv_next_seq_() -> atomics:add_get(bv_seq_ref_(), 1, 1).
%% The actors a class is declared in, innermost first, each {Class, Pid}. The file
%% actor is the last, and its class is <<>>.
bv_chain_() -> case get(bv_chain_) of undefined -> []; C_ -> C_ end.
bv_my_class_() -> case get(bv_self_class_) of undefined -> <<>>; C_ -> C_ end.
%% What a class constructed here starts with. Its chain is this actor and the ones it's
%% declared in, from the one of class Enclosing out.
bv_outer_ctx_(Enclosing) -> {bv_outer_(), bv_seq_ref_(), bv_chain_from_(Enclosing, [{bv_my_class_(), self()} | bv_chain_()])}.
bv_chain_from_(_, [Last_]) -> [Last_];
bv_chain_from_(E_, [{E_, _} | _] = C_) -> C_;
bv_chain_from_(E_, [_ | T_]) -> bv_chain_from_(E_, T_).
bv_adopt_outer_({Pid, Ref, Chain}) -> put(bv_outer_, Pid), put(bv_seq_ref_, Ref), put(bv_chain_, Chain).
%% A class reading a cell of an actor it's declared in, Level actors up the chain:
%% \`$get\` to that actor's Token (\`~total\`), from a class declared in it. Each of
%% them answers in every wait, its idle one included, so a read is answered at the
%% owner's next wait or once its turn ends.
bv_outer_get_(Level, Token) ->
    Owner_ = case bv_chain_() of [] -> bv_outer_(); C_ -> element(2, lists:nth(Level, C_)) end,
    case Owner_ of
        Self_ when Self_ =:= self() -> bv_read_(bv_my_class_(), Token);
        _ ->
            Ref_ = make_ref(),
            Owner_ ! {bv_outer_get, self(), Token, Ref_},
            receive {bv_reply, Ref_, V_} -> V_ end
    end.
%% \`$get\` from a class declared in us, answered from the table \`$get\` reads
%% (bv_read_). A cell that a class's construction waits on isn't declared yet: the
%% read is held until its line runs (src/init_order.js).
bv_answer_outer_(From, Token, Ref) ->
    case get({bv_pending_, Token}) of
        undefined -> From ! {bv_reply, Ref, bv_read_(bv_my_class_(), Token)};
        Waiting_ -> put({bv_pending_, Token}, [{From, Ref} | Waiting_])
    end.
bv_pending_cells_(Tokens) -> [put({bv_pending_, T_}, []) || T_ <- Tokens], ok.
bv_cell_ready_(Token) ->
    Waiting_ = case erase({bv_pending_, Token}) of undefined -> []; W_ -> W_ end,
    [From_ ! {bv_reply, Ref_, bv_read_(bv_my_class_(), Token)} || {From_, Ref_} <- lists:reverse(Waiting_)],
    ok.
%% A class constructed without waiting for it; the end of the block waits.
bv_join_(Pid) ->
    put(bv_joins_, [Pid | case get(bv_joins_) of undefined -> []; J_ -> J_ end]),
    Pid.
bv_join_all_() ->
    Joins_ = case erase(bv_joins_) of undefined -> []; J_ -> J_ end,
    [bv_spawn_sync_(P_) || P_ <- lists:reverse(Joins_)],
    ok.
%% A class calling one of its file's dependencies: the dependency is the file
%% actor's, so the file actor makes the call, under an id of its own, and passes the
%% reply back. It answers in every wait, as for a read.
bv_outer_call_(Msg, Silent) ->
    case bv_outer_() of
        Self_ when Self_ =:= self() -> bv_outer_send_(Msg, Silent);
        Outer_ ->
            Ref_ = make_ref(),
            Outer_ ! {bv_outer_call, self(), Msg, Silent, Ref_},
            receive {bv_reply, Ref_, V_} -> V_ end
    end.
%% A class's call goes out as ours, so its relative addresses and tags are
%% translated as we translate what it replies: under its address, when we
%% published it.
bv_lift_(Pid, Msg) ->
    case get({bv_addr_of, Pid}) of
        undefined -> Msg;
        A_ -> maps:map(fun(<<"to">>, V_) -> V_; (<<"ty">>, V_) -> bv_local_tag_(V_, A_); (_, V_) -> bv_under_payload_(V_, A_) end, Msg)
    end.
bv_outer_send_(Msg, Silent) ->
    Seq_ = bv_next_seq_(),
    Id_ = integer_to_binary(Seq_),
    io:put_chars([json_encode(Msg#{<<"id">> => Id_}), $\n]),
    case Silent of true -> null; false -> await_response_(Id_) end.

%% ── Stdin ───────────────────────────────────────────────────────────────
%% The file actor is stdin's one reader. It asks for a line without blocking (the io
%% protocol's own request), so it can serve its classes while it waits, and it hands
%% each reply on to whoever is waiting for it. Its classes never read stdin: a class
%% waiting on a reply asks its file actor for it (bv_await_line_).
%% At most one request is out at a time, and only while someone wants a line.
bv_want_line_() ->
    case get(bv_line_ref_) of
        undefined ->
            Ref_ = make_ref(),
            group_leader() ! {io_request, self(), Ref_, {get_line, unicode, ""}},
            put(bv_line_ref_, Ref_);
        _ -> ok
    end.
%% A line has come. A reply a class is waiting on goes to that class (taken); the
%% file actor gets anything else.
bv_take_line_(Ref, Data) ->
    case get(bv_line_ref_) of
        Ref ->
            erase(bv_line_ref_),
            case Data of
                eof -> bv_lines_end_(), eof;
                {error, _} -> bv_lines_end_(), eof;
                _ ->
                    case unicode:characters_to_binary(string:trim(Data)) of
                        <<>> -> taken;
                        Bin_ ->
                            Message_ = json_decode(Bin_),
                            Id_ = maps:get(<<"id">>, Message_, <<>>),
                            IsReply_ = maps:is_key(<<"re">>, Message_) orelse maps:is_key(<<"ex">>, Message_),
                            case IsReply_ andalso erase({bv_line_waiter, Id_}) of
                                Pid_ when is_pid(Pid_) ->
                                    put(bv_line_waiters_, get(bv_line_waiters_) - 1),
                                    Pid_ ! {bv_line, Id_, Message_},
                                    taken;
                                _ -> {line, Message_}
                            end
                    end
            end;
        _ -> taken
    end.
bv_lines_end_() ->
    [Pid_ ! {bv_line, Id_, eof} || {{bv_line_waiter, Id_}, Pid_} <- get()],
    ok.
bv_add_line_waiter_(Pid, Id) ->
    put({bv_line_waiter, Id}, Pid),
    put(bv_line_waiters_, case get(bv_line_waiters_) of undefined -> 1; N_ -> N_ + 1 end),
    bv_want_line_().
bv_line_waiters_() -> case get(bv_line_waiters_) of undefined -> 0; N_ -> N_ end.
%% A line that came while the file actor waited on something else: it keeps it for
%% its own loop, and asks for another if a class is still waiting.
bv_line_aside_(Ref, Data) ->
    case bv_take_line_(Ref, Data) of
        taken -> ok;
        L_ -> put(bv_line_q_, bv_line_q_() ++ [L_])
    end,
    case bv_line_waiters_() > 0 of true -> bv_want_line_(); false -> ok end.
bv_line_q_() -> case get(bv_line_q_) of undefined -> []; Q_ -> Q_ end.
%% The reply to a message this actor sent on the wire: {re, Message}, {ex, Message}
%% or eof. Anything else that comes meanwhile is handled as it comes.
bv_await_line_(Id) ->
    case bv_outer_() of
        Self_ when Self_ =:= self() ->
            case lists:partition(fun({line, M_}) -> maps:get(<<"id">>, M_, <<>>) =:= Id andalso bv_is_reply_(M_); (_) -> false end, bv_line_q_()) of
                {[{line, M_} | _], Rest_} -> put(bv_line_q_, Rest_), bv_reply_kind_(M_);
                _ -> bv_want_line_(), bv_await_line_loop_(Id)
            end;
        Outer_ ->
            Outer_ ! {bv_await_line, self(), Id},
            bv_await_line_from_(Id)
    end.
%% A class waiting on its file actor for a reply still answers the classes declared in it.
bv_await_line_from_(Id) ->
    receive
        {bv_line, Id, eof} -> eof;
        {bv_line, Id, M_} -> bv_reply_kind_(M_);
        {bv_outer_get, OFrom_, OKey_, ORef_} -> bv_answer_outer_(OFrom_, OKey_, ORef_), bv_await_line_from_(Id)
    end.
bv_is_reply_(M) -> maps:is_key(<<"re">>, M) orelse maps:is_key(<<"ex">>, M).
bv_reply_kind_(M) -> case maps:is_key(<<"re">>, M) of true -> {re, M}; false -> {ex, M} end.
bv_await_line_loop_(Id) ->
    receive
        {io_reply, LRef_, LData_} ->
            case bv_take_line_(LRef_, LData_) of
                eof -> eof;
                taken -> bv_want_line_(), bv_await_line_loop_(Id);
                {line, M_} ->
                    MsgId_ = maps:get(<<"id">>, M_, <<>>),
                    case maps:is_key(<<"re">>, M_) of
                        true when MsgId_ =:= Id -> {re, M_};
                        %% Another reply: it isn't this wait's, and no one else waits on it.
                        true -> bv_want_line_(), bv_await_line_loop_(Id);
                        false ->
                            case maps:is_key(<<"ex">>, M_) of
                                true when MsgId_ =:= Id -> {ex, M_};
                                _ -> dispatch(M_), bv_want_line_(), bv_await_line_loop_(Id)
                            end
                    end
            end;
        ${serveClasses('bv_await_line_loop_(Id)')}
    end.
%% The file actor's next message of its own. Before it asks for one, what it launched
%% into its classes has finished, unless one of them is waiting on the wire too.
bv_next_line_() ->
    case bv_line_q_() of
        [L_ | Rest_] -> put(bv_line_q_, Rest_), L_;
        [] ->
            case bv_launched_() of [] -> bv_want_line_(); _ -> ok end,
            receive
                {io_reply, LRef_, LData_} ->
                    case bv_take_line_(LRef_, LData_) of
                        taken -> bv_next_line_();
                        L_ -> L_
                    end;
                {bv_reply, LId_, _} -> bv_landed_(LId_), bv_next_line_();
                {bv_error, LId_, _} -> bv_landed_(LId_), bv_next_line_();
                {bv_notify, SubId_, Re_} ->
                    case get({pending_subscribe, SubId_}) of
                        F_ when is_function(F_) -> F_(Re_);
                        _ -> ok
                    end,
                    bv_next_line_();
                ${serveClasses('bv_next_line_()')}
            end
    end.
%% A call into a class that nothing waits on, such as a subscription callback.
bv_launch_(Pid, Op, Payload) ->
    Id_ = integer_to_binary(erlang:unique_integer([positive])),
    Pid ! {bv_dispatch, self(), Op, Payload, Id_},
    put(bv_launched_, [Id_ | bv_launched_()]),
    ok.
bv_launched_() -> case get(bv_launched_) of undefined -> []; L_ -> L_ end.
bv_landed_(Id) -> put(bv_launched_, lists:delete(Id, bv_launched_())).

%% An actor made by \`#new\` has its own address, kept here so it can be reached.
%% Its address relative to us is #<. C N>.
bv_publish_(Class, Pid) ->
    N_ = case get({bv_inst_seq, Class}) of undefined -> 1; C_ -> C_ + 1 end,
    put({bv_inst_seq, Class}, N_),
    Addr_ = <<Class/binary, " ", (integer_to_binary(N_))/binary>>,
    bv_publish_at_(Addr_, Pid),
    <<"#<. ", Addr_/binary, ">">>.
%% Publish an actor of ours under the tokens Addr: C N for one made by #new, s
%% for a singleton. The public singletons it published itself go under it
%% (C N s), so a wire message reaches them from here.
bv_publish_at_(Addr, Pid) ->
    put({bv_instance, Addr}, Pid),
    put({bv_addr_of, Pid}, Addr),
    put(bv_published_, [{Addr, Pid} | bv_published_()]),
    Ref_ = make_ref(),
    Pid ! {bv_get, self(), bv_published_, Ref_},
    Under_ = receive {bv_reply, Ref_, U_} -> U_ end,
    [begin
        put({bv_instance, <<Addr/binary, " ", A_/binary>>}, P_),
        put({bv_addr_of, P_}, <<Addr/binary, " ", A_/binary>>)
     end || {A_, P_} <- case Under_ of undefined -> []; _ -> Under_ end],
    ok.
bv_published_() -> case get(bv_published_) of undefined -> []; L_ -> L_ end.
%% The actor a received to names: what reaches us is relative to us (. Box 1 x,
%% Box 1 x, bracketed or not), so the longest published address its tokens
%% start with.
bv_instance_at_(To) when is_binary(To) ->
    Sz_ = byte_size(To),
    Inner_ = case To of <<"#<", R_:(Sz_ - 3)/binary, ">">> -> R_; _ -> To end,
    Toks_ = case catch bv_opre_split_(Inner_) of [self | T_] -> T_; T_ when is_list(T_) -> T_; _ -> [] end,
    Found_ = [{A_, get({bv_instance, A_})} || N_ <- lists:seq(length(Toks_), 1, -1),
              A_ <- [bv_opre_join_(lists:sublist(Toks_, N_))],
              get({bv_instance, A_}) =/= undefined],
    case Found_ of [F_ | _] -> F_; [] -> none end;
bv_instance_at_(_) -> none.
%% An actor's class tag from its address: C N is of . C; a singleton (s, C N s)
%% is its own class.
bv_addr_class_(Addr) ->
    Base_ = case re:run(Addr, <<" [0-9]+$">>) of
        {match, [{P_, _}]} -> binary:part(Addr, 0, P_);
        nomatch -> Addr
    end,
    <<". ", Base_/binary>>.
%% A reply leaving for the wire names an actor we published by its address.
bv_wire_own_(P) when is_pid(P) -> case get({bv_addr_of, P}) of undefined -> P; A_ -> <<"#<. ", A_/binary, ">">> end;
bv_wire_own_(L) when is_list(L) -> [bv_wire_own_(X) || X <- L];
bv_wire_own_(M) when is_map(M) -> maps:map(fun(_, X) -> bv_wire_own_(X) end, M);
bv_wire_own_(V) -> V.
%% A tag from an actor we published, relative to it: a bare . is its class;
%% any other relative tag goes under its address. A type is declared at the
%% top of a file, so . ::Point already names us. A global tag passes.
bv_local_tag_(<<".">>, Addr) -> bv_addr_class_(Addr);
bv_local_tag_(<<". ::", _/binary>> = T, _) -> T;
bv_local_tag_(<<". ", _/binary>> = T, Addr) -> bv_opre_under_(T, Addr);
bv_local_tag_(L, Addr) when is_list(L) -> [bv_local_tag_(X, Addr) || X <- L];
bv_local_tag_(M, Addr) when is_map(M) -> maps:map(fun(_, X) -> bv_local_tag_(X, Addr) end, M);
bv_local_tag_(T, _) -> T.
%% A call from outside: its tags are checked, and its reply keeps its tag.
bv_forward_(Pid, Addr, Op, Message, Payload, Id, From) ->
    Base_ = #{<<"id">> => Id, <<"to">> => From, <<"from">> => <<". ", Addr/binary>>},
    case Payload =/= #{} andalso Payload =/= [] andalso not maps:is_key(<<"ty">>, Message) of
        true -> io:put_chars([json_encode(Base_#{<<"ex">> => #{bv_ex_key_(Op) => <<"schema_required">>}}), $\n]);
        false ->
            Pid ! {bv_dispatch_wire, self(), Op, Message, Payload, Id},
            R_ = bv_await_wire_(Id),
            bv_drain_notify_(),
            case R_ of
                {ok, null, _} -> ok;
                %% A self-return: we made this actor, so we name it and its class, as for #new.
                {ok, <<"#<.>"/utf8>>, _} ->
                    io:put_chars([json_encode(Base_#{<<"re">> => <<"#<. ", Addr/binary, ">">>, <<"ty">> => bv_addr_class_(Addr)}), $\n]);
                %% Its relative addresses, "me" among them, go under it.
                {ok, V_, null} -> io:put_chars([json_encode(Base_#{<<"re">> => bv_wire_own_(bv_under_payload_(V_, Addr))}), $\n]);
                {ok, V_, Tag_} ->
                    io:put_chars([json_encode(Base_#{<<"re">> => bv_wire_own_(bv_under_payload_(V_, Addr)), <<"ty">> => bv_local_tag_(Tag_, Addr)}), $\n]);
                {failed, F_} -> io:put_chars([json_encode(Base_#{<<"ex">> => #{bv_ex_key_(Op) => F_}}), $\n])
            end
    end.
%% A child's "me" (#<.>) as one slot of several: its parent swaps in what it knows
%% the child as, at any depth. The matching ty slot holds a bare ., "my class".
bv_swap_self_(<<"#<.>">>, With) -> With;
bv_swap_self_(L, With) when is_list(L) -> [bv_swap_self_(X, With) || X <- L];
bv_swap_self_(M, With) when is_map(M) -> maps:map(fun(_, X) -> bv_swap_self_(X, With) end, M);
bv_swap_self_(V, _) -> V.
bv_swap_tag_(<<".">>, Class) -> Class;
bv_swap_tag_(L, Class) when is_list(L) -> [bv_swap_tag_(X, Class) || X <- L];
bv_swap_tag_(M, Class) when is_map(M) -> maps:map(fun(_, X) -> bv_swap_tag_(X, Class) end, M);
bv_swap_tag_(T, _) -> T.
%% A subscribe carries its whole message (op args, ty) and its id.
bv_inst_sub_(Pid, Op, Msg, Payload, Id) when is_pid(Pid) ->
    Pid ! {bv_dispatch_msg, self(), Op, Msg, Payload, Id},
    R_ = bv_await_(Id),
    bv_drain_notify_(),
    R_;
bv_inst_sub_(_, _, _, _, _) -> null.
%% Wait for a freshly spawned instance to finish its init (it handles the
%% sync only once in its loop).
bv_spawn_sync_(Pid) ->
    Pid ! {bv_init_sync, self()},
    bv_await_ready_(Pid).
bv_await_ready_(Pid) ->
    receive {bv_ready, Pid} -> Pid; {bv_init_failed, Pid} -> error(bv_call_failed);
        ${serveClasses('bv_await_ready_(Pid)')};
        ${asideLine('bv_await_ready_(Pid)')} end.
bv_await_wire_(Id) ->
    receive {bv_wire_reply, Id, Re_, Ty_} -> {ok, Re_, Ty_}; {bv_error, Id, Fail_} -> {failed, Fail_};
        ${serveClasses('bv_await_wire_(Id)')};
        ${asideLine('bv_await_wire_(Id)')} end.
%% A constructor block failed: there's no actor, and whoever is constructing it is told.
bv_init_failed_() ->
    receive {bv_init_sync, From_} -> From_ ! {bv_init_failed, self()} end.
%% Deliver an emitted event to a subscriber instance and await its handler.
bv_inst_emit_(Pid, Ev, Payload) ->
    Id_ = integer_to_binary(erlang:unique_integer([positive])),
    Pid ! {bv_emit, self(), Ev, Payload, Id_},
    bv_await_emit_(Id_).
bv_await_emit_(Id_) ->
    receive {bv_reply, Id_, R_} -> R_; {bv_error, Id_, _} -> null;
        ${serveClasses('bv_await_emit_(Id_)')};
        ${asideLine('bv_await_emit_(Id_)')} end.
%% Register this process for an emitter instance's event.
bv_on_(Pid, Ev) when is_pid(Pid) ->
    Ref_ = make_ref(),
    Pid ! {bv_on, Ev, self(), self(), Ref_},
    receive {bv_reply, Ref_, _} -> ok end;
bv_on_(_, _) -> ok.
%% Run subscription callbacks for notifications an instance has sent us.
bv_drain_notify_() ->
    receive
        {bv_notify, SubId_, Re_} ->
            case get({pending_subscribe, SubId_}) of
                F_ when is_function(F_) -> F_(Re_);
                _ -> ok
            end,
            bv_drain_notify_()
    after 0 -> ok
    end.

%% An Object nested as one value of a reply: its wire form, if it is still the
%% packed {Pos, Named} pair.
bv_object_wire({Pos, Named}) when is_list(Pos), is_map(Named) -> structure_splat({Pos, Named});
bv_object_wire(V) -> V.

structure_splat({Pos, Named}) ->
    HasPos = length(Pos) > 0,
    HasNamed = map_size(Named) > 0,
    if
        HasPos andalso HasNamed -> Pos ++ [Named];
        HasPos -> Pos;
        HasNamed -> Named;
        %% An empty Object's wire form is []; #{} and [#{}] are read as the same.
        true -> []
    end.

structure_splat_ty(TyFirst) when is_list(TyFirst) ->
    case TyFirst of
        [] -> [];
        _ ->
            Last = lists:last(TyFirst),
            case is_map(Last) of
                true when length(TyFirst) =:= 1 -> Last;
                _ -> TyFirst
            end
    end;
structure_splat_ty(M) when is_map(M) -> M;
structure_splat_ty(_) -> null.

%% ── Type matching ───────────────────────────────────────────────────────────
%% Bare type name of a parameter annotation (Alias::Name -> Name, Name -> Name).
bv_bare_name(T) when is_binary(T) -> lists:last(binary:split(T, <<"::">>, [global]));
bv_bare_name(T) -> T.

%% A type value's wire tag is its authority address carrying ::Name; the
%% parameter spells the type by name (possibly Alias::Name). Match on the bare
%% type name (authority is identity that travels, not a v1 match key).
type_member_of(Actual, Expected) when Actual =:= Expected -> true;
type_member_of(Actual, Expected) when is_binary(Expected) ->
    An = bv_type_name(Actual),
    case (An =/= undefined) andalso (An =:= bv_bare_name(Expected)) of
        true -> true;
        false ->
            case binary:match(Expected, <<"|">>) of
                nomatch -> false;
                _ ->
                    Parts = binary:split(Expected, <<"|">>, [global]),
                    lists:any(fun(P) ->
                        T = string:trim(P),
                        T =:= Actual orelse
                            ((An =/= undefined) andalso (An =:= bv_bare_name(T)))
                    end, Parts)
            end
    end;
type_member_of(_, _) -> false.

%% Whether an in-process arg value (no tag travels with it) can be a param of
%% type T. Only a scalar member can contradict a value's kind; any other type is
%% not judged here. An absent (optional) arg fits.
bv_value_fits('__bv_absent', _T) -> true;
bv_value_fits(V, T) ->
    lists:any(fun(M) -> bv_value_fits_one(V, string:trim(M)) end, binary:split(T, <<"|">>, [global])).
bv_value_fits_one(V, <<"Integer">>) -> is_integer(V);
bv_value_fits_one(V, <<"Text">>) -> is_binary(V);
bv_value_fits_one(V, <<"Boolean">>) -> is_boolean(V);
bv_value_fits_one(V, M) when M =:= <<"Float">>; M =:= <<"Decimal">> ->
    not is_binary(V) andalso not is_boolean(V) andalso V =/= null;
bv_value_fits_one(V, <<"null">>) -> V =:= null;
bv_value_fits_one(_, _) -> true.

%% An overload clause's guard for an in-process call: every arg value fits its param.
bv_values_fit(Pos, Named, PosTypes, NamedTypes) ->
    Nth = fun(I) -> case I =< length(Pos) of true -> lists:nth(I, Pos); false -> '__bv_absent' end end,
    lists:all(fun({I, T}) -> bv_value_fits(Nth(I), T) end, lists:zip(lists:seq(1, length(PosTypes)), PosTypes))
        andalso lists:all(fun({K, T}) -> bv_value_fits(maps:get(K, Named, '__bv_absent'), T) end, NamedTypes).

match_types(Message, Pairs) ->
    case maps:find(<<"ty">>, Message) of
        {ok, Ty} when is_list(Ty), length(Ty) > 0 ->
            TypesObj = hd(Ty),
            lists:all(fun({Name, TypeName}) ->
                case maps:find(Name, TypesObj) of
                    {ok, _} when TypeName =:= <<"Anything">> -> true;
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
    case maps:find(<<"ty">>, Message) of
        {ok, Ty} when is_list(Ty), length(Ty) > 0 ->
            %% An all-named call's tags are the named map alone: no positionals.
            TypesArr = case hd(Ty) of M0 when is_map(M0) -> [M0]; T0 -> T0 end,
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
                                            {ok, _} when T =:= <<"Anything">> -> true;
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
            Ok = T =:= <<"Anything">>
                orelse (is_list(Actual) andalso (T =:= <<"List">> orelse T =:= <<"List of Anything">>))
                orelse (is_binary(Actual) andalso type_member_of(Actual, T)),
            case Ok of
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

%% The tag for a value whose slot is declared as a union or 'Anything': the member
%% the value is, else the value's own kind (a list: each element's). M is
%% [{Kind, Tag}]; <<"*">> is a member taken when no other matches.
bv_ty_of(V, M) ->
    K = bv_as_kind(V),
    Alt = case K of <<"Integer">> -> [<<"Float">>, <<"Decimal">>]; <<"null">> -> [<<"List">>]; _ -> [] end,
    case bv_ty_pick_([K | Alt] ++ [<<"*">>], M) of
        {ok, T} -> T;
        none when is_list(V) -> El = [E || {Ek, _} = E <- M, Ek =/= <<"List">>], [bv_ty_of(X, El) || X <- V];
        none when is_map(V), is_map_key(<<"__type">>, V) -> <<"::", (lists:last(binary:split(K, <<"::">>, [global])))/binary>>;
        none -> K
    end.
bv_ty_pick_([], _) -> none;
bv_ty_pick_([K | Ks], M) ->
    case lists:keyfind(K, 1, M) of {_, T} -> {ok, T}; false -> bv_ty_pick_(Ks, M) end.

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

%% A reply whose whole value is one actor: its address is in re, and ty, if
%% any, is that address without its trailing number (C N, or an opaque C/N),
%% its class.
bv_self_reply_(<<"#<", _/binary>> = Re, Message) when byte_size(Re) >= 3, binary_part(Re, byte_size(Re), -1) =:= <<">">> ->
    Addr_ = binary:part(Re, 2, byte_size(Re) - 3),
    Class_ = case re:run(Addr_, <<"[ /][0-9]+$">>) of
        {match, [{P_, _}]} -> binary:part(Addr_, 0, P_);
        nomatch -> Addr_
    end,
    case maps:find(<<"ty">>, Message) of
        error -> [Re];
        {ok, Class_} -> [Re];
        _ -> Re
    end;
bv_self_reply_(Re, Message) -> bv_unwire_reply(Re, maps:get(<<"ty">>, Message, null)).

await_response_(Id) ->
    case bv_await_line_(Id) of
        {re, Message} -> bv_self_reply_(maps:get(<<"re">>, Message), Message);
        {ex, Message} -> error({ex_response, Message});
        eof -> null
    end.

await_new_response_(Id) ->
    case bv_await_line_(Id) of
        {re, Message} ->
            case maps:get(<<"re">>, Message) of
                <<"#<", Rest/binary>> ->
                    Len = byte_size(Rest) - 1,
                    <<Addr:Len/binary, ">">> = Rest,
                    Addr;
                _ -> maps:get(<<"from">>, Message, null)
            end;
        _ -> null
    end.

%% ── Wire-format helpers ─────────────────────────────────────────────────────
%% Given a to-field binary, the wire name its last token names on us (val,
%% ~val, #x, @N). The to is relative to us (. x, x, or #<alias x>). Returns the
%% name or nomatch.
extract_to_selector_(Bin) when is_binary(Bin) ->
    Sz = byte_size(Bin),
    Inner = case Bin of
        <<"#<", Rest:(Sz - 3)/binary, ">">> -> Rest;
        _ -> Bin
    end,
    case catch bv_opre_split_(Inner) of
        Toks when is_list(Toks), Toks =/= [] ->
            case lists:last(Toks) of
                self -> nomatch;
                Last when is_binary(Last) -> Last
            end;
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
  'Result', 'Re', 'Resp', 'Resp0', 'Ex', 'TyRe', 'TyFirst',
  'S_pos', 'S_named', 'Args_pos', 'Args_named',
]);

function erlVarName(name) {
  // Erlang vars must start uppercase. camelCase → CamelCase, snake_case → Snake_case
  if (!name) return '_';
  // Private function names (#name) → Pv_name (# is not valid in Erlang identifiers)
  if (name.startsWith('#')) name = 'pv_' + name.slice(1);
  name = name.replace(/!/g, '__w');
  const base = name.charAt(0).toUpperCase() + name.slice(1);
  if (RESERVED_ERL_VARS.has(base)) return 'V_' + base;
  return base;
}

function erlString(s) {
  // Erlang binary string literal with UTF-8 encoding
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `<<"${escaped}"/utf8>>`;
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

// An op carrying a payload, in canonical wire shape: no args is the bare
// selector, named only \`[#{k => v}, Sel]\`, otherwise \`[[p…], Sel]\` with
// any named slots in a trailing map: \`[[p…, #{k => v}], Sel]\`.
function erlOpExpr(vals, fields, method) {
  if (vals.length === 0 && !fields) return method;
  if (vals.length === 0) return `[#{${fields}}, ${method}]`;
  return `[[${[...vals, ...(fields ? [`#{${fields}}`] : [])].join(', ')}], ${method}]`;
}

// An actor's own label as the key it dispatches on: its wire name (`@a` is
// `a`, `a` is `~a`), and for a cell or class arm (`set@val`, `new@Box`) the
// intrinsic and the token of `to` it answers for: `{<<"$set">>, <<"val">>}`.
function erlOp(name) {
  const arm = intrinsicArm(name);
  if (arm) return `{${erlString(arm.op)}, ${erlString(arm.target)}}`;
  return erlString(wireLabel(name));
}

// The op an ex names for one of an actor's labels: an intrinsic arm by its
// intrinsic alone (`set@val` is `$set`).
function erlExKey(name) {
  const arm = intrinsicArm(name);
  return erlString(arm ? arm.op : wireLabel(name));
}

export { PREAMBLE, RESERVED_ERL_VARS, erlVarName, erlString, erlStateKey, erlOpExpr, erlOp, erlExKey };
