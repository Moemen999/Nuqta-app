import { db } from '@/firebaseConfig';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

/**
 * مسح هجمات (2026-11-07، طلب مؤمن "اختبار عنيف/مخترق") — بيسجّل كل هجمة اتقبلت ولا اترفضت ويطبع جدول.
 * مش بيفشل: ده **قياس** للقواعد الحالية، مش حارس. الحرّاس الحقيقيين في security.emulator.test.
 */
type Result = { name: string; allowed: boolean; code?: string };
const results: Result[] = [];
async function attempt(name: string, p: () => Promise<unknown>) {
  try { await p(); results.push({ name, allowed: true }); }
  catch (e) { results.push({ name, allowed: false, code: (e as { code?: string }).code }); }
}

beforeAll(async () => { await clearFirestore(); });
afterAll(() => {
  // eslint-disable-next-line no-console
  console.log('ATTACK RESULTS\n' + results.map(r => `${r.allowed ? 'ALLOWED' : 'denied '}  ${r.name}${r.code ? ' (' + r.code + ')' : ''}`).join('\n'));
});

it('probe', async () => {
  const B = await signInTestUser();
  await setDoc(doc(db, 'users', B, 'wallets', 'wb'), { name: 'B', openingBalance: 10, lowAlert: 0 });
  const A = await signInTestUser();
  const big = 'x'.repeat(900000);
  const tx = { type: 'expense', amount: 10, walletId: 'w', date: '2026-01-01' };
  // داخل الحساب نفسه (قيم بايظة)
  await attempt('1 tx amount Infinity', () => setDoc(doc(db, 'users', A, 'transactions', 't1'), { ...tx, amount: Infinity }));
  await attempt('2 debt totalAmount Infinity', () => setDoc(doc(db, 'users', A, 'debts', 'd1'), { personName: 'x', totalAmount: Infinity, direction: 'i_owe' }));
  await attempt('3 sub amount Infinity', () => setDoc(doc(db, 'users', A, 'subscriptions', 's1'), { name: 'x', amount: Infinity }));
  await attempt('4 income amount Infinity', () => setDoc(doc(db, 'users', A, 'incomes', 'i1'), { name: 'x', amount: Infinity, walletId: 'w', frequency: 'monthly', mode: 'auto', status: 'active' }));
  await attempt('5 wallet openingBalance NaN', () => setDoc(doc(db, 'users', A, 'wallets', 'w1'), { name: 'x', openingBalance: NaN, lowAlert: Infinity }));
  await attempt('6 wallet openingBalance -1e300', () => setDoc(doc(db, 'users', A, 'wallets', 'w2'), { name: 'x', openingBalance: -1e300, lowAlert: 0 }));
  await attempt('7 gamiya monthlyAmount -5', () => setDoc(doc(db, 'users', A, 'gamiyas', 'g1'), { name: 'x', monthlyAmount: -5 }));
  await attempt('8 gamiya empty name', () => setDoc(doc(db, 'users', A, 'gamiyas', 'g2'), { name: '', monthlyAmount: 100 }));
  await attempt('9 sub empty name', () => setDoc(doc(db, 'users', A, 'subscriptions', 's2'), { name: '', amount: 10 }));
  await attempt('10 shakhbata NaN/neg/huge', () => setDoc(doc(db, 'users', A, 'shakhbata_settings', 'percents'), { needs: NaN, wants: -50, future: 1e308 }));
  await attempt('11 budget limit Infinity', () => setDoc(doc(db, 'users', A, 'budgets', 'c1'), { limit: Infinity }));
  await attempt('12 shakhbata income Infinity', () => setDoc(doc(db, 'users', A, 'shakhbata_income', '2026-01'), { income: Infinity }));
  await attempt('13 tx note 900KB', () => setDoc(doc(db, 'users', A, 'transactions', 't13'), { ...tx, note: big }));
  await attempt('14 tx date garbage', () => setDoc(doc(db, 'users', A, 'transactions', 't14'), { ...tx, date: 'not-a-date' }));
  await attempt('15 tx createdAt number / deep note', () => setDoc(doc(db, 'users', A, 'transactions', 't15'), { ...tx, createdAt: 12345, note: { a: { b: [1] } }, toWalletId: 5 }));
  await attempt('16 debt payments negative / increases string', () => setDoc(doc(db, 'users', A, 'debts', 'd16'), { personName: '', totalAmount: 1, direction: 'i_owe', payments: [{ amount: -1e9 }], increases: 'x' }));
  await attempt('20 users/A role+900KB', () => setDoc(doc(db, 'users', A), { seeded: true, role: 'admin', big }));
  await attempt('21 unknown subcollection', () => setDoc(doc(db, 'users', A, 'random_new', 'x'), { a: 1 }));
  await attempt('update valid tx to Infinity', async () => { await setDoc(doc(db, 'users', A, 'transactions', 'tv'), tx); await updateDoc(doc(db, 'users', A, 'transactions', 'tv'), { amount: Infinity }); });
  // عزل بين المستخدمين
  await attempt('X list all users', () => getDocs(collection(db, 'users')));
  await attempt('X collectionGroup transactions', () => getDocs(collectionGroup(db, 'transactions')));
  await attempt('X collectionGroup debts', () => getDocs(collectionGroup(db, 'debts')));
  await attempt('X read users/B', () => getDoc(doc(db, 'users', B)));
  await attempt('X read B wallet', () => getDoc(doc(db, 'users', B, 'wallets', 'wb')));
  await attempt('X write B wallet', () => setDoc(doc(db, 'users', B, 'wallets', 'x'), { name: 'hack', openingBalance: 0, lowAlert: 0 }));
  await attempt('X delete B wallet', () => deleteDoc(doc(db, 'users', B, 'wallets', 'wb')));
  await attempt('X delete users/B', () => deleteDoc(doc(db, 'users', B)));
  // feedback
  const fb = (extra: object) => ({ uid: A, type: 'idea', text: 'رأي', createdAt: new Date(), appVersion: '1', platform: 'android', deviceModel: 'x', osVersion: '1', buildNumber: '1', fullVersion: '1', ...extra });
  await attempt('17 feedback + junk 900KB', () => setDoc(doc(collection(db, 'feedback')), fb({ junk: big })));
  await attempt('18 feedback + status/reply', () => setDoc(doc(collection(db, 'feedback')), fb({ status: 'resolved', reply: 'x' })));
  await attempt('X feedback as other uid', () => setDoc(doc(collection(db, 'feedback')), fb({ uid: B })));
  expect(results.length).toBeGreaterThan(20);
});
