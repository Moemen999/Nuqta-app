import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { WRITE_ERROR_TITLE, writeErrorBody, namedLabel } from '@/lib/writeError';
import { waitFor } from '@testing-library/react-native';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * رسالة "فيه تعديل ما اتحفظش" لازم تعدّي على `notice` (بيصف ومبيرميش) مش `confirm`
 * (silent-failure-hunter، 2026-11-02: `confirm` بيلغي أي شباك والتطبيق مقفول — فكتابة
 * اترفضت والتطبيق في الخلفية كانت هتختفي من غير ولا كلمة).
 *
 * `confirm` هنا بيتصرف زي ما بيتصرف والتطبيق مقفول: بيبلع الشباك. لو الرسالة رجعت
 * على `confirm`، `notice` مش هيتنادى والاختبار يقع.
 */
const mockNotice = jest.fn();
const mockConfirm = jest.fn(); // = مقفول: مفيش شباك
jest.mock('@/components/NoticeProvider', () => ({ useNotice: () => mockNotice }));
jest.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => mockConfirm }));

let harness: Awaited<ReturnType<typeof renderDataProvider>>;
beforeEach(async () => {
  mockNotice.mockClear(); mockConfirm.mockClear();
  await clearFirestore();
  setMockUid(await signInTestUser());
  harness = await renderDataProvider();
  await harness.waitForReady();
});
afterEach(async () => { await harness.unmount(); });

it('كتابة القواعد رفضتها (محفظة من غير اسم) ← الرسالة بتظهر بـnotice، مش بتعدّي على confirm', async () => {
  await harness.api().addWallet('');
  await waitFor(() => expect(mockNotice).toHaveBeenCalledWith(WRITE_ERROR_TITLE, writeErrorBody(namedLabel('المحفظة', '')), expect.any(Function)), { timeout: 10000 });
  expect(mockConfirm).not.toHaveBeenCalled();
});

it('فشلين ورا بعض ← رسالة واحدة (مش شباكين فوق بعض)', async () => {
  await harness.api().addWallet('');
  await harness.api().addWallet('');
  await waitFor(() => expect(mockNotice).toHaveBeenCalled(), { timeout: 10000 });
  // الفشل التاني بيوصل بعد الأول بلحظة — نستنى شوية عشان لو كان هيطلع رسالة تانية تطلع
  await new Promise(r => setTimeout(r, 1500));
  expect(mockNotice.mock.calls.filter(c => c[0] === WRITE_ERROR_TITLE)).toHaveLength(1);
});

it('"تمام" على الرسالة ثم فشل جديد ← رسالة جديدة (القفل بيتفك بالدوسة مش بالمؤقّت بس)', async () => {
  await harness.api().addWallet('');
  await waitFor(() => expect(mockNotice).toHaveBeenCalledTimes(1), { timeout: 10000 });
  mockNotice.mock.calls[0][2](); // = المستخدم داس "تمام"
  await harness.api().addWallet('');
  // قبل WRITE_ERROR_RESET_MS (10 ثواني) بكتير — بالمؤقّت لوحده كان الفشل ده هيتبلع
  await waitFor(() => expect(mockNotice).toHaveBeenCalledTimes(2), { timeout: 5000 });
});
