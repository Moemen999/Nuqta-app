import { CATEGORY_ICONS, categoryIconValid } from '@/lib/finance';
import { CATEGORY_OPTIONS, PRESELECTED_CATEGORIES, SKIP_SETUP, setupCategoryIcon } from '@/lib/firstRunSetup';

/** أيقونات فئات "نبدأ بإيه؟" — مكان واحد (الاسم ← الأيقونة)، والباقي مشتق منه */
describe('أيقونات فئات التجهيز', () => {
  const EXPECTED: Record<string, string> = {
    أكل: '🍔', مواصلات: '🚗', سوبرماركت: '🛒', فواتير: '🧾', صحة: '💊', ترفيه: '🎮', لبس: '👕',
  };

  it('كل اسم ليه الأيقونة المتفق عليها، و«أخرى» من غير أيقونة', () => {
    for (const [name, icon] of Object.entries(EXPECTED)) expect(setupCategoryIcon(name)).toBe(icon);
    expect(setupCategoryIcon('أخرى')).toBeUndefined();
  });

  it('فئة مكتوبة بإيد المستخدم مالهاش أيقونة', () => {
    expect(setupCategoryIcon('قهوة')).toBeUndefined();
  });

  it('كل أيقونة من CATEGORY_ICONS وبتعدّي categoryIconValid', () => {
    for (const name of CATEGORY_OPTIONS) {
      const icon = setupCategoryIcon(name);
      if (icon === undefined) { expect(name).toBe('أخرى'); continue; }
      expect(CATEGORY_ICONS).toContain(icon);
      expect(categoryIconValid(icon)).toBe(true);
    }
  });

  it('قايمة الاختيارات والمختارة من الأول و"تخطي" كلها من نفس المصدر', () => {
    expect([...CATEGORY_OPTIONS]).toEqual(['أكل', 'مواصلات', 'سوبرماركت', 'فواتير', 'صحة', 'ترفيه', 'لبس', 'أخرى']);
    expect([...PRESELECTED_CATEGORIES]).toEqual(['أكل', 'مواصلات', 'سوبرماركت', 'فواتير', 'أخرى']);
    expect(SKIP_SETUP.categories).toEqual([...PRESELECTED_CATEGORIES]);
    for (const c of SKIP_SETUP.categories) expect(CATEGORY_OPTIONS).toContain(c);
  });
});
