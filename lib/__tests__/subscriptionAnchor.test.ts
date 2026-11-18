import {
  gamiyaOpenCharges, subscriptionAdvance, subscriptionAnchorDay, subscriptionNextCycle, subscriptionOpenCharges,
  subscriptionResumeDate, type GamiyaLike, type SubscriptionLike,
} from '@/lib/autoCharge';
import { addMonthsAnchored } from '@/lib/finance';

/**
 * بند C (مراجعة الاشتراكات، 2026-11-17): الاشتراك بتاع يوم 31 كان بيتقصّ على 28 في فبراير
 * و**يفضل 28 للأبد** (`addMonths` على المعاد اللي اتقصّ). دلوقتي اليوم الأصلي متخزّن
 * (`anchorDay`) وكل دورة بتتحسب منه: min(اليوم الأصلي، عدد أيام الشهر).
 */
const sub = (over: Partial<SubscriptionLike> = {}): SubscriptionLike => ({
  id: 's1', name: 'نتفليكس', amount: 200, frequency: 'monthly', nextDueDate: '2026-01-31', active: true, ...over,
});

describe('addMonthsAnchored', () => {
  it('31 يناير ← 28 فبراير ← 31 مارس', () => {
    expect(addMonthsAnchored('2026-01-31', 1, 31)).toBe('2026-02-28');
    expect(addMonthsAnchored('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonthsAnchored('2026-03-31', 1, 31)).toBe('2026-04-30');
    expect(addMonthsAnchored('2026-04-30', 1, 31)).toBe('2026-05-31');
  });
  it('يوم 30: فبراير 28 (29 في الكبيسة) وبعده 30', () => {
    expect(addMonthsAnchored('2026-01-30', 1, 30)).toBe('2026-02-28');
    expect(addMonthsAnchored('2026-02-28', 1, 30)).toBe('2026-03-30');
    expect(addMonthsAnchored('2028-01-30', 1, 30)).toBe('2028-02-29');
  });
  it('سنوي 29 فبراير ← 28 في السنين العادية و29 في الكبيسة', () => {
    expect(addMonthsAnchored('2028-02-29', 12, 29)).toBe('2029-02-28');
    expect(addMonthsAnchored('2029-02-28', 12, 29)).toBe('2030-02-28');
    expect(addMonthsAnchored('2031-02-28', 12, 29)).toBe('2032-02-29');
  });
  it('بالسالب برضه', () => {
    expect(addMonthsAnchored('2026-03-31', -1, 31)).toBe('2026-02-28');
    expect(addMonthsAnchored('2026-02-28', -1, 31)).toBe('2026-01-31');
  });
});

describe('subscriptionAnchorDay', () => {
  it('المتخزّن الصالح بيكسب', () => {
    expect(subscriptionAnchorDay(sub({ anchorDay: 31, nextDueDate: '2026-02-28' }))).toBe(31);
  });
  it('قديم من غير anchorDay ← يوم المعاد المتخزّن (اللي اتقصّ قبل كده مبيرجعش)', () => {
    expect(subscriptionAnchorDay(sub({ nextDueDate: '2026-02-28' }))).toBe(28);
    expect(subscriptionAnchorDay(sub({ nextDueDate: '2026-01-31' }))).toBe(31);
  });
  it('قيمة بايظة ← بتتجاهل', () => {
    expect(subscriptionAnchorDay(sub({ anchorDay: 0 as never, nextDueDate: '2026-01-15' }))).toBe(15);
    expect(subscriptionAnchorDay(sub({ anchorDay: 32 as never, nextDueDate: '2026-01-15' }))).toBe(15);
    expect(subscriptionAnchorDay(sub({ anchorDay: 3.5 as never, nextDueDate: '2026-01-15' }))).toBe(15);
    expect(subscriptionAnchorDay(sub({ anchorDay: '31' as never, nextDueDate: '2026-01-15' }))).toBe(15);
  });
});

describe('الدورة الجاية بتحترم اليوم الأصلي', () => {
  it('شهري 31: يناير ← فبراير 28 ← مارس 31 (مش 28 للأبد)', () => {
    const s = sub({ anchorDay: 31, nextDueDate: '2026-01-31' });
    expect(subscriptionOpenCharges(s, '2026-04-30').map(c => c.key))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(subscriptionNextCycle(s, '2026-02-28')).toBe('2026-03-31');
  });
  it('قديم من غير anchorDay والمعاد 31 ← بيتحسب من المعاد المتخزّن، فبيرجع 31 بعد فبراير', () => {
    const s = sub({ nextDueDate: '2026-01-31' });
    expect(subscriptionOpenCharges(s, '2026-03-31').map(c => c.key)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
  it('اتقفل فبراير ← المعاد الجاي 31 مارس', () => {
    const s = sub({ anchorDay: 31, nextDueDate: '2026-02-28' });
    expect(subscriptionAdvance(s, { '2026-02-28': { txId: 'x', at: 'a' } })).toBe('2026-03-31');
  });
  it('سنوي 29 فبراير', () => {
    const s = sub({ frequency: 'yearly', anchorDay: 29, nextDueDate: '2028-02-29' });
    expect(subscriptionOpenCharges(s, '2032-03-01').map(c => c.key))
      .toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });
  it('الرجوع بعد الإيقاف بيحترم اليوم الأصلي', () => {
    expect(subscriptionResumeDate(sub({ anchorDay: 31, nextDueDate: '2026-01-31' }), '2026-03-01')).toBe('2026-03-31');
  });
  it('أيام مخصصة مالهاش دعوة باليوم', () => {
    const s = sub({ frequency: 'custom', customDays: 30, anchorDay: 31, nextDueDate: '2026-01-31' });
    expect(subscriptionNextCycle(s, '2026-01-31')).toBe('2026-03-02');
  });
});

describe('مبلغ متخزّن بايظ على "تلقائي" ← مبيتبلعش، بيرجع يسأل', () => {
  it('اشتراك: autoOk=false فالكارت بيظهر بدل ما التلقائي يتخطّاه ساكت', () => {
    const s = sub({ amount: NaN, chargeMode: 'auto', chargeAutoSince: '2026-01-01', nextDueDate: '2026-02-01' });
    const open = subscriptionOpenCharges(s, '2026-02-01');
    expect(open).toHaveLength(1);
    expect(open[0].autoOk).toBe(false);
    expect(subscriptionOpenCharges({ ...s, amount: 0 }, '2026-02-01')[0].autoOk).toBe(false);
    expect(subscriptionOpenCharges({ ...s, amount: 200 }, '2026-02-01')[0].autoOk).toBe(true);
  });
  it('جمعية: نفس الكلام', () => {
    const g: GamiyaLike = {
      id: 'g', name: 'ج', chargeMode: 'auto', chargeAutoSince: '2026-01-01',
      months: [{ id: 'm1', monthIndex: 2, dueDate: '2026-02-01', isPayoutMonth: false, amount: NaN, status: 'pending' }],
    };
    expect(gamiyaOpenCharges(g, '2026-02-01')[0].autoOk).toBe(false);
  });
});
