import { db } from '@/firebaseConfig';
import { todayStr } from '@/lib/finance';
import { getMockUid } from '@/test-utils/mockAuth';
import type { renderDataProvider } from '@/test-utils/renderDataProvider';
import { collection, doc, getDoc } from 'firebase/firestore';

/**
 * مساعدات اختبارات المحاكي لبند 15/13 (اشتراك وجمعية بقيم عادية، وقراية المتخزّن من
 * فايرستور). كل دالة بتتأكد إن الإضافة رجّعت `done` — fixture بقى غلط بيقع هنا على
 * طول مش بعدين بعَرَض محيّر (tdd-guide).
 */
type Harness = Awaited<ReturnType<typeof renderDataProvider>>;

export const userCol = (name: string) => collection(db, 'users', getMockUid(), name);
export const storedDoc = async (name: string, id: string) => (await getDoc(doc(userCol(name), id))).data()!;

export const subData = (h: Harness, o: Record<string, unknown> = {}) => ({
  name: 'نتفليكس', amount: 100, walletId: h.api().wallets[0].id, frequency: 'monthly' as const,
  nextDueDate: todayStr(), reminderDaysBefore: 3, ...o,
});
export const gamData = (h: Harness, o: Record<string, unknown> = {}) => ({
  name: 'جمعية', monthlyAmount: 1000, payoutAmount: 10000, totalMonths: 10, payoutMonthIndex: 3,
  walletId: h.api().wallets[0].id, startDate: todayStr(), reminderDaysBefore: 3, ...o,
});

export async function addOneSub(h: Harness, o: Record<string, unknown> = {}) {
  expect(await h.api().addSubscription(subData(h, o) as never)).toEqual({ outcome: 'done' });
  await h.waitForData(api => api.subscriptions.length === 1);
  return h.api().subscriptions[0].id;
}
export async function addOneGam(h: Harness, o: Record<string, unknown> = {}) {
  expect(await h.api().addGamiya(gamData(h, o) as never)).toEqual({ outcome: 'done' });
  await h.waitForData(api => api.gamiyas.length === 1);
  return h.api().gamiyas[0].id;
}
