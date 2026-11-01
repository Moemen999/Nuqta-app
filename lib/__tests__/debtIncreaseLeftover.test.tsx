import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DebtIncreaseModal, INSTALLMENTS_CHANGED_TITLE } from '@/components/DebtEntryModals';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import type { Debt } from '@/context/DataContext';
import { installmentsPhrase } from '@/lib/archiving';
import { fmt, planInstallments, stampResidue } from '@/lib/finance';

/**
 * بند 8 D1: سؤال "الباقي من الزيادة" جوه شيت الزيادة (قرار مؤمن 2026-10-30). النصوص
 * بالظبط من TIMELINE، والأرقام بنفس `fmt` بتاع التطبيق (مش فواصل مكتوبة).
 * الحساب نفسه في `finance.leftoverChoice.test.ts`.
 */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/components/useDeviceContacts', () => ({ useDeviceContacts: () => ({}) }));

const plan = planInstallments(1000, 12)!;
const debt = {
  id: 'd1', direction: 'i_owe', personName: 'صاحبي', totalAmount: 1000, isInstallment: true,
  installmentCount: 12, installmentAmount: plan.value, date: '2026-01-01', payments: [], increases: [],
  installmentResidue: stampResidue({ amount: plan.residue, forInstallment: plan.value, over: 12 }, [])!,
} as unknown as Debt;
const VALUE = plan.value; // 83.33

const ERROR_TEXT = 'اختار الأول: يتضاف على آخر قسط ولا قسط منفصل.';

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  Object.assign(mockData, { wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }], transactions: [] });
  mockData.addDebtIncrease = jest.fn(async () => ({ outcome: 'done', note: null }));
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

/** نص عقدة مرسومة كله (بما فيه الـ`Money` المتداخل) */
function textOf(node: any): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return (node.children || []).map(textOf).join('');
}

async function open(d: Debt = debt, onClose = jest.fn()) {
  await render(<ThemeProvider><NoticeProvider><PrivacyProvider><DebtIncreaseModal debt={d} onClose={onClose} /></PrivacyProvider></NoticeProvider></ThemeProvider>);
  return onClose;
}
async function type(amount: string) {
  await act(async () => { fireEvent.changeText(screen.getByTestId('debt_increase_amount'), amount); });
}
async function save() {
  await act(async () => { fireEvent.press(screen.getByTestId('debt_increase_save')); });
}
async function pick(id: 'debt_leftover_absorb' | 'debt_leftover_separate') {
  await act(async () => { fireEvent.press(screen.getByTestId(id)); });
}

describe('ظهور السؤال', () => {
  it('+100 ← السؤال بالنص المتفق عليه وخيارين', async () => {
    await open();
    expect(screen.queryByTestId('debt_leftover_question')).toBeNull();
    await type('100');
    expect(textOf(screen.getByTestId('debt_leftover_question'))).toContain(
      `الزيادة سابت ${fmt(16.71)} ج.م، أقل من قسط كامل. تعمل فيه إيه؟`);
    expect(screen.getByTestId('debt_leftover_absorb')).toBeTruthy();
    expect(screen.getByTestId('debt_leftover_separate')).toBeTruthy();
  });

  it('مفيش اختيار مسبق (لا افتراضي): الاتنين مش مختارين', async () => {
    await open();
    await type('100');
    expect(screen.getByTestId('debt_leftover_absorb').props.accessibilityState?.selected).toBeFalsy();
    expect(screen.getByTestId('debt_leftover_separate').props.accessibilityState?.selected).toBeFalsy();
  });

  it('+0.03 ← بيتسأل حتى لو الباقي صغير', async () => {
    await open();
    await type('0.03');
    expect(textOf(screen.getByTestId('debt_leftover_question'))).toContain(`الزيادة سابت ${fmt(0.07)} ج.م`);
  });

  it('+0.01 (تقريب قروش) ← مفيش سؤال، والحفظ بيمشي من غير خيار', async () => {
    const onClose = await open();
    await type('0.01');
    expect(screen.queryByTestId('debt_leftover_question')).toBeNull();
    await save();
    expect(mockData.addDebtIncrease).toHaveBeenCalledWith('d1', 0.01, expect.any(String), 'w1');
    expect(onClose).toHaveBeenCalled();
  });

  it('+500 ← مفيش سؤال', async () => {
    await open();
    await type('500');
    expect(screen.queryByTestId('debt_leftover_question')).toBeNull();
  });

  it('دين قديم من غير فرق معروف ← مفيش سؤال والسلوك القديم', async () => {
    const legacy = { ...debt, installmentResidue: undefined } as unknown as Debt;
    await open(legacy);
    await type('100');
    expect(screen.queryByTestId('debt_leftover_question')).toBeNull();
    await save();
    expect(mockData.addDebtIncrease).toHaveBeenCalledWith('d1', 100, expect.any(String), 'w1');
  });

  it('دين مش قسط ← مفيش سؤال', async () => {
    const plain = { ...debt, isInstallment: false, installmentCount: undefined, installmentAmount: undefined, installmentResidue: undefined } as unknown as Debt;
    await open(plain);
    await type('100');
    expect(screen.queryByTestId('debt_leftover_question')).toBeNull();
  });

  it('مسح المبلغ ← السؤال بيختفي', async () => {
    await open();
    await type('100');
    await type('');
    expect(screen.queryByTestId('debt_leftover_question')).toBeNull();
  });
});

describe('نص الخيارين', () => {
  it('+100: يتضاف = 13 قسط وآخرهم 100.04 (من غير "ضعف")، منفصل = قسط أخير 16.71 و14 قسط', async () => {
    await open();
    await type('100');
    const a = textOf(screen.getByTestId('debt_leftover_absorb'));
    const b = textOf(screen.getByTestId('debt_leftover_separate'));
    expect(a).toContain('يتضاف على آخر قسط');
    expect(a).toContain(`الأقساط هتبقى ${installmentsPhrase(13)}، وآخر قسط ${fmt(100.04)} ج.م بدل ${fmt(VALUE)} ج.م.`);
    expect(a).not.toContain('ضعف');
    expect(b).toContain('قسط منفصل في الآخر');
    expect(b).toContain(`هيتضاف قسط أخير قيمته ${fmt(16.71)} ج.م، والأقساط هتبقى ${installmentsPhrase(14)}.`);
  });

  it('+60: آخر قسط 143.37 ≥ 1.5× القسط ← "، يعني تقريبًا ضعف القسط العادي" قبل النقطة الأخيرة', async () => {
    await open();
    await type('60');
    const a = textOf(screen.getByTestId('debt_leftover_absorb'));
    expect(a).toContain(
      `الأقساط هتبقى ${installmentsPhrase(12)}، وآخر قسط ${fmt(143.37)} ج.م بدل ${fmt(VALUE)} ج.م، يعني تقريبًا ضعف القسط العادي.`);
    const b = textOf(screen.getByTestId('debt_leftover_separate'));
    expect(b).toContain(`هيتضاف قسط أخير قيمته ${fmt(60.04)} ج.م، والأقساط هتبقى ${installmentsPhrase(13)}.`);
    expect(textOf(screen.getByTestId('debt_leftover_question'))).toContain(`الزيادة سابت ${fmt(60.04)} ج.م`);
  });

  it('تغيير المبلغ بيحدّث الأرقام', async () => {
    await open();
    await type('100');
    await type('0.03');
    expect(textOf(screen.getByTestId('debt_leftover_absorb'))).toContain(`${installmentsPhrase(12)}، وآخر قسط ${fmt(83.4)} ج.م`);
  });
});

describe('الحفظ', () => {
  it('من غير اختيار ← رسالة الخطأ جوه الشيت وaddDebtIncrease مبتتناداش والشيت مفتوح', async () => {
    const onClose = await open();
    await type('100');
    await save();
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
    expect(mockData.addDebtIncrease).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('A ← بيبعت الباقي والعدد وآخر قسط اللي شافهم كمعامل خامس', async () => {
    await open();
    await type('100');
    await pick('debt_leftover_absorb');
    await save();
    expect(mockData.addDebtIncrease).toHaveBeenCalledWith('d1', 100, expect.any(String), 'w1', { mode: 'absorb', amount: 16.71, count: 13, last: 100.04 });
  });

  it('B ← بيبعت الباقي والعدد وآخر قسط بتوع "منفصل"', async () => {
    await open();
    await type('100');
    await pick('debt_leftover_separate');
    await save();
    expect(mockData.addDebtIncrease).toHaveBeenCalledWith('d1', 100, expect.any(String), 'w1', { mode: 'separate', amount: 16.71, count: 14, last: 16.71 });
  });

  it('+60 ← الباقي المبعوت 60.04 (مش -23.29)', async () => {
    await open();
    await type('60');
    await pick('debt_leftover_absorb');
    await save();
    expect(mockData.addDebtIncrease).toHaveBeenCalledWith('d1', 60, expect.any(String), 'w1', { mode: 'absorb', amount: 60.04, count: 12, last: 143.37 });
  });

  it('اختار وبعدين غيّر المبلغ ← الاختيار بيتصفّر وبيتسأل تاني', async () => {
    await open();
    await type('100');
    await pick('debt_leftover_absorb');
    await type('60');
    await save();
    expect(mockData.addDebtIncrease).not.toHaveBeenCalled();
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
  });

  it('الدين اتغيّر من جهاز تاني والشيت مفتوحة (نفس المبلغ) ← الاختيار بيتصفّر ومبيتبعتش على أرقام جديدة', async () => {
    const onClose = jest.fn();
    const ui = (d: Debt) => <ThemeProvider><NoticeProvider><PrivacyProvider><DebtIncreaseModal debt={d} onClose={onClose} /></PrivacyProvider></NoticeProvider></ThemeProvider>;
    const r = await render(ui(debt));
    await type('100');
    await pick('debt_leftover_absorb');
    // دفعة 100 اتسجلت من جهاز تاني ← الذيل بقى 0.04 مش 16.71
    const paid = { ...debt, payments: [{ id: 'p1', date: '2026-01-15', amount: 100, walletId: 'w1', transactionId: 'tx_p1' }] } as unknown as Debt;
    await act(async () => { r.rerender(ui(paid)); });
    expect(screen.getByTestId('debt_leftover_absorb').props.accessibilityState?.selected).toBeFalsy();
    expect(textOf(screen.getByTestId('debt_leftover_question'))).toContain(`الزيادة سابت ${fmt(0.04)} ج.م`);
    await save();
    expect(mockData.addDebtIncrease).not.toHaveBeenCalled();
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
  });

  it('"اختار الأول" وبعدين مبلغ مالوش سؤال (+500) ← الخطأ القديم بيختفي', async () => {
    await open();
    await type('100');
    await save();
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
    await type('500');
    expect(screen.queryByTestId('debt_leftover_question')).toBeNull();
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  });

  it('رسالة الخطأ برّه الـScrollView (فوق الأزرار) ومعلنة لقارئ الشاشة', async () => {
    await open();
    await type('100');
    await save();
    const err = screen.getByTestId('debt_increase_error');
    expect(err.props.accessibilityLiveRegion).toBe('polite');
    const scrollAncestors = (n: any) => { let c = 0; for (let p = n.parent; p; p = p.parent) if (p.type === 'RCTScrollView') c++; return c; };
    // الفحص نفسه بيشوف الـScrollView: خانة المبلغ جواه
    expect(scrollAncestors(screen.getByTestId('debt_increase_amount'))).toBeGreaterThan(0);
    expect(scrollAncestors(err)).toBe(0);
  });

  it('اختار الأول ثم الحفظ: رسالة الخطأ بتختفي', async () => {
    await open();
    await type('100');
    await save();
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
    await pick('debt_leftover_separate');
    await save();
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  });
});

describe('رسالة بعد الحفظ', () => {
  it('A والعدد ما اتغيّرش (+60: 12 → 12) ← "آخر قسط اتظبط" / "آخر قسط بقى 143.37 ج.م بدل 83.33 ج.م."', async () => {
    const onClose = await open();
    await type('60');
    await pick('debt_leftover_absorb');
    await save();
    expect(screen.getByTestId('notice_title').props.children).toBe('آخر قسط اتظبط');
    expect(screen.getByTestId('notice_body').props.children).toBe(`آخر قسط بقى ${fmt(143.37)} ج.م بدل ${fmt(VALUE)} ج.م.`);
    expect(onClose).toHaveBeenCalled();
  });

  it('A والعدد اتغيّر (+100) ← رسالة الزيادة الحالية + " آخر قسط بقى 100.04 ج.م."', async () => {
    mockData.addDebtIncrease = jest.fn(async () => ({ outcome: 'done', note: 'بعد الزيادة، الأقساط بقت 13 بدل 12.' }));
    await open();
    await type('100');
    await pick('debt_leftover_absorb');
    await save();
    expect(screen.getByTestId('notice_title').props.children).toBe(INSTALLMENTS_CHANGED_TITLE);
    expect(screen.getByTestId('notice_body').props.children).toBe(`بعد الزيادة، الأقساط بقت 13 بدل 12. آخر قسط بقى ${fmt(100.04)} ج.م.`);
  });

  it('B ← رسالة الزيادة الحالية زي ما هي', async () => {
    mockData.addDebtIncrease = jest.fn(async () => ({ outcome: 'done', note: 'بعد الزيادة، الأقساط بقت 14 بدل 12.' }));
    await open();
    await type('100');
    await pick('debt_leftover_separate');
    await save();
    expect(screen.getByTestId('notice_title').props.children).toBe(INSTALLMENTS_CHANGED_TITLE);
    expect(screen.getByTestId('notice_body').props.children).toBe('بعد الزيادة، الأقساط بقت 14 بدل 12.');
  });

  it('B من غير تغيير عدد (note فاضية) ← مفيش رسالة', async () => {
    await open();
    await type('0.03');
    await pick('debt_leftover_separate');
    await save();
    expect(screen.queryByTestId('notice_dialog')).toBeNull();
  });
});

describe('leftover-changed', () => {
  it('الشيت بيعرض رسالة ومبيتقفلش والسؤال لسه ظاهر', async () => {
    mockData.addDebtIncrease = jest.fn(async () => ({ outcome: 'leftover-changed' }));
    const onClose = await open();
    await type('100');
    await pick('debt_leftover_absorb');
    await save();
    expect(screen.getByTestId('notice_dialog')).toBeTruthy();
    expect(screen.getByTestId('notice_title').props.children).not.toBe(INSTALLMENTS_CHANGED_TITLE);
    expect(screen.getByTestId('notice_title').props.children).not.toBe('آخر قسط اتظبط');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('debt_leftover_question')).toBeTruthy();
  });

  it('وبعدها الحفظ من غير اختيار جديد مبيبعتش (بيتسأل تاني)', async () => {
    mockData.addDebtIncrease = jest.fn(async () => ({ outcome: 'leftover-changed' }));
    await open();
    await type('100');
    await pick('debt_leftover_absorb');
    await save();
    (mockData.addDebtIncrease as jest.Mock).mockClear();
    await act(async () => { fireEvent.press(screen.getByTestId('notice_ok')); });
    await save();
    expect(mockData.addDebtIncrease).not.toHaveBeenCalled();
  });
});

describe('الاختيار ومسح الأخطاء (جولة 2)', () => {
  it('اختيار خيار بيمسح "اختار الأول" بس، مش "اختار محفظة"', async () => {
    mockData.wallets = [];
    await open();
    await type('100');
    await save();
    expect(screen.getByText('اختار محفظة')).toBeTruthy();
    await pick('debt_leftover_absorb');
    expect(screen.getByText('اختار محفظة')).toBeTruthy();
  });
});
