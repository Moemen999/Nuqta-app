import { doc, setDoc } from 'firebase/firestore';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * بند B (مراجعة المشروع 2026-11-05) على الـlisteners الحقيقية: مستند دين بـ`payments: null` وحقل `id` مزيّف، ونسب
 * شخبطة نص — القواعد بتقبلهم (مبتفحصش الحقول دي)، والتطبيق لازم ميوقعش ولا يكتب على مستند غلط.
 */

let harness: Awaited<ReturnType<typeof renderDataProvider>>;

beforeEach(async () => {
  await clearFirestore();
  setMockUid(await signInTestUser());
  harness = await renderDataProvider();
  await harness.waitForReady();
});
afterEach(async () => { await harness.unmount(); });

it('دين payments: null وid مزيّف ← مصفوفة فاضية والمعرّف من المسار', async () => {
  const { db } = require('@/firebaseConfig');
  await setDoc(doc(db, 'users', getMockUid(), 'debts', 'real_id'), {
    personName: 'صاحبي', totalAmount: 100, direction: 'owed_to_me', date: '2026-09-01',
    payments: null, increases: null, id: 'someone_elses_doc',
  });
  await harness.waitForData(a => a.debts.length === 1);
  const d = harness.api().debts[0];
  expect(d.id).toBe('real_id');
  expect(d.payments).toEqual([]);
  expect(d.increases).toEqual([]);
});

// النسب: القواعد نفسها بتطلب أرقام (firestore.rules shakhbata_settings) — الحارس في الكلاينت احتياط، واختباره وحدة (fromDoc.test)
