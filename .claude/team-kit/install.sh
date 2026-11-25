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
agents="$target/.claude/agents"
if [ -d "$agents" ]; then
  total=$(find "$agents" -maxdepth 1 -name '*.md' | wc -l)
  echo "الوكلاء الموجودين: $total (ما اتلمسوش)"
  for f in "$agents"/*.md; do
    [ -e "$f" ] || continue
    grep -q '^model:' "$f" || echo "  من غير model: $(basename "$f") — اختار له من الجدول"
  done
fi
