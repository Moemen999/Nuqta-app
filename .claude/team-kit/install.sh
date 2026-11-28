#!/usr/bin/env bash
# بيثبّت توزيع الموديلات في ريبو تاني — إضافة بس:
# - بيضيف بلوك ROUTING.md لآخر CLAUDE.md (مرة واحدة، بعلامة)
# - مبيمسحش ولا بيعدّل أي وكيل أو مهارة؛ بيطبع بس الوكلاء اللي مالهمش model:
set -euo pipefail
target="${1:?استخدم: install.sh <مسار الريبو>}"
kit="$(cd "$(dirname "$0")" && pwd)"
md="$target/CLAUDE.md"
if [ -f "$md" ] && grep -q 'team-kit:routing:start' "$md"; then
  echo "البلوك موجود في $md — مفيش تغيير"
else
  { [ -f "$md" ] && echo; cat "$kit/ROUTING.md"; } >> "$md"
  echo "اتضاف البلوك لـ $md"
fi
# حارس ميزانية السياق — بيتنسخ لو مش موجود، وبيتضاف لـsettings.json من غير ما يلمس أي hook تاني
mkdir -p "$target/.claude/hooks"
[ -e "$target/.claude/hooks/context-budget.js" ] || cp "$kit/context-budget.js" "$target/.claude/hooks/context-budget.js"; echo "حارس السياق: .claude/hooks/context-budget.js"
node - "$target/.claude/settings.json" <<'NODE'
const fs = require('fs'); const f = process.argv[2];
let s = {}; try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
s.hooks = s.hooks || {}; const list = s.hooks.UserPromptSubmit = s.hooks.UserPromptSubmit || [];
if (JSON.stringify(list).includes('context-budget.js')) { console.log('الحارس متوصّل قبل كده'); process.exit(0); }
list.push({ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/context-budget.js"', timeout: 10 }] });
fs.writeFileSync(f, JSON.stringify(s, null, 2) + '\n'); console.log('اتوصّل في ' + f);
NODE
agents="$target/.claude/agents"
if [ -d "$agents" ]; then
  total=$(find "$agents" -maxdepth 1 -name '*.md' | wc -l)
  echo "الوكلاء الموجودين: $total (ما اتلمسوش)"
  for f in "$agents"/*.md; do
    [ -e "$f" ] || continue
    grep -q '^model:' "$f" || echo "  من غير model: $(basename "$f") — اختار له من الجدول"
  done
fi
