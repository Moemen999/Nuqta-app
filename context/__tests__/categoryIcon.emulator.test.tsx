import { db } from '@/firebaseConfig';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { CATEGORY_ICON_MAX, DEFAULT_CATEGORY_ICON, categoryIcon, categoryLabelById } from '@/lib/finance';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
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
    expect(categoryLabelById(harness.api().categories, created.id)).toBe('✈️\u00A0سفر');
  });
});

/**
 * سقف `icon` في القواعد. `size()` بتعدّ وحدات UTF-16 — اتقاس على المحاكي
 * قبل ما السقف يتغيّر (👨‍👩‍👧‍👦 = 11 وحدة كانت بتترفض على سقف 8 مع إنها
 * إيموجي واحد). الكتابة هنا مباشرة على المستند، من غير طبقة التطبيق —
 * يعني ده اختبار القاعدة نفسها زي ما هي على السيرفر.
 */
describe('سقف الأيقونة في القواعد', () => {
  async function write(icon: unknown) {
    const cat = harness.api().categories[0];
    return updateDoc(doc(db, 'users', getMockUid(), 'categories', cat.id), { icon });
  }
  async function expectDenied(p: Promise<unknown>) {
    await expect(p).rejects.toMatchObject({ code: 'permission-denied' });
  }

  it.each([
    ['عيلة بأربعة (11)', '👨‍👩‍👧‍👦'],
    ['علم إنجلترا (14)', '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'],
    ['بوسة بلونين بشرة (15)', '👩🏽‍❤️‍💋‍👨🏻'],
  ])('%s بيعدّي', async (_l, icon) => {
    expect(icon.length).toBeLessThanOrEqual(CATEGORY_ICON_MAX);
    await expect(write(icon)).resolves.toBeUndefined();
  });

  it('على السقف بالظبط بيعدّي، وواحد زيادة بيترفض', async () => {
    await expect(write('x'.repeat(CATEGORY_ICON_MAX))).resolves.toBeUndefined();
    await expectDenied(write('x'.repeat(CATEGORY_ICON_MAX + 1)));
  });

  it('نص طويل (حد بيكتب في الحقل من برّه التطبيق) بيترفض', async () => {
    await expectDenied(write('🍔'.repeat(50)));
  });

  it('مش نص بيترفض', async () => {
    await expectDenied(write(123));
  });

  it('الفئة الجديدة بأيقونة طويلة بتترفض من أول كتابة', async () => {
    await expectDenied(setDoc(doc(db, 'users', getMockUid(), 'categories', 'new'), { name: 'x', icon: 'y'.repeat(17) }));
  });
});
