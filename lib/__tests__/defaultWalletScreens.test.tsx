import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AddTransactionModal from '@/app/modal';
import { AddDebtModal, DebtIncreaseModal, DebtPaymentModal } from '@/components/DebtEntryModals';
import SubscriptionsView from '@/components/SubscriptionsView';
import GamiyaView from '@/components/GamiyaView';
import { IOS_DISMISS_FALLBACK_MS } from '@/components/ActionSheet';
import IncomesView from '@/components/IncomesView';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import type { Debt } from '@/context/DataContext';
import { warmUp } from '@/test-utils/warmUp';

/**
 * المحفظة الافتراضية في الفورمات (ب4، 2026-11-13) — على الشاشات نفسها:
 * - دين (سداد/زيادة): محفظة الدين. أي فورم إضافة تاني: آخر محفظة اتسجل عليها.
 * - التعديل: محفظة السجل نفسه.
 * - المحفظة اللي الشيب شايفه مختارة = اللي بتتبعت للحفظ، والبيانات المتأخرة عمرها ما تغيّرها بعد أول إدخال.
 * - إضافة اشتراك/جمعية (متركّبين طول الوقت): كل فتحة من الأول، من غير محفظة اتأرشفت.
 */

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const W = (id: string, name: string, archived = false) => ({ id, name, openingBalance: 0, lowAlert: 0, ...(archived ? { archived: true } : {}) });
const A = W('A', 'ألف'), B = W('B', 'باء'), C = W('C', 'جيم');
let n = 0;
const T = (walletId: string, createdAt: string | undefined, extra: Record<string, unknown> = {}) => ({
  id: `t${++n}`, type: 'expense', amount: 10, walletId, date: '2026-11-01', ...(createdAt ? { createdAt } : {}), ...extra,
});
const at = (day: number) => `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z`;

const wrap = (node: React.ReactNode) => <ThemeProvider><NoticeProvider><ConfirmProvider><PrivacyProvider>{node}</PrivacyProvider></ConfirmProvider></NoticeProvider></ThemeProvider>;
// بالـregex: اسم المحفظة المؤرشفة بيتعرض بعلامة بعده (`walletHistoryName`)
const checked = (name: string) => !!screen.queryByRole('radio', { name: new RegExp(name), checked: true });
const shown = (name: string) => screen.queryAllByRole('radio', { name: new RegExp(name) }).length > 0;
const press = (el: Parameters<typeof fireEvent.press>[0]) => act(async () => { fireEvent.press(el); });
const type = (el: Parameters<typeof fireEvent.changeText>[0], v: string) => act(async () => { fireEvent.changeText(el, v); });

function seed(over: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [A, B, C], categories: [], transactions: [], debts: [], subscriptions: [], gamiyas: [], incomes: [],
    linkSourcesReady: true, loadErrors: [], figuresPending: [], retryLoad: jest.fn(), transactionLinkWarning: () => null,
    addTransaction: jest.fn(), updateTransaction: jest.fn(), deleteTransaction: jest.fn(),
    addDebtPayment: jest.fn(async () => ({ outcome: 'done', note: null })),
    addDebtIncrease: jest.fn(async () => ({ outcome: 'done' })),
    addDebt: jest.fn(),
    addSubscription: jest.fn(async () => ({ outcome: 'done' })),
    addGamiya: jest.fn(async () => ({ outcome: 'done' })),
    addIncome: jest.fn(),
    updateIncome: jest.fn(),
    recordIncomePeriods: jest.fn(), setIncomeStatus: jest.fn(), deleteIncome: jest.fn(),
    deleteSubscription: jest.fn(), deleteGamiya: jest.fn(), setSubscriptionActive: jest.fn(), markSubscriptionPaid: jest.fn(), markGamiyaMonthDone: jest.fn(),
    ...over,
  });
}
/** بيانات اتغيّرت وهو فاتح الشاشة (snapshot جديد) */
async function dataChanges(r: { rerender: (e: React.ReactElement) => unknown }, ui: () => React.ReactElement, over: Record<string, unknown>) {
  Object.assign(mockData, over);
  await act(async () => { r.rerender(ui()); });
}

beforeEach(() => { mockParams = {}; seed(); });
warmUp(() => { seed(); return wrap(<AddTransactionModal />); });

/* ───────────── نموذج العملية (app/modal.tsx) ───────────── */

describe('عملية جديدة', () => {
  const ui = () => wrap(<AddTransactionModal />);
  const lastUsedB = () => [T('A', at(1)), T('B', at(2))];

  it('بتبدأ على آخر محفظة اتسجل عليها (مش أول واحدة)', async () => {
    seed({ transactions: lastUsedB() });
    await render(ui());
    expect(checked('باء')).toBe(true);
    expect(checked('ألف')).toBe(false);
  });

  it('حساب جديد من غير عمليات ← أول محفظة شغّالة', async () => {
    seed({ wallets: [W('A', 'ألف', true), B, C] });
    await render(ui());
    expect(checked('باء')).toBe(true);
  });

  it('البيانات وصلت متأخرة وقبل أي إدخال ← بتتبعها', async () => {
    seed({ wallets: [], transactions: [] });
    const r = await render(ui());
    await dataChanges(r, ui, { wallets: [A, B, C], transactions: lastUsedB() });
    expect(checked('باء')).toBe(true);
    await dataChanges(r, ui, { transactions: [...lastUsedB(), T('C', at(3))] });
    expect(checked('جيم')).toBe(true);
  });

  it('المحفظة اللي الشيب شايفه مختارة هي اللي بتتبعت للحفظ (من "آخر محفظة")', async () => {
    seed({ transactions: lastUsedB() });
    await render(ui());
    await type(screen.getByTestId('tx_amount_input'), '50');
    expect(checked('باء')).toBe(true);
    await press(screen.getByTestId('tx_save_button'));
    expect(mockData.addTransaction).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'B', amount: 50 }));
  });

  it('كتابة المبلغ وبعدين البيانات اتغيّرت (آخر محفظة بقت جيم) ← لسه باء، وباء هي اللي بتتحفظ', async () => {
    seed({ transactions: lastUsedB() });
    const r = await render(ui());
    await type(screen.getByTestId('tx_amount_input'), '50');
    await dataChanges(r, ui, { transactions: [...lastUsedB(), T('C', at(3))] });
    expect(checked('باء')).toBe(true);
    expect(checked('جيم')).toBe(false);
    await press(screen.getByTestId('tx_save_button'));
    expect(mockData.addTransaction).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'B' }));
  });

  it('المستخدم اختار ألف وبعدين الافتراضي اتغيّر ← ألف', async () => {
    seed({ transactions: lastUsedB() });
    const r = await render(ui());
    await press(screen.getByRole('radio', { name: 'ألف' }));
    await dataChanges(r, ui, { transactions: [...lastUsedB(), T('C', at(3))] });
    expect(checked('ألف')).toBe(true);
    await type(screen.getByTestId('tx_amount_input'), '5');
    await press(screen.getByTestId('tx_save_button'));
    expect(mockData.addTransaction).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'A' }));
  });

  // كل خانة إدخال بتثبّت — لو واحدة نسيت، الافتراضي ممكن يتقلب بعد ما المستخدم بدأ
  it.each([
    ['المبلغ', () => type(screen.getByTestId('tx_amount_input'), '7')],
    ['الملاحظة', () => type(screen.getByPlaceholderText('اختياري'), 'قهوة')],
    ['نوع العملية', () => press(screen.getByTestId('tx_type_income'))],
  ])('%s بتثبّت المحفظة قبل ما البيانات تتغيّر', async (_name, input) => {
    seed({ transactions: lastUsedB() });
    const r = await render(ui());
    await input();
    await dataChanges(r, ui, { transactions: [...lastUsedB(), T('C', at(3))] });
    expect(checked('باء')).toBe(true);
    expect(checked('جيم')).toBe(false);
  });

  it('محفظة الافتراضي اتأرشفت وهو بيكتب ← الشيب لسه ظاهر ومختار (مبيختفيش وهو اللي هيتحفظ)', async () => {
    seed({ transactions: lastUsedB() });
    const r = await render(ui());
    await type(screen.getByTestId('tx_amount_input'), '9');
    await dataChanges(r, ui, { wallets: [A, W('B', 'باء', true), C] });
    expect(checked('باء')).toBe(true);
    await press(screen.getByTestId('tx_save_button'));
    expect(mockData.addTransaction).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'B' }));
  });

  it('الافتراضي عمره ما يبقى مؤرشفة: آخر محفظة مؤرشفة ← الأحدث بعدها', async () => {
    seed({ wallets: [A, W('B', 'باء', true), C], transactions: [T('C', at(1)), T('B', at(2))] });
    await render(ui());
    expect(checked('جيم')).toBe(true);
    expect(shown('باء')).toBe(false);
  });

  it('اللي اتسجل لوحده والتسوية والسحب مش بيحدّدوا الافتراضي', async () => {
    seed({
      transactions: [
        T('A', at(1)), T('B', at(2), { autoRecorded: true }), T('C', at(3), { isSettlement: true }),
        T('B', at(4), { type: 'withdraw', toWalletId: 'C' }),
      ],
    });
    await render(ui());
    expect(checked('ألف')).toBe(true);
  });

  it('كل المحافظ مؤرشفة ← مفيش محفظة مختارة، والحفظ بيترفض ومفيش كتابة', async () => {
    seed({ wallets: [W('A', 'ألف', true)], transactions: [T('A', at(1))] });
    await render(ui());
    expect(screen.queryAllByRole('radio', { checked: true }).filter(e => e.props.accessibilityState?.checked).length).toBe(1); // نوع العملية بس
    await press(screen.getByTestId('tx_save_button'));
    expect(screen.getAllByText('مفيش ولا محفظة لسه — ضيف محفظة الأول، وبعدين سجّل العملية.').length).toBeGreaterThan(0);
    expect(mockData.addTransaction).not.toHaveBeenCalled();
  });
});

describe('تحويل (سحب) — "إلى" عمرها ما تساوي "من"', () => {
  const ui = () => wrap(<AddTransactionModal />);
  async function saveTransfer() {
    await render(ui());
    await press(screen.getByTestId('tx_type_withdraw'));
    await type(screen.getByTestId('tx_amount_input'), '30');
    await press(screen.getByTestId('tx_save_button'));
  }
  const saved = () => (mockData.addTransaction as jest.Mock).mock.calls[0]?.[0] as { walletId: string; toWalletId?: string } | undefined;

  it('آخر تحويل راح لجيم وآخر محفظة باء ← من باء إلى جيم', async () => {
    seed({ transactions: [T('B', at(2)), T('A', at(1), { type: 'withdraw', toWalletId: 'C' })] });
    await saveTransfer();
    expect(saved()).toEqual(expect.objectContaining({ walletId: 'B', toWalletId: 'C', type: 'withdraw' }));
  });

  it('آخر تحويل راح لنفس "من" الافتراضي ← "إلى" أول محفظة تانية مش "من"', async () => {
    seed({ transactions: [T('B', at(2)), T('A', at(1), { type: 'withdraw', toWalletId: 'B' })] });
    await saveTransfer();
    expect(saved()).toEqual(expect.objectContaining({ walletId: 'B', toWalletId: 'A' }));
  });

  it('محفظة واحدة بس ← مفيش "إلى"، والحفظ بيتقال له "اختار محفظة وجهة مختلفة"', async () => {
    seed({ wallets: [A], transactions: [T('A', at(1))] });
    await saveTransfer();
    expect(mockData.addTransaction).not.toHaveBeenCalled();
    expect(screen.getByText('اختار محفظة وجهة مختلفة')).toBeTruthy();
  });

  it('وجهة آخر تحويل اتأرشفت ← أول محفظة شغّالة غير "من"', async () => {
    seed({ wallets: [A, B, W('C', 'جيم', true)], transactions: [T('B', at(2)), T('A', at(1), { type: 'withdraw', toWalletId: 'C' })] });
    await saveTransfer();
    expect(saved()).toEqual(expect.objectContaining({ walletId: 'B', toWalletId: 'A' }));
  });

  // فحص شامل: أي عدد محافظ، أي "آخر محفظة"، أي وجهة تحويل — اللي بيتحفظ عمره ما يبقى من = إلى
  const combos: [string[], string, string][] = [];
  for (const ws of [['A', 'B'], ['A', 'B', 'C']]) for (const last of ws) for (const dest of ws) combos.push([ws, last, dest]);
  it.each(combos)('محافظ %j، آخر محفظة %s، آخر وجهة %s ← من ≠ إلى', async (ws, last, dest) => {
    const all = { A, B, C } as Record<string, ReturnType<typeof W>>;
    seed({ wallets: ws.map(id => all[id]), transactions: [T(last, at(5)), T('A', at(4), { type: 'withdraw', toWalletId: dest })] });
    await saveTransfer();
    const s = saved();
    expect(s).toBeDefined();
    expect(s!.walletId).toBe(last);
    expect(s!.toWalletId).toBeDefined();
    expect(s!.toWalletId).not.toBe(s!.walletId);
  });

  it('كتابة المبلغ بتثبّت "إلى" كمان: البيانات اتغيّرت بعدها ← نفس الوجهة', async () => {
    seed({ transactions: [T('B', at(2)), T('A', at(1), { type: 'withdraw', toWalletId: 'C' })] });
    const r = await render(ui());
    await press(screen.getByTestId('tx_type_withdraw'));
    await type(screen.getByTestId('tx_amount_input'), '30');
    await dataChanges(r, ui, { transactions: [T('B', at(2)), T('A', at(9), { type: 'withdraw', toWalletId: 'A' })] });
    await press(screen.getByTestId('tx_save_button'));
    expect(saved()).toEqual(expect.objectContaining({ walletId: 'B', toWalletId: 'C' }));
  });
});

describe('تعديل عملية — محفظة السجل نفسه، مش الافتراضي', () => {
  const ui = () => wrap(<AddTransactionModal />);

  it('مصروف على جيم وآخر محفظة باء ← جيم', async () => {
    const e = T('C', at(1), { id: 'e1' });
    seed({ transactions: [e, T('B', at(2))] });
    mockParams = { id: 'e1' };
    await render(ui());
    expect(checked('جيم')).toBe(true);
    expect(checked('باء')).toBe(false);
  });

  it('تحويل من ألف إلى باء وآخر محفظة جيم ← ألف وباء بتوعه', async () => {
    const e = T('A', at(1), { id: 'e2', type: 'withdraw', toWalletId: 'B' });
    seed({ transactions: [e, T('C', at(3))] });
    mockParams = { id: 'e2' };
    await render(ui());
    expect(screen.getAllByRole('radio', { name: 'ألف' }).some(x => x.props.accessibilityState?.checked)).toBe(true);
    expect(screen.getAllByRole('radio', { name: 'باء' }).some(x => x.props.accessibilityState?.checked)).toBe(true);
    expect(checked('جيم')).toBe(false);
  });

  it('البيانات اتغيّرت وهو بيعدّل ← محفظة السجل لسه', async () => {
    const e = T('C', at(1), { id: 'e1' });
    seed({ transactions: [e] });
    mockParams = { id: 'e1' };
    const r = await render(ui());
    await dataChanges(r, ui, { transactions: [e, T('A', at(5))] });
    expect(checked('جيم')).toBe(true);
  });
});

/* ───────────── الديون ───────────── */

const debtOf = (over: Record<string, unknown> = {}) => ({
  id: 'd1', personName: 'أحمد', direction: 'owed_to_me', totalAmount: 1000, isInstallment: false,
  date: '2026-07-01', createdAt: '2026-07-01', payments: [], increases: [], ...over,
}) as unknown as Debt;

describe('سداد دين', () => {
  const mount = (d: Debt) => { const ui = () => wrap(<DebtPaymentModal debt={d} onClose={jest.fn()} />); return { ui, r: render(ui()) }; };

  it('الدين على باء وآخر محفظة ألف ← باء، وهي اللي بتتبعت', async () => {
    seed({ transactions: [T('A', at(2))] });
    const d = debtOf({ initialWalletId: 'B', initialTransactionId: 'x' });
    await mount(d).r;
    expect(checked('باء')).toBe(true);
    await type(screen.getByTestId('debt_payment_amount'), '100');
    await press(screen.getByTestId('debt_payment_save'));
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 100, 'B', expect.any(String), undefined);
  });

  it('محفظة الدين مؤرشفة ودفعة على جيم ← جيم', async () => {
    seed({ wallets: [A, W('B', 'باء', true), C], transactions: [T('A', at(2))] });
    await mount(debtOf({ initialWalletId: 'B', payments: [{ id: 'p', date: '2026-08-01', amount: 10, walletId: 'C' }] })).r;
    expect(checked('جيم')).toBe(true);
    expect(shown('باء')).toBe(false);
  });

  it('شرا بالأجل (من غير محفظة) ← آخر محفظة اتسجل عليها، وهي اللي بتتبعت', async () => {
    seed({ transactions: [T('A', at(1)), T('C', at(2))] });
    await mount(debtOf({ direction: 'i_owe' })).r;
    expect(checked('جيم')).toBe(true);
    await type(screen.getByTestId('debt_payment_amount'), '100');
    await press(screen.getByTestId('debt_payment_save'));
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 100, 'C', expect.any(String), undefined);
  });

  it('كتابة المبلغ وبعدين البيانات اتغيّرت ← نفس المحفظة', async () => {
    seed({ transactions: [T('A', at(1))] });
    const m = mount(debtOf({ direction: 'i_owe' }));
    const r = await m.r;
    await type(screen.getByTestId('debt_payment_amount'), '100');
    await dataChanges(r, m.ui, { transactions: [T('A', at(1)), T('B', at(5))] });
    expect(checked('ألف')).toBe(true);
    await press(screen.getByTestId('debt_payment_save'));
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 100, 'A', expect.any(String), undefined);
  });

  it('المحفظة المختارة اتأرشفت وهو فاتح ← شيبها لسه ظاهر ومختار وهي اللي بتتبعت (إصلاح الشيب الغايب)', async () => {
    seed({ transactions: [] });
    const m = mount(debtOf({ initialWalletId: 'B' }));
    const r = await m.r;
    await type(screen.getByTestId('debt_payment_amount'), '100');
    await dataChanges(r, m.ui, { wallets: [A, W('B', 'باء', true), C] });
    expect(shown('باء')).toBe(true);
    expect(checked('باء')).toBe(true);
    await press(screen.getByTestId('debt_payment_save'));
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 100, 'B', expect.any(String), undefined);
  });

  it('كل المحافظ مؤرشفة ← مفيش محفظة، والحفظ بيترفض ومفيش دفعة', async () => {
    seed({ wallets: [W('A', 'ألف', true)] });
    await mount(debtOf({ initialWalletId: 'A' })).r;
    expect(checked('ألف')).toBe(false);
    await type(screen.getByTestId('debt_payment_amount'), '100');
    await press(screen.getByTestId('debt_payment_save'));
    expect(screen.getByText('دخّل مبلغ ومحفظة صحيحين')).toBeTruthy();
    expect(mockData.addDebtPayment).not.toHaveBeenCalled();
  });
});

describe('زيادة على دين', () => {
  const mount = (d: Debt) => { const ui = () => wrap(<DebtIncreaseModal debt={d} onClose={jest.fn()} />); return { ui, r: render(ui()) }; };

  it('الدين على باء وآخر محفظة ألف ← باء، وهي اللي بتتبعت', async () => {
    seed({ transactions: [T('A', at(2))] });
    await mount(debtOf({ initialWalletId: 'B' })).r;
    expect(checked('باء')).toBe(true);
    await type(screen.getByTestId('debt_increase_amount'), '100');
    await press(screen.getByTestId('debt_increase_save'));
    expect(mockData.addDebtIncrease).toHaveBeenCalledWith('d1', 100, expect.any(String), 'B');
  });

  it('شرا بالأجل ← آخر محفظة، وكتابة المبلغ بتثبّتها لو البيانات اتغيّرت', async () => {
    seed({ transactions: [T('A', at(1))] });
    const m = mount(debtOf({ direction: 'i_owe' }));
    const r = await m.r;
    await type(screen.getByTestId('debt_increase_amount'), '100');
    await dataChanges(r, m.ui, { transactions: [T('A', at(1)), T('C', at(5))] });
    expect(checked('ألف')).toBe(true);
    await press(screen.getByTestId('debt_increase_save'));
    expect(mockData.addDebtIncrease).toHaveBeenCalledWith('d1', 100, expect.any(String), 'A');
  });

  it('المحفظة المختارة اتأرشفت وهو فاتح ← شيبها لسه ظاهر', async () => {
    seed();
    const m = mount(debtOf({ initialWalletId: 'B' }));
    const r = await m.r;
    await type(screen.getByTestId('debt_increase_amount'), '100');
    await dataChanges(r, m.ui, { wallets: [A, W('B', 'باء', true), C] });
    expect(checked('باء')).toBe(true);
  });
});

describe('دين جديد', () => {
  const ui = () => wrap(<AddDebtModal onClose={jest.fn()} />);

  it('بيبدأ على آخر محفظة اتسجل عليها، وهي اللي بتتبعت', async () => {
    seed({ transactions: [T('A', at(1)), T('C', at(2))] });
    await render(ui());
    expect(checked('جيم')).toBe(true);
    await type(screen.getByTestId('debt_add_person'), 'صاحبي');
    await type(screen.getByTestId('debt_add_amount'), '500');
    await press(screen.getByTestId('debt_add_save'));
    expect(mockData.addDebt).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'C', totalAmount: 500 }));
  });

  it('كتابة الاسم وبعدين البيانات اتغيّرت ← نفس المحفظة', async () => {
    seed({ transactions: [T('A', at(1)), T('C', at(2))] });
    const r = await render(ui());
    await type(screen.getByTestId('debt_add_person'), 'صاحبي');
    await dataChanges(r, ui, { transactions: [T('A', at(1)), T('C', at(2)), T('B', at(6))] });
    expect(checked('جيم')).toBe(true);
    await type(screen.getByTestId('debt_add_amount'), '500');
    await press(screen.getByTestId('debt_add_save'));
    expect(mockData.addDebt).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'C' }));
  });

  it('مربوط بمحفظة ← معاينة الرصيد بتسمّي المحفظة؛ بالأجل ← مفيش معاينة', async () => {
    seed({ transactions: [T('C', at(2))] });
    await render(ui());
    expect(screen.queryAllByText('جيم')).toHaveLength(1); // الشيب بس
    await type(screen.getByTestId('debt_add_amount'), '500');
    expect(screen.queryAllByText('جيم')).toHaveLength(2); // + سطر المعاينة
    expect(screen.getByText('500 ج.م')).toBeTruthy();
    await press(screen.getByText('لأ (بالأجل مثلاً)'));
    expect(screen.queryByText('500 ج.م')).toBeNull();
    expect(screen.queryAllByText('جيم')).toHaveLength(0);
  });

  it('كل المحافظ مؤرشفة ← مفيش محفظة، والحفظ بيرفض برسالة ومفيش دين', async () => {
    seed({ wallets: [W('A', 'ألف', true)] });
    await render(ui());
    await type(screen.getByTestId('debt_add_person'), 'صاحبي');
    await type(screen.getByTestId('debt_add_amount'), '500');
    await press(screen.getByTestId('debt_add_save'));
    expect(screen.getByText('اختار محفظة')).toBeTruthy();
    expect(mockData.addDebt).not.toHaveBeenCalled();
  });
});

/* ───────────── اشتراك وجمعية (المودال متركّب طول الوقت) ───────────── */

describe('إضافة اشتراك', () => {
  const ui = () => wrap(<SubscriptionsView />);
  const open = () => press(screen.getByTestId('subscription_add_button'));
  const fill = async () => {
    await type(screen.getByPlaceholderText('مثلاً: نتفليكس'), 'نتفليكس');
    await type(screen.getAllByPlaceholderText('0')[0], '150');
  };

  it('بيبدأ على آخر محفظة، وهي اللي بتتبعت', async () => {
    seed({ transactions: [T('A', at(1)), T('B', at(2))] });
    await render(ui());
    await open();
    expect(checked('باء')).toBe(true);
    await fill();
    await press(screen.getByTestId('subscription_add_save'));
    expect(mockData.addSubscription).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'B', amount: 150 }));
  });

  it('كتابة الاسم وبعدين البيانات اتغيّرت ← نفس المحفظة', async () => {
    seed({ transactions: [T('A', at(1)), T('B', at(2))] });
    const r = await render(ui());
    await open();
    await fill();
    await dataChanges(r, ui, { transactions: [T('A', at(1)), T('B', at(2)), T('C', at(7))] });
    expect(checked('باء')).toBe(true);
    await press(screen.getByTestId('subscription_add_save'));
    expect(mockData.addSubscription).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'B' }));
  });

  it('اختار باء، قفل، باء اتأرشفت، فتح تاني ← مفيش باء، والافتراضي محفظة شغّالة (إصلاح المحفظة القديمة)', async () => {
    seed({ transactions: [T('A', at(1))] });
    const r = await render(ui());
    await open();
    await press(screen.getByRole('radio', { name: 'باء' }));
    await press(screen.getByTestId('subscription_add_cancel'));
    await dataChanges(r, ui, { wallets: [A, W('B', 'باء', true), C] });
    await open();
    expect(shown('باء')).toBe(false);
    expect(checked('ألف')).toBe(true);
    await fill();
    await press(screen.getByTestId('subscription_add_save'));
    expect(mockData.addSubscription).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'A' }));
  });

  it('الفتحة اللي بعد حفظ ناجح بتبدأ من الأول (آخر محفظة اتغيّرت)', async () => {
    seed({ transactions: [T('A', at(1))] });
    const r = await render(ui());
    await open();
    await press(screen.getByRole('radio', { name: 'جيم' }));
    await fill();
    await press(screen.getByTestId('subscription_add_save'));
    await dataChanges(r, ui, { transactions: [T('A', at(1)), T('B', at(9))] });
    await open();
    expect(checked('باء')).toBe(true);
  });

  it('مقفول بزرار الرجوع من غير reset (الفتحة اللي بعده) ← برضه بيبدأ من الافتراضي', async () => {
    seed({ transactions: [T('A', at(1))] });
    const r = await render(ui());
    await open();
    await press(screen.getByRole('radio', { name: 'جيم' }));
    // onRequestClose بيقفل من غير reset
    await act(async () => { fireEvent(screen.getByText('اشتراك جديد'), 'requestClose'); });
    await dataChanges(r, ui, { wallets: [A, B, W('C', 'جيم', true)] });
    await open();
    expect(shown('جيم')).toBe(false);
    expect(checked('ألف')).toBe(true);
  });

  it('كل المحافظ مؤرشفة ← مفيش محفظة والحفظ بيترفض ومفيش اشتراك', async () => {
    seed({ wallets: [W('A', 'ألف', true)], transactions: [T('A', at(1))] });
    await render(ui());
    await open();
    expect(checked('ألف')).toBe(false);
    await fill();
    await press(screen.getByTestId('subscription_add_save'));
    expect(screen.getByText('دخّل اسم ومبلغ ومحفظة صحيحين')).toBeTruthy();
    expect(mockData.addSubscription).not.toHaveBeenCalled();
  });

  it('تعديل اشتراك ← محفظة الاشتراك نفسه مش الافتراضي', async () => {
    const sub = {
      id: 's1', name: 'نتفليكس', amount: 150, walletId: 'C', frequency: 'monthly', nextDueDate: '2099-01-01',
      reminderDaysBefore: 1, active: true, history: [], createdAt: '2026-01-01',
    };
    seed({ subscriptions: [sub], transactions: [T('B', at(2))] });
    await render(ui());
    await press(screen.getByTestId('subscription_more_s1'));
    await press(screen.getByTestId('subscription_edit_s1'));
    // الشيت بتستنى إغلاقها قبل ما تنفّذ (iOS)
    await act(async () => { await new Promise(r => setTimeout(r, IOS_DISMISS_FALLBACK_MS + 50)); });
    expect(checked('جيم')).toBe(true);
    expect(checked('باء')).toBe(false);
  });
});

describe('إضافة جمعية', () => {
  const ui = () => wrap(<GamiyaView />);
  const open = () => press(screen.getByTestId('gamiya_add_button'));
  const fill = async () => {
    await type(screen.getByPlaceholderText('مثلاً: جمعية الشغل'), 'جمعية');
    await type(screen.getAllByPlaceholderText('0')[0], '1000');
    await type(screen.getByPlaceholderText('عادة = القسط × عدد الأعضاء'), '12000');
  };

  it('بيبدأ على آخر محفظة، وهي اللي بتتبعت، ومبتتقلبش بعد أول إدخال', async () => {
    seed({ transactions: [T('A', at(1)), T('B', at(2))] });
    const r = await render(ui());
    await open();
    expect(checked('باء')).toBe(true);
    await fill();
    await dataChanges(r, ui, { transactions: [T('A', at(1)), T('B', at(2)), T('C', at(7))] });
    expect(checked('باء')).toBe(true);
    await press(screen.getByTestId('gamiya_add_save'));
    expect(mockData.addGamiya).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'B' }));
  });

  it('اختار جيم، قفل، جيم اتأرشفت، فتح تاني ← مفيش جيم والافتراضي محفظة شغّالة', async () => {
    seed({ transactions: [T('A', at(1))] });
    const r = await render(ui());
    await open();
    await press(screen.getByRole('radio', { name: 'جيم' }));
    await press(screen.getByTestId('gamiya_add_cancel'));
    await dataChanges(r, ui, { wallets: [A, B, W('C', 'جيم', true)] });
    await open();
    expect(shown('جيم')).toBe(false);
    expect(checked('ألف')).toBe(true);
    await fill();
    await press(screen.getByTestId('gamiya_add_save'));
    expect(mockData.addGamiya).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'A' }));
  });

  it('كل المحافظ مؤرشفة ← الحفظ بيترفض ومفيش جمعية', async () => {
    seed({ wallets: [W('A', 'ألف', true)] });
    await render(ui());
    await open();
    await fill();
    await press(screen.getByTestId('gamiya_add_save'));
    expect(screen.getByText('دخّل اسم ومحفظة صحيحين')).toBeTruthy();
    expect(mockData.addGamiya).not.toHaveBeenCalled();
  });

  it('تعديل جمعية ← محفظة الجمعية نفسها مش الافتراضي', async () => {
    const g = {
      id: 'g1', name: 'جمعية الشغل', monthlyAmount: 1000, totalMonths: 2, payoutMonthIndex: 2, payoutAmount: 2000,
      walletId: 'C', startDate: '2026-07-01', reminderDaysBefore: 1, createdAt: '2026-07-01',
      months: [
        { id: 'm1', monthIndex: 1, dueDate: '2099-07-01', amount: 1000, status: 'pending', isPayoutMonth: false },
        { id: 'm2', monthIndex: 2, dueDate: '2099-08-01', amount: 2000, status: 'pending', isPayoutMonth: true },
      ],
    };
    seed({ gamiyas: [g], transactions: [T('B', at(2))] });
    await render(ui());
    await press(screen.getByText('جمعية الشغل'));
    await press(screen.getByText('تعديل'));
    expect(checked('جيم')).toBe(true);
    expect(checked('باء')).toBe(false);
  });
});

/* ───────────── دخل ثابت ───────────── */

describe('دخل ثابت', () => {
  const ui = () => wrap(<IncomesView />);

  // المحفظة في الخطوة التانية (بينزل فين وامتى) — الخطوة الأولى اسم ومبلغ، فالإدخال فيها بيثبّت المحفظة قبل ما تتشاف
  const fillStep0 = async () => {
    await type(screen.getByTestId('income_name'), 'مرتب');
    await type(screen.getByTestId('income_amount'), '5000');
  };
  const next = () => press(screen.getByTestId('income_setup_next'));
  async function fillAndSave() { await fillStep0(); await next(); await next(); await next(); }

  it('إضافة: بيبدأ على آخر محفظة، وهي اللي بتتبعت', async () => {
    seed({ transactions: [T('A', at(1)), T('B', at(2))] });
    await render(ui());
    await press(screen.getByTestId('income_add_button'));
    await fillStep0();
    await next();
    expect(checked('باء')).toBe(true);
    await next(); await next();
    expect(mockData.addIncome).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'B', amount: 5000 }));
  });

  it('إضافة: كتابة الاسم وبعدين البيانات اتغيّرت ← نفس المحفظة', async () => {
    seed({ transactions: [T('A', at(1)), T('B', at(2))] });
    const r = await render(ui());
    await press(screen.getByTestId('income_add_button'));
    await fillStep0();
    await dataChanges(r, ui, { transactions: [T('A', at(1)), T('B', at(2)), T('C', at(8))] });
    await next();
    expect(checked('باء')).toBe(true);
    expect(checked('جيم')).toBe(false);
    await next(); await next();
    expect(mockData.addIncome).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'B' }));
  });

  it('إضافة وكل المحافظ مؤرشفة ← الحفظ بيترفض ومفيش دخل', async () => {
    seed({ wallets: [W('A', 'ألف', true)] });
    await render(ui());
    await press(screen.getByTestId('income_add_button'));
    await fillAndSave();
    expect(screen.getByText('اختار المحفظة اللي الفلوس بتنزل فيها.')).toBeTruthy();
    expect(mockData.addIncome).not.toHaveBeenCalled();
  });

  it('تعديل ← محفظة الدخل نفسه مش الافتراضي', async () => {
    const inc = {
      id: 'i1', name: 'مرتب', amount: 5000, walletId: 'C', frequency: 'monthly', dayOfMonth: 1, mode: 'confirm',
      status: 'active', createdAt: '2026-01-01', startDate: '2026-01-01', history: [], closed: {},
    };
    seed({ incomes: [inc], transactions: [T('B', at(2))] });
    await render(ui());
    await press(screen.getByText('تعديل'));
    await next();
    expect(checked('جيم')).toBe(true);
    expect(checked('باء')).toBe(false);
  });
});

/* ───────────── مراجعة money-reviewer + silent-failure-hunter: تثبيت الدفعة، وبنود ناقصة ───────────── */

describe('سداد دين من غير أي إدخال (المبلغ متعبّي بالمقترح)', () => {
  const instDebt = (over: Record<string, unknown> = {}) => debtOf({
    isInstallment: true, installmentCount: 4, installmentAmount: 250, totalAmount: 1000, ...over,
  });
  const chipsChecked = () => ['ألف', 'باء', 'جيم'].filter(checked);

  it('الدين على باء، وبعدين البيانات اتغيّرت وبقى الافتراضي المحسوب جيم ← الحفظ من غير إدخال بيروح باء، وهو الشيب المختار', async () => {
    seed({ transactions: [] });
    let d = instDebt({ initialWalletId: 'B' });
    const ui = () => wrap(<DebtPaymentModal debt={d} onClose={jest.fn()} />);
    const r = await render(ui());
    expect(chipsChecked()).toEqual(['باء']);
    d = instDebt({ initialWalletId: 'C' });
    await dataChanges(r, ui, { transactions: [T('A', at(9))] });
    expect(chipsChecked()).toEqual(['باء']);
    await press(screen.getByTestId('debt_payment_save'));
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 250, 'B', expect.any(String), undefined);
  });

  it('شرا بالأجل: آخر محفظة ألف وبعدين بقت جيم ← الحفظ من غير إدخال بيروح ألف', async () => {
    seed({ transactions: [T('A', at(1))] });
    const d = instDebt({ direction: 'i_owe' });
    const ui = () => wrap(<DebtPaymentModal debt={d} onClose={jest.fn()} />);
    const r = await render(ui());
    await dataChanges(r, ui, { transactions: [T('A', at(1)), T('C', at(8))] });
    expect(chipsChecked()).toEqual(['ألف']);
    await press(screen.getByTestId('debt_payment_save'));
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 250, 'A', expect.any(String), undefined);
  });

  it('أول رسمة من غير محافظ ← المحفظة بتظهر لما توصل، وبعدها بتتثبّت', async () => {
    seed({ wallets: [], transactions: [] });
    const d = instDebt({ direction: 'i_owe' });
    const ui = () => wrap(<DebtPaymentModal debt={d} onClose={jest.fn()} />);
    const r = await render(ui());
    expect(chipsChecked()).toEqual([]);
    await dataChanges(r, ui, { wallets: [A, B, C], transactions: [T('B', at(2))] });
    expect(chipsChecked()).toEqual(['باء']);
    await dataChanges(r, ui, { transactions: [T('B', at(2)), T('C', at(9))] });
    expect(chipsChecked()).toEqual(['باء']);
    await press(screen.getByTestId('debt_payment_save'));
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 250, 'B', expect.any(String), undefined);
  });

  it('المستخدم اختار محفظة وبعدين البيانات اتغيّرت ← فاضل على اختياره', async () => {
    seed({ transactions: [T('A', at(1))] });
    const d = instDebt({ direction: 'i_owe' });
    const ui = () => wrap(<DebtPaymentModal debt={d} onClose={jest.fn()} />);
    const r = await render(ui());
    await press(screen.getByRole('radio', { name: 'جيم' }));
    await dataChanges(r, ui, { transactions: [T('A', at(1)), T('B', at(8))] });
    expect(chipsChecked()).toEqual(['جيم']);
    await press(screen.getByTestId('debt_payment_save'));
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 250, 'C', expect.any(String), undefined);
  });

  it('مسار تأكيد الزيادة: البيانات بتتغيّر والتأكيد مفتوح ← بيتحفظ نفس محفظة الشيب', async () => {
    seed({ transactions: [T('A', at(1))] });
    const d = debtOf({ direction: 'i_owe' });
    const ui = () => wrap(<DebtPaymentModal debt={d} onClose={jest.fn()} />);
    const r = await render(ui());
    await type(screen.getByTestId('debt_payment_amount'), '5000'); // أكتر من المتبقي ← تأكيد
    await press(screen.getByTestId('debt_payment_save'));
    expect(mockData.addDebtPayment).not.toHaveBeenCalled();
    await dataChanges(r, ui, { transactions: [T('A', at(1)), T('C', at(8))] });
    expect(chipsChecked()).toEqual(['ألف']);
    await press(screen.getByText('أيوة، سجّل'));
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 5000, 'A', expect.any(String), undefined);
  });
});

describe('بنود ناقصة في المراجعة', () => {
  const ui = () => wrap(<AddTransactionModal />);

  it('تحويل و"إلى" متثبّتة، واختار "من" = "إلى" ← الحفظ بيترفض بنفس الرسالة ومفيش كتابة', async () => {
    seed({ transactions: [T('B', at(2)), T('A', at(1), { type: 'withdraw', toWalletId: 'C' })] });
    await render(ui());
    await press(screen.getByTestId('tx_type_withdraw'));
    await type(screen.getByTestId('tx_amount_input'), '30'); // بيثبّت "إلى" = جيم
    await press(screen.getAllByRole('radio', { name: 'جيم' })[0]); // شيب "من"
    await press(screen.getByTestId('tx_save_button'));
    expect(screen.getByText('اختار محفظة وجهة مختلفة')).toBeTruthy();
    expect(mockData.addTransaction).not.toHaveBeenCalled();
  });

  it('الافتراضي اتقلب قبل أي إدخال في إضافة عملية ← الشيب المختار هو اللي بيتحفظ', async () => {
    seed({ transactions: [T('A', at(1)), T('B', at(2))] });
    const r = await render(ui());
    expect(checked('باء')).toBe(true);
    await dataChanges(r, ui, { transactions: [T('A', at(1)), T('B', at(2)), T('C', at(3))] });
    expect(checked('جيم')).toBe(true);
    expect(checked('باء')).toBe(false);
    await press(screen.getByTestId('tx_amount_input')); // ضغط من غير كتابة مش إدخال
    await type(screen.getByTestId('tx_amount_input'), '12');
    await press(screen.getByTestId('tx_save_button'));
    expect(mockData.addTransaction).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'C' }));
  });

  // بيوثّق السلوك الحالي مش بيزكّيه: محفظة اتأرشفت والفورم مفتوح ← الشيب لسه ظاهر ومختار والحفظ بيبعتها.
  // ده بند مفتوح لوحده (متتبّع)، ولو اتقرر سلوك تاني الاختبار ده هو اللي يتغيّر
  it('[سلوك حالي موثّق — بند مفتوح منفصل] محفظة مختارة اتأرشفت والفورم مفتوح ← الشيب ظاهر ومختار والحفظ بيستقبلها', async () => {
    seed({ transactions: [T('A', at(1)), T('B', at(2))] });
    const r = await render(ui());
    await type(screen.getByTestId('tx_amount_input'), '9');
    await dataChanges(r, ui, { wallets: [A, W('B', 'باء', true), C] });
    expect(shown('باء')).toBe(true);
    expect(checked('باء')).toBe(true);
    await press(screen.getByTestId('tx_save_button'));
    expect(mockData.addTransaction).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'B' }));
  });
});

describe('سداد دين — العمليات لسه ما وصلتش وقت الفتح (ملاحظة silent-failure-hunter الجولة 2)', () => {
  const chipsChecked = () => ['ألف', 'باء', 'جيم'].filter(checked);
  const credit = () => debtOf({ direction: 'i_owe', isInstallment: true, installmentCount: 4, installmentAmount: 250 });

  it('العمليات لسه ← أول محفظة شغّالة، وبعدين تيجي قبل أي إدخال ← تتحوّل لآخر محفظة وبعدها تتثبّت', async () => {
    seed({ transactions: [], figuresPending: ['transactions'] });
    const d = credit();
    const ui = () => wrap(<DebtPaymentModal debt={d} onClose={jest.fn()} />);
    const r = await render(ui());
    expect(chipsChecked()).toEqual(['ألف']);
    await dataChanges(r, ui, { transactions: [T('C', at(3))], figuresPending: [] });
    expect(chipsChecked()).toEqual(['جيم']);
    await dataChanges(r, ui, { transactions: [T('C', at(3)), T('B', at(9))] });
    expect(chipsChecked()).toEqual(['جيم']);
    await press(screen.getByTestId('debt_payment_save'));
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 250, 'C', expect.any(String), undefined);
  });

  it('دوسة الحفظ والعمليات لسه ← بيتحفظ اللي ظاهر (مفيش إدخال غيرها)', async () => {
    seed({ transactions: [], figuresPending: ['transactions'] });
    const d = credit();
    await render(wrap(<DebtPaymentModal debt={d} onClose={jest.fn()} />));
    expect(chipsChecked()).toEqual(['ألف']);
    await press(screen.getByTestId('debt_payment_save'));
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 250, 'A', expect.any(String), undefined);
  });

  it('تأكيد زيادة عن المتبقي مفتوح والعمليات بتوصل ← الشيب ما بيتغيّرش والمحفظة المتحفظة هي هي', async () => {
    seed({ transactions: [], figuresPending: ['transactions'] });
    const d = debtOf({ direction: 'i_owe' });
    const ui = () => wrap(<DebtPaymentModal debt={d} onClose={jest.fn()} />);
    const r = await render(ui());
    await press(screen.getByTestId('debt_payment_amount')); // مش إدخال
    await type(screen.getByTestId('debt_payment_amount'), '5000');
    await press(screen.getByTestId('debt_payment_save'));
    await dataChanges(r, ui, { transactions: [T('C', at(3))], figuresPending: [] });
    expect(chipsChecked()).toEqual(['ألف']);
    await press(screen.getByText('أيوة، سجّل'));
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 5000, 'A', expect.any(String), undefined);
  });

  it('محفظة الدين نفسه بتتثبّت على طول حتى والعمليات لسه', async () => {
    seed({ transactions: [], figuresPending: ['transactions'] });
    let d = debtOf({ initialWalletId: 'B', isInstallment: true, installmentCount: 4, installmentAmount: 250 });
    const ui = () => wrap(<DebtPaymentModal debt={d} onClose={jest.fn()} />);
    const r = await render(ui());
    expect(chipsChecked()).toEqual(['باء']);
    d = debtOf({ initialWalletId: 'C', isInstallment: true, installmentCount: 4, installmentAmount: 250 });
    await dataChanges(r, ui, {});
    expect(chipsChecked()).toEqual(['باء']);
  });
});
