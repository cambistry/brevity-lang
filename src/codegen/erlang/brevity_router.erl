-module(brevity_router).
-export([main/0]).

%% ── Router: manages actor instances inside a single Erlang VM ──────────────
%%
%% Protocol (JSON lines on stdin/stdout):
%%
%%   Commands (JS -> stdin):
%%     {"cmd":"load","mod":"brevity_actor_1","dir":"/path/to/comp1"}
%%     {"cmd":"spawn","id":"a1","mod":"brevity_actor_1","args":[1,"x"]}
%%     {"cmd":"msg","id":"a1","line":"{...json...}"}
%%     {"cmd":"stop","id":"a1"}
%%
%%   Events (stdout -> JS):
%%     {"ev":"loaded","mod":"brevity_actor_1"}
%%     {"ev":"spawned","id":"a1"}
%%     {"ev":"out","id":"a1","data":{raw json line}}
%%     {"ev":"ready","id":"a1"}

main() ->
    process_flag(trap_exit, true),
    Router = self(),
    %% Separate process reads stdin and forwards lines as messages.
    %% This lets the router handle both stdin commands and {emit,...}
    %% from group leaders without deadlocking.
    spawn_link(fun() -> stdin_reader(Router) end),
    router_loop(#{}).

stdin_reader(Router) ->
    case io:get_line("") of
        eof -> Router ! eof;
        {error, _} -> Router ! eof;
        Line ->
            Bin = unicode:characters_to_binary(string:trim(Line)),
            case Bin of
                <<>> -> ok;
                _ -> Router ! {cmd, Bin}
            end,
            stdin_reader(Router)
    end.

router_loop(Instances) ->
    receive
        {cmd, Bin} ->
            Cmd = decode_cmd(Bin),
            Instances2 = handle_cmd(Cmd, Instances),
            router_loop(Instances2);
        {emit, IoList} ->
            io:put_chars(standard_io, IoList),
            router_loop(Instances);
        eof ->
            %% stdin closed — kill all instances and exit
            maps:foreach(fun(_Id, #{pid := Pid, gl := GL}) ->
                exit(Pid, kill),
                exit(GL, kill)
            end, Instances),
            ok;
        {'EXIT', _Pid, _Reason} ->
            router_loop(Instances)
    end.

%% ── Command dispatch ───────────────────────────────────────────────────────

handle_cmd(#{<<"cmd">> := <<"load">>, <<"mod">> := ModBin, <<"dir">> := DirBin}, Instances) ->
    Dir = binary_to_list(DirBin),
    Mod = binary_to_atom(ModBin, utf8),
    code:add_patha(Dir),
    {module, Mod} = code:load_file(Mod),
    io:put_chars(standard_io, ["{\"ev\":\"loaded\",\"mod\":\"", ModBin, "\"}\n"]),
    Instances;

handle_cmd(#{<<"cmd">> := <<"spawn">>, <<"id">> := Id, <<"mod">> := ModBin, <<"args">> := Args}, Instances) ->
    Mod = binary_to_atom(ModBin, utf8),
    Router = self(),
    GL = spawn_link(fun() -> group_leader_loop(Id, Router) end),
    Pid = spawn_link(fun() ->
        group_leader(GL, self()),
        Mod:start(Args)
    end),
    GL ! {set_actor, Pid},
    io:put_chars(standard_io, ["{\"ev\":\"spawned\",\"id\":\"", Id, "\"}\n"]),
    Instances#{Id => #{pid => Pid, gl => GL}};

handle_cmd(#{<<"cmd">> := <<"msg">>, <<"id">> := Id, <<"line">> := LineBin}, Instances) ->
    #{Id := #{gl := GL}} = Instances,
    GL ! {input_line, LineBin},
    Instances;

handle_cmd(#{<<"cmd">> := <<"stop">>, <<"id">> := Id}, Instances) ->
    case maps:find(Id, Instances) of
        {ok, #{pid := Pid, gl := GL}} ->
            unlink(Pid),
            unlink(GL),
            exit(Pid, kill),
            exit(GL, kill),
            maps:remove(Id, Instances);
        error -> Instances
    end.

%% ── Group leader: intercepts actor I/O ─────────────────────────────────────
%%
%% The actor process uses standard io:get_line/io:put_chars calls.
%% This group leader:
%%   - Feeds input lines from {input_line, Bin} messages
%%   - Captures output and emits {"ev":"out",...} events
%%   - Emits {"ev":"ready",...} when the actor requests more input

group_leader_loop(Id, Router) ->
    receive
        {set_actor, _Pid} -> ok
    end,
    gl_loop(Id, Router, queue:new()).

gl_loop(Id, Router, InputQ) ->
    receive
        %% Input line queued from router
        {input_line, LineBin} ->
            gl_loop(Id, Router, queue:in(LineBin, InputQ));

        %% io:put_chars request from actor
        {io_request, From, Ref, {put_chars, Enc, Chars}} ->
            Data = case Enc of
                unicode -> unicode:characters_to_binary(Chars);
                _ -> iolist_to_binary(Chars)
            end,
            %% Strip trailing newline if present (the actor adds \n)
            Trimmed = strip_newline(Data),
            case Trimmed of
                <<>> -> ok;
                _ ->
                    Router ! {emit, ["{\"ev\":\"out\",\"id\":\"", Id, "\",\"data\":", Trimmed, "}\n"]}
            end,
            From ! {io_reply, Ref, ok},
            gl_loop(Id, Router, InputQ);

        %% io:put_chars without encoding
        {io_request, From, Ref, {put_chars, Chars}} ->
            Data = iolist_to_binary(Chars),
            Trimmed = strip_newline(Data),
            case Trimmed of
                <<>> -> ok;
                _ ->
                    Router ! {emit, ["{\"ev\":\"out\",\"id\":\"", Id, "\",\"data\":", Trimmed, "}\n"]}
            end,
            From ! {io_reply, Ref, ok},
            gl_loop(Id, Router, InputQ);

        %% io:get_line request from actor
        {io_request, From, Ref, {get_line, _Enc, _Prompt}} ->
            %% Signal that previous message processing is complete
            Router ! {emit, ["{\"ev\":\"ready\",\"id\":\"", Id, "\"}\n"]},
            gl_wait_input(Id, Router, InputQ, From, Ref);

        %% io:get_line (without encoding)
        {io_request, From, Ref, {get_line, _Prompt}} ->
            Router ! {emit, ["{\"ev\":\"ready\",\"id\":\"", Id, "\"}\n"]},
            gl_wait_input(Id, Router, InputQ, From, Ref);

        %% Catch-all for other io_requests (e.g. getopts, setopts)
        {io_request, From, Ref, _Request} ->
            From ! {io_reply, Ref, {error, enotsup}},
            gl_loop(Id, Router, InputQ);

        %% Handle actor process exit
        {'EXIT', _Pid, _Reason} ->
            ok
    end.

%% Wait for an input line to satisfy a pending io:get_line request
gl_wait_input(Id, Router, InputQ, From, Ref) ->
    case queue:out(InputQ) of
        {{value, LineBin}, InputQ2} ->
            From ! {io_reply, Ref, unicode:characters_to_list(<<LineBin/binary, "\n">>)},
            gl_loop(Id, Router, InputQ2);
        {empty, _} ->
            receive
                {input_line, LineBin} ->
                    From ! {io_reply, Ref, unicode:characters_to_list(<<LineBin/binary, "\n">>)},
                    gl_loop(Id, Router, InputQ);
                {'EXIT', _Pid, _Reason} ->
                    From ! {io_reply, Ref, eof},
                    ok
            end
    end.

strip_newline(<<>>) -> <<>>;
strip_newline(Data) ->
    Sz = byte_size(Data) - 1,
    case Data of
        <<Pre:Sz/binary, $\n>> -> Pre;
        _ -> Data
    end.

%% ── Minimal JSON command decoder ───────────────────────────────────────────
%% Only needs to handle the router command format (flat objects with string/list values).

decode_cmd(Bin) ->
    {Obj, _} = decode_value(skip_ws(Bin)),
    Obj.

decode_value(<<${, Rest/binary>>) -> decode_object(skip_ws(Rest), #{});
decode_value(<<$[, Rest/binary>>) -> decode_array(skip_ws(Rest), []);
decode_value(<<$", _/binary>> = Bin) -> decode_string(Bin);
decode_value(<<"true", Rest/binary>>) -> {true, Rest};
decode_value(<<"false", Rest/binary>>) -> {false, Rest};
decode_value(<<"null", Rest/binary>>) -> {null, Rest};
decode_value(Bin) -> decode_number(Bin).

decode_object(<<$}, Rest/binary>>, Acc) -> {Acc, Rest};
decode_object(Bin, Acc) ->
    {Key, R1} = decode_string(Bin),
    <<$:, R2/binary>> = skip_ws(R1),
    {Val, R3} = decode_value(skip_ws(R2)),
    R4 = skip_ws(R3),
    case R4 of
        <<$,, R5/binary>> -> decode_object(skip_ws(R5), Acc#{Key => Val});
        <<$}, R5/binary>> -> {Acc#{Key => Val}, R5}
    end.

decode_array(<<$], Rest/binary>>, Acc) -> {lists:reverse(Acc), Rest};
decode_array(Bin, Acc) ->
    {Val, R1} = decode_value(skip_ws(Bin)),
    R2 = skip_ws(R1),
    case R2 of
        <<$,, R3/binary>> -> decode_array(skip_ws(R3), [Val | Acc]);
        <<$], R3/binary>> -> {lists:reverse([Val | Acc]), R3}
    end.

decode_string(<<$", Rest/binary>>) -> decode_string_body(Rest, []).

decode_string_body(<<$", Rest/binary>>, Acc) ->
    {iolist_to_binary(lists:reverse(Acc)), Rest};
decode_string_body(<<$\\, $", Rest/binary>>, Acc) ->
    decode_string_body(Rest, [$" | Acc]);
decode_string_body(<<$\\, $\\, Rest/binary>>, Acc) ->
    decode_string_body(Rest, [$\\ | Acc]);
decode_string_body(<<$\\, $/, Rest/binary>>, Acc) ->
    decode_string_body(Rest, [$/ | Acc]);
decode_string_body(<<$\\, $n, Rest/binary>>, Acc) ->
    decode_string_body(Rest, [$\n | Acc]);
decode_string_body(<<$\\, $t, Rest/binary>>, Acc) ->
    decode_string_body(Rest, [$\t | Acc]);
decode_string_body(<<$\\, $r, Rest/binary>>, Acc) ->
    decode_string_body(Rest, [$\r | Acc]);
decode_string_body(<<$\\, $u, A, B, C, D, Rest/binary>>, Acc) ->
    CP = list_to_integer([A, B, C, D], 16),
    decode_string_body(Rest, [<<CP/utf8>> | Acc]);
decode_string_body(<<C, Rest/binary>>, Acc) ->
    decode_string_body(Rest, [C | Acc]).

decode_number(Bin) -> decode_number(Bin, []).
decode_number(<<C, Rest/binary>>, Acc) when C >= $0, C =< $9; C =:= $-; C =:= $.; C =:= $e; C =:= $E; C =:= $+ ->
    decode_number(Rest, [C | Acc]);
decode_number(Rest, Acc) ->
    Str = lists:reverse(Acc),
    Num = case lists:member($., Str) orelse lists:member($e, Str) orelse lists:member($E, Str) of
        true -> list_to_float(Str);
        false -> list_to_integer(Str)
    end,
    {Num, Rest}.

skip_ws(<<$\s, Rest/binary>>) -> skip_ws(Rest);
skip_ws(<<$\t, Rest/binary>>) -> skip_ws(Rest);
skip_ws(<<$\n, Rest/binary>>) -> skip_ws(Rest);
skip_ws(<<$\r, Rest/binary>>) -> skip_ws(Rest);
skip_ws(Bin) -> Bin.
