import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ChargeHomeCards from '@/components/ChargeHomeCards';
import { ThemeProvider } from '@/context/ThemeContext';
import { addMonths, todayStr } from '@/lib/finance';
import { CHARGE_UNCERTAIN_RETRY_MAX, useChargeAutoRecord } from '@/lib/useChargeAutoRecord';
import { INCOME_RETRY_MS } from '@/lib/useIncomeAutoRecord';

/**
 * الخصم التلقائي من جهة الواجهة: التلقائي بيسجل كل اللي فات في **رسالة
 * واحدة** وإشعار واحد، و"بتأكيد" بيطلع كارت "اتخصم؟" ومبيتسجلش لوحده،
 * والفشل بيبان مش بيتبلع. (الحماية من الخصم مرتين في اختبارات المحاكي.)
 */

const mockData: any = {};
const mockNotify = jest.fn(async () => {});
let mockHidden = false;

jest.mock('@/context/DataContext', () => ({
  ...jest.requireActual('@/context/DataContext'),
  useData: () => mockData,
}));
jest.mock('@/context/NotificationsContext', () => ({ useNotifications: () => ({ enabled: true }) }));
jest.mock('@/context/PrivacyContext', () => ({
  usePrivacy: () => ({ amountsHidden: mockHidden, hidePreference: mockHidden, loaded: true, money: (n: number) => String(n) }),
}));
jest.mock('@/lib/notifications', () => ({ notifyNow: (...a: unknown[]) => (mockNotify as any)(...a) }));

const today = todayStr();
const start = addMonths(today, -1);

const sub = (over: Record<string, unknown> = {}) => ({
  id: 's1', name: 'نتفليكس', amount: 200, walletId: 'w', frequency: 'monthly', nextDueDate: start,
  reminderDaysBefore: 3, active: true, createdAt: '', history: [], ...over,
});
const gamiya = (over: Record<string, unknown> = {}) => ({
  id: 'g1', name: 'العيلة', monthlyAmount: 1000, totalMonths: 2, payoutMonthIndex: 2, payoutAmount: 2000,
  walletId: 'w', startDate: today, reminderDaysBefore: 3, createdAt: '',
  months: [
    { id: 'm1', monthIndex: 1, dueDate: today, isPayoutMonth: false, amount: 1000, status: 'pending' },
    { id: 'm2', monthIndex: 2, dueDate: addMonths(today, 1), isPayoutMonth: true, amount: 2000, status: 'pending' },
  ],
  ...over,
});

function Probe() {
  const { notices } = useChargeAutoRecord();
  return <>{notices.map(n => <Text key={n.id} testID={`notice_${n.kind}`}>{n.text}</Text>)}</>;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockNotify.mockClear();
  mockHidden = false;
  Object.assign(mockData, {
    subscriptions: [sub({ chargeMode: 'auto', chargeAutoSince: start })],
    gamiyas: [gamiya({ chargeMode: 'auto', chargeAutoSince: start })],
    wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }],
    serverReachable: true,
    recordCharges: jest.fn(async (_k: string, _id: string, entries: { key: string }[]) => ({
      outcome: 'done', recorded: entries.map(e => e.key),
    })),
    skipSubscriptionCharge: jest.fn(async () => 'done'),
  });
});

describe('التلقائي', () => {
  it('اشتراك فاته شهرين + قسط جمعية ← رسالة واحدة وإشعار واحد', async () => {
    await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('notice_recorded')).toBeTruthy());
    expect(screen.getAllByTestId('notice_recorded')).toHaveLength(1);
    expect(mockData.recordCharges).toHaveBeenCalledTimes(2);
    expect(mockData.recordCharges.mock.calls.every((c: unknown[]) => (c[3] as { auto: boolean }).auto)).toBe(true);
    const text = screen.getByTestId('notice_recorded').props.children;
    expect(text).toMatch(/^سجلنا لوحدنا: اشتراك "نتفليكس" \(.+ و.+\) وقسط جمعية "العيلة" \(شهر 1\)$/);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect((mockNotify.mock.calls[0] as unknown as string[])[1]).toContain('1,400');
  });

  it('المبالغ مخفية ← الإشعار من غير رقم', async () => {
    mockHidden = true;
    await render(<Probe />);
    await waitFor(() => expect(mockNotify).toHaveBeenCalled());
    const body = (mockNotify.mock.calls[0] as unknown as string[])[1];
    expect(body.replace(/\d+ [^\s)]+|شهر \d+/g, '')).not.toMatch(/[0-9٠-٩]|ج\.م/);
  });

  it('"بتأكيد" ← مفيش ولا نداء تلقائي', async () => {
    mockData.subscriptions = [sub()];
    mockData.gamiyas = [gamiya()];
    await render(<Probe />);
    await new Promise(r => setTimeout(r, 50));
    expect(mockData.recordCharges).not.toHaveBeenCalled();
  });

  it('المحفظة اتأرشفت ← رسالة في الرئيسية **وإشعار** (التلقائي معناه إنه مش هيفتح يتأكد)', async () => {
    mockData.gamiyas = [];
    mockData.recordCharges = jest.fn(async () => ({ outcome: 'wallet-missing', recorded: [] }));
    await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('notice_error')).toBeTruthy());
    expect(screen.getByTestId('notice_error').props.children).toContain('مفيش أي خصم اتسجل');
    expect(screen.getByTestId('notice_error').props.children).toContain('الالتزامات ← الاشتراكات');
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect((mockNotify.mock.calls[0] as unknown as string[])[0]).toBe('ما سجلناش اشتراك "نتفليكس"');
  });
});

describe('كارت "اتخصم؟"', () => {
  const mount = () => render(<ThemeProvider><ChargeHomeCards /></ThemeProvider>);

  it('اشتراك "بتأكيد" معاده فات ← كارت بالأقدم، و"اتخصم" بيسجل الفترة دي بالمبلغ المعتاد', async () => {
    mockData.subscriptions = [sub()];
    mockData.gamiyas = [];
    await mount();
    expect(screen.getByTestId('charge_card_s1')).toBeTruthy();
    fireEvent.press(screen.getByTestId('charge_card_yes_s1'));
    await waitFor(() => expect(mockData.recordCharges).toHaveBeenCalledWith('subscription', 's1', [{ key: start, amount: 200 }]));
  });

  it('اتسجلت قبلنا (جهاز تاني) ← بيتقال، مش "اتسجل" وخلاص', async () => {
    const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    mockData.subscriptions = [sub()];
    mockData.gamiyas = [];
    mockData.recordCharges = jest.fn(async () => ({ outcome: 'done', recorded: [] }));
    await mount();
    fireEvent.press(screen.getByTestId('charge_card_yes_s1'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('اتسجلت قبل كده', expect.stringContaining('ما سجلناش تاني')));
    alert.mockRestore();
  });

  it('قسط الجمعية "لسه" ← الكارت بيستخبّى من غير أي كتابة', async () => {
    mockData.subscriptions = [];
    mockData.gamiyas = [gamiya()];
    await mount();
    fireEvent.press(screen.getByText('لسه'));
    await waitFor(() => expect(screen.queryByTestId('charge_card_g1')).toBeNull());
    expect(mockData.recordCharges).not.toHaveBeenCalled();
  });
});

/**
 * مراجعة الاشتراكات (2026-11-17): نتايج `recordCharges` الجديدة بتتقال زي ما هي — `uncertain` ممنوع يقول
 * "ومفيش أي خصم اتسجل"، و`missing` مبيقولش حاجة في التلقائي، و`recorded=[]` بيقول السبب الحقيقي في الكارت.
 */
describe('نتايج صريحة (مراجعة 2026-11-17)', () => {
  const mount = () => render(<ThemeProvider><ChargeHomeCards /></ThemeProvider>);

  it('التلقائي uncertain ← رسالة "مش متأكدين" وإشعار صادق، مش "مفيش أي خصم اتسجل"', async () => {
    mockData.gamiyas = [];
    mockData.recordCharges = jest.fn(async () => ({ outcome: 'uncertain', recorded: [] }));
    await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('notice_error')).toBeTruthy());
    const text = screen.getByTestId('notice_error').props.children as string;
    expect(text).toContain('مش متأكدين سجلنا اشتراك "نتفليكس"');
    expect(text).not.toContain('مفيش أي خصم اتسجل');
    expect(mockNotify).toHaveBeenCalledTimes(1);
    const [title, body] = mockNotify.mock.calls[0] as unknown as string[];
    expect(title).toBe('مش متأكدين سجلنا اشتراك "نتفليكس" ولا لأ');
    expect(body).not.toContain('مفيش أي خصم اتسجل');
  });

  it('التلقائي missing (اتمسح) ← ولا رسالة ولا إشعار', async () => {
    mockData.gamiyas = [];
    mockData.recordCharges = jest.fn(async () => ({ outcome: 'missing', recorded: [] }));
    await render(<Probe />);
    await waitFor(() => expect(mockData.recordCharges).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByTestId('notice_error')).toBeNull();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('التلقائي رمى (باگ) ← مبيتبلعش: Sentry، والرسايل اللي قبله بتتعرض', async () => {
    const atomic = jest.spyOn(require('@/lib/atomicFailure'), 'reportAtomicFailure').mockImplementation(() => {});
    mockData.recordCharges = jest.fn(async (kind: string, _id: string, entries: { key: string }[]) => {
      if (kind === 'gamiya') throw new Error('boom');
      return { outcome: 'done', recorded: entries.map(e => e.key) };
    });
    await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('notice_recorded')).toBeTruthy());
    expect(atomic).toHaveBeenCalledWith('الخصم التلقائي', expect.any(Error));
    atomic.mockRestore();
  });

  const cardCase = (result: Record<string, unknown>, title: string) => async () => {
    const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    mockData.subscriptions = [sub()];
    mockData.gamiyas = [];
    mockData.recordCharges = jest.fn(async () => result);
    await mount();
    fireEvent.press(screen.getByTestId('charge_card_yes_s1'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(title, expect.any(String)));
    expect(alert).not.toHaveBeenCalledWith('اتسجلت قبل كده', expect.anything());
    alert.mockRestore();
  };
  it('الكارت uncertain ← "مش متأكدين"', cardCase({ outcome: 'uncertain', recorded: [] }, 'مش متأكدين اتسجل ولا لأ'));
  it('الكارت missing ← "الاشتراك ده اتمسح"', cardCase({ outcome: 'missing', recorded: [] }, 'الاشتراك ده اتمسح'));
  it('الكارت على فترة اتفوّتت ← مش "اتسجلت قبل كده"', cardCase({ outcome: 'done', recorded: [], skipped: true }, 'اتقفلت على إنها ما اتخصمتش'));
  it('الكارت والفترة اتغيّرت ← "الفترة اتغيّرت"', cardCase({ outcome: 'done', recorded: [], changed: true }, 'الفترة اتغيّرت'));

  const skipCase = (outcome: string, title: string) => async () => {
    const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation((...args: unknown[]) => {
      // التأكيد نفسه: دوس "ما اتخصمش"
      const buttons = args[2] as { text: string; onPress?: () => void }[] | undefined;
      buttons?.find(b => b.text === 'ما اتخصمش')?.onPress?.();
    });
    mockData.subscriptions = [sub()];
    mockData.gamiyas = [];
    mockData.skipSubscriptionCharge = jest.fn(async () => outcome);
    await mount();
    fireEvent.press(screen.getByLabelText('"نتفليكس" ما اتخصمش'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(title, expect.any(String)));
    alert.mockRestore();
  };
  it('"ما اتخصمش" على فترة اتسجلت ← "اتسجل عليها خصم خلاص"', skipCase('already-recorded', 'اتسجل عليها خصم خلاص'));
  it('"ما اتخصمش" على اشتراك اتوقف ← "الاشتراك ده اتوقف"', skipCase('stopped', 'الاشتراك ده اتوقف'));
  it('"ما اتخصمش" على اشتراك اتمسح ← "الاشتراك ده اتمسح"', skipCase('missing', 'الاشتراك ده اتمسح'));
});

describe('مبلغ متخزّن بايظ', () => {
  it('الكارت badAmount ← "المبلغ مش مقروء" مش "اتسجلت قبل كده"', async () => {
    const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    mockData.subscriptions = [sub()];
    mockData.gamiyas = [];
    mockData.recordCharges = jest.fn(async () => ({ outcome: 'done', recorded: [], badAmount: true }));
    await render(<ThemeProvider><ChargeHomeCards /></ThemeProvider>);
    fireEvent.press(screen.getByTestId('charge_card_yes_s1'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('المبلغ مش مقروء', expect.any(String)));
    alert.mockRestore();
  });
});

/** الجولة 2 (silent-failure-hunter على f1cc057) */
describe('التلقائي uncertain: الإعادة ليها سقف، والرسالة بتمشي لما الفترة تتحسم', () => {
  beforeEach(() => { mockData.gamiyas = []; });

  it('المحاولات بتقف عند CHARGE_UNCERTAIN_RETRY_MAX في الجلسة', async () => {
    jest.useFakeTimers();
    try {
      mockData.recordCharges = jest.fn(async () => ({ outcome: 'uncertain', recorded: [] }));
      await render(<Probe />);
      await waitFor(() => expect(mockData.recordCharges).toHaveBeenCalledTimes(1));
      for (let i = 0; i < CHARGE_UNCERTAIN_RETRY_MAX + 4; i++) {
        await act(async () => { jest.advanceTimersByTime(INCOME_RETRY_MS + 10); });
      }
      expect(mockData.recordCharges).toHaveBeenCalledTimes(CHARGE_UNCERTAIN_RETRY_MAX);
      // الرسالة لسه باينة — الإعادة بس اللي وقفت
      expect(screen.getByTestId('notice_error')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('الفترات اتقفلت على عملياتها بعد كده ← "مش متأكدين" بتختفي', async () => {
    mockData.recordCharges = jest.fn(async () => ({ outcome: 'uncertain', recorded: [] }));
    const view = await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('notice_error')).toBeTruthy());
    mockData.subscriptions = [sub({
      chargeMode: 'auto', chargeAutoSince: start, nextDueDate: addMonths(today, 1),
      closed: { [start]: { txId: `sub_s1_${start}`, at: 'x' }, [today]: { txId: `sub_s1_${today}`, at: 'x' } },
    })];
    await view.rerender(<Probe />);
    await waitFor(() => expect(screen.queryByTestId('notice_error')).toBeNull());
  });

  it('فترة واحدة بس اتقفلت ← الرسالة لسه باينة', async () => {
    mockData.recordCharges = jest.fn(async () => ({ outcome: 'uncertain', recorded: [] }));
    const view = await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('notice_error')).toBeTruthy());
    mockData.subscriptions = [sub({
      chargeMode: 'auto', chargeAutoSince: start, nextDueDate: today,
      closed: { [start]: { txId: `sub_s1_${start}`, at: 'x' } },
    })];
    await view.rerender(<Probe />);
    await new Promise(r => setTimeout(r, 30));
    expect(screen.getByTestId('notice_error')).toBeTruthy();
  });

  it('فتحة باردة تانية في نفس اليوم ← الرسالة تاني بس **من غير** إشعار تاني', async () => {
    mockData.recordCharges = jest.fn(async () => ({ outcome: 'uncertain', recorded: [] }));
    const view = await render(<Probe key="first" />);
    await waitFor(() => expect(screen.getByTestId('notice_error')).toBeTruthy());
    expect(mockNotify).toHaveBeenCalledTimes(1);
    await view.rerender(<Probe key="second" />);
    await waitFor(() => expect(mockData.recordCharges).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('notice_error')).toBeTruthy());
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });
});

/** جولة الدخل الأخيرة (2026-11-18): نفس تصليح `useIncomeAutoRecord` — "مش متأكدين" مبتعلّقش، واللي اتسجل بيتقال */
describe('التلقائي uncertain: الحسم', () => {
  beforeEach(() => { mockData.gamiyas = []; });
  const closedSub = () => sub({
    chargeMode: 'auto', chargeAutoSince: start, nextDueDate: addMonths(today, 1),
    closed: { [start]: { txId: `sub_s1_${start}`, at: 'x' }, [today]: { txId: `sub_s1_${today}`, at: 'x' } },
  });

  it('اتقفلت على عمليات ← "سجلنا لوحدنا" بدل ما الرسالة تختفي ساكتة', async () => {
    mockData.recordCharges = jest.fn(async () => ({ outcome: 'uncertain', recorded: [] }));
    const view = await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('notice_error')).toBeTruthy());
    mockData.subscriptions = [closedSub()];
    await view.rerender(<Probe />);
    await waitFor(() => expect(screen.queryByTestId('notice_error')).toBeNull());
    expect(screen.getByTestId('notice_recorded').props.children).toMatch(/^سجلنا لوحدنا: اشتراك "نتفليكس"/);
  });

  it('الـsnapshot اللي بيقفل وصل قبل ما النتيجة ترجع ← الرسالة مبتعلّقش', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    mockData.recordCharges = jest.fn(async () => { await gate; return { outcome: 'uncertain', recorded: [] }; });
    const view = await render(<Probe />);
    await waitFor(() => expect(mockData.recordCharges).toHaveBeenCalledTimes(1));
    mockData.subscriptions = [closedSub()];
    await view.rerender(<Probe />);
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId('notice_recorded')).toBeTruthy());
    expect(screen.queryByTestId('notice_error')).toBeNull();
  });
});

describe('التلقائي ومبلغ متخزّن بايظ (الجولة 2)', () => {
  it('done من غير تسجيل وbadAmount ← console.warn باسم الخطوة بس', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockData.gamiyas = [];
    mockData.recordCharges = jest.fn(async () => ({ outcome: 'done', recorded: [], badAmount: true }));
    await render(<Probe />);
    await waitFor(() => expect(warn).toHaveBeenCalledWith('[charge] auto skipped: stored amount unreadable'));
    expect(mockNotify).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  // الجولة 2 على شهر الاستلام (hardening): أي نتيجة/سبب مش متعالج بيتسجل في اللوج باسم الخطوة بس — مش بيعدّي ساكت
  it.each([
    [{ outcome: 'done', recorded: [], changed: true }, ['[charge] auto recorded nothing', 'changed']],
    [{ outcome: 'done', recorded: [], badInstallment: true }, ['[charge] auto recorded nothing', 'bad-installment']],
    [{ outcome: 'done', recorded: [], stopped: true }, ['[charge] auto recorded nothing', 'stopped']],
    [{ outcome: 'amount-changed', recorded: [] }, ['[charge] auto unhandled outcome', 'amount-changed']],
  ])('%p ← console.warn باسم الخطوة والسبب بس (من غير مبالغ)', async (result, expected) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockData.gamiyas = [];
    mockData.recordCharges = jest.fn(async () => result);
    await render(<Probe />);
    await waitFor(() => expect(warn).toHaveBeenCalledWith(...expected));
    warn.mockRestore();
  });
});
