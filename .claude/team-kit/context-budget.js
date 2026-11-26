#!/usr/bin/env node
/**
 * ميزانية السياق — القاعدة اللي بتوفّر فعلاً (2026-11-26، طلب مؤمن).
 *
 * الدليل: جلسة «Subagents haike session» (15→20 نوفمبر) ≈ 573 دولار بسعر
 * القايمة، opus منها ≈ 525 (92%)، والوكلاء (sonnet + haiku) ≈ 48 بس.
 * الصرف كان في الجلسة الرئيسية: كل رسالة بتعيد قراية السياق كله (~275 ألف
 * توكن في الرسالة). وتجربة جرافيفاي (2026-11-25) وفّرت 2% بس. يعني اللي
 * بيوفّر هو **طول الجلسة**، مش أداة ولا تبديل وكيل.
 *
 * بيشتغل على UserPromptSubmit: بيقرا آخر `usage` للجلسة الرئيسية من الـ
 * transcript ويحسب حجم السياق (input + cache read + cache creation). فوق
 * الحد بيقول للمستخدم ولـClaude: اقفل البند، كوميت، سطر تسليم، وبعدين
 * `/clear` أو جلسة جديدة. **مبيمنعش أي حاجة** — تنبيه بس.
 */
const fs = require('fs');

const WARN = 150_000;
const STRONG = 250_000;
const TAIL_BYTES = 2_000_000;

/** آخر حجم سياق للجلسة الرئيسية (مش الوكلاء) من نص الـtranscript، أو null */
function lastContextTokens(jsonlText) {
  const lines = jsonlText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l.includes('"usage"')) continue;
    let d;
    try { d = JSON.parse(l); } catch { continue; }
    if (d.type !== 'assistant' || d.isSidechain) continue;
    const u = d.message && d.message.usage;
    if (!u) continue;
    return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  }
  return null;
}

function readTail(file) {
  const st = fs.statSync(file);
  const start = Math.max(0, st.size - TAIL_BYTES);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

const k = n => `${Math.round(n / 1000)} ألف`;

/** الحكم: null أو { user, claude } */
function decide(tokens) {
  if (tokens == null || tokens < WARN) return null;
  const strong = tokens >= STRONG;
  const user = strong
    ? `⚠️ السياق ${k(tokens)} توكن — كل رسالة بتعيد قرايته كله. خلّص البند اللي في إيدك واعمل /clear أو افتح جلسة جديدة.`
    : `السياق ${k(tokens)} توكن. أول ما البند ده يخلص: /clear أو جلسة جديدة.`;
  const claude = `[ميزانية السياق] السياق دلوقتي ≈ ${k(tokens)} توكن (الحد ${k(WARN)}/${k(STRONG)}). `
    + 'متبدأش بند جديد في الجلسة دي. خلّص اللي في إيدك، كوميت وpush، اكتب سطر تسليم '
    + '(الوضع + الجاي) في TIMELINE أو reports، وقول لمؤمن يعمل /clear أو جلسة جديدة. '
    + 'أي استقصاء أو مراجعة تقيلة تتفوّض لوكيل بدل ما تتقري في الجلسة الرئيسية.';
  return { user, claude, strong };
}

module.exports = { lastContextTokens, decide, WARN, STRONG };

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(raw || '{}');
      if (!input.transcript_path || !fs.existsSync(input.transcript_path)) return process.exit(0);
      const v = decide(lastContextTokens(readTail(input.transcript_path)));
      if (v) {
        process.stdout.write(JSON.stringify({
          systemMessage: v.user,
          hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: v.claude },
        }));
      }
    } catch (e) {
      process.stderr.write(`context-budget وقع: ${e && e.message}\n`);
    }
    process.exit(0);
  });
}
