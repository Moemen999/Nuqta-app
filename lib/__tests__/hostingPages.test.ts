/**
 * صفحات Firebase Hosting (9.5-1): سياسة الخصوصية ومسح الحساب — اللينكين اللي بيتحطوا في Google Play.
 * الاختبار بيثبّت الحاجات اللي Google بتطلبها بالاسم، والحاجات اللي لو اتغيّرت في التطبيق الصفحة تبقى بتكذب:
 * - الصفحتين RTL وعربي، وفيهم ملخص إنجليزي.
 * - صفحة المسح فيها اسم التطبيق، والطريقين (من التطبيق + من غير التطبيق)، وإيه اللي بيتمسح وإيه اللي بيفضل.
 * - مسار المسح في الصفحة = اسم الصف في الإعدادات + جملة التأكيد في شاشة المسح (لو اتغيّروا، الصفحة لازم تتغيّر).
 * - الخصوصية بتذكر كل مزوّد خدمة بيستقبل بيانات (Firebase، Sentry) وكل إذن حساس (جهات الاتصال).
 * الخانات الفاضية ({{...}}) مش هنا — دي `scripts/hosting-check.js` قبل النشر.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const pub = (name: string) => read(path.join('hosting', 'public', name));

describe('صفحات الاستضافة', () => {
  const privacy = pub('privacy.html');
  const del = pub('delete-account.html');

  it.each([['privacy.html'], ['delete-account.html'], ['index.html'], ['404.html']])('%s عربي ومن اليمين', name => {
    expect(pub(name)).toMatch(/<html lang="ar" dir="rtl">/);
    expect(pub(name)).toMatch(/<meta name="viewport"/);
  });

  it('firebase.json بيستضيف الفولدر وبيفحص الخانات قبل النشر', () => {
    const cfg = JSON.parse(read('firebase.json'));
    expect(cfg.hosting.public).toBe('hosting/public');
    expect(cfg.hosting.cleanUrls).toBe(true);
    expect(cfg.hosting.predeploy).toContain('node scripts/hosting-check.js');
    // قواعد فايرستور لسه زي ما هي — النشر بـ --only firestore:rules مبيتأثرش
    expect(cfg.firestore.rules).toBe('firestore.rules');
  });

  it('صفحة المسح: نفس مسار الإعدادات ونفس جملة التأكيد اللي في التطبيق', () => {
    const settings = read('app/(tabs)/settings.tsx');
    expect(settings).toMatch(/key: 'deleteAccount', title: 'مسح الحساب'/);
    expect(del).toMatch(/<strong>الإعدادات<\/strong> ← <strong>مسح الحساب<\/strong>/);
    const screen = read('app/settings-screens/delete-account.tsx');
    const phrase = screen.match(/DELETE_CONFIRM_PHRASE = '([^']+)'/)?.[1];
    expect(phrase).toBeTruthy();
    expect(del).toContain(`«${phrase}»`);
  });

  it('صفحة المسح فيها اللي Google بتطلبه: اسم التطبيق، طريق من غير التطبيق، اللي بيتمسح واللي بيفضل', () => {
    expect(del).toContain('«نقطة»');
    expect(del).toContain('من تطوير');
    expect(del).toMatch(/بالإيميل/);
    expect(del).toMatch(/إيه اللي بيتمسح/);
    expect(del).toMatch(/إيه اللي بيفضل/);
    expect(del).toContain('href="/privacy"');
  });

  it('صفحة المسح بتذكر كل مجموعة بتتمسح من الحساب', () => {
    // لو مجموعة جديدة اتضافت لـACCOUNT_COLLECTIONS، الصفحة لازم تقول إنها بتتمسح
    const words: Record<string, RegExp> = {
      wallets: /المحافظ/, categories: /الفئات/, transactions: /العمليات/, budgets: /الميزانية/,
      shakhbata_income: /توزيع الدخل/, shakhbata_settings: /توزيع الدخل/, debts: /الديون/,
      subscriptions: /الاشتراكات/, gamiyas: /الجمعيات/, incomes: /الدخل الثابت/,
    };
    const src = read('context/DataContext.tsx');
    const list = src.match(/export const ACCOUNT_COLLECTIONS = \[([^\]]+)\]/)?.[1] ?? '';
    const names = [...list.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(words[n]).toBeDefined();
      expect(del).toMatch(words[n]);
    }
  });

  it('الخصوصية بتذكر كل مزوّد بيستقبل بيانات وكل إذن حساس', () => {
    expect(privacy).toMatch(/Firebase/);
    expect(privacy).toMatch(/Sentry/);
    expect(privacy).toMatch(/جهات الاتصال/);
    expect(privacy).toContain('href="/delete-account"');
    // الإذن ده موجود في app.json — لو اتشال أو اتضاف إذن تاني، راجع الصفحة
    const perms = JSON.parse(read('app.json')).expo.android.permissions;
    expect(perms).toEqual(['POST_NOTIFICATIONS', 'SCHEDULE_EXACT_ALARM']);
  });

  it('Sentry مبيبعتش بيانات شخصية — اللي الصفحة بتقوله', () => {
    const sentry = read('lib/sentry.ts');
    expect(sentry).toMatch(/sendDefaultPii: false/);
    expect(sentry).toMatch(/attachScreenshot: false/);
  });
});

describe('لينك الخصوصية جوه التطبيق', () => {
  const appInfo = read(path.join('lib', 'appInfo.ts'));
  const about = read(path.join('app', 'settings-screens', 'about.tsx'));
  const url = appInfo.match(/PRIVACY_POLICY_URL = '([^']+)'/)?.[1] ?? '';

  it('بيشاور على صفحة موجودة في الاستضافة وعلى مشروع فايربيز نفسه', () => {
    const projectId = read('firebaseConfig.js').match(/projectId:\s*"([^"]+)"/)?.[1];
    expect(url).toBe(`https://${projectId}.web.app/privacy`);
    // `cleanUrls`: ‎/privacy ← privacy.html
    expect(fs.existsSync(path.join(root, 'hosting', 'public', 'privacy.html'))).toBe(true);
  });

  it('شاشة «عن التطبيق» بتفتحه، والفشل بيطلّع رسالة فيها اللينك', () => {
    expect(about).toMatch(/Linking\.openURL\(PRIVACY_POLICY_URL\)\.catch\(/);
    expect(about).toMatch(/notice\([^)]*\$\{PRIVACY_POLICY_URL\}/s);
  });
});
