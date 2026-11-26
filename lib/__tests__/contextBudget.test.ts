// ميزانية السياق (2026-11-26): التنبيه بيتحسب من آخر usage للجلسة الرئيسية بس.
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const hook = require('../../.claude/hooks/context-budget.js');
const line = (o: object) => JSON.stringify(o);
const asst = (n: number, extra: object = {}) =>
  line({ type: 'assistant', message: { usage: { input_tokens: 2, cache_read_input_tokens: n, cache_creation_input_tokens: 0 } }, ...extra });

describe('ميزانية السياق', () => {
  it('بياخد آخر رسالة للجلسة الرئيسية ويتجاهل الوكلاء', () => {
    const t = [asst(100_000), asst(400_000, { isSidechain: true }), 'سطر بايظ {', ''].join('\n');
    expect(hook.lastContextTokens(t)).toBe(100_002);
  });
  it('من غير usage ← null ومفيش تنبيه', () => {
    expect(hook.lastContextTokens(line({ type: 'user' }))).toBeNull();
    expect(hook.decide(null)).toBeNull();
  });
  it('تحت الحد ساكت، وفوقه تنبيه، وفوق التاني تنبيه قوي', () => {
    expect(hook.decide(hook.WARN - 1)).toBeNull();
    expect(hook.decide(hook.WARN).strong).toBe(false);
    const v = hook.decide(hook.STRONG);
    expect(v.strong).toBe(true);
    expect(v.user).toContain('/clear');
    expect(v.claude).toContain('متبدأش بند جديد');
  });
  it('السكريبت نفسه: بيطلع JSON صالح ومبيوقعش على مدخل بايظ', () => {
    const f = path.join(os.tmpdir(), `cb-${process.pid}.jsonl`);
    fs.writeFileSync(f, asst(300_000));
    const script = path.join(__dirname, '../../.claude/hooks/context-budget.js');
    const out = execFileSync('node', [script], { input: JSON.stringify({ transcript_path: f }) }).toString();
    expect(JSON.parse(out).hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(execFileSync('node', [script], { input: 'مش JSON' }).toString()).toBe('');
    fs.unlinkSync(f);
  });
  it('متوصّل في settings.json', () => {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, '../../.claude/settings.json'), 'utf8'));
    expect(JSON.stringify(s.hooks.UserPromptSubmit)).toContain('context-budget.js');
  });
});
