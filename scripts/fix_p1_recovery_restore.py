from pathlib import Path

path = Path('src/App.tsx')
text = path.read_text(encoding='utf-8')
old = "setRecovery(null); void writeRecovery(recovered.document, null).then(() => clearRecoveryKey(recovered.key)).catch((caught) => setError(`迁移恢复内容失败：${String(caught)}`));"
new = "setRecovery(null); const restoredKey = documentInstanceKey(recovered.document.id, null); void writeRecovery(recovered.document, null).then(() => recovered.key === restoredKey ? undefined : clearRecoveryKey(recovered.key)).catch((caught) => setError(`迁移恢复内容失败：${String(caught)}`));"
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected exactly one recovery restore migration chain, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8', newline='\n')
print('recovery restore migration now preserves same-key recovery')
