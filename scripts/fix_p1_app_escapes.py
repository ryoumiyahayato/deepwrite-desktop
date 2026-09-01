from pathlib import Path

path = Path('src/App.tsx')
text = path.read_text(encoding='utf-8')

broken_string = "'\n'"
string_count = text.count(broken_string)
if string_count != 5:
    raise SystemExit(f"expected 5 broken newline string literals, found {string_count}")
text = text.replace(broken_string, "'\\n'")

broken_regex = "split(/\n+/)"
regex_count = text.count(broken_regex)
if regex_count != 1:
    raise SystemExit(f"expected 1 broken continuation split regex, found {regex_count}")
text = text.replace(broken_regex, r"split(/\n+/)")

path.write_text(text, encoding='utf-8', newline='\n')
print('repaired 5 newline string literals and 1 regex literal')
