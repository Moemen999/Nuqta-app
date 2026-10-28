#!/usr/bin/env node
/**
 * حرّاس نقطة — قواعد CLAUDE.md المكتوبة اللي تستاهل تتنفّذ بالآلة بدل ما
 * تعتمد على إن حد يفتكرها (2026-10-28). كل قاعدة ليها معرّف (G1، P1…) ومصدرها.
 *
 *   node .claude/hooks/nuqta-guard.js <event>   (stdin = JSON بتاع Claude Code)
 *
 * الأحداث: pre-bash، pre-edit، post-edit، stop، session-start، session-end.
 * كل حدث بيرجّع حكم ({deny|ask|block|context}) أو مفيش — والدالة `decide`
 * مفصولة عن قراية stdin عشان الاختبار (`lib/__tests__/claudeHooks.test.ts`)
 * يناديها من غير Claude Code.
 *
 * **قاعدة التصميم:** الحارس مبيضربش على حالة مشروعة (ذاكرة المشروع: الإشارة
 * اللي بتولّع على الطبيعي بتعلّم الكل يتجاهلها). عشان كده الممنوع بالنص في
 * CLAUDE.md = deny، واللي محتاج موافقة مؤمن = ask، والباقي ملاحظة بس.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── مسارات الفلوس (جدول توجيه الوكلاء في CLAUDE.md) ──
const MONEY_PATHS = [
  /^lib\/(finance|archiving|linkedEdit|autoCharge|spending|useChargeAutoRecord|useIncomeAutoRecord)\.tsx?$/,
  /^context\/DataContext\.tsx$/,
  /^components\/(DebtEntryModals|SubscriptionsView|GamiyaView|ArchivedSettlement|ArchiveSheet)\.tsx$/,
  /^app\/(modal|person-ledger)\.tsx$/,
  /^app\/\(tabs\)\/debts\.tsx$/,
];
const isMoneyPath = f => MONEY_PATHS.some(r => r.test(f));

// ملفات محتاجة موافقة مؤمن قبل أي تعديل (P1)
const PROTECTED = [
  { re: /^firestore\.rules$/, why: 'تعديل firestore.rules محتاج security-reviewer + database-reviewer واختبارات محاكي، والنشر يدوي (CLAUDE.md قاعدة 6)' },
  { re: /^(app\.config\.js|eas\.json)$/, why: 'عدّاد البناء (versionCode) مربوط بالملف ده — اقرا "رقم البناء" في CLAUDE.md' },
  { re: /^\.github\//, why: 'الورك فلو بتاع البناء: حذفه أو تغيير اسمه بيرجّع run_number ويكرر أرقام البناء (CLAUDE.md)' },
  { re: /^\.claude\/settings(\.local)?\.json$/, why: 'إعدادات الحرّاس نفسها — تعديلها بيشيل حماية' },
  { re: /^\.claude\/hooks\//, why: 'سكريبت الحرّاس نفسه — تعديله بيغيّر الحماية' },
];

// أسرار (S1) — ذاكرة المشروع: robo-script.json سرّب إيميل/باسورد حقيقيين في الريبو العام.
// مفتاح فايربيز (AIza…) مش هنا عن قصد: عام بالتصميم وموجود في firebaseConfig.js.
const SECRETS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'مفتاح خاص'],
  [/https:\/\/[0-9a-f]{32}@[a-z0-9.-]*sentry\.io/i, 'Sentry DSN (بييجي من EXPO_PUBLIC_SENTRY_DSN وقت البناء)'],
  [/\bgh[pousr]_[A-Za-z0-9]{36}\b/, 'توكن GitHub'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'مفتاح Anthropic'],
  [/["']?password["']?\s*[:=]\s*["'][^"'\s$]{6,}["']/i, 'باسورد مكتوب'],
];

// ── git ──
function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}
const currentBranch = cwd => git(cwd, ['branch', '--show-current']) || '';

function lockHolder(root) {
  try {
    const m = fs.readFileSync(path.join(root, '.agent-lock'), 'utf8').match(/^tool=(.*)$/m);
    return m ? m[1].trim() : '';
  } catch { return null; }
}

const rel = (root, p) => path.relative(root, path.resolve(root, p)).split(path.sep).join('/');

// ── الأحكام ──
const deny = reason => ({ kind: 'deny', reason });
const ask = reason => ({ kind: 'ask', reason });

function lockRule(root) {
  const holder = lockHolder(root);
  if (holder && holder !== 'claude-code') {
    return deny(`L1: القفل مع "${holder}" — أداة تانية شغالة على الريبو (CLAUDE.md: قفل الأدوات). متكملش؛ قول لمؤمن.`);
  }
  return null;
}

/** أمر Bash واحد ممكن يكون فيه أكتر من أمر (&&، ;، |) — بنفحص كل جزء */
function splitCommands(cmd) {
  return cmd.split(/&&|\|\||;|\n|\|/).map(s => s.trim()).filter(Boolean);
}

function preBash(input, root, env) {
  const cmd = String(input.tool_input?.command || '');
  const parts = splitCommands(cmd);
  const branch = env.branch(root);

  for (const p of parts) {
    // G5: تخطّي الهوكس أو التوقيع
    if (/\bgit\b.*\s--no-verify\b/.test(p) || /--no-gpg-sign\b|commit\.gpgsign=false/.test(p)) {
      return deny('G5: ممنوع تخطّي hooks الـgit أو التوقيع (--no-verify / --no-gpg-sign). لو hook وقع، صلّح السبب.');
    }
    // G1: force-push
    if (/\bgit\s+push\b/.test(p) && /(\s--force(-with-lease)?\b|\s-[a-zA-Z]*f\b|\s\+[^\s]+)/.test(p)) {
      if (/\bmain\b/.test(p) || branch === 'main') {
        return deny('G1: force-push على main ممنوع خالص، حتى بموافقة (CLAUDE.md: Git). التصليح = كوميت جديد فوقه.');
      }
      return ask('G1: force-push محتاج موافقة مؤمن الأول (CLAUDE.md: Git). الأحسن كوميت جديد فوق اللي اتعمله push.');
    }
    // G7: push على main = قرار مؤمن
    if (/\bgit\s+push\b/.test(p)) {
      // `git push [remote] [refspec…]` — من غير refspec بيروح الفرع الحالي
      const args = p.replace(/^.*?\bgit\s+push\b/, '').trim().split(/\s+/).filter(a => a && !a.startsWith('-'));
      const refs = args.slice(1);
      const toMain = refs.length ? refs.some(r => r === 'main' || /:main$/.test(r)) : branch === 'main';
      if (toMain) return ask('G7: push على main — مسموح بس لو مؤمن طلبه في الجلسة دي.');
    }
    // G2: إعادة كتابة تاريخ اتعمله push
    if (/\bgit\s+(commit\b.*--amend|rebase\b)/.test(p) && !/--abort|--continue|--quit/.test(p)) {
      if (env.headIsPushed(root)) {
        return deny('G2: الكوميت ده اتعمله push — ممنوع amend/rebase عليه (CLAUDE.md: Git). اعمل كوميت جديد فوقه.');
      }
    }
    if (/\bgit\s+reset\b.*--hard/.test(p)) {
      return ask('G2: git reset --hard بيمسح شغل مش متعمله كوميت ومبيترجعش — متأكد؟');
    }
    // G3: البناء
    if (/\bgh\s+run\s+rerun\b/.test(p)) {
      return deny('G3: Re-run ممنوع — بيعيد نفس run_number فبناءين بنفس versionCode (CLAUDE.md: رقم البناء). شغّل تشغيلة جديدة.');
    }
    if (/\beas\s+build\b|\bgh\s+workflow\s+run\b/.test(p)) {
      return ask('G3: بناء — محتاج موافقة مؤمن صريحة للمرة دي بالذات (حصة البناء، TIMELINE).');
    }
    if (/\b(git\s+(rm|mv)|rm|mv|del)\b.*android-local-build\.yml/.test(p)) {
      return deny('G3: حذف أو نقل ملف الورك فلو بيرجّع العدّاد ويكرر أرقام البناء (CLAUDE.md: رقم البناء).');
    }
    // G4: نشر القواعد
    if (/\bfirebase\b.*\bdeploy\b/.test(p)) {
      return ask('G4: نشر على فايربيز — بعد security-reviewer + database-reviewer على الفرق بين المنشور والريبو بس (CLAUDE.md قاعدة 6).');
    }
    // G6: بوابة الدمج في main
    const m = p.match(/\bgit\s+merge\b(?!.*--(abort|continue|quit))\s+(?:-[^\s]+\s+)*([^\s-][^\s]*)/);
    if (m && branch === 'main') {
      const verdict = env.mergeGate(root, m[2]);
      if (verdict) return verdict;
    }
    // L1: كوميت والقفل مع أداة تانية
    if (/\bgit\s+(commit|merge|push)\b/.test(p)) {
      const l = lockRule(root);
      if (l) return l;
    }
  }
  return null;
}

/**
 * G6: فرع داخل main ولمس فلوس ← لازم رسايل كوميتاته تقول إن money-reviewer
 * و silent-failure-hunter عدّوا عليه (القاعدة الإجبارية). ولمس القواعد ←
 * security-reviewer + database-reviewer. ده بيتأكد إن المراجعة **اتكتبت**، مش
 * إنها اتعملت — أقصى اللي الآلة تقدر تشوفه.
 */
function mergeGate(root, target, gitFn = git) {
  const files = (gitFn(root, ['diff', '--name-only', `HEAD...${target}`]) || '').split('\n').filter(Boolean);
  if (!files.length) return null;
  const log = gitFn(root, ['log', '--format=%B', `HEAD..${target}`]) || '';
  const missing = [];
  if (files.some(isMoneyPath)) {
    for (const r of ['money-reviewer', 'silent-failure-hunter']) if (!log.includes(r)) missing.push(r);
  }
  if (files.includes('firestore.rules')) {
    for (const r of ['security-reviewer', 'database-reviewer']) if (!log.includes(r)) missing.push(r);
  }
  if (missing.length) {
    return deny(`G6: الفرع "${target}" بيلمس ${files.includes('firestore.rules') ? 'القواعد/' : ''}الفلوس ورسايل كوميتاته مفيهاش: ${missing.join('، ')}. المراجعة إجبارية قبل الدمج (CLAUDE.md: توجيه الوكلاء).`);
  }
  const code = files.filter(f => !/\.md$/.test(f) && !f.startsWith('reports/') && !f.startsWith('.claude/'));
  if (code.length && !files.includes('TIMELINE.md')) {
    return ask(`G6: الفرع "${target}" بيغيّر كود ومفيهوش سطر في TIMELINE.md — "أي جولة بتقفل أو بتفتح بند بتحدّث الخريطة والسطر" (CLAUDE.md). كمّل بس لو ده مقصود.`);
  }
  return null;
}

function preEdit(input, root) {
  const l = lockRule(root);
  if (l) return l;
  const file = rel(root, String(input.tool_input?.file_path || ''));
  const content = [input.tool_input?.content, input.tool_input?.new_string,
    ...(input.tool_input?.edits || []).map(e => e.new_string)].filter(Boolean).join('\n');
  for (const [re, what] of SECRETS) {
    if (re.test(content)) {
      return deny(`S1: شكله ${what} في ${file}. ممنوع أي سر أو بيانات دخول في ملف — الريبو عام (CLAUDE.md: بيانات الدخول). الأسرار مكانها GitHub Secrets أو env وقت التشغيل.`);
    }
  }
  const prot = PROTECTED.find(p => p.re.test(file));
  if (prot) return ask(`P1: ${file} — ${prot.why}.`);
  return null;
}

/** ملاحظات بعد التعديل — مبتمنعش، بترجّع لـClaude سبب يصلّح (C1–C4) + تذكير الفلوس (M1) */
function postEdit(input, root, env) {
  const file = rel(root, String(input.tool_input?.file_path || ''));
  if (/__tests__\//.test(file) || !/\.(tsx?|jsx?)$/.test(file)) return moneyReminder(file, input, env);
  const added = [input.tool_input?.content, input.tool_input?.new_string,
    ...(input.tool_input?.edits || []).map(e => e.new_string)].filter(Boolean).join('\n');
  const problems = [];
  if (/^(app|components)\//.test(file) && /import\s*\{[^}]*\b(Text|TextInput)\b[^}]*\}\s*from\s*['"]react-native['"]/.test(added)) {
    problems.push('C1: Text/TextInput لازم من "@/components/AppText" مش react-native (CLAUDE.md قاعدة 4).');
  }
  if (file !== 'lib/appFont.ts' && /\bfontFamily\s*:/.test(added)) {
    problems.push('C2: fontFamily يدوي ممنوع برّه lib/appFont.ts (CLAUDE.md قاعدة 4).');
  }
  if (/^(app|components|context)\//.test(file) && /\bawait\s+(setDoc|updateDoc|deleteDoc|addDoc)\(/.test(added)) {
    problems.push('C3: await على setDoc/updateDoc/deleteDoc/addDoc — الكتابة بتعدّي من track/addDocNoWait من غير انتظار (CLAUDE.md قاعدة 7).');
  }
  if (/^(app|components)\//.test(file) && /\b(color|backgroundColor|borderColor|tintColor)\s*:\s*['"]#[0-9a-fA-F]{3,8}['"]/.test(added)) {
    problems.push('C4: لون hex مباشر — الألوان من useTheme().colors إلا لو لون وظيفي ثابت (CLAUDE.md قاعدة 3).');
  }
  if (problems.length) return { kind: 'block', reason: problems.join('\n') };
  return moneyReminder(file, input, env);
}

/** M1: أول تعديل على مسار فلوس في الجلسة ← تذكير بالقاعدة الإجبارية (مرة واحدة بس) */
function moneyReminder(file, input, env) {
  if (!isMoneyPath(file)) return null;
  if (!env.once(`money-${input.session_id || 'x'}`)) return null;
  return { kind: 'context', text: `M1: ${file} مسار فلوس. التغيير مش "خلص" غير بعد money-reviewer + silent-failure-hunter (جولتين بالظبط)، واختبار بيقع لو التصليح اترجع، وnpm run test:db على اللابتوب.` };
}

/**
 * T1 (Stop): كوميتات على فرع شغل بتغيّر كود ومفيش سطر TIMELINE في الفرع،
 * والشجرة نضيفة (يعني الشغل اتعمله كوميت مش لسه في النص) ← وقفة واحدة.
 */
function stop(input, root, env) {
  if (input.stop_hook_active) return null;
  const branch = env.branch(root);
  if (!branch || branch === 'main') return null;
  if (env.dirty(root)) return null;
  const files = (env.git(root, ['diff', '--name-only', 'main...HEAD']) || '').split('\n').filter(Boolean);
  const code = files.filter(f => !/\.md$/.test(f) && !f.startsWith('reports/') && !f.startsWith('.claude/'));
  if (code.length && !files.includes('TIMELINE.md')) {
    return { kind: 'block', reason: `T1: الفرع ${branch} فيه كوميتات بتغيّر كود (${code.slice(0, 3).join('، ')}${code.length > 3 ? '…' : ''}) ومفيش سطر في TIMELINE.md. حدّث الخريطة والسطر (CLAUDE.md: سجل القرارات) أو قول صراحةً ليه لأ.` };
  }
  return null;
}

/** SessionStart: سطور قصيرة بتدخل السياق — القفل، الفرع، التقارير الجديدة، خط النهاية */
function sessionStart(input, root, env) {
  const lines = [];
  const holder = lockHolder(root);
  if (holder === null) lines.push('القفل: مفيش. خده قبل أي شغل: scripts/agent-lock.sh acquire claude-code');
  else if (holder === 'claude-code') lines.push('القفل: مع claude-code (ممكن يكون من جلسة قديمة — شوف scripts/agent-lock.sh status).');
  else lines.push(`⛔ القفل مع "${holder}" — أداة تانية شغالة. متبدأش شغل؛ قول لمؤمن.`);
  lines.push(`الفرع: ${env.branch(root) || '؟'} — HEAD ${env.git(root, ['rev-parse', '--short', 'HEAD']) || '؟'}`);
  try {
    const fresh = fs.readdirSync(path.join(root, 'reports')).filter(f => /\.md$/.test(f) && f !== 'README.md')
      .filter(f => /الحالة:\*{0,2}\s*جديد/.test(fs.readFileSync(path.join(root, 'reports', f), 'utf8').slice(0, 600)));
    lines.push(fresh.length ? `تقارير لسه محدش رد عليها: ${fresh.join('، ')}` : 'reports/: مفيش تقرير حالته "جديد".');
  } catch { /* مفيش فولدر */ }
  try {
    const tl = fs.readFileSync(path.join(root, 'TIMELINE.md'), 'utf8');
    const fl = tl.match(/### 0\. خط النهاية[\s\S]*?(?=\n### )/);
    if (fl) {
      const open = fl[0].split('\n').filter(l => /^\s*- \[ \]/.test(l)).slice(0, 3).map(l => l.trim());
      if (open.length) lines.push(`خط النهاية — أول المفتوح: ${open.join(' | ')}`);
    }
  } catch { /* مفيش TIMELINE */ }
  lines.push('الدور: /nuqta-ceo لاختيار الجاي وتوجيهه.');
  return { kind: 'context', text: lines.join('\n') };
}

/** SessionEnd: بيشيل قفل claude-code **بس** لو الشجرة نضيفة — شغل مش متعمله كوميت يفضل محمي */
function sessionEnd(input, root, env) {
  if (lockHolder(root) !== 'claude-code') return null;
  if (env.dirty(root)) return null;
  try { fs.unlinkSync(path.join(root, '.agent-lock')); } catch { /* اتشال */ }
  return null;
}

function defaultEnv() {
  return {
    git,
    branch: currentBranch,
    dirty: root => (git(root, ['status', '--porcelain', '--untracked-files=no']) || '') !== '',
    headIsPushed: root => (git(root, ['branch', '-r', '--contains', 'HEAD']) || '') !== '',
    mergeGate: (root, target) => mergeGate(root, target),
    once: key => {
      const marker = path.join(os.tmpdir(), `nuqta-hook-${key.replace(/[^\w-]/g, '_')}`);
      if (fs.existsSync(marker)) return false;
      try { fs.writeFileSync(marker, ''); } catch { /* مش مهم */ }
      return true;
    },
  };
}

function decide(event, input, root, env = defaultEnv()) {
  switch (event) {
    case 'pre-bash': return preBash(input, root, env);
    case 'pre-edit': return preEdit(input, root);
    case 'post-edit': return postEdit(input, root, env);
    case 'stop': return stop(input, root, env);
    case 'session-start': return sessionStart(input, root, env);
    case 'session-end': return sessionEnd(input, root, env);
    default: return null;
  }
}

/** الحكم ← شكل الخرج اللي Claude Code بيفهمه لكل حدث (code.claude.com/docs/en/hooks) */
function render(event, v) {
  if (!v) return null;
  if (event.startsWith('pre-') && (v.kind === 'deny' || v.kind === 'ask')) {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: v.kind, permissionDecisionReason: v.reason } };
  }
  if (v.kind === 'block') return { decision: 'block', reason: v.reason };
  if (v.kind === 'context') {
    const hookEventName = event === 'session-start' ? 'SessionStart' : 'PostToolUse';
    return { hookSpecificOutput: { hookEventName, additionalContext: v.text } };
  }
  return null;
}

module.exports = { decide, render, mergeGate, isMoneyPath, splitCommands };

if (require.main === module) {
  const event = process.argv[2];
  let raw = '';
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('end', () => {
    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch { /* مدخل بايظ = مفيش حكم */ }
    const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    try {
      const out = render(event, decide(event, input, root));
      if (out) process.stdout.write(JSON.stringify(out));
      // سجل محلي إن الحارس اشتغل فعلاً (للتأكد إن الحدث بيوصل) — مش في الريبو
      if (process.env.NUQTA_HOOK_LOG) {
        fs.appendFileSync(process.env.NUQTA_HOOK_LOG, `${new Date().toISOString()} ${event} ${out ? JSON.stringify(out).slice(0, 160) : '-'}\n`);
      }
    } catch (e) {
      // الحارس نفسه وقع: منمنعش الشغل بسبب باج في الحارس، بس بنقول
      process.stderr.write(`nuqta-guard (${event}) وقع: ${e && e.message}\n`);
    }
    process.exit(0);
  });
}
