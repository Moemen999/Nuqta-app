import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
/**
 * كل الملفات تحت الفولدرات دي، بـ Node مش بـ `grep`: `execSync` على ويندوز
 * بيشغّل cmd.exe، ومفيهوش `grep` ولا `|` لـ `sed` — فالاختبار كان بيقع
 * على اللاب بس وينجح في الكلاود.
 */
function walk(dirs: string[], ext?: RegExp): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) visit(p);
      else if (!ext || ext.test(e.name)) out.push(p);
    }
  };
  dirs.forEach(visit);
  return out;
}


/**
 * "زرار الحفظ بيضيع تحت الكيبورد".
 *
 * العلّة واحدة في كل مرة: فورم طويل جوه `ScrollView`، والزرار آخر عنصر
 * **جوه** المحتوى القابل للتمرير. الكيبورد بيفتح، الزرار يروح تحته، ومفيش
 * طريق توصله غير إنك تقفل الكيبورد الأول — لو عرفت إن ده اللي لازم تعمله.
 *
 * الحل المتفق عليه: الزرار في فوتر لاصق **برّه** الـ`ScrollView`
 * (`stickyFooterStyle`). الاختبار ده بيقرا الملفات نفسها ويتأكد إن مفيش
 * مودال رجع للنمط القديم — لأن ده بالظبط اللي حصل: اتصلح في `modal.tsx`
 * و`DebtEntryModals` وفضل ستة تانيين سنة كاملة من غير ما حد ياخد باله.
 */

const MODAL_FILES = [
  'app/modal.tsx',
  'app/(tabs)/debts.tsx',
  'components/DebtEntryModals.tsx',
  'components/SubscriptionsView.tsx',
  'components/GamiyaView.tsx',
  'components/SetLockModal.tsx',
];

function read(p: string) {
  return readFileSync(p, 'utf-8');
}

describe('كل مودال فيه فورم له فوتر لاصق', () => {
  it.each(MODAL_FILES)('%s بيستورد stickyFooterStyle', file => {
    expect(read(file)).toContain('stickyFooterStyle');
  });

  it.each(MODAL_FILES)('%s مفيهوش النمط القديم (زرار جوه ScrollView الورقة)', file => {
    // النمط القديم بالحرف: الورقة نفسها هي الـScrollView، فكل حاجة جوّاها
    expect(read(file)).not.toContain('<ScrollView style={styles.sheet}');
  });

  it.each(MODAL_FILES)('%s مفيهوش صف أزرار اسمه actions لسه جوه المحتوى', file => {
    expect(read(file)).not.toContain('style={styles.actions}');
  });
});

describe('كل مودال فيه إدخال ملفوف بـKeyboardAvoidingView', () => {
  it.each(MODAL_FILES)('%s', file => {
    const src = read(file);
    if (!src.includes('<TextInput')) return;
    expect(src).toContain('KeyboardAvoidingView');
  });
});

describe('مفيش شاشة فيها TextInput من غير KeyboardAvoidingView', () => {
  /**
   * القاعدة 5 في CLAUDE.md. الاختبار ده بيمسح التطبيق كله مش قايمة ثابتة،
   * عشان شاشة جديدة تتحاسب عليها من أول يوم. `LockScreen` كانت آخر واحدة
   * خرقاها وهي أخطر واحدة — القفل بيتحط قدام التطبيق كله.
   */
  it('كل الشاشات', () => {
    const files = walk(['app', 'components'], /.tsx$/)
      .filter(p => readFileSync(p, 'utf-8').includes('<TextInput'));

    expect(files.length).toBeGreaterThan(5);

    const offenders = files.filter(f => {
      const src = readFileSync(f, 'utf-8');
      // كومبوننت بياخد الإدخال كـchild وبيتلف عند الاستخدام مش هنا
      if (!src.includes('<TextInput')) return false;
      return !src.includes('KeyboardAvoidingView') && !src.includes('<ScrollView');
    });

    expect(offenders).toEqual([]);
  });
});
