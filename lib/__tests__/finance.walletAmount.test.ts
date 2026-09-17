import { parseWalletAmountInput, planWalletAmountCommit } from '@/lib/finance';

/**
 * خانة الرصيد الابتدائي كانت `Number(x) || 0`، وده كان بيخلط تلات حاجات
 * مختلفة تمامًا في نتيجة واحدة: الفاضي، والكلام اللي مش رقم، و"المستخدم
 * مادخلش الخانة أصلاً" — كلهم كانوا بيبقوا صفر ويتكتبوا.
 *
 * أوضح نتيجة: تدوس على خانة رصيد فيها 5000 وتطلع منها من غير ما تكتب حرف،
 * فالرصيد يتصفّر. فلوس بتختفي من غير أي سؤال ومن غير رجعة.
 */

describe('parseWalletAmountInput', () => {
  it('الرقم الموجب بيعدّي', () => {
    expect(parseWalletAmountInput('1500')).toBe(1500);
  });

  it('الكسور بتعدّي', () => {
    expect(parseWalletAmountInput('99.5')).toBe(99.5);
  });

  it('صفر بيعدّي', () => {
    expect(parseWalletAmountInput('0')).toBe(0);
  });

  it('السالب بيعدّي — دي محفظة كارت ائتمان مش غلطة', () => {
    expect(parseWalletAmountInput('-500')).toBe(-500);
    expect(parseWalletAmountInput('-0.01')).toBe(-0.01);
  });

  it('الفاضي والمسافات بيرجّعوا صفر — قاعدة المنتج', () => {
    expect(parseWalletAmountInput('')).toBe(0);
    expect(parseWalletAmountInput('   ')).toBe(0);
  });

  it('الكلام اللي مش رقم مترفوض — مش متحوّل لصفر', () => {
    expect(parseWalletAmountInput('abc')).toBeNull();
    expect(parseWalletAmountInput('مية جنيه')).toBeNull();
    expect(parseWalletAmountInput('1.2.3')).toBeNull();
    expect(parseWalletAmountInput('-')).toBeNull();
    expect(parseWalletAmountInput('12abc')).toBeNull();
  });

  it('اللانهاية مترفوضة زي أي كلام مش رقم', () => {
    expect(parseWalletAmountInput('Infinity')).toBeNull();
    expect(parseWalletAmountInput('-Infinity')).toBeNull();
  });

  it('المسافات حوالين رقم صحيح مبتفرقش', () => {
    expect(parseWalletAmountInput('  250  ')).toBe(250);
  });
});

describe('planWalletAmountCommit', () => {
  it('مسوّدة مش موجودة = مفيش كتابة — دي الباگ الأصلية (دوس واطلع من غير ما تكتب)', () => {
    expect(planWalletAmountCommit(undefined, 5000)).toEqual({ action: 'none' });
    expect(planWalletAmountCommit(undefined, 0)).toEqual({ action: 'none' });
    expect(planWalletAmountCommit(undefined, -200)).toEqual({ action: 'none' });
  });

  it('نفس الرقم المحفوظ = مفيش كتابة', () => {
    expect(planWalletAmountCommit('5000', 5000)).toEqual({ action: 'none' });
    expect(planWalletAmountCommit('0', 0)).toEqual({ action: 'none' });
    expect(planWalletAmountCommit('-300', -300)).toEqual({ action: 'none' });
  });

  it('نفس الرقم بصيغة مكتوبة مختلفة برضه مفيش كتابة', () => {
    expect(planWalletAmountCommit('5000.0', 5000)).toEqual({ action: 'none' });
    expect(planWalletAmountCommit(' 5000 ', 5000)).toEqual({ action: 'none' });
  });

  it('الفاضي على محفوظ صفر = مفيش كتابة', () => {
    expect(planWalletAmountCommit('', 0)).toEqual({ action: 'none' });
  });

  it('الفاضي على محفوظ مش صفر = كتابة صفر (مسح الخانة)', () => {
    expect(planWalletAmountCommit('', 5000)).toEqual({ action: 'write', value: 0 });
  });

  it('كلام مش رقم = مترفوض، والخانة ترجع للمحفوظ', () => {
    expect(planWalletAmountCommit('abc', 5000)).toEqual({ action: 'reject' });
    expect(planWalletAmountCommit('1.2.3', 0)).toEqual({ action: 'reject' });
    expect(planWalletAmountCommit('-', 100)).toEqual({ action: 'reject' });
  });

  it('رقم موجب جديد بيتكتب على طول', () => {
    expect(planWalletAmountCommit('750', 500)).toEqual({ action: 'write', value: 750 });
  });

  it('من موجب لسالب: تأكيد — ومفيش كتابة في الخطة', () => {
    const plan = planWalletAmountCommit('-500', 1000);
    expect(plan).toEqual({ action: 'confirm', value: -500 });
    expect(plan.action).not.toBe('write');
  });

  it('من صفر لسالب: تأكيد كمان', () => {
    expect(planWalletAmountCommit('-1', 0)).toEqual({ action: 'confirm', value: -1 });
  });

  it('من سالب لسالب: مفيش سؤال — المستخدم عارف أصلاً', () => {
    expect(planWalletAmountCommit('-900', -500)).toEqual({ action: 'write', value: -900 });
    expect(planWalletAmountCommit('-100', -500)).toEqual({ action: 'write', value: -100 });
  });

  it('من سالب لموجب: مفيش سؤال', () => {
    expect(planWalletAmountCommit('300', -500)).toEqual({ action: 'write', value: 300 });
  });

  it('من سالب لصفر: مفيش سؤال', () => {
    expect(planWalletAmountCommit('0', -500)).toEqual({ action: 'write', value: 0 });
  });

  it('محفوظ مش رقم (بيانات قديمة) بيتقري كصفر', () => {
    expect(planWalletAmountCommit('0', NaN)).toEqual({ action: 'none' });
    expect(planWalletAmountCommit('-5', NaN)).toEqual({ action: 'confirm', value: -5 });
  });
});
