/**
 * حرّاس Claude Code (`.claude/hooks/nuqta-guard.js`) — كل قاعدة بتتجرب على
 * الحالة اللي المفروض تمسكها **وعلى الحالة المشروعة اللي جنبها** (الحارس اللي
 * بيضرب على الطبيعي بيتجاهل). إن الحدث نفسه بيوصل من Claude Code اتأكد بتشغيل
 * حقيقي (TIMELINE 2026-10-28) — الاختبار ده بيثبّت المنطق بس.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const guard = require('../../.claude/hooks/nuqta-guard.js');

type Verdict = { kind: string; reason?: string; text?: string } | null;

function env(over: Record<string, unknown> = {}) {
  return {
    git: () => '',
    branch: () => 'feat/x',
    dirty: () => false,
    headIsPushed: () => false,
    mergeGate: () => null,
    once: () => true,
    ...over,
  };
}

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nuqta-hooks-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const bash = (command: string, e = env()): Verdict => guard.decide('pre-bash', { tool_input: { command } }, root, e);
const edit = (file_path: string, content: string): Verdict =>
  guard.decide('pre-edit', { tool_input: { file_path, content } }, root, env());
const post = (file_path: string, new_string: string, e = env()): Verdict =>
  guard.decide('post-edit', { session_id: 's', tool_input: { file_path, new_string } }, root, e);

describe('G1/G7 push', () => {
  it('force-push على main ← ممنوع', () => {
    expect(bash('git push --force origin main')?.kind).toBe('deny');
    expect(bash('git push -f', env({ branch: () => 'main' }))?.kind).toBe('deny');
    expect(bash('git push origin +HEAD:main')?.kind).toBe('deny');
  });
  it('force-push على فرع ← يسأل مؤمن', () => {
    expect(bash('git push --force-with-lease origin feat/x')?.kind).toBe('ask');
  });
  it('push عادي على main ← يسأل؛ على فرع ← عادي', () => {
    expect(bash('git push origin main')?.kind).toBe('ask');
    expect(bash('git push', env({ branch: () => 'main' }))?.kind).toBe('ask');
    expect(bash('git push -u origin feat/x')).toBeNull();
    expect(bash('git push --follow-tags origin feat/x')).toBeNull();
  });
});

describe('G2 تاريخ اتعمله push', () => {
  it('amend/rebase على كوميت اتعمله push ← ممنوع', () => {
    const pushed = env({ headIsPushed: () => true });
    expect(bash('git commit --amend --no-edit', pushed)?.kind).toBe('deny');
    expect(bash('git rebase main', pushed)?.kind).toBe('deny');
  });
  it('amend على كوميت محلي ← مسموح (CLAUDE.md)، و--abort دايمًا مسموح', () => {
    expect(bash('git commit --amend --no-edit')).toBeNull();
    expect(bash('git rebase --abort', env({ headIsPushed: () => true }))).toBeNull();
  });
  it('reset --hard ← يسأل', () => expect(bash('git reset --hard HEAD~1')?.kind).toBe('ask'));
});

describe('G3/G4/G5', () => {
  it('Re-run ← ممنوع؛ بناء ← يسأل', () => {
    expect(bash('gh run rerun 123')?.kind).toBe('deny');
    expect(bash('gh workflow run android-local-build.yml -f profile=preview')?.kind).toBe('ask');
    expect(bash('npx eas build --local -p android')?.kind).toBe('ask');
  });
  it('حذف الورك فلو ← ممنوع', () => {
    expect(bash('git rm .github/workflows/android-local-build.yml')?.kind).toBe('deny');
  });
  it('نشر القواعد ← يسأل؛ الفحص بتاعها قراية بس ← عادي', () => {
    expect(bash('npx firebase deploy --only firestore:rules')?.kind).toBe('ask');
    expect(bash('node scripts/rules-published-check.js')).toBeNull();
    expect(bash('npm run test:db')).toBeNull();
  });
  it('--no-verify ← ممنوع', () => expect(bash('git commit --no-verify -m x')?.kind).toBe('deny'));
  it('أمر مركّب: الجزء الممنوع بيتمسك', () => {
    expect(bash('npm test && gh run rerun 9')?.kind).toBe('deny');
  });
});

describe('G6 بوابة الدمج', () => {
  const fakeGit = (files: string[], log: string) => (_r: string, args: string[]) =>
    args[0] === 'diff' ? files.join('\n') : log;
  it('فرع فلوس من غير ذكر المراجعين ← ممنوع', () => {
    const v = guard.mergeGate(root, 'fix/x', fakeGit(['context/DataContext.tsx', 'TIMELINE.md'], 'كود'));
    expect(v?.kind).toBe('deny');
    expect(v?.reason).toContain('money-reviewer');
  });
  it('فرع فلوس فيه الاتنين ← عادي', () => {
    expect(guard.mergeGate(root, 'fix/x', fakeGit(['lib/finance.ts', 'TIMELINE.md'],
      'مراجعة: money-reviewer + silent-failure-hunter جولتين'))).toBeNull();
  });
  it('القواعد من غير security/database ← ممنوع', () => {
    expect(guard.mergeGate(root, 'r', fakeGit(['firestore.rules', 'TIMELINE.md'], 'x'))?.kind).toBe('deny');
  });
  it('كود من غير TIMELINE ← يسأل؛ توثيق بس ← عادي', () => {
    expect(guard.mergeGate(root, 'f', fakeGit(['app/archive.tsx'], 'x'))?.kind).toBe('ask');
    expect(guard.mergeGate(root, 'd', fakeGit(['CLAUDE.md'], 'x'))).toBeNull();
  });
  it('بيتنادى بس والفرع الحالي main', () => {
    const gate = jest.fn(() => ({ kind: 'deny', reason: 'x' }));
    expect(bash('git merge --no-ff fix/x', env({ branch: () => 'main', mergeGate: gate }))?.kind).toBe('deny');
    expect(gate).toHaveBeenCalledWith(root, 'fix/x');
    expect(bash('git merge main', env({ mergeGate: gate }))).toBeNull();
    expect(bash('git merge --abort', env({ branch: () => 'main', mergeGate: gate }))).toBeNull();
  });
});

describe('L1 القفل', () => {
  it('مع أداة تانية ← التعديل والكوميت ممنوعين', () => {
    fs.writeFileSync(path.join(root, '.agent-lock'), 'tool=antigravity\nstarted=x\nbranch=y\n');
    expect(edit(path.join(root, 'lib/x.ts'), 'a')?.kind).toBe('deny');
    expect(bash('git commit -m x')?.kind).toBe('deny');
    expect(bash('git status')).toBeNull();
  });
  it('مع claude-code أو مفيش ← عادي', () => {
    expect(edit(path.join(root, 'lib/x.ts'), 'a')).toBeNull();
    fs.writeFileSync(path.join(root, '.agent-lock'), 'tool=claude-code\n');
    expect(edit(path.join(root, 'lib/x.ts'), 'a')).toBeNull();
  });
});

describe('S1 الأسرار و P1 الملفات المحمية', () => {
  it('باسورد/DSN/مفتاح خاص ← ممنوع', () => {
    expect(edit(path.join(root, 'test-lab/robo.json'), '{"password": "hunter22"}')?.kind).toBe('deny');
    expect(edit(path.join(root, 'a.ts'), `const d = "https://${'a'.repeat(32)}@o1.ingest.sentry.io/1"`)?.kind).toBe('deny');
    expect(edit(path.join(root, 'k'), '-----BEGIN RSA PRIVATE KEY-----')?.kind).toBe('deny');
  });
  it('الحالات المشروعة: مفتاح فايربيز العام، متغيّر env، حقل باسورد في الكود ← عادي', () => {
    expect(edit(path.join(root, 'firebaseConfig.js'), `apiKey: "AIza${'x'.repeat(35)}"`)).toBeNull();
    expect(edit(path.join(root, 'a.sh'), 'ROBO_TEST_PASSWORD=$ROBO_TEST_PASSWORD')).toBeNull();
    expect(edit(path.join(root, 'a.tsx'), 'const [password, setPassword] = useState("")')).toBeNull();
  });
  it('القواعد والبناء والحرّاس ← يسأل', () => {
    for (const f of ['firestore.rules', 'app.config.js', 'eas.json', '.github/workflows/a.yml', '.claude/settings.json', '.claude/hooks/nuqta-guard.js']) {
      expect(edit(path.join(root, f), 'x')?.kind).toBe('ask');
    }
    expect(edit(path.join(root, 'lib/finance.ts'), 'x')).toBeNull();
  });
});

describe('C1–C4 بعد التعديل، و M1', () => {
  it('Text من react-native في شاشة ← ملاحظة', () => {
    expect(post(path.join(root, 'app/x.tsx'), "import { View, Text } from 'react-native';")?.kind).toBe('block');
    expect(post(path.join(root, 'app/x.tsx'), "import { View } from 'react-native';")).toBeNull();
  });
  it('await updateDoc في context ← ملاحظة؛ في اختبار ← عادي', () => {
    expect(post(path.join(root, 'context/X.tsx'), 'await updateDoc(ref, {})')?.kind).toBe('block');
    expect(post(path.join(root, 'context/__tests__/a.emulator.test.tsx'), 'await updateDoc(ref, {})')).toBeNull();
    expect(post(path.join(root, 'context/X.tsx'), 'track(updateDoc(ref, {}))')).toBeNull();
  });
  it('لون hex ← ملاحظة؛ من الثيم ← عادي', () => {
    expect(post(path.join(root, 'components/A.tsx'), "color: '#ff0000'")?.kind).toBe('block');
    expect(post(path.join(root, 'components/A.tsx'), 'color: colors.text')).toBeNull();
  });
  it('fontFamily برّه appFont ← ملاحظة', () => {
    expect(post(path.join(root, 'components/A.tsx'), "fontFamily: 'x'")?.kind).toBe('block');
    expect(post(path.join(root, 'lib/appFont.ts'), "fontFamily: 'x'")).toBeNull();
  });
  it('مسار فلوس ← تذكير مرة واحدة بس في الجلسة', () => {
    let first = true;
    const e = env({ once: () => { const r = first; first = false; return r; } });
    expect(post(path.join(root, 'context/DataContext.tsx'), 'const x = 1', e)?.kind).toBe('context');
    expect(post(path.join(root, 'context/DataContext.tsx'), 'const y = 2', e)).toBeNull();
    expect(post(path.join(root, 'app/archive.tsx'), 'const y = 2')).toBeNull();
  });
});

describe('T1 Stop', () => {
  const stop = (o: Record<string, unknown>, input: Record<string, unknown> = {}) => guard.decide('stop', input, root, env(o));
  const diff = (files: string[]) => () => files.join('\n');
  it('كود من غير TIMELINE والشجرة نضيفة ← وقفة', () => {
    expect(stop({ git: diff(['lib/a.ts']) })?.kind).toBe('block');
  });
  it('مرة واحدة بس (stop_hook_active)، ومش على main، ومش والشغل لسه في النص', () => {
    expect(stop({ git: diff(['lib/a.ts']) }, { stop_hook_active: true })).toBeNull();
    expect(stop({ git: diff(['lib/a.ts']), branch: () => 'main' })).toBeNull();
    expect(stop({ git: diff(['lib/a.ts']), dirty: () => true })).toBeNull();
    expect(stop({ git: diff(['lib/a.ts', 'TIMELINE.md']) })).toBeNull();
  });
});

describe('SessionStart / SessionEnd', () => {
  it('بيقول القفل والتقارير الجديدة وأول المفتوح في خط النهاية', () => {
    fs.mkdirSync(path.join(root, 'reports'));
    fs.writeFileSync(path.join(root, 'reports', '2026-01-01-x.md'), '# x\n> **الحالة:** جديد — لسه محدش رد عليه\n');
    fs.writeFileSync(path.join(root, 'TIMELINE.md'), '### 0. خط النهاية\n- [x] قديم\n- [ ] بند أ\n### 1. الوضع\n');
    const v = guard.decide('session-start', {}, root, env());
    expect(v?.text).toContain('2026-01-01-x.md');
    expect(v?.text).toContain('بند أ');
    expect(v?.text).not.toContain('قديم');
    expect(v?.text).toContain('القفل: مفيش');
  });
  it('SessionEnd بيشيل قفل claude-code بس، وبس لو الشجرة نضيفة', () => {
    const lock = path.join(root, '.agent-lock');
    fs.writeFileSync(lock, 'tool=claude-code\n');
    guard.decide('session-end', {}, root, env({ dirty: () => true }));
    expect(fs.existsSync(lock)).toBe(true);
    guard.decide('session-end', {}, root, env());
    expect(fs.existsSync(lock)).toBe(false);
    fs.writeFileSync(lock, 'tool=antigravity\n');
    guard.decide('session-end', {}, root, env());
    expect(fs.existsSync(lock)).toBe(true);
  });
});

it('شكل الخرج لكل حدث (code.claude.com/docs/en/hooks)', () => {
  expect(guard.render('pre-bash', { kind: 'deny', reason: 'r' })).toEqual(
    { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'r' } });
  expect(guard.render('stop', { kind: 'block', reason: 'r' })).toEqual({ decision: 'block', reason: 'r' });
  expect(guard.render('session-start', { kind: 'context', text: 't' })).toEqual(
    { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 't' } });
  expect(guard.render('pre-bash', null)).toBeNull();
});
