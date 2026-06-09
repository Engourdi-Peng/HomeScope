with open(r'e:\cursor\HomeScope\extension\content.js', 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')

depth = 0
in_str = False
str_char = None
in_multiline_comment = False
errors = []

for lineno, line in enumerate(lines, 1):
    i = 0
    while i < len(line):
        c = line[i]

        if not in_multiline_comment:
            if c in ('"', "'", '`') and (i == 0 or line[i-1] != '\\'):
                if not in_str:
                    in_str = True
                    str_char = c
                elif c == str_char:
                    in_str = False
                    str_char = None
                i += 1
                continue

        if in_str:
            i += 1
            continue

        if not in_multiline_comment and i < len(line) - 1 and line[i:i+2] == '//':
            break

        if not in_str:
            if i < len(line) - 1 and line[i:i+2] == '/*':
                in_multiline_comment = True
                i += 2
                continue
            if i < len(line) - 1 and line[i:i+2] == '*/':
                in_multiline_comment = False
                i += 2
                continue

        if in_multiline_comment:
            i += 1
            continue

        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth < 0:
                errors.append('Line %d: unexpected ")": %s' % (lineno, line.strip()))
                depth = 0

        i += 1

print('Errors found:', len(errors))
for e in errors[:30]:
    print(e)
print('Final depth:', depth)
print('Total lines:', len(lines))
