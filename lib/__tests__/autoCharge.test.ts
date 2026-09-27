import {
  CHARGE_CATCHUP_MAX, chargeModePatch, chargeRecordedMessage, chargeRecordedNotification, chargeRecordedPart,
  gamiyaOpenCharges, subscriptionAdvance, subscriptionKeyOpen, subscriptionManualKey, subscriptionOpenCharges,
  subscriptionTxId, gamiyaTxId, type GamiyaLike, type SubscriptionLike,
} from '@/lib/autoCharge';

const sub = (over: Partial<SubscriptionLike> = {}): SubscriptionLike => ({
  id: 's1', name: 'نتفليكس', amount: 200, frequency: 'monthly', nextDueDate: '2026-09-25', active: true, ...over,
});

describe('فترات الاشتراك المفتوحة', () => {
  it('المعاد لسه ما جاش ← مفيش', () => {
    expect(subscriptionOpenCharges(sub(), '2026-09-24')).toEqual([]);
  });

  it('يوم المعاد نفسه ← مفتوحة', () => {
    expect(subscriptionOpenCharges(sub(), '2026-09-25').map(c => c.key)).toEqual(['2026-09-25']);
  });

  it('غاب 3 شهور ← التلات فترات بالترتيب (اللحاق)', () => {
    expect(subscriptionOpenCharges(sub({ nextDueDate: '2026-07-25' }), '2026-09-30').map(c => c.key))
      .toEqual(['2026-07-25', '2026-08-25', '2026-09-25']);
  });

  it('سنوي وأيام مخصصة', () => {
    expect(subscriptionOpenCharges(sub({ frequency: 'yearly', nextDueDate: '2025-09-01' }), '2026-09-02').map(c => c.key))
      .toEqual(['2025-09-01', '2026-09-01']);
    expect(subscriptionOpenCharges(sub({ frequency: 'custom', customDays: 10, nextDueDate: '2026-09-01' }), '2026-09-21').map(c => c.key))
      .toEqual(['2026-09-01', '2026-09-11', '2026-09-21']);
  });

  it(`أكتر من ${CHARGE_CATCHUP_MAX} ← الأقدم ${CHARGE_CATCHUP_MAX} (الباقي يتلحق المرة الجاية)`, () => {
    const open = subscriptionOpenCharges(sub({ nextDueDate: '2024-01-25' }), '2026-09-30');
    expect(open).toHaveLength(CHARGE_CATCHUP_MAX);
    expect(open[0].key).toBe('2024-01-25');
  });

  it('الاشتراك واقف ← مفيش حاجة', () => {
    expect(subscriptionOpenCharges(sub({ active: false }), '2026-09-30')).toEqual([]);
  });

  it('واقف وفيه فترة رجعت تسأل ← لسه بتسأل (السؤال عن فلوس فاتت)', () => {
    const s = sub({ active: false, closed: { '2026-08-25': { reopened: true, at: 'a' } } });
    expect(subscriptionOpenCharges(s, '2026-09-30').map(c => c.key)).toEqual(['2026-08-25']);
  });

  it('الفترة المقفولة (اتسجلت أو اتفوّتت) مش مفتوحة', () => {
    const s = sub({ nextDueDate: '2026-08-25', closed: { '2026-08-25': { txId: 'x', at: 'a' } } });
    expect(subscriptionOpenCharges(s, '2026-09-30').map(c => c.key)).toEqual(['2026-09-25']);
  });

  it('فترة رجعت تسأل (عمليتها اتمسحت) ← مفتوحة بس عمرها ما تتسجل لوحدها', () => {
    const s = sub({
      chargeMode: 'auto', chargeAutoSince: '2026-01-01', nextDueDate: '2026-10-25',
      closed: { '2026-09-25': { reopened: true, at: 'a' } },
    });
    expect(subscriptionOpenCharges(s, '2026-09-30')).toEqual([{ key: '2026-09-25', due: '2026-09-25', amount: 200, autoOk: false }]);
  });
});

describe('التلقائي بيسجل بس من يوم ما اتفعّل', () => {
  it('"بتأكيد" (الافتراضي) ← ولا فترة تلقائية', () => {
    expect(subscriptionOpenCharges(sub(), '2026-09-30').every(c => !c.autoOk)).toBe(true);
  });

  it('فترات قبل التفعيل بتسأل، واللي بعده بتتسجل', () => {
    const s = sub({ chargeMode: 'auto', chargeAutoSince: '2026-09-01', nextDueDate: '2026-07-25' });
    expect(subscriptionOpenCharges(s, '2026-09-30').map(c => [c.key, c.autoOk]))
      .toEqual([['2026-07-25', false], ['2026-08-25', false], ['2026-09-25', true]]);
  });

  it('"تلقائي" من غير تاريخ تفعيل ← مبيسجلش حاجة لوحده (الأمان قبل الراحة)', () => {
    expect(subscriptionOpenCharges(sub({ chargeMode: 'auto' }), '2026-09-30').every(c => !c.autoOk)).toBe(true);
  });

  it('chargeModePatch: تلقائي بياخد النهاردة، والتعديل على تلقائي مبيحرّكش التاريخ، وبتأكيد مبيحطش تاريخ', () => {
    expect(chargeModePatch('auto', undefined, '2026-09-27')).toEqual({ chargeMode: 'auto', chargeAutoSince: '2026-09-27' });
    expect(chargeModePatch('auto', { chargeMode: 'auto', chargeAutoSince: '2026-01-01' }, '2026-09-27'))
      .toEqual({ chargeMode: 'auto', chargeAutoSince: '2026-01-01' });
    expect(chargeModePatch('auto', { chargeMode: 'confirm', chargeAutoSince: '2026-01-01' }, '2026-09-27'))
      .toEqual({ chargeMode: 'auto', chargeAutoSince: '2026-09-27' });
    expect(chargeModePatch('confirm', { chargeMode: 'auto', chargeAutoSince: '2026-01-01' }, '2026-09-27')).toEqual({ chargeMode: 'confirm' });
  });
});

describe('"سدّد" بيقفل أنهي فترة', () => {
  it('فيه فترة متأخرة ← الأقدم', () => {
    expect(subscriptionManualKey(sub({ nextDueDate: '2026-08-25' }), '2026-09-30')).toBe('2026-08-25');
  });

  it('مفيش متأخر ← اللي جاية (دفع بدري)', () => {
    expect(subscriptionManualKey(sub({ nextDueDate: '2026-10-25' }), '2026-09-30')).toBe('2026-10-25');
  });

  it('فترة رجعت تسأل أقدم من المعاد ← هي الأول', () => {
    const s = sub({ nextDueDate: '2026-10-25', closed: { '2026-09-25': { reopened: true, at: 'a' } } });
    expect(subscriptionManualKey(s, '2026-09-30')).toBe('2026-09-25');
  });

  it('اشتراك واقف ← برضه بيقفل الفترة الجاية (الزرار في الشاشة مش في الكارت)', () => {
    expect(subscriptionManualKey(sub({ active: false, nextDueDate: '2026-10-25' }), '2026-09-30')).toBe('2026-10-25');
  });
});

describe('subscriptionAdvance / subscriptionKeyOpen', () => {
  it('المعاد بيعدّي كل الفترات المقفولة ورا بعض ويقف عند أول مفتوحة', () => {
    const s = sub({ nextDueDate: '2026-07-25' });
    const closed = { '2026-07-25': { txId: 'a', at: 'x' }, '2026-08-25': { skipped: true, at: 'x' } };
    expect(subscriptionAdvance(s, closed)).toBe('2026-09-25');
  });

  it('فترة رجعت تسأل مبتتعدّاش', () => {
    expect(subscriptionAdvance(sub(), { '2026-09-25': { reopened: true, at: 'x' } })).toBe('2026-09-25');
  });

  it('فترة قبل المعاد مقفولة بالتعريف — إلا لو رجعت تسأل', () => {
    expect(subscriptionKeyOpen(sub(), '2026-08-25')).toBe(false);
    expect(subscriptionKeyOpen(sub({ closed: { '2026-08-25': { reopened: true, at: 'x' } } }), '2026-08-25')).toBe(true);
    expect(subscriptionKeyOpen(sub(), '2026-09-25')).toBe(true);
  });
});

describe('شهور الجمعية', () => {
  const g = (over: Partial<GamiyaLike> = {}): GamiyaLike => ({
    id: 'g1', name: 'العيلة', chargeMode: 'auto', chargeAutoSince: '2026-01-01',
    months: [
      { id: 'm1', monthIndex: 1, dueDate: '2026-07-01', isPayoutMonth: false, amount: 1000, status: 'done', transactionId: 't' },
      { id: 'm2', monthIndex: 2, dueDate: '2026-08-01', isPayoutMonth: true, amount: 12000, status: 'pending' },
      { id: 'm3', monthIndex: 3, dueDate: '2026-09-01', isPayoutMonth: false, amount: 1000, status: 'pending' },
      { id: 'm4', monthIndex: 4, dueDate: '2026-10-01', isPayoutMonth: false, amount: 1000, status: 'pending' },
    ],
    ...over,
  });

  it('المستحق بس (مش اللي جاي ولا اللي اتسدد)، والاستلام بيسأل دايمًا', () => {
    expect(gamiyaOpenCharges(g(), '2026-09-27')).toEqual([
      { key: 'm2', due: '2026-08-01', amount: 12000, autoOk: false },
      { key: 'm3', due: '2026-09-01', amount: 1000, autoOk: true },
    ]);
  });

  it('شهر رجع يسأل ← مبيتسجلش لوحده', () => {
    const x = g();
    x.months[2].reopened = true;
    expect(gamiyaOpenCharges(x, '2026-09-27').find(c => c.key === 'm3')?.autoOk).toBe(false);
  });

  it('"بتأكيد" ← ولا شهر تلقائي', () => {
    expect(gamiyaOpenCharges(g({ chargeMode: 'confirm' }), '2026-09-27').every(c => !c.autoOk)).toBe(true);
  });
});

describe('المعرّفات الثابتة', () => {
  it('نفس الفترة ← نفس المعرّف من أي جهاز', () => {
    expect(subscriptionTxId('s1', '2026-09-25')).toBe('sub_s1_2026-09-25');
    expect(gamiyaTxId('g1', 'm3')).toBe('gamiya_g1_m3');
  });
});

describe('الرسالة الواحدة', () => {
  it('كذا اشتراك وكذا فترة ← جملة واحدة', () => {
    const msg = chargeRecordedMessage([
      chargeRecordedPart('subscription', 'نتفليكس', ['25 أغسطس', '25 سبتمبر']),
      chargeRecordedPart('gamiya', 'العيلة', ['شهر 3']),
    ]);
    expect(msg).toBe('سجلنا لوحدنا: اشتراك "نتفليكس" (25 أغسطس و25 سبتمبر) وقسط جمعية "العيلة" (شهر 3)');
  });

  it('أكتر من 3 فترات ← العدد والمدى', () => {
    expect(chargeRecordedPart('subscription', 'x', ['أ', 'ب', 'ج', 'د'])).toBe('اشتراك "x" (4 مرات، من أ لـ د)');
  });

  it('الإشعار من غير رقم لو المبالغ مخفية', () => {
    expect(chargeRecordedNotification('m', 400, true)).toBe('m. لو الرقم مختلف عدّله من الأرشيف.');
    expect(chargeRecordedNotification('m', 400, false)).toContain('400');
  });
});

describe('أسامي الوضعين', () => {
  it('الدخل الثابت والاشتراكات والجمعية بنفس الأسامي بالظبط (2026-09-28)', () => {
    const { CHARGE_MODE_LABEL } = require('@/lib/autoCharge');
    const { INCOME_MODE_LABEL } = require('@/components/IncomesView');
    expect(CHARGE_MODE_LABEL).toEqual({ confirm: 'بيسألك الأول', auto: 'بيتسجل لوحده' });
    expect(INCOME_MODE_LABEL).toBe(CHARGE_MODE_LABEL);
  });
});
