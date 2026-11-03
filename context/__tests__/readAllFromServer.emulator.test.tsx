import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { buildFullExportSheets } from '@/lib/fullExport';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * التصدير الكامل بيقرا من السيرفر (`readAllFromServer`) مش من حالة الـlisteners: اللي اتكتب **حالًا** (لسه بيرفع)
 * لازم يبقى في الملف — القراية بتستنى كتاباتنا توصل الأول — وكل المجموعات بنفس شكل اللي الشاشات شايفاه.
 */
let h: Awaited<ReturnType<typeof renderDataProvider>>;
beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  h = await renderDataProvider();
  await h.waitForReady();
});
afterEach(async () => { await h.unmount(); });

it('عملية ودين اتكتبوا حالًا (من غير استنى) ← موجودين في اللي اتقرا من السيرفر وفي الملف', async () => {
  const w = h.api().wallets[0];
  // من غير await على وصولهم: القراية نفسها لازم تستنى
  void h.api().addTransaction({ type: 'expense', amount: 42, walletId: w.id, date: '2026-11-01' } as never);
  void h.api().addDebt({ personName: 'صاحبي', direction: 'owed_to_me', totalAmount: 300, walletId: w.id, date: '2026-11-01', isInstallment: false } as never);
  const read = await h.api().readAllFromServer();
  expect(read.outcome).toBe('done');
  if (read.outcome !== 'done') return;
  expect(read.data.wallets.length).toBe(h.api().wallets.length);
  expect(read.data.transactions.some(t => t.amount === 42)).toBe(true);
  expect(read.data.debts.map(d => d.personName)).toContain('صاحبي');
  expect(read.data.categories.length).toBe(h.api().categories.length);
  // مستند النسب مش متخزّن لحساب جديد ← null (الملف بيقول "الافتراضي")
  expect(read.data.shakhbataPercents).toBeNull();
  const sheets = buildFullExportSheets(read.data);
  expect(sheets.find(s => s.name === 'Debts')!.rows[0]).toMatchObject({ Person: 'صاحبي', TotalAmount: 300 });
});
