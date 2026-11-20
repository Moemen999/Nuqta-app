import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * الميزة 6، الجولة الأخيرة (بند 1): خانات السقف والدخل والنسب مقفولة لحد ما الأرقام **تتشاف** (`snapshotTrusted`).
 * الخطر العكسي: حساب جديد مالوش سقوف ولا دخل ولا مستند نسب — لو الإشارة مستنية بيانات كانت هتفضل false للأبد والخانات
 * مقفولة. هنا على فايرستور الحقيقي (المحاكي): المجموعات فاضية والمستند مش موجود، والتلاتة بيبقوا true من رد السيرفر.
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

it('حساب فاضي: السقوف والدخل والنسب جاهزين من رد السيرفر', async () => {
  await harness.waitForData(api => api.budgetsReady && api.incomeReady && api.percentsReady);
  expect(harness.api().budgets).toEqual({});
  expect(harness.api().shakhbataIncome).toEqual({});
});

it('سقف اتكتب بيوصل والإشارة بتفضل true', async () => {
  await harness.waitForData(api => api.budgetsReady);
  await harness.api().setBudget('total_budget', 1500);
  await harness.waitForData(api => api.budgets.total_budget === 1500);
  expect(harness.api().budgetsReady).toBe(true);
});
