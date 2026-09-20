import { DEFAULT_CATEGORY_ICON, categoryIcon, categoryLabelById } from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * حقل `icon` جديد على الفئات، فلازم يعدّي من **قواعد الأمان الحقيقية**.
 *
 * وأهم من كده: الفئات اللي موجودة خلاص (كل الافتراضية) مالهاش الحقل ده،
 * والقاعدة بتتحقق من المستند **بعد الدمج** — فلو الحقل كان مطلوب، أي تعديل
 * على فئة قديمة كان هيترفض بـpermission-denied. الاختبار ده بيثبّت إنه مش
 * كده.
 */

let harness: Awaited<ReturnType<typeof renderDataProvider>>;

beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  harness = await renderDataProvider();
  await harness.waitForReady();
});

afterEach(async () => {
  await harness.unmount();
});

describe('كتابة الأيقونة', () => {
  it('بتتخزّن وبترجع مع الفئة', async () => {
    const cat = harness.api().categories[0];
    await harness.api().updateCategory(cat.id, { icon: '🍔' });
    await harness.waitForData(api => api.categories.find(c => c.id === cat.id)?.icon === '🍔');

    const saved = harness.api().categories.find(c => c.id === cat.id)!;
    expect(categoryIcon(saved)).toBe('🍔');
    expect(categoryLabelById(harness.api().categories, cat.id)).toContain('🍔');
  });

  it('الإيموجي المركّب بيعدّي كمان (✈️ مش حرف واحد)', async () => {
    const cat = harness.api().categories[0];
    await harness.api().updateCategory(cat.id, { icon: '✈️' });
    await harness.waitForData(api => api.categories.find(c => c.id === cat.id)?.icon === '✈️');
    expect(harness.api().categories.find(c => c.id === cat.id)!.icon).toBe('✈️');
  });

  it('الفاضي معناه "شيل الأيقونة" وبيرجّع الافتراضية', async () => {
    const cat = harness.api().categories[0];
    await harness.api().updateCategory(cat.id, { icon: '🍔' });
    await harness.waitForData(api => api.categories.find(c => c.id === cat.id)?.icon === '🍔');

    await harness.api().updateCategory(cat.id, { icon: '' });
    await harness.waitForData(api => api.categories.find(c => c.id === cat.id)?.icon === '');

    const saved = harness.api().categories.find(c => c.id === cat.id)!;
    expect(categoryIcon(saved)).toBe(DEFAULT_CATEGORY_ICON);
  });
});

describe('التوافق مع الفئات القديمة', () => {
  it('الفئات الافتراضية بتيجي من غير أيقونة', async () => {
    harness.api().categories.forEach(c => {
      expect(c.icon).toBeUndefined();
      expect(categoryIcon(c)).toBe(DEFAULT_CATEGORY_ICON);
    });
  });

  it('**وتعديل فئة قديمة لسه بيعدّي** — القاعدة اختيارية مش مطلوبة', async () => {
    const cat = harness.api().categories[0];
    expect(cat.icon).toBeUndefined();

    await harness.api().updateCategory(cat.id, { name: 'اسم جديد' });
    await harness.waitForData(api => api.categories.find(c => c.id === cat.id)?.name === 'اسم جديد');

    // ولسه من غير أيقونة — ما اتفرضش عليها حاجة
    expect(harness.api().categories.find(c => c.id === cat.id)!.icon).toBeUndefined();
  });

  it('وأرشفة فئة قديمة كمان', async () => {
    const cat = harness.api().categories[0];
    await harness.api().archiveCategory(cat.id, {});
    await harness.waitForData(api => api.categories.find(c => c.id === cat.id)?.archived === true);
    expect(harness.api().categories.find(c => c.id === cat.id)!.archived).toBe(true);
  });
});

describe('الفئة الجديدة', () => {
  it('بتتعمل من غير أيقونة وبتاخد واحدة بعدين', async () => {
    await harness.api().addCategory('سفر');
    await harness.waitForData(api => api.categories.some(c => c.name === 'سفر'));

    const created = harness.api().categories.find(c => c.name === 'سفر')!;
    expect(created.icon).toBeUndefined();

    await harness.api().updateCategory(created.id, { icon: '✈️' });
    await harness.waitForData(api => api.categories.find(c => c.id === created.id)?.icon === '✈️');
    expect(categoryLabelById(harness.api().categories, created.id)).toBe('✈️ سفر');
  });
});
