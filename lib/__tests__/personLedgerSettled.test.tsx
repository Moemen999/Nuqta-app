import React from 'react';
import { render, screen } from '@testing-library/react-native';
import PersonLedgerScreen from '@/app/person-ledger';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import type { Debt } from '@/context/DataContext';
import { debtExcess, groupDebtsByPerson, snapPiastre } from '@/lib/finance';

/**
 * "اتسدد" بنص قرش في كشف الشخص والتقارير (fix/settled-epsilon-2، money-reviewer + silent-failure-hunter):
 * راس الكشف والقايمة اللي تحته لازم يقولوا نفس الكلام.
 */

const mockData: Record<string, unknown> = {};
let mockKey = '';
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({ personKey: mockKey }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/components/useDeviceContacts', () => ({ useDeviceContacts: () => ({}) }));

const debt = (id: string, direction: 'owed_to_me' | 'i_owe', total: number, paid: number[]) => ({
  id, personName: 'منى', direction, totalAmount: total, isInstallment: false, date: '2026-07-01', createdAt: '2026-07-01',
  payments: paid.map((amount, i) => ({ id: `p_${id}_${i}`, date: '2026-08-01', amount, walletId: 'w1', transactionId: `tp_${id}_${i}` })),
  increases: [],
}) as unknown as Debt;

function show(debts: Debt[], pendingTxIds: Set<string> = new Set()) {
  Object.assign(mockData, { debts, pendingTxIds, wallets: [{ id: 'w1', name: 'الكاش', openingBalance: 0, lowAlert: 0 }], transactions: [] });
  mockKey = groupDebtsByPerson(debts)[0].key;
  return render(<ThemeProvider><NoticeProvider><PrivacyProvider><PersonLedgerScreen /></PrivacyProvider></NoticeProvider></ThemeProvider>);
}

describe('كشف الشخص: الراس والقايمة نفس الكلام', () => {
  it('دينين متسددين في نفس الاتجاه، كل واحد باقيه 0.004 (قديم) ← "متسدد بالكامل" مش "ليك عنده 0.01"', async () => {
    await show([debt('a', 'owed_to_me', 100.004, [100]), debt('b', 'owed_to_me', 50.004, [50])]);
    expect(screen.getByText('متسدد بالكامل')).toBeTruthy();
    expect(screen.queryByText('ليك عنده')).toBeNull();
  });

  it('دين ليك ودين عليك قد بعض ومفتوحين ← مش "متسدد بالكامل"', async () => {
    await show([debt('a', 'owed_to_me', 100, []), debt('b', 'i_owe', 100, [])]);
    expect(screen.queryByText('متسدد بالكامل')).toBeNull();
    expect(screen.getByText('اللي ليك قد اللي عليك')).toBeTruthy();
  });

  it('دفعة بتقفل الدين ولسه بترفع ← الدين يفضل في القايمة زي تاب الديون، والراس مبيقولش "قد بعض"', async () => {
    await show([debt('a', 'owed_to_me', 100, [100])], new Set(['tp_a_0']));
    expect(screen.queryByText(/كل حاجة متسددة/)).toBeNull();
    expect(screen.queryByText('اللي ليك قد اللي عليك')).toBeNull();
    expect(screen.getByText('متسدد بالكامل')).toBeTruthy();
  });

  it('كسور الجمع (~1e-13) مبتطلّعش "−0.00" في رصيد آخر سطر', async () => {
    await show([debt('a', 'i_owe', 875.37, [205.7, 420.39, 4.17, 245.11])]);
    expect(screen.queryByText(/−\s*0[.,]00/)).toBeNull();
    expect(screen.getByText('متسدد بالكامل')).toBeTruthy();
  });
});

describe('snapPiastre و debtExcess بنفس العتبة', () => {
  it('snapPiastre: نص قرش ← صفر، أكتر ← زي ما هو', () => {
    expect(snapPiastre(0.004)).toBe(0);
    expect(snapPiastre(-0.004)).toBe(0);
    expect(snapPiastre(1e-13)).toBe(0);
    expect(snapPiastre(0.006)).toBe(0.006);
    expect(snapPiastre(-12.5)).toBe(-12.5);
  });
  it('debtExcess: زيادة أقل من نص قرش ← صفر (كانت "زيادة 0.00")، قرش ← قرش', () => {
    expect(debtExcess(debt('a', 'owed_to_me', 550, [550.004]))).toBe(0);
    expect(debtExcess(debt('a', 'owed_to_me', 550, [550.01]))).toBeCloseTo(0.01, 6);
  });
});

describe('وصف الدين في الكشف: اليوم المحلي مش يوم UTC', () => {
  afterEach(() => jest.useRealTimers());
  const noDate = (createdAt?: string) => ({ ...debt('a', 'owed_to_me', 100, []), date: undefined, createdAt }) as unknown as Debt;
  const pin = () => jest.useFakeTimers({ now: new Date(2026, 10, 13, 12, 0), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'hrtime', 'performance'] });

  it('من غير date، الساعة 11:30 بالليل محليًا ← يوم محلي (حتى لو UTC بقى اليوم اللي بعده)', async () => {
    pin();
    await show([noDate(new Date(2026, 10, 12, 23, 30).toISOString())]);
    expect(screen.getByText('ليا · 12 نوفمبر')).toBeTruthy();
  });

  it('من غير date، الساعة 12:30 بعد نص الليل محليًا ← يوم محلي (حتى لو UTC لسه اليوم اللي قبله)', async () => {
    pin();
    await show([noDate(new Date(2026, 10, 13, 0, 30).toISOString())]);
    expect(screen.getByText('ليا · 13 نوفمبر')).toBeTruthy();
  });

  it('من غير date ولا createdAt ← من غير فاصل متدلّي', async () => {
    pin();
    await show([noDate(undefined)]);
    expect(screen.getByText('ليا')).toBeTruthy();
    expect(screen.queryByText(/ليا ·s*$/)).toBeNull();
  });
});
