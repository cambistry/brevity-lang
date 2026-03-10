#!/usr/bin/env python3
"""Convert test boilerplate to expectReply helper calls.

Handles:
  - Standard single-receive / single-reply
  - not.toHaveBeenCalled() → reply defaults to []
  - Inline compile('...') source → extract to const source
  - Non-default export name (actor tests)
  - Multi-line toHaveBeenCalledWith({...})
  - Import line cleanup

Skips blocks it cannot safely convert (prints a warning).

Usage:
  python3 convert_tests2.py                  # all __tests__/*.test.js
  python3 convert_tests2.py path/to/file.js
"""

import re
import sys
from pathlib import Path

COMPILE_SRC_RE  = re.compile(r'^(\s*)const \{ output \} = compile\((source)\);$')
COMPILE_INLINE_RE = re.compile(r'^(\s*)const \{ output \} = compile\(((?:\'[^\']*\'|`[^`]*`))\);$')
EVALUATE_RE     = re.compile(r"^\s*const \w+ = await evaluate\(output(?:,\s*(\'[^\']+\'|\"[^\"]+\"))?\);$")
BINDING_RE      = re.compile(r'^\s*const \w+ = \{ post: jest\.fn\(\) \};$')
ACTOR_VAR_RE    = re.compile(r'^\s*const actor = new \w+\(\w+\);$')
RECEIVE_RE      = re.compile(r'^\s*(?:new \w+\(\w+\)|\w+)\.receive\((.+)\);$')
AWAIT_RE        = re.compile(r'^\s*await new Promise\(resolve => setTimeout\(resolve, 0\)\);(\s*//.*)?$')
EXPECT_INLINE_RE = re.compile(r'^\s*expect\(\w+\.post\)\.toHaveBeenCalledWith\((\{.+\})\);$')
EXPECT_MULTI_RE  = re.compile(r'^\s*expect\(\w+\.post\)\.toHaveBeenCalledWith\(\{$')
EXPECT_OPEN_RE   = re.compile(r'^\s*expect\(\w+\.post\)\.toHaveBeenCalledWith\($')
EXPECT_NOT_RE    = re.compile(r'^\s*expect\(\w+\.post\)\.not\.toHaveBeenCalled\(\);$')

IMPORT_HELPERS_RE = re.compile(r"^import \{([^}]+)\} from '\.\/helpers\.js';$")


def convert_block(lines, start):
    """
    Try to convert the boilerplate block starting at lines[start].
    Returns (replacement_lines, end_index) or (None, start) if it can't convert.
    end_index is the first line AFTER the consumed block.
    """
    line = lines[start]
    base_indent = ''
    compile_arg = None
    inline_source = None

    m = COMPILE_SRC_RE.match(line)
    if m:
        base_indent = m.group(1)
        compile_arg = 'source'
    else:
        m2 = COMPILE_INLINE_RE.match(line)
        if m2:
            base_indent = m2.group(1)
            inline_source = m2.group(2)
            compile_arg = 'source'
        else:
            return None, start

    j = start + 1

    # evaluate line
    if j >= len(lines) or not EVALUATE_RE.match(lines[j]):
        return None, start
    eval_m = EVALUATE_RE.match(lines[j])
    export_name = eval_m.group(1) if eval_m and eval_m.group(1) else None
    j += 1

    # binding line
    if j >= len(lines) or not BINDING_RE.match(lines[j]):
        return None, start
    j += 1

    # optional: const actor = new Actor(binding);
    if j < len(lines) and ACTOR_VAR_RE.match(lines[j]):
        j += 1

    # receive line
    if j >= len(lines) or not RECEIVE_RE.match(lines[j]):
        return None, start
    receive_arg = RECEIVE_RE.match(lines[j]).group(1)
    j += 1

    # optional: await Promise
    if j < len(lines) and AWAIT_RE.match(lines[j]):
        j += 1

    # expect line
    if j >= len(lines):
        return None, start

    expected_arg = None
    not_called = False

    if EXPECT_NOT_RE.match(lines[j]):
        not_called = True
        j += 1

    elif EXPECT_INLINE_RE.match(lines[j]):
        expected_arg = EXPECT_INLINE_RE.match(lines[j]).group(1)
        j += 1

    elif EXPECT_MULTI_RE.match(lines[j]):
        # Collect body lines until '});'
        body_lines = []
        j += 1
        while j < len(lines):
            stripped = lines[j].strip()
            if stripped == '});':
                j += 1
                break
            body_lines.append(lines[j])
            j += 1
        # Re-indent body: add 2 spaces (reply: { is 2 deeper than base+2)
        re_indented = ['  ' + l for l in body_lines]
        closing = base_indent + '  }'
        expected_arg = '{\n' + '\n'.join(re_indented) + '\n' + closing

    elif EXPECT_OPEN_RE.match(lines[j]):
        # toHaveBeenCalledWith(\n  <arg>\n); — collect until standalone );
        arg_lines = []
        j += 1
        while j < len(lines):
            if lines[j].strip() == ');':
                j += 1
                break
            arg_lines.append(lines[j])
            j += 1
        if not arg_lines:
            return None, start
        if len(arg_lines) == 1:
            expected_arg = arg_lines[0].strip()
        else:
            # First line stripped (goes inline with reply:), rest keep indentation
            expected_arg = arg_lines[0].strip() + '\n' + '\n'.join(arg_lines[1:])

    else:
        return None, start

    # Build replacement lines
    out = []
    if inline_source:
        out.append(f'{base_indent}const source = {inline_source};')
    out.append(f'{base_indent}await expectReply({{')
    out.append(f'{base_indent}  source,')
    if export_name:
        out.append(f'{base_indent}  exportName: {export_name},')
    out.append(f'{base_indent}  receive: {receive_arg},')
    if not not_called:
        out.append(f'{base_indent}  reply: {expected_arg},')
    out.append(f'{base_indent}}});')

    return out, j


def update_imports(text):
    """Add expectReply to helpers import; strip unused compile/evaluate/jest imports."""
    lines = text.split('\n')
    out = []

    uses_evaluate  = bool(re.search(r'\bevaluate\s*\(', text))
    uses_compile   = bool(re.search(r'\bcompile\s*\(', text))
    uses_jest      = bool(re.search(r'\bjest\.fn\b', text))
    uses_expectReply = bool(re.search(r'\bexpectReply\b', text))

    for line in lines:
        # jest import
        if re.match(r"^import \{ jest \} from '@jest/globals';$", line):
            if uses_jest:
                out.append(line)
            # else drop it
            continue

        # compile import
        if re.match(r"^import compile from '\.\./index\.js';$", line):
            if uses_compile:
                out.append(line)
            continue

        # helpers import — add expectReply if needed
        m = IMPORT_HELPERS_RE.match(line)
        if m:
            names = [n.strip() for n in m.group(1).split(',')]
            if uses_expectReply and 'expectReply' not in names:
                names.append('expectReply')
            if not uses_evaluate:
                names = [n for n in names if n != 'evaluate']
            if names:
                out.append(f"import {{ {', '.join(names)} }} from './helpers.js';")
            continue

        out.append(line)

    return '\n'.join(out)


def convert_content(text, filename=''):
    lines = text.split('\n')
    out = []
    i = 0
    skipped = []

    while i < len(lines):
        line = lines[i]
        m = COMPILE_SRC_RE.match(line) or COMPILE_INLINE_RE.match(line)
        if m:
            replacement, end = convert_block(lines, i)
            if replacement is not None:
                out.extend(replacement)
                i = end
            else:
                skipped.append(i + 1)
                out.append(line)
                i += 1
        else:
            out.append(line)
            i += 1

    result = '\n'.join(out)
    result = update_imports(result)

    if skipped and filename:
        print(f'  ↳ skipped lines: {skipped} (manual review needed)')

    return result


def main():
    if len(sys.argv) >= 2:
        paths = [Path(f) for f in sys.argv[1:]]
    else:
        paths = sorted(Path('__tests__').glob('*.test.js'))

    for path in paths:
        original = path.read_text()
        converted = convert_content(original, str(path))
        if converted != original:
            path.write_text(converted)
            print(f'converted  {path}')
        else:
            print(f'no change  {path}')


if __name__ == '__main__':
    main()
