import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import DebtsTabScreen from '@/app/(tabs)/debts';
import GamiyaView from '@/components/GamiyaView';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import type { Debt, Gamiya } from '@/context/DataContext';
import { isDebtSettled, isGamiyaFinished, splitDone } from '@/lib/doneSections';

/**
 * أقسام "خلص" المطوية (قرار مؤمن 2026-11-02): ديون اتسددت وجمعيات خلصت. محسوبة وقت
 * العرض، مطوية افتراضيًا، والعنوان فيه العدد. الإجماليات مبتتغيّرش.
 */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/components/useDeviceContacts', () => ({ useDeviceContacts: () => ({}) }));

const W = { id: 'w1', name: 'الكاش', openingBalance: 0, lowAlert: 0 };
const debt = (id: string, personName: string, direction: 'owed_to_me' | 'i_owe', total: number, paid: number, increases: number[] = []) => ({
  id, personName, direction, totalAmount: total, isInstallment: false, date: '2026-07-01', createdAt: '2026-07-01',
  payments: paid ? [{ id: `p_${id}`, date: '2026-08-01', amount: paid, walletId: W.id, transactionId: `tp_${id}` }] : [],
  increases: increases.map((amount, i) => ({ id: `i_${id}_${i}`, date: '2026-07-15', amount })),
}) as unknown as Debt;
const month = (i: number, status: 'done' | 'pending') => ({
  id: `m${i}`, monthIndex: i, dueDate: `2026-0${i}-01`, amount: 1000, status, isPayoutMonth: false,
});
const gamiya = (id: string, name: string, statuses: ('done' | 'pending')[]) => ({
  id, name, monthlyAmount: 1000, totalMonths: statuses.length, payoutMonthIndex: statuses.length, payoutAmount: 1000 * statuses.length,
  walletId: W.id, startDate: '2026-01-01', createdAt: '2026-01-01', months: statuses.map((s, i) => month(i + 1, s)),
}) as unknown as Gamiya;

describe('الحساب', () => {
  it('isDebtSettled = "اتسدد بالكامل" (الباقي ≤ نص قرش)، والزيادة بترجّعه', () => {
    expect(isDebtSettled(debt('a', 'أ', 'owed_to_me', 1000, 1000))).toBe(true);
    expect(isDebtSettled(debt('a', 'أ', 'owed_to_me', 1000, 1200))).toBe(true);
    expect(isDebtSettled(debt('a', 'أ', 'owed_to_me', 1000, 999.99))).toBe(false);
    expect(isDebtSettled(debt('a', 'أ', 'owed_to_me', 1000, 1000, [100]))).toBe(false);
  });

  it('isGamiyaFinished: كل الشهور done بس؛ من غير شهور ← مش خلصت', () => {
    expect(isGamiyaFinished(gamiya('g', 'ج', ['done', 'done']))).toBe(true);
    expect(isGamiyaFinished(gamiya('g', 'ج', ['done', 'pending']))).toBe(false);
    expect(isGamiyaFinished(gamiya('g', 'ج', []))).toBe(false);
    expect(isGamiyaFinished({ ...gamiya('g', 'ج', []), months: undefined } as unknown as Gamiya)).toBe(false);
  });

  it('splitDone بيحافظ على الترتيب', () => {
    expect(splitDone([1, 2, 3, 4, 5], n => n % 2 === 0)).toEqual({ active: [1, 3, 5], done: [2, 4] });
  });
});

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [W], categories: [], loadErrors: [], figuresPending: [], transactions: [], subscriptions: [], gamiyas: [],
    pendingTxIds: new Set<string>(),
    deleteDebt: jest.fn(), deleteDebtPayment: jest.fn(), deleteDebtIncrease: jest.fn(), deleteGamiya: jest.fn(),
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

const wrap = (node: React.ReactNode) => <ThemeProvider><NoticeProvider><PrivacyProvider>{node}</PrivacyProvider></NoticeProvider></ThemeProvider>;

describe('شاشة الديون — "اتسددت" مطوي', () => {
  beforeEach(() => {
    mockData.debts = [
      debt('d1', 'أحمد', 'owed_to_me', 1000, 400),
      debt('d2', 'منى', 'owed_to_me', 500, 500),
      debt('d3', 'كريم', 'owed_to_me', 300, 300),
      debt('d4', 'سارة', 'i_owe', 200, 200),
    ];
  });

  it('المتسدد مطوي افتراضيًا والعنوان فيه العدد لكل اتجاه، والنشط باين', async () => {
    await render(wrap(<DebtsTabScreen />));
    expect(screen.getByText('أحمد')).toBeTruthy();
    expect(screen.queryByText('منى')).toBeNull();
    expect(screen.queryByText('سارة')).toBeNull();
    expect(screen.getByTestId('debts_settled_owed_toggle').props.accessibilityState).toEqual({ expanded: false });
    expect(screen.getByText('ديون اتسددت (2)')).toBeTruthy();
    expect(screen.getByText('ديون اتسددت (1)')).toBeTruthy();
    // قارئ الشاشة بيفرّق بين القسمين
    expect(screen.getByTestId('debts_settled_owed_toggle').props.accessibilityLabel).toBe('ديون اتسددت من فلوس ليا، دينين');
    expect(screen.getByTestId('debts_settled_iowe_toggle').props.accessibilityLabel).toBe('ديون اتسددت من فلوس عليا، دين واحد');
  });

  it('الدوس بيفتح القسم وبيبيّن الكروت بنفس الكارت ("اتسدد بالكامل")', async () => {
    await render(wrap(<DebtsTabScreen />));
    await act(async () => { fireEvent.press(screen.getByTestId('debts_settled_owed_toggle')); });
    expect(screen.getByText('منى')).toBeTruthy();
    expect(screen.getByText('كريم')).toBeTruthy();
    expect(screen.getAllByText('اتسدد بالكامل')).toHaveLength(2);
    expect(screen.getByTestId('debts_settled_owed_toggle').props.accessibilityState).toEqual({ expanded: true });
    // الاتجاه التاني لسه مطوي
    expect(screen.queryByText('سارة')).toBeNull();
  });

  it('كل الديون في اتجاه اتسددت ← رسالة "مفيش" فوق القسم المطوي (مش شاشة فاضية)', async () => {
    await render(wrap(<DebtsTabScreen />));
    expect(screen.getByText('مفيش عليك ديون دلوقتي')).toBeTruthy();
    expect(screen.getByTestId('debts_settled_iowe')).toBeTruthy();
  });

  it('مفيش متسدد ← مفيش قسم خالص', async () => {
    mockData.debts = [debt('d1', 'أحمد', 'owed_to_me', 1000, 400)];
    await render(wrap(<DebtsTabScreen />));
    expect(screen.queryByTestId('debts_settled_owed')).toBeNull();
    expect(screen.queryByTestId('debts_settled_iowe')).toBeNull();
  });

  it('دفعة السداد لسه بترفع ← الدين يفضل في النشط (لو اترفضت ميبقاش مطوي ومتسدد)', async () => {
    mockData.pendingTxIds = new Set(['tp_d2']);
    await render(wrap(<DebtsTabScreen />));
    expect(screen.getByText('منى')).toBeTruthy();
    // كريم بس اللي في المطوي من ناحية ليا
    expect(screen.getByTestId('debts_settled_owed_toggle').props.accessibilityLabel).toBe('ديون اتسددت من فلوس ليا، دين واحد');
  });

  it('زيادة على دين متسدد (من جهاز تاني) ← بيرجع للنشط لوحده', async () => {
    const r = await render(wrap(<DebtsTabScreen />));
    mockData.debts = [debt('d2', 'منى', 'owed_to_me', 500, 500, [100])];
    await act(async () => { r.rerender(wrap(<DebtsTabScreen />)); });
    expect(screen.getByText('منى')).toBeTruthy();
    expect(screen.queryByTestId('debts_settled_owed')).toBeNull();
  });
});

describe('الجمعية — "جمعيات خلصت" مطوي', () => {
  beforeEach(() => {
    mockData.gamiyas = [gamiya('g1', 'جمعية الشغل', ['done', 'pending']), gamiya('g2', 'جمعية العيلة', ['done', 'done'])];
  });

  it('اللي خلصت مطوية والعنوان فيه العدد، والشغالة باينة', async () => {
    await render(wrap(<GamiyaView />));
    expect(screen.getByText('جمعية الشغل')).toBeTruthy();
    expect(screen.queryByText('جمعية العيلة')).toBeNull();
    expect(screen.getByText('جمعيات خلصت (1)')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('gamiyas_finished_toggle')); });
    expect(screen.getByText('جمعية العيلة')).toBeTruthy();
  });

  it('كل الجمعيات خلصت ← مفيش "مفيش جمعية مسجلة" (مسجلة فعلاً) والقسم موجود', async () => {
    mockData.gamiyas = [gamiya('g2', 'جمعية العيلة', ['done', 'done'])];
    await render(wrap(<GamiyaView />));
    expect(screen.queryByText('مفيش جمعية مسجلة')).toBeNull();
    expect(screen.getByTestId('gamiyas_finished')).toBeTruthy();
  });
});

describe('الدفعة اللي بتسدد الدين بتقول الكارت راح فين', () => {
  const { DebtPaymentModal, DEBT_SETTLED_TITLE, DEBT_SETTLED_BODY } = jest.requireActual('@/components/DebtEntryModals');
  beforeEach(() => {
    mockData.addDebtPayment = jest.fn(async () => ({ outcome: 'done', note: null }));
  });
  async function pay(d: Debt, amount: string) {
    await render(wrap(<DebtPaymentModal debt={d} onClose={jest.fn()} />));
    await act(async () => { fireEvent.changeText(screen.getByTestId('debt_payment_amount'), amount); });
    await act(async () => { fireEvent.press(screen.getByTestId('debt_payment_save')); });
  }

  it('السيرفر بيقول الدفعة دي سددت (settledNow) ← "الدين اتسدد بالكامل" ومكانه', async () => {
    mockData.addDebtPayment = jest.fn(async () => ({ outcome: 'done', note: null, settledNow: true }));
    await pay(debt('d1', 'أحمد', 'owed_to_me', 1000, 400), '600');
    expect(screen.getByTestId('notice_title').props.children).toBe(DEBT_SETTLED_TITLE);
    expect(screen.getByTestId('notice_body').props.children).toBe(DEBT_SETTLED_BODY);
  });

  it('الشاشة شايفاها بتسدد بس السيرفر لأ (الدين اتغيّر من جهاز تاني) ← مفيش رسالة سداد', async () => {
    await pay(debt('d1', 'أحمد', 'owed_to_me', 1000, 400), '600');
    expect(screen.queryByTestId('notice_title')).toBeNull();
  });

  it('دفعة جزئية ← مفيش رسالة سداد', async () => {
    await pay(debt('d1', 'أحمد', 'owed_to_me', 1000, 400), '100');
    expect(screen.queryByTestId('notice_title')).toBeNull();
  });
});

describe('جمعيات خلصت — ليبل قارئ الشاشة', () => {
  it('العدد بالمعدود', async () => {
    mockData.gamiyas = [gamiya('g2', 'جمعية العيلة', ['done', 'done'])];
    await render(wrap(<GamiyaView />));
    expect(screen.getByTestId('gamiyas_finished_toggle').props.accessibilityLabel).toBe('جمعيات خلصت، جمعية واحدة');
  });
});

describe('isDebtSettled بسماحية نص قرش (fix/settled-epsilon)', () => {
  const pays = (amounts: number[]) => amounts.map((amount, i) => ({ id: `p${i}`, date: '2026-08-01', amount }));
  it('دين متسدد بالقرش والمجموع العشري ساب ~1e-13 ← متسدد (قبل كده كان 0.00 ومش متسدد)', () => {
    const amounts = [205.7, 420.39, 4.17, 245.11]; // مجموعهم بالقرش 875.37
    const d = { ...debt('a', 'أ', 'owed_to_me', 875.37, 0), payments: pays(amounts) } as unknown as Debt;
    expect(875.37 - amounts.reduce((x, y) => x + y, 0)).toBeGreaterThan(0); // المشكلة نفسها موجودة
    expect(isDebtSettled(d)).toBe(true);
  });
  it('الحد: باقي 0.003 أو 0.005 ← متسدد؛ 0.006 أو قرش ← لأ؛ دفع زيادة ← متسدد', () => {
    // داتا قديمة قبل تقريب القرش (2026-09-30) ممكن يبقى فيها باقي أقل من قرش
    expect(isDebtSettled(debt('a', 'أ', 'owed_to_me', 100.003, 100))).toBe(true);
    expect(isDebtSettled(debt('a', 'أ', 'owed_to_me', 100.005, 100))).toBe(true);
    expect(isDebtSettled(debt('a', 'أ', 'owed_to_me', 100.006, 100))).toBe(false);
    expect(isDebtSettled(debt('a', 'أ', 'owed_to_me', 1000, 999.99))).toBe(false);
    expect(isDebtSettled(debt('a', 'أ', 'owed_to_me', 1000, 1000.5))).toBe(true);
  });

  it('الكارت والتذكير والدفع متفقين على نفس الدين (باقي 0.004 قديم)', () => {
    const { overpayCheck, debtRemaining } = jest.requireActual('@/lib/finance');
    const d = debt('a', 'أ', 'owed_to_me', 100.004, 100);
    expect(isDebtSettled(d)).toBe(true);
    expect(overpayCheck(0.01, debtRemaining(d))).toBe('settled');
  });
});

describe('عتبة "اتسدد" في باقي الأماكن (fix/settled-epsilon، جولة 2)', () => {
  const fin = jest.requireActual('@/lib/finance');
  it('overpayCheck: نص قرش ← settled، أكتر ← مش settled، و"exceeds" لسه بالقرش', () => {
    expect(fin.overpayCheck(0.01, 0.004)).toBe('settled');
    expect(fin.overpayCheck(0.01, 0.006)).toBe('exceeds');
    expect(fin.overpayCheck(550.01, 550)).toBe('exceeds');
    expect(fin.overpayCheck(550, 550)).toBe('none');
  });
  it('lastInstalmentOf: باقي كسور (~1e-13) ← مفيش قسط أخير تافه', () => {
    const amounts = [205.7, 420.39, 4.17, 245.11];
    const d = { ...debt('a', 'أ', 'i_owe', 875.37, 0), isInstallment: true, installmentAmount: 100, installmentCount: 9,
      payments: amounts.map((amount, i) => ({ id: `p${i}`, date: '2026-08-01', amount })) } as unknown as Debt;
    expect(fin.lastInstalmentOf(d)).toBeNull();
  });
});

describe('تاب الديون: دين باقيه أقل من نص قرش', () => {
  it('دين باقيه 0.004 (قديم) بيتطوي متسدد، والنشط باين (فرق الإجمالي أقل من قرش فمش بيتقاس هنا)', async () => {
    mockData.debts = [debt('d1', 'أحمد', 'owed_to_me', 1000, 400), debt('d2', 'منى', 'owed_to_me', 100.004, 100)];
    await render(wrap(<DebtsTabScreen />));
    expect(screen.queryByText('منى')).toBeNull();
    expect(screen.getByText('ديون اتسددت (1)')).toBeTruthy();
  });
});
