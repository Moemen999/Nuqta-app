import AsyncStorage from '@react-native-async-storage/async-storage';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Money, REVEAL_MS } from '@/components/Money';
import { HIDE_AMOUNTS_KEY, PrivacyProvider, usePrivacy } from '@/context/PrivacyContext';
import type { Debt, Gamiya, Subscription } from '@/context/DataContext';
import { addDays, debtPaidLabel, todayStr } from '@/lib/finance';
import { MONEY_MASK, amountFormatter, moneyText } from '@/lib/money';
import { scheduleAllReminders } from '@/lib/scheduleAllReminders';

const scheduled: { title: string; body: string; date: string }[] = [];
jest.mock('@/lib/notifications', () => ({
  cancelAllReminders: jest.fn(async () => {}),
  scheduleReminder: jest.fn(async (o: any) => { scheduled.push(o); }),
  scheduleDailyReminder: jest.fn(async () => {}),
}));

beforeEach(async () => {
  scheduled.length = 0;
  await AsyncStorage.clear();
});

describe('صيغة القناع', () => {
  it('طول القناع ثابت مهما كان الرقم — مبيقولش حجم المبلغ', () => {
    expect(moneyText(5, true)).toBe(moneyText(5_000_000, true));
    expect(moneyText(1250, true)).toBe(`${MONEY_MASK} ج.م`);
    expect(moneyText(1250, false)).toBe('1,250 ج.م');
  });

  it('الجمل اللي فيها مبلغ بتتخبّى كلها (debtPaidLabel)', () => {
    const d = { totalAmount: 550, payments: [{ amount: 200 }], increases: [] } as unknown as Debt;
    expect(debtPaidLabel(d, amountFormatter(true))).toBe(`اتسدد ${MONEY_MASK} من ${MONEY_MASK} ج.م`);
    expect(debtPaidLabel(d, amountFormatter(false))).toBe('اتسدد 200 من 550 ج.م');
    // من غير الفورماتر بيفضل زي ما كان (الاختبارات القديمة والاستخدامات برّه الشاشات)
    expect(debtPaidLabel(d)).toBe('اتسدد 200 من 550 ج.م');
  });
});

function Probe() {
  const { amountsHidden, toggleAmounts, loaded } = usePrivacy();
  return (
    <>
      <Text testID="state">{loaded ? (amountsHidden ? 'hidden' : 'shown') : 'loading'}</Text>
      <Text testID="toggle" onPress={toggleAmounts}>toggle</Text>
      <Money value={1250} />
    </>
  );
}

const mount = async () => {
  await render(<PrivacyProvider><Probe /></PrivacyProvider>);
  await waitFor(() => expect(screen.getByTestId('state').props.children).not.toBe('loading'));
};

describe('التفضيل بيتفكر على الجهاز', () => {
  it('أول مرة: ظاهر', async () => {
    await mount();
    expect(screen.getByTestId('state').props.children).toBe('shown');
    expect(screen.getByText('1,250 ج.م')).toBeTruthy();
  });

  it('الإخفاء بيتكتب في AsyncStorage وبيرجع بعد إعادة التشغيل', async () => {
    await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('toggle')); });
    expect(await AsyncStorage.getItem(HIDE_AMOUNTS_KEY)).toBe('1');
    // key جديد = الـProvider بيتشال ويترسم من الأول، زي إعادة تشغيل التطبيق
    await screen.rerender(<PrivacyProvider key="restart"><Probe /></PrivacyProvider>);
    await waitFor(() => expect(screen.getByTestId('state').props.children).not.toBe('loading'));
    expect(screen.getByTestId('state').props.children).toBe('hidden');
    expect(screen.getByText(`${MONEY_MASK} ج.م`)).toBeTruthy();
    expect(screen.queryByText('1,250 ج.م')).toBeNull();
  });

  it('قبل ما التفضيل يتقري المبالغ مخفية — المخبّي مايشوفش أرقامه تلمع', async () => {
    await AsyncStorage.setItem(HIDE_AMOUNTS_KEY, '1');
    await render(<PrivacyProvider><Probe /></PrivacyProvider>);
    // أول رسمة قبل ما القراية ترجع
    expect(screen.queryByText('1,250 ج.م')).toBeNull();
    // نستنى القراية تخلص عشان متتسرّبش للاختبار اللي بعده
    await waitFor(() => expect(screen.getByTestId('state').props.children).toBe('hidden'));
  });
});

describe('الدوسة على رقم مخفي', () => {
  afterEach(() => jest.useRealTimers());

  it('بتكشفه ٣ ثواني وبعدين يرجع قناع', async () => {
    await AsyncStorage.setItem(HIDE_AMOUNTS_KEY, '1');
    await mount();
    // المؤقت الوهمي بعد الرسم: مؤقت الكشف بيتعمل مع الدوسة
    jest.useFakeTimers();
    await act(async () => { fireEvent.press(screen.getByText(`${MONEY_MASK} ج.م`)); });
    expect(screen.getByText('1,250 ج.م')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(REVEAL_MS + 10); });
    expect(screen.queryByText('1,250 ج.م')).toBeNull();
  });

  it('قارئ الشاشة بيعلن الرقم وقت الكشف (مش بيعيد القراية لوحده)', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    await AsyncStorage.setItem(HIDE_AMOUNTS_KEY, '1');
    await mount();
    await act(async () => { fireEvent.press(screen.getByText(`${MONEY_MASK} ج.م`)); });
    expect(announce).toHaveBeenCalledWith('1,250 ج.م');
    announce.mockRestore();
  });

  it('الرقم الظاهر مبيتداسش (مفيش onPress يلخبط الدوس على الكارت اللي حواليه)', async () => {
    await mount();
    expect(screen.getByText('1,250 ج.م').props.onPress).toBeUndefined();
  });
});

describe('الإشعارات والمبالغ مخفية', () => {
  const today = todayStr();
  const sub = { id: 's', name: 'نتفليكس', amount: 150, nextDueDate: today, reminderDaysBefore: 0 } as Subscription;
  const gam = {
    id: 'g', name: 'جمعية الشغل', reminderDaysBefore: 0,
    months: [{ id: 'm', monthIndex: 1, dueDate: addDays(today, 1), amount: 2000, status: 'pending', isPayoutMonth: false }],
  } as unknown as Gamiya;
  const debt = {
    id: 'd', personName: 'أحمد', direction: 'owed_to_me', totalAmount: 900, date: today,
    payments: [], increases: [], dueDate: today, reminderDaysBefore: 0,
  } as unknown as Debt;
  const run = (hideAmounts: boolean) => scheduleAllReminders({
    subscriptions: [sub], gamiyas: [gam], debts: [debt],
    dailyReminderEnabled: false, dailyHour: 20, dailyMinute: 0, hideAmounts,
  });

  it('مفيش ولا رقم فلوس في أي إشعار', async () => {
    await run(true);
    expect(scheduled).toHaveLength(3);
    for (const n of scheduled) {
      expect(n.body).not.toMatch(/[0-9٠-٩]|ج\.م|•/);
    }
    expect(scheduled.map(n => n.body)).toEqual(expect.arrayContaining([
      'مستحق النهاردة', 'قسط الشهر قرب', 'المعاد النهاردة — لسه فيه متبقي',
    ]));
  });

  it('ولما تكون ظاهرة المبالغ موجودة زي الأول', async () => {
    await run(false);
    expect(scheduled.map(n => n.body)).toEqual(expect.arrayContaining([
      'مستحق النهاردة — 150 ج.م', 'قسط الشهر قرب — 2,000 ج.م', 'المعاد النهاردة — متبقي 900 ج.م',
    ]));
  });
});

/**
 * جرد: أي شاشة بتعرض فلوس لازم تعدّي من `<Money>` أو `money()` بتاعة
 * `usePrivacy`. `fmt(` في الشاشات ممنوعة خالص — الشاشة الجديدة اللي هتنسى
 * الإخفاء هتقع هنا من أول يوم مش بعد ما حد يلاحظ رقمه ظاهر.
 *
 * `plainAmount(` = رقم حقيقي **عن قصد**، ومسموح بس في الاستثناءات دي:
 */
const PLAIN_AMOUNT_ALLOWED: Record<string, { count: number; why: string }> = {
  'components/AmountPreview.tsx': { count: 1, why: 'صدى الرقم اللي بيتكتب في الخانة دلوقتي' },
  'components/DebtEntryModals.tsx': { count: 4, why: 'تأكيد قبل تسجيل دفعة أكبر من المتبقي' },
  'components/GamiyaView.tsx': { count: 2, why: 'تأكيد قبل خصم/استلام قسط الجمعية' },
  'components/SubscriptionsView.tsx': { count: 1, why: 'تأكيد قبل خصم الاشتراك' },
  'components/ArchivedSettlement.tsx': { count: 1, why: 'تأكيد قبل تحويل فرق المحفظة المؤرشفة' },
  'app/settings-screens/wallets.tsx': { count: 1, why: 'رسالة ليه الأرشفة اتمنعت — الرصيد هو السبب' },
};

/** الشاشات اللي بتعرض مبالغ — كل واحدة لازم فيها `<Money` أو `money(` */
const MONEY_SCREENS = [
  'app/(tabs)/index.tsx', 'app/(tabs)/debts.tsx', 'app/(tabs)/reports.tsx', 'app/archive.tsx',
  'app/person-ledger.tsx', 'components/AmountPreview.tsx', 'components/BudgetView.tsx',
  'components/DebtEntryModals.tsx', 'components/GamiyaView.tsx', 'components/ShakhbataView.tsx',
  'components/SubscriptionsView.tsx',
];

const ROOT = path.join(__dirname, '..', '..');
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');
const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))];

describe('جرد الإخفاء في كل الشاشات', () => {
  it('مفيش fmt( في أي شاشة غير Money نفسها', () => {
    const offenders = files
      .filter(f => rel(f) !== 'components/Money.tsx')
      .filter(f => /\bfmt\(/.test(fs.readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('plainAmount( في الاستثناءات المكتوبة بس، وبالعدد', () => {
    const found: Record<string, number> = {};
    for (const f of files) {
      const n = (fs.readFileSync(f, 'utf8').match(/\bplainAmount\(/g) || []).length;
      if (n) found[rel(f)] = n;
    }
    const expected = Object.fromEntries(Object.entries(PLAIN_AMOUNT_ALLOWED).map(([k, v]) => [k, v.count]));
    expect(found).toEqual(expected);
  });

  it('كل شاشة فيها فلوس بتعدّي من الإخفاء', () => {
    const missing = MONEY_SCREENS.filter(f => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      return !src.includes('<Money') && !/\bmoney\(/.test(src);
    });
    expect(missing).toEqual([]);
  });

  it('الإشعارات بتتجدول بتفضيل الإخفاء', () => {
    const src = fs.readFileSync(path.join(ROOT, 'context', 'NotificationsContext.tsx'), 'utf8');
    expect(src).toMatch(/hideAmounts: amountsHidden/);
    expect(src).toMatch(/!privacyLoaded/);
  });

  it('التصدير بيستخدم الأرقام الحقيقية (t.amount خام)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'archive.tsx'), 'utf8');
    expect(src).toMatch(/Amount: t\.amount,/);
  });

  /**
   * الجرد اللي فوق بيمسح `app/` و`components/` بس — والجمل اللي فيها مبلغ
   * ممكن تتبني في `lib/` وتتعرض في شاشة (`walletDeleteConsequences` مثلاً كانت
   * كده ومحدش حس). أي `${fmt(` في `lib/` لازم يبقى هنا بسببه.
   */
  it('الجمل اللي فيها مبلغ في lib/ في الاستثناءات المكتوبة بس', () => {
    const LIB_FMT_ALLOWED: Record<string, { count: number; why: string }> = {
      'lib/money.ts': { count: 1, why: 'moneyText نفسها — بتختار القناع أو الرقم' },
      'lib/scheduleAllReminders.ts': { count: 2, why: 'محكومة بـ hideAmounts — الإشعار من غير رقم لو مخفي' },
      'lib/finance.ts': { count: 2, why: '«دفعت X بدل Y» في installmentChangeMessage — صدى المبلغ اللي لسه دافعه في نفس اللحظة' },
      'lib/archiving.ts': { count: 1, why: 'walletDeleteConsequences — تأكيد قبل المسح، والرصيد هو تمن القرار' },
    };
    const libFiles = fs.readdirSync(path.join(ROOT, 'lib')).filter(n => /\.tsx?$/.test(n));
    const found: Record<string, number> = {};
    for (const n of libFiles) {
      const src = fs.readFileSync(path.join(ROOT, 'lib', n), 'utf8');
      const hits = (src.match(/\$\{[^}]*\bfmt\(/g) || []).length;
      if (hits) found[`lib/${n}`] = hits;
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(LIB_FMT_ALLOWED).map(([k, v]) => [k, v.count])));
  });
});
