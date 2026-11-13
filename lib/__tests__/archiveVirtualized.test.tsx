import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import ArchiveScreen from '@/app/archive';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { todayStr } from '@/lib/finance';

/**
 * بند C (مراجعة المشروع 2026-11-05): الأرشيف بـ`FlatList` — "الكل" على آلاف العمليات مبيركّبش كل الصفوف مرة واحدة
 * (كان `ScrollView` + `map`). الهيدر (الإجماليات) والحالة الفاضية لسه ظاهرين.
 */

const mockData: Record<string, unknown> = {};
let mockParams: Record<string, string> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true }, useLocalSearchParams: () => mockParams }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const today = todayStr();
function seed(n: number) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [],
    brokenTransactions: [], pendingTxIds: new Set(), serverReachable: true, debts: [], gamiyas: [], transfersStatus: 'ready',
    transactions: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, type: 'expense', amount: i + 1, date: today, walletId: 'w', createdAt: `${today}T${String(i % 24).padStart(2, '0')}:00:00Z` })),
  });
}
const ui = () => <ThemeProvider><PrivacyProvider><ArchiveScreen /></PrivacyProvider></ThemeProvider>;

it('500 عملية ← القايمة افتراضية: صفوف قليلة متركّبة مش 500', async () => {
  seed(500);
  await render(ui());
  expect(screen.getByTestId('archive_list')).toBeTruthy();
  const mounted = screen.queryAllByTestId(/^archive_tx_/).length;
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(500);
  // الهيدر لسه موجود
  expect(screen.getByText(/العمليات \(500\)/)).toBeTruthy();
});

it('مفيش عمليات ← الحالة الفاضية', async () => {
  seed(0);
  await render(ui());
  expect(screen.getByText('مفيش عمليات في الفترة دي')).toBeTruthy();
});

it('الصف memo: علامة "لسه بترفع" بتظهر وتختفي مع pendingTxIds (مش بتفضل قديمة)', async () => {
  seed(3);
  const view = await render(ui());
  expect(screen.queryByText('⏳ لسه بترفع')).toBeNull();
  mockData.pendingTxIds = new Set(['t1']);
  await view.rerender(ui());
  expect(screen.getAllByText('⏳ لسه بترفع')).toHaveLength(1);
  mockData.pendingTxIds = new Set();
  await view.rerender(ui());
  expect(screen.queryByText('⏳ لسه بترفع')).toBeNull();
});

/** يثبّت «النهاردة» (Date بس) عشان نص التاريخ ميتغيّرش بتغيّر يوم الجهاز — باقي التايمرز حقيقية */
const pinToday = (y: number, m: number, d: number) => jest.useFakeTimers({
  now: new Date(y, m, d, 12, 0), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'hrtime', 'performance'],
});

describe('وقت العملية في صف الأرشيف', () => {
  beforeEach(() => pinToday(2026, 10, 13)); // النهاردة 13 نوفمبر
  afterEach(() => jest.useRealTimers());
  const made = new Date(2026, 10, 12, 11, 34).toISOString();
  const tx = (id: string, date: string) => ({ id, type: 'expense', amount: 5, date, walletId: 'w', createdAt: made });

  it('بتاريخ قديم ← التاريخ لوحده، ونفس يومها ← التاريخ والوقت', async () => {
    seed(0);
    mockData.transactions = [tx('back', '2026-11-10'), tx('same', '2026-11-12')];
    await render(ui());
    fireEvent.press(screen.getByTestId('archive_preset_all'));
    expect(within(screen.getByTestId('archive_tx_back')).getByText('10 نوفمبر')).toBeTruthy();
    expect(within(screen.getByTestId('archive_tx_same')).getByText('امبارح · 11:34 ص')).toBeTruthy();
  });
});

describe('الفتح على فلتر من باراميتر (شوف كل العمليات من الرئيسية)', () => {
  afterEach(() => { mockParams = {}; });

  function seedOldAndNew() {
    seed(0);
    const old = (id: string, date: string) => ({ id, type: 'expense', amount: 5, date, walletId: 'w', createdAt: `${date}T10:00:00Z` });
    mockData.transactions = [old('new1', today), old('old1', '2020-01-15'), old('old2', '2020-02-15')];
  }

  it('preset=all ← "الكل" هي المختارة وكل العمليات ظاهرة', async () => {
    mockParams = { preset: 'all' };
    seedOldAndNew();
    await render(ui());
    expect(screen.getByTestId('archive_preset_all').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('archive_preset_thisMonth').props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByText(/العمليات \(3\)/)).toBeTruthy();
    expect(screen.getByTestId('archive_tx_old1')).toBeTruthy();
  });

  it('من غير باراميتر ← "الشهر ده" زي الأول', async () => {
    seedOldAndNew();
    await render(ui());
    expect(screen.getByTestId('archive_preset_thisMonth').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('archive_preset_all').props.accessibilityState).toEqual({ checked: false });
    expect(screen.queryByTestId('archive_tx_old1')).toBeNull();
  });

  it('باراميتر غير "all" ← بيتتجاهل', async () => {
    mockParams = { preset: 'custom' };
    seedOldAndNew();
    await render(ui());
    expect(screen.getByTestId('archive_preset_thisMonth').props.accessibilityState).toEqual({ checked: true });
  });
});
