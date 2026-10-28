import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import GamiyaView from '@/components/GamiyaView';
import { NoticeProvider } from '@/components/NoticeProvider';
import SubscriptionsView from '@/components/SubscriptionsView';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ENTRY_MESSAGES, gamiyaEntryProblem, subscriptionEntryProblem } from '@/lib/entryValidation';

/**
 * بند 15 (2026-10-28): فورمات الاشتراك (إضافة وتعديل) والجمعية (إضافة، والتذكير في
 * التعديل). كانت بتفحص `!amt || amt <= 0` بس، فـ"1e999" كان بيتخزّن Infinity،
 * و`Number(x) || 30`/`|| 0` كانوا بيحوّلوا الغلط لقيمة افتراضية ساكت. **قرار مؤمن:**
 * الغلط بيترفض برسالة جديدة، والفورم بتفضل مفتوحة، ومفيش كتابة.
 */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const sub = {
  id: 's1', name: 'نتفليكس', amount: 200, walletId: 'w1', frequency: 'custom', customDays: 30, nextDueDate: '2099-01-01',
  reminderDaysBefore: 3, active: true, history: [], closed: {}, createdAt: 'x',
};
const gam = {
  id: 'g1', name: 'جمعية الشغل', monthlyAmount: 1000, totalMonths: 2, payoutMonthIndex: 2, payoutAmount: 2000, walletId: 'w1',
  startDate: '2099-01-01', reminderDaysBefore: 3, createdAt: 'x',
  months: [
    { id: 'm1', monthIndex: 1, dueDate: '2099-01-01', amount: 1000, status: 'pending', isPayoutMonth: false },
    { id: 'm2', monthIndex: 2, dueDate: '2099-02-01', amount: 2000, status: 'pending', isPayoutMonth: true },
  ],
};

const done = async () => ({ outcome: 'done' });
let alertSpy: jest.SpyInstance;
beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [], transactions: [],
    subscriptions: [sub], gamiyas: [gam], loadErrors: [], figuresPending: [],
    addSubscription: jest.fn(done), updateSubscription: jest.fn(done), addGamiya: jest.fn(done), updateGamiya: jest.fn(done),
    deleteSubscription: jest.fn(), deleteGamiya: jest.fn(), markSubscriptionPaid: jest.fn(), markGamiyaMonthDone: jest.fn(),
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

const wrap = (ui: React.ReactElement) => <ThemeProvider><NoticeProvider><PrivacyProvider>{ui}</PrivacyProvider></NoticeProvider></ThemeProvider>;
const type = async (el: unknown, v: string) => { await act(async () => { fireEvent.changeText(el as never, v); }); };
const press = async (el: unknown) => { await act(async () => { fireEvent.press(el as never); }); };

// المبالغ: غير المحدود، وبيبقى Infinity بعد التقريب، وسالب، وبيتقرّب لصفر
const BAD_AMOUNTS = ['1e999', '1e307', '-5', '0.004', ''];
// أرقام صحيحة: الكسر كمان مرفوض
const BAD_DAYS = ['1e999', '1e307', '-5', '0.5', ''];

describe('اشتراك جديد', () => {
  async function add(o: { amount?: string; custom?: string; reminder?: string }) {
    await render(wrap(<SubscriptionsView />));
    await press(screen.getByTestId('subscription_add_button'));
    await type(screen.getByPlaceholderText('مثلاً: نتفليكس'), 'شاهد');
    await type(screen.getByPlaceholderText('0'), o.amount ?? '150');
    if (o.custom !== undefined) {
      await press(screen.getByText('مخصص'));
      await type(screen.getByDisplayValue('30'), o.custom);
    }
    if (o.reminder !== undefined) await type(screen.getByDisplayValue('3'), o.reminder);
    await press(screen.getByTestId('subscription_add_save'));
  }
  const refused = (msg: string) => {
    expect(mockData.addSubscription).not.toHaveBeenCalled();
    expect(screen.getByText(msg)).toBeTruthy();
    expect(screen.getByTestId('subscription_add_save')).toBeTruthy(); // الفورم مفتوحة
  };
  it.each(BAD_AMOUNTS)('مبلغ "%s" ← مرفوض برسالته', async v => { await add({ amount: v }); refused(ENTRY_MESSAGES.amount); });
  it.each([...BAD_DAYS, '0'])('أيام التكرار "%s" ← مرفوض (مش 30 ساكت)', async v => { await add({ custom: v }); refused(ENTRY_MESSAGES.customDays); });
  it.each(BAD_DAYS)('أيام التذكير "%s" ← مرفوض (مش 0 ساكت)', async v => { await add({ reminder: v }); refused(ENTRY_MESSAGES.reminderDays); });
  it('قيم عادية ← بتتحفظ زي ما هي (التقريب جوه DataContext)', async () => {
    await add({ amount: '99.5', custom: '45', reminder: '0' });
    expect(mockData.addSubscription).toHaveBeenCalledWith(expect.objectContaining({
      amount: 99.5, frequency: 'custom', customDays: 45, reminderDaysBefore: 0,
    }));
  });
  it('DataContext رفض ← رسالته بتبان والفورم مفتوحة', async () => {
    (mockData.addSubscription as jest.Mock).mockResolvedValueOnce({ outcome: 'invalid', field: 'amount', message: ENTRY_MESSAGES.amount });
    await add({});
    expect(screen.getByText(ENTRY_MESSAGES.amount)).toBeTruthy();
  });
});

describe('تعديل اشتراك', () => {
  async function edit(o: { amount?: string; custom?: string; reminder?: string }) {
    await render(wrap(<SubscriptionsView />));
    await press(screen.getByText('تعديل'));
    if (o.amount !== undefined) await type(screen.getByDisplayValue('200'), o.amount);
    if (o.custom !== undefined) await type(screen.getByDisplayValue('30'), o.custom);
    if (o.reminder !== undefined) await type(screen.getByDisplayValue('3'), o.reminder);
    await press(screen.getByTestId('subscription_edit_save'));
  }
  const refused = (msg: string) => {
    expect(mockData.updateSubscription).not.toHaveBeenCalled();
    expect(screen.getByText(msg)).toBeTruthy();
    expect(screen.getByTestId('subscription_edit_save')).toBeTruthy();
  };
  it.each(BAD_AMOUNTS)('مبلغ "%s" ← مرفوض', async v => { await edit({ amount: v }); refused(ENTRY_MESSAGES.amount); });
  it.each(BAD_DAYS)('أيام التكرار "%s" ← مرفوض', async v => { await edit({ custom: v }); refused(ENTRY_MESSAGES.customDays); });
  it.each(BAD_DAYS)('أيام التذكير "%s" ← مرفوض', async v => { await edit({ reminder: v }); refused(ENTRY_MESSAGES.reminderDays); });
  it('قيم عادية ← بتتحفظ', async () => {
    await edit({ amount: '250', custom: '14', reminder: '1' });
    expect(mockData.updateSubscription).toHaveBeenCalledWith('s1', expect.objectContaining({ amount: 250, customDays: 14, reminderDaysBefore: 1 }));
  });
});

describe('جمعية جديدة', () => {
  async function add(o: { monthly?: string; total?: string; idx?: string; payout?: string; reminder?: string }) {
    await render(wrap(<GamiyaView />));
    await press(screen.getByTestId('gamiya_add_button'));
    await type(screen.getByPlaceholderText('مثلاً: جمعية الشغل'), 'جمعية');
    await type(screen.getByPlaceholderText('0'), o.monthly ?? '1000');
    // الترتيب مهم: `getByDisplayValue` بيلاقي خانتين لو القيمتين اتشابهوا
    if (o.reminder !== undefined) await type(screen.getByDisplayValue('3'), o.reminder);
    if (o.idx !== undefined) await type(screen.getByDisplayValue('1'), o.idx);
    if (o.total !== undefined) await type(screen.getByDisplayValue('12'), o.total);
    await type(screen.getByPlaceholderText('عادة = القسط × عدد الأعضاء'), o.payout ?? '12000');
    await press(screen.getByTestId('gamiya_add_save'));
  }
  const refused = (msg: string) => {
    expect(mockData.addGamiya).not.toHaveBeenCalled();
    expect(screen.getByText(msg)).toBeTruthy();
    expect(screen.getByTestId('gamiya_add_save')).toBeTruthy();
  };
  it.each(BAD_AMOUNTS)('قسط "%s" ← مرفوض', async v => { await add({ monthly: v }); refused(ENTRY_MESSAGES.monthlyAmount); });
  it.each(BAD_AMOUNTS)('مبلغ استلام "%s" ← مرفوض', async v => { await add({ payout: v }); refused(ENTRY_MESSAGES.payoutAmount); });
  it.each([...BAD_DAYS, '0', '61'])('عدد شهور "%s" ← مرفوض (1..60)', async v => { await add({ total: v }); refused(ENTRY_MESSAGES.totalMonths); });
  it.each(['1.5', '0', '13'])('شهر استلام "%s" ← مرفوض بالرسالة القديمة', async v => { await add({ idx: v }); refused(ENTRY_MESSAGES.payoutMonth); });
  it.each(BAD_DAYS)('أيام التذكير "%s" ← مرفوض', async v => { await add({ reminder: v }); refused(ENTRY_MESSAGES.reminderDays); });
  it.each(['1', '60'])('حدود الشهور "%s" ← مقبولة', async v => {
    await add({ total: v, idx: '1' });
    expect(mockData.addGamiya).toHaveBeenCalledWith(expect.objectContaining({ totalMonths: Number(v) }));
  });
  it('بيانات عادية ← بتتحفظ', async () => {
    await add({ monthly: '1000.5', total: '10', idx: '3', payout: '10000', reminder: '0' });
    expect(mockData.addGamiya).toHaveBeenCalledWith(expect.objectContaining({
      monthlyAmount: 1000.5, totalMonths: 10, payoutMonthIndex: 3, payoutAmount: 10000, reminderDaysBefore: 0,
    }));
  });
});

describe('تعديل جمعية — التذكير بس', () => {
  async function edit(reminder: string) {
    await render(wrap(<GamiyaView />));
    await press(screen.getByText('جمعية الشغل'));
    await press(screen.getByText('تعديل'));
    await type(screen.getByDisplayValue('3'), reminder);
    await press(screen.getByTestId('gamiya_edit_save'));
  }
  it.each(BAD_DAYS)('"%s" ← مرفوض (مش 0 ساكت)', async v => {
    await edit(v);
    expect(mockData.updateGamiya).not.toHaveBeenCalled();
    expect(screen.getByText(ENTRY_MESSAGES.reminderDays)).toBeTruthy();
  });
  it('"5" ← بيتحفظ', async () => {
    await edit('5');
    expect(mockData.updateGamiya).toHaveBeenCalledWith('g1', expect.objectContaining({ reminderDaysBefore: 5 }));
  });
});

describe('الدوال نفسها (المصدر الواحد للشاشة وDataContext)', () => {
  it('اشتراك', () => {
    expect(subscriptionEntryProblem({ amount: Infinity })?.field).toBe('amount');
    expect(subscriptionEntryProblem({ amount: 1e307 })?.field).toBe('amount');
    expect(subscriptionEntryProblem({ frequency: 'custom', customDays: 0.5 })?.field).toBe('customDays');
    expect(subscriptionEntryProblem({ frequency: 'monthly', customDays: undefined })).toBeNull();
    expect(subscriptionEntryProblem({ reminderDaysBefore: -1 })?.field).toBe('reminderDays');
    expect(subscriptionEntryProblem({ name: 'x' } as never)).toBeNull();
  });
  it('جمعية', () => {
    const ok = { monthlyAmount: 1000, totalMonths: 60, payoutMonthIndex: 60, payoutAmount: 60000, reminderDaysBefore: 0 };
    expect(gamiyaEntryProblem(ok)).toBeNull();
    expect(gamiyaEntryProblem({ ...ok, totalMonths: 61 })?.field).toBe('totalMonths');
    expect(gamiyaEntryProblem({ ...ok, totalMonths: Infinity })?.field).toBe('totalMonths');
    expect(gamiyaEntryProblem({ ...ok, payoutAmount: 1e307 })?.field).toBe('payoutAmount');
  });
});

describe('parseEntryNumber', () => {
  it('عشري بس — "0x10" و"0b11" مش أرقام هنا', () => {
    const { parseEntryNumber } = jest.requireActual('@/lib/entryValidation');
    expect(parseEntryNumber('0x10')).toBeNaN();
    expect(parseEntryNumber('0b11')).toBeNaN();
    expect(parseEntryNumber('')).toBeNaN();
    expect(parseEntryNumber(' 99.5 ')).toBe(99.5);
    expect(parseEntryNumber('.5')).toBe(0.5);
    expect(parseEntryNumber('1e999')).toBe(Infinity);
  });
});

describe('تعديل قديم: التذكير مش متخزّن', () => {
  it('الخانة بتبدأ 0 مش "undefined" ← الحفظ بيمشي', async () => {
    mockData.subscriptions = [{ ...sub, reminderDaysBefore: undefined }];
    await render(wrap(<SubscriptionsView />));
    await press(screen.getByText('تعديل'));
    await press(screen.getByTestId('subscription_edit_save'));
    expect(mockData.updateSubscription).toHaveBeenCalledWith('s1', expect.objectContaining({ reminderDaysBefore: 0 }));
  });
});
