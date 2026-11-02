import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * جرد `Alert` الأصلي (خط النهاية: "مكوّن تأكيد بشكل التطبيق بدل Alert").
 *
 * الـAlert الأصلي على أندرويد عنوانه على الشمال، وأزراره "OK"/"Cancel" بالإنجليزي، وأبيض
 * في الثيم الغامق. اتنقل كله لـ`useNotice()` (رسالة بزرار "تمام") و`useConfirm()` (اختيار).
 * الاختبار ده بيقرا الملفات نفسها ويرفض أي `Alert.alert(` أو استيراد `Alert` من
 * `react-native` برّه الأماكن المسموحة — عشان النقل ميرجعش بشويش زي الفوتر اللاصق.
 *
 * **المسموح بالاسم، وكل واحد بسببه:**
 * - `NoticeProvider` و`ConfirmProvider`: الرجوع للأصلي لما مفيش Provider (اختبار، أو برّه الشجرة).
 * - `LockScreen`: القفل قدام التطبيق كله، و`ConfirmProvider` بيلغي أي تأكيد والتطبيق مقفول
 *   عن قصد — فمخرج "نسيت الكود؟" لازم يفضل على الأصلي.
 */
const ALLOWED = new Set([
  'components/NoticeProvider.tsx',
  'components/ConfirmProvider.tsx',
  'components/LockScreen.tsx',
]);

const ROOT = join(__dirname, '..', '..');
const DIRS = ['app', 'components', 'context', 'lib', 'hooks'];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/** التعليقات بتتشال الأول: الشرح اللي بيقول "بدل `Alert.alert(…)`" مش استخدام */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = DIRS.flatMap(d => walk(join(ROOT, d))).map(p => relative(ROOT, p).split(sep).join('/'));

function importsNativeAlert(code: string): boolean {
  const imports = code.match(/import\s*\{[^}]*\}\s*from\s*['"]react-native['"]/g) ?? [];
  return imports.some(i => /[{,\s]Alert[\s,}]/.test(i));
}

describe('Alert الأصلي برّه الأماكن المسموحة', () => {
  it('الجرد لاقي ملفات أصلاً (مش بيعدّي وهو فاضي)', () => {
    expect(files.length).toBeGreaterThan(50);
    ALLOWED.forEach(f => expect(files).toContain(f));
  });

  it('مفيش Alert.alert( ولا استيراد Alert من react-native غير في المسموح', () => {
    const offenders = files.filter(f => {
      if (ALLOWED.has(f)) return false;
      const code = stripComments(readFileSync(join(ROOT, f), 'utf-8'));
      return /\bAlert\s*\.\s*alert\s*\(/.test(code) || importsNativeAlert(code);
    });
    expect(offenders).toEqual([]);
  });

  it('الفحص نفسه بيمسك الاستخدام (لو اتكسر الريجيكس الاختبار اللي فوق يعدّي ساكت)', () => {
    const bad = stripComments("import { View, Alert } from 'react-native';\nAlert.alert('x', 'y');");
    expect(/\bAlert\s*\.\s*alert\s*\(/.test(bad)).toBe(true);
    expect(importsNativeAlert(bad)).toBe(true);
    const comment = stripComments("// بدل Alert.alert('x')\n/* Alert.alert( */ const a = 1;");
    expect(/\bAlert\s*\.\s*alert\s*\(/.test(comment)).toBe(false);
  });
});
