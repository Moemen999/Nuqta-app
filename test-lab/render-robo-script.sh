#!/usr/bin/env bash
# بيولّد نسخة حقيقية من robo-script.json وقت التشغيل، بعيد عن شجرة الريبو خالص —
# عشان أي باسورد ميقعدش في ملف جوه working tree زي ما حصل قبل كده (شوف
# CLAUDE.md، حادثة تسريب test-lab/robo-script.json). لازم يتنفّذ في CI بعد
# ما ROBO_TEST_EMAIL و ROBO_TEST_PASSWORD يتحطّوا في الـ env من GitHub secrets.
#
# استخدام: ROBO_TEST_EMAIL=... ROBO_TEST_PASSWORD=... ./render-robo-script.sh [output-path]
# لو مفيش output-path اتبعت، بيستخدم $RUNNER_TEMP/robo-script.json.

set -euo pipefail

: "${ROBO_TEST_EMAIL:?ROBO_TEST_EMAIL is not set}"
: "${ROBO_TEST_PASSWORD:?ROBO_TEST_PASSWORD is not set}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
template="${script_dir}/robo-script.json"

if [ -n "${1:-}" ]; then
  out="$1"
else
  : "${RUNNER_TEMP:?RUNNER_TEMP is not set — pass an explicit output path when running outside GitHub Actions}"
  out="${RUNNER_TEMP}/robo-script.json"
fi

jq --arg email "$ROBO_TEST_EMAIL" --arg password "$ROBO_TEST_PASSWORD" '
  walk(
    if type == "string" then
      gsub("__ROBO_TEST_EMAIL__"; $email) | gsub("__ROBO_TEST_PASSWORD__"; $password)
    else
      .
    end
  )
' "$template" > "$out"

echo "robo script rendered -> $out"
