#!/usr/bin/env python3
"""Convert expectBehavior calls from {input, output} to separate step objects.

Old: expectBehavior(script, { input: X, output: Y })
New: expectBehavior(script, { input: X }, { output: Y })

Handles both single-line and multi-line forms.
"""

import re
import sys
from pathlib import Path


def find_balanced_end(text, start):
    """Find the index after the closing brace/bracket matching the one at start."""
    opener = text[start]
    closer = '}' if opener == '{' else ']'
    depth = 1
    i = start + 1
    in_string = None
    while i < len(text):
        ch = text[i]
        if in_string:
            if ch == '\\':
                i += 2
                continue
            if ch == in_string:
                in_string = None
        elif ch in ("'", '"', '`'):
            in_string = ch
        elif ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return -1


def split_input_output(obj_text):
    """Given text of { input: ..., output: ... }, return (input_val, output_val) or None.
    obj_text starts with { and ends with }."""
    inner = obj_text[1:-1]  # strip outer braces

    # Find ', output:' at brace depth 0
    i = 0
    depth = 0
    in_string = None
    split_pos = None

    while i < len(inner):
        ch = inner[i]
        if in_string:
            if ch == '\\':
                i += 2
                continue
            if ch == in_string:
                in_string = None
        elif ch in ("'", '"', '`'):
            in_string = ch
        elif ch in ('{', '[', '('):
            depth += 1
        elif ch in ('}', ']', ')'):
            depth -= 1
        elif depth == 0:
            # Check for output: preceded by comma (with optional whitespace/newline)
            rest = inner[i:]
            m = re.match(r',\s*output:', rest)
            if m:
                split_pos = i
                split_len = m.end()
                break
        i += 1

    if split_pos is None:
        return None

    input_part = inner[:split_pos].strip()
    output_part = 'output:' + inner[split_pos + re.match(r',\s*output:', inner[split_pos:]).end() - len('output:'):].strip()

    # Actually, let me be more precise
    comma_match = re.match(r',\s*', inner[split_pos:])
    after_comma = split_pos + comma_match.end()
    output_part = inner[after_comma:].strip()

    # Handle trailing comma
    if output_part.endswith(','):
        output_part = output_part[:-1].rstrip()

    return input_part, output_part


def convert_file(filepath):
    text = filepath.read_text()
    if 'expectBehavior' not in text:
        return False

    changed = False

    # Handle single-line cases: expectBehavior(script, { input: ..., output: ... });
    def convert_single_line(m):
        nonlocal changed
        full_line = m.group(0)

        # Already converted?
        if '}, { output:' in full_line:
            return full_line

        prefix = m.group(1)  # everything up to the {
        brace_start = len(prefix)
        # Find the { in the full line
        rest = full_line[brace_start:]
        obj_end = find_balanced_end(rest, 0)
        if obj_end == -1:
            return full_line

        obj_text = rest[:obj_end]
        result = split_input_output(obj_text)
        if result is None:
            return full_line

        input_part, output_part = result
        changed = True
        return prefix + '{ ' + input_part + ' }, { ' + output_part + ' }' + rest[obj_end:]

    # Single line pattern
    text = re.sub(
        r'(await expectBehavior\([^,]+,\s*)\{[^\n]*input:[^\n]*output:[^\n]*\}[^\n]*',
        convert_single_line,
        text
    )

    # Handle multi-line cases:
    # expectBehavior(script, {
    #   input: ...,
    #   output: ...,
    # });
    lines = text.split('\n')
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r'^(\s*)(await expectBehavior\([^,]+,)\s*\{\s*$', line)
        if m:
            indent = m.group(1)
            call_prefix = m.group(2)  # "await expectBehavior(script,"
            inner_indent = indent + '  '

            # Collect lines until we find the closing });
            j = i + 1
            body_lines = []
            found_end = False
            while j < len(lines):
                stripped = lines[j].strip()
                if stripped in ('});', '});,'):
                    found_end = True
                    j += 1
                    break
                body_lines.append(lines[j])
                j += 1

            if not found_end:
                out.append(line)
                i += 1
                continue

            # Parse the body to find input: and output:
            body_text = '{\n' + '\n'.join(body_lines) + '\n}'
            # Remove trailing comma before }
            body_text = re.sub(r',\s*\n\s*\}$', '\n}', body_text)

            result = split_input_output(body_text)
            if result is None:
                # Not convertible, keep original
                for k in range(i, j):
                    out.append(lines[k])
                i = j
                continue

            input_part, output_part = result

            # Clean up: normalize whitespace in input/output parts
            input_clean = ' '.join(input_part.split())
            output_clean = ' '.join(output_part.split())

            # Emit new format
            out.append(f'{indent}{call_prefix}')
            out.append(f'{inner_indent}{{ {input_clean} }},')
            out.append(f'{inner_indent}{{ {output_clean} }},')
            out.append(f'{indent});')
            changed = True
            i = j
        else:
            out.append(line)
            i += 1

    if changed:
        filepath.write_text('\n'.join(out))
    return changed


def main():
    if len(sys.argv) >= 2:
        paths = [Path(f) for f in sys.argv[1:]]
    else:
        paths = sorted(Path('__tests__').rglob('*.test.js'))

    for path in paths:
        if convert_file(path):
            print(f'converted  {path}')
        else:
            print(f'no change  {path}')


if __name__ == '__main__':
    main()
