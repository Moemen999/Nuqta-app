#!/usr/bin/env bash
# قفل الأدوات: أداة واحدة بس (Claude Code أو Antigravity) شغّالة على نسخة
# الريبو دي في نفس الوقت. التفاصيل في CLAUDE.md ← "قفل الأدوات".
#
#   scripts/agent-lock.sh acquire <tool>   # قبل أي شغل — بيفشل لو فيه قفل
#   scripts/agent-lock.sh release <tool>   # بعد ما تخلص — بس لو القفل بتاعك
#   scripts/agent-lock.sh status           # مين شايله ومن امتى
#
# القفل **محلي للنسخة دي من الريبو** (.agent-lock متجاهَل في git): بيمنع
# أداتين على نفس الفولدر، ومش بيشوف جلسة سحابية على نسخة تانية.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
LOCK=.agent-lock
STALE_HOURS=12

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
field() { sed -n "s/^$1=//p" "$LOCK" 2>/dev/null | head -1; }

age_hours() {
  local started epoch_started
  started=$(field started)
  # GNU date (لينكس/Git Bash) أو BSD (ماك). لو الاتنين فشلوا: فاضي — مش صفر،
  # لأن صفر كان هيطلع عمر آلاف الساعات ويخلّي قفل شغال يبان قديم
  epoch_started=$(date -u -d "$started" +%s 2>/dev/null || date -u -j -f %Y-%m-%dT%H:%M:%SZ "$started" +%s 2>/dev/null || true)
  [ -n "$epoch_started" ] || return 0
  echo $(( ($(date -u +%s) - epoch_started) / 3600 ))
}

show() {
  echo "القفل شايله: $(field tool) — من $(field started) (فرع: $(field branch))"
  local age; age=$(age_hours)
  if [ -z "$age" ]; then
    echo "⚠️  مش قادر أقرا وقت القفل ($(field started)) — متعتبروش قديم؛ اتأكد بنفسك إن الأداة مش شغالة."
  elif [ "$age" -ge "$STALE_HOURS" ]; then
    echo "⚠️  القفل عنده $age ساعة — غالبًا الأداة وقعت ومشالتوش. اتأكد إنها مش شغالة،"
    echo "   وبص على git status، وبعدين امسحه بإيدك: rm $LOCK  (شوف CLAUDE.md)"
  fi
}

case "${1:-}" in
  acquire)
    tool="${2:?اكتب اسم الأداة: acquire claude-code | acquire antigravity}"
    # noclobber: لو أداتين حاولوا في نفس اللحظة، واحدة بس تكسب
    if ! ( set -o noclobber; printf 'tool=%s\nstarted=%s\nbranch=%s\n' \
        "$tool" "$(now)" "$(git branch --show-current)" > "$LOCK" ) 2>/dev/null; then
      echo "❌ مش هينفع تبدأ — فيه أداة تانية شغالة."
      show
      exit 1
    fi
    echo "✅ القفل بقى مع $tool"
    ;;
  release)
    tool="${2:?اكتب اسم الأداة: release claude-code | release antigravity}"
    [ -f "$LOCK" ] || { echo "مفيش قفل أصلاً."; exit 0; }
    holder=$(field tool)
    if [ "$holder" != "$tool" ]; then
      echo "❌ القفل مع $holder مش $tool — مش هشيله. لو متأكد إنه قديم، امسحه بإيدك."
      show
      exit 1
    fi
    rm -f "$LOCK"
    echo "✅ القفل اتشال"
    ;;
  status)
    if [ -f "$LOCK" ]; then show; else echo "مفيش قفل — الريبو فاضي."; fi
    ;;
  *)
    echo "الاستخدام: $0 acquire <tool> | release <tool> | status" >&2
    exit 2
    ;;
esac
