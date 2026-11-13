import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { COLD_CACHE_PREFIX, COLD_CACHE_WRITE_DELAY_MS, coldCacheKey } from '@/lib/coldCache';
import { act, waitFor } from '@testing-library/react-native';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => {
    const uid = require('@/test-utils/mockAuth').getMockUid();
    return { user: uid ? { uid } : null };
  },
}));

/**
 * مسح الحساب والكاش المحلي (`lib/coldCache.ts`): بعد المسح الكامل مفيش `nuqta-cold-cache:{uid}` فاضل على الجهاز
 * ومفيش حاجة بتكتبه تاني بعد كده — حتى بعد أكتر من `COLD_CACHE_WRITE_DELAY_MS`. (مسار المسح نفسه مبيمسحوش:
 * اللي بيمسحه هو تأثير المسح في `DataContext` لما الـuid يتغيّر، ولما المحافظ تفضى.)
 * المحاكي الحقيقي + `DataProvider` الحقيقي + `deleteAllMyData` الحقيقية؛ خروج المستخدم (`deleteUser`) متقلّد بـ`user = null`.
 */
let h: Awaited<ReturnType<typeof renderDataProvider>>;
beforeEach(async () => {
  await AsyncStorage.clear();
  await clearFirestore();
  setMockUid(await signInTestUser());
});
afterEach(async () => { await h?.unmount(); });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const coldKeys = async () => (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(COLD_CACHE_PREFIX));

async function readyWithWrittenCache() {
  h = await renderDataProvider();
  await h.waitForReady();
  const w = h.api().wallets[0];
  await h.api().addTransaction({ type: 'expense', amount: 75, walletId: w.id, date: '2026-11-01', note: 'x' } as never);
  await h.waitForData(api => api.transactions.length === 1 && api.figuresFromServer);
  await waitFor(async () => expect(await AsyncStorage.getItem(coldCacheKey(getMockUid()))).not.toBeNull(), { timeout: COLD_CACHE_WRITE_DELAY_MS + 8000 });
}

it('مسح كامل ثم خروج المستخدم ← الكاش بيتمسح ومبيتكتبش تاني بعد المهلة', async () => {
  await readyWithWrittenCache();
  const uid = getMockUid();
  expect(await h.api().deleteAllMyData()).toEqual({ outcome: 'done' });
  // deleteUser بيخرّج المستخدم
  setMockUid(null as never);
  await act(async () => { h.rerender(); });
  await waitFor(async () => expect(await AsyncStorage.getItem(coldCacheKey(uid))).toBeNull(), { timeout: 5000 });
  // أكتر من مهلة الكتابة، والكاش لسه مش موجود (وأي مفتاح كاش)
  await sleep(COLD_CACHE_WRITE_DELAY_MS + 1500);
  expect(await AsyncStorage.getItem(coldCacheKey(uid))).toBeNull();
  expect(await coldKeys()).toEqual([]);
});

it('مسح كامل والمستخدم لسه داخل (قبل deleteUser) ← الكاش بيتمسح لما المحافظ تفضى ومفيش نص-بيانات بتفضل', async () => {
  await readyWithWrittenCache();
  const uid = getMockUid();
  expect(await h.api().deleteAllMyData()).toEqual({ outcome: 'done' });
  await waitFor(async () => expect(await AsyncStorage.getItem(coldCacheKey(uid))).toBeNull(), { timeout: COLD_CACHE_WRITE_DELAY_MS + 8000 });
  await sleep(COLD_CACHE_WRITE_DELAY_MS + 1500);
  expect(await AsyncStorage.getItem(coldCacheKey(uid))).toBeNull();
  // ولما المستخدم يخرج بعدها كمان
  setMockUid(null as never);
  await act(async () => { h.rerender(); });
  await sleep(COLD_CACHE_WRITE_DELAY_MS + 1500);
  expect(await coldKeys()).toEqual([]);
});

it('خروج المستخدم فورًا بعد المسح (قبل ما أي listener أو مؤقّت كتابة يلحق) ← مفيش كتابة بعد المسح', async () => {
  await readyWithWrittenCache();
  const uid = getMockUid();
  expect(await h.api().deleteAllMyData()).toEqual({ outcome: 'done' });
  setMockUid(null as never);
  await act(async () => { h.rerender(); });
  await sleep(COLD_CACHE_WRITE_DELAY_MS + 2500);
  expect(await AsyncStorage.getItem(coldCacheKey(uid))).toBeNull();
  expect(await coldKeys()).toEqual([]);
});
