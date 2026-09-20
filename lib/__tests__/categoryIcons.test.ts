import {
  CATEGORY_ICONS, CATEGORY_ICON_MAX, DEFAULT_CATEGORY_ICON,
  categoryIcon, categoryIconValid, categoryLabel, categoryLabelById,
} from '@/lib/finance';

/**
 * `CATEGORY_ICONS` كانت موجودة من كوميت `4ff1553` — عشرين إيموجي متعرّفين
 * ومصدّرين، و`categoryLabel` كانت بتعرض `icon` لو موجودة. بس **ولا سطر في
 * التطبيق كان بيكتب الحقل**: `addCategory` بتكتب `{ name }` بس، والزرع
 * الافتراضي بيكتب `{ name }` بس. يعني ميزة بتتقري ومستحيل تتكتب.
 */

describe('الأيقونة الافتراضية', () => {
  it('الفئة من غير أيقونة بتاخد الافتراضية مش فراغ', () => {
    expect(categoryIcon({})).toBe(DEFAULT_CATEGORY_ICON);
    expect(categoryIcon({ icon: '' })).toBe(DEFAULT_CATEGORY_ICON);
    expect(categoryIcon(undefined)).toBe(DEFAULT_CATEGORY_ICON);
  });

  it('واللي ليها أيقونة بتاخد بتاعتها', () => {
    expect(categoryIcon({ icon: '🍔' })).toBe('🍔');
  });

  it('الافتراضية مش من ضمن قايمة الاختيار — دي "من غير أيقونة"', () => {
    expect(CATEGORY_ICONS).not.toContain(DEFAULT_CATEGORY_ICON);
  });
});

describe('اسم الفئة بالأيقونة', () => {
  it('الفئة الجديدة بأيقونتها', () => {
    expect(categoryLabel({ name: 'أكل', icon: '🍔' })).toBe('🍔 أكل');
  });

  it('والقديمة بالافتراضية — الشكل بيفضل واحد', () => {
    expect(categoryLabel({ name: 'أكل' })).toBe(`${DEFAULT_CATEGORY_ICON} أكل`);
  });

  it('المؤرشفة لسه بتقول إنها مؤرشفة', () => {
    expect(categoryLabel({ name: 'أكل', icon: '🍔', archived: true })).toBe('🍔 أكل (مؤرشفة)');
  });

  it('مفيش فئة = نص فاضي', () => {
    expect(categoryLabel(undefined)).toBe('');
  });

  it('`icon: false` بتدّي الاسم نضيف — للتصدير', () => {
    expect(categoryLabel({ name: 'أكل', icon: '🍔' }, { icon: false })).toBe('أكل');
    expect(categoryLabel({ name: 'أكل', archived: true }, { icon: false })).toBe('أكل (مؤرشفة)');
  });
});

describe('categoryLabelById', () => {
  const cats = [{ id: 'c1', name: 'أكل', icon: '🍔' }, { id: 'c2', name: 'مواصلات' }];

  it('بتوصّل الأيقونة', () => {
    expect(categoryLabelById(cats, 'c1')).toBe('🍔 أكل');
    expect(categoryLabelById(cats, 'c2')).toBe(`${DEFAULT_CATEGORY_ICON} مواصلات`);
  });

  it('وبتوصّل الخيار كمان', () => {
    expect(categoryLabelById(cats, 'c1', { icon: false })).toBe('أكل');
  });

  it('الفئة الممسوحة مبتاخدش أيقونة — هي مش فئة أصلاً', () => {
    expect(categoryLabelById(cats, 'gone')).toBe('فئة ممسوحة');
  });

  it('من غير معرّف = فاضي', () => {
    expect(categoryLabelById(cats, undefined)).toBe('');
  });
});

describe('التحقق من الأيقونة', () => {
  it('كل أيقونات القايمة مقبولة', () => {
    CATEGORY_ICONS.forEach(ic => expect(categoryIconValid(ic)).toBe(true));
  });

  it('الإيموجي المركّب جواه الحد — عشان ✈️ و👨‍👩‍👧 مش حرف واحد', () => {
    CATEGORY_ICONS.forEach(ic => expect(ic.length).toBeLessThanOrEqual(CATEGORY_ICON_MAX));
  });

  it('النص الطويل مرفوض — ده اسم مش أيقونة', () => {
    expect(categoryIconValid('أكل وشرب وحاجات تانية كتير')).toBe(false);
  });

  it('الفاضي مرفوض من التحقق — الفاضي معناه "شيل" مش "أيقونة"', () => {
    expect(categoryIconValid('')).toBe(false);
  });
});
