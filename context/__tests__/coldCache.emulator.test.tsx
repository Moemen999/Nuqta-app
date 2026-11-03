import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { getMockUid, setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import { COLD_CACHE_VERSION, COLD_CACHE_WRITE_DELAY_MS, coldCacheKey } from '@/lib/coldCache';
import { walletBalance } from '@/lib/finance';
import { act, waitFor } from '@testing-library/react-native';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => {
    const uid = require('@/test-utils/mockAuth').getMockUid();
    return { user: uid ? { uid } : null };
  },
}));

/**
 * كاش أول فتحة باردة متوصّل بـ`DataProvider` الحقيقي (`reports/2026-11-02-cold-cache-design.md`):
 * بيتكتب من أرقام السيرفر من غير نوتات، **عمره ما يدخل `wallets`** (اللي الكتابات والحراسات بتقرا منه)،
 * وبيتمسح مع الخروج.
 */
let h: Awaited<ReturnType<typeof renderDataProvider>>;
beforeEach(async () => {
  await AsyncStorage.clear();
  await clearFirestore();
  setMockUid(await signInTestUser());
});
afterEach(async () => { await h?.unmount(); });

const stored = async (uid = getMockUid()) => {
  const raw = await AsyncStorage.getItem(coldCacheKey(uid));
  return raw ? JSON.parse(raw) : null;
};

it('بعد ما الأرقام تيجي من السيرفر ← الكاش بيتكتب بالأرصدة الصح ومن غير نوتات', async () => {
  h = await renderDataProvider();
  await h.waitForReady();
  const w = h.api().wallets[0];
  await h.api().addTransaction({ type: 'expense', amount: 75, walletId: w.id, date: '2026-11-01', note: 'غدا مع محمد' } as never);
  await h.waitForData(api => api.transactions.length === 1 && api.figuresFromServer);
  await waitFor(async () => {
    const s = await stored();
    expect(s?.recent).toHaveLength(1);
  }, { timeout: COLD_CACHE_WRITE_DELAY_MS + 8000 });
  const s = await stored();
  expect(s.v).toBe(COLD_CACHE_VERSION);
  expect(JSON.stringify(s)).not.toContain('محمد');
  const cached = s.wallets.find((x: { id: string }) => x.id === w.id);
  expect(cached.balance).toBe(walletBalance(h.api().transactions, w.id, w.openingBalance));
  // والأرقام من السيرفر موجودة ← مفيش coldSnapshot للعرض
  expect(h.api().coldSnapshot).toBeNull();
});

it('محفظة موجودة في الكاش بس ← عمرها ما تظهر في wallets (ولا في أي رسمة)', async () => {
  const uid = getMockUid();
  await AsyncStorage.setItem(coldCacheKey(uid), JSON.stringify({
    v: COLD_CACHE_VERSION, uid, savedAt: Date.now() - 1000,
    wallets: [{ id: 'ghost', name: 'شبح', balance: 999999 }], recent: [], categories: [],
  }));
  const seen = new Set<string>();
  const coldSeen: (string | undefined)[] = [];
  function Spy() {
    const { useData } = require('@/context/DataContext');
    const d = useData();
    d.wallets.forEach((x: { id: string }) => seen.add(x.id));
    coldSeen.push(d.coldSnapshot?.wallets[0]?.id);
    return null;
  }
  h = await renderDataProvider(<Spy />);
  await h.waitForReady();
  expect(seen.has('ghost')).toBe(false);
  // ولما السيرفر رد، الكاش اختفى من العرض
  expect(h.api().coldSnapshot).toBeNull();
  // (لو الكاش ظهر للعرض قبل السيرفر، ده المسموح — بس في coldSnapshot لوحده)
  expect(coldSeen.every(id => id === undefined || id === 'ghost')).toBe(true);
});

it('الخروج ← كاش الحساب ده بيتمسح من الجهاز', async () => {
  h = await renderDataProvider();
  await h.waitForReady();
  const uid = getMockUid();
  await waitFor(async () => expect(await stored(uid)).not.toBeNull(), { timeout: COLD_CACHE_WRITE_DELAY_MS + 8000 });
  setMockUid(null as never);
  await act(async () => { h.rerender(); });
  await waitFor(async () => expect(await AsyncStorage.getItem(coldCacheKey(uid))).toBeNull(), { timeout: 5000 });
});

it('كنس: كاش حساب تاني فاضل على الجهاز (التطبيق اتقفل قبل المسح) ← بيتمسح أول ما حساب يفتح', async () => {
  await AsyncStorage.setItem(coldCacheKey('someone-else'), JSON.stringify({ v: COLD_CACHE_VERSION, uid: 'someone-else' }));
  h = await renderDataProvider();
  await h.waitForReady();
  await waitFor(async () => expect(await AsyncStorage.getItem(coldCacheKey('someone-else'))).toBeNull(), { timeout: 5000 });
});

it('كاش من غير محافظ ← عمره ما يتعرض (كان هيخبّي "مفيش ولا محفظة")', async () => {
  const uid = getMockUid();
  await AsyncStorage.setItem(coldCacheKey(uid), JSON.stringify({
    v: COLD_CACHE_VERSION, uid, savedAt: Date.now() - 1000, wallets: [], recent: [], categories: [],
  }));
  const shown: unknown[] = [];
  function Spy() {
    const { useData } = require('@/context/DataContext');
    shown.push(useData().coldSnapshot);
    return null;
  }
  h = await renderDataProvider(<Spy />);
  await h.waitForReady();
  expect(shown.every(s => s === null)).toBe(true);
});
