import { doc } from 'firebase/firestore';
import { clearFirestore, signInTestUser, writeRawDoc } from '@/test-utils/emulator';
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
  await writeRawDoc(`users/${getMockUid()}/debts/real_id`, {
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

it('جولة 2: دين payments بتاعه شكله غلط (مش null) ← الدفعة بتترفض ومبتكتبش فوقه', async () => {
  const { db } = require('@/firebaseConfig');
  const { getDoc } = require('firebase/firestore');
  const ref = doc(db, 'users', getMockUid(), 'debts', 'odd');
  await writeRawDoc(ref.path, { personName: 'صاحبي', totalAmount: 100, direction: 'owed_to_me', date: '2026-09-01', payments: { legacy: 50 }, increases: [] });
  await harness.waitForData(a => a.debts.length === 1);
  const w = harness.api().wallets[0];
  const res = await harness.api().addDebtPayment('odd', 20, w.id, '2026-09-02');
  expect(res.outcome).not.toBe('done');
  const after = (await getDoc(ref)).data();
  expect(after.payments).toEqual({ legacy: 50 });
});

/**
 * بند B — قرار مؤمن 2026-11-06: القواعد بتقبل `Infinity` (رقم و> 0) وتاريخ نص أي شكل. العملية دي **مبتدخلش الرصيد**
 * (كان Infinity في الرئيسية) وبتطلع في `brokenTransactions`؛ والمحفظة رصيد بدايتها Infinity ← صفر + `openingInvalid`.
 */
it('عملية مبلغها Infinity وعملية تاريخها مش YYYY-MM-DD ← برّه transactions وفي brokenTransactions', async () => {
  const { walletBalance } = require('@/lib/finance');
  await harness.waitForData(a => a.wallets.length > 0);
  const w = harness.api().wallets[0];
  const before = walletBalance(harness.api().transactions, w.id, w.openingBalance);
  const uid = getMockUid();
  await writeRawDoc(`users/${uid}/transactions/inf`, { type: 'expense', amount: Infinity, walletId: w.id, date: '2026-09-01' });
  await writeRawDoc(`users/${uid}/transactions/baddate`, { type: 'expense', amount: 50, walletId: w.id, date: '1/9/2026' });
  await writeRawDoc(`users/${uid}/transactions/ok`, { type: 'expense', amount: 30, walletId: w.id, date: '2026-09-01' });
  await harness.waitForData(a => a.brokenTransactions.length === 2 && a.transactions.some(t => t.id === 'ok'));
  const api = harness.api();
  expect(api.transactions.map(t => t.id)).not.toEqual(expect.arrayContaining(['inf']));
  expect(api.transactions.some(t => t.id === 'baddate')).toBe(false);
  expect(api.brokenTransactions.map(b => [b.id, b.reasons]).sort()).toEqual([['baddate', ['date']], ['inf', ['amount']]]);
  expect(walletBalance(api.transactions, w.id, w.openingBalance)).toBe(before - 30);
  // التصدير الكامل بيطلع كل المتخزّن ومبيقعش (كان TypeError على التاريخ) — والبايظة عليها عمود "مشكلة"
  const { buildFullExportSheets } = require('@/lib/fullExport');
  const all = await api.readAllFromServer();
  expect(all.outcome).toBe('done');
  if (all.outcome !== 'done') throw new Error('export');
  const txSheet = buildFullExportSheets(all.data).find((s: { name: string }) => s.name === 'Transactions');
  const problem = Object.fromEntries(txSheet.rows.map((r: { Id: string; Problem: string }) => [r.Id, r.Problem]));
  expect([problem.inf, problem.baddate, problem.ok]).toEqual(['المبلغ مش مقروء', 'التاريخ مش مقروء', '']);
});

it('محفظة رصيد بدايتها Infinity ← صفر + openingInvalid', async () => {
  await writeRawDoc(`users/${getMockUid()}/wallets/winf`, { name: 'بايظة', openingBalance: Infinity, lowAlert: 0 });
  await harness.waitForData(a => a.wallets.some(w => w.id === 'winf'));
  const w = harness.api().wallets.find(x => x.id === 'winf')!;
  expect(w.openingBalance).toBe(0);
  expect(w.openingInvalid).toBe(true);
});
