import { readFileSync } from 'fs';
import type { Debt } from '@/context/DataContext';
import { installmentCountAfterPayment, installmentValue, pinInstallmentAmount } from '@/lib/finance';

/**
 * دين قديم من غير `installmentAmount` (خطوة 6): القيمة كانت بتتحسب كل مرة
 * بالعدد الحالي، فكل دفعة بتغيّر العدد كانت بتغيّر القسط (6000/7 = 857).
 * أول ما يتلمس بيتثبّت بالعدد القديم. المسار الكامل على المحاكي:
 * `pinInstallmentAmount.emulator.test.tsx` (**ما اتشغلش في السحابة**).
 */

const legacy = (over: Partial<Debt> = {}) => ({
  id: 'd', personName: 'أحمد', direction: 'i_owe', isInstallment: true, totalAmount: 6000, installmentCount: 6,
  payments: [], increases: [], date: '2026-01-01', createdAt: '2026-01-01', ...over,
}) as unknown as Debt;

describe('pinInstallmentAmount', () => {
  it('دين قديم ← القيمة بالعدد الحالي (قبل أي تغيير)', () => {
    // ومعاها فرق التقريب بنفس الأساس (2026-09-30): 6000 − 6 × 1000 = 0،
    // و6500 − 6 × 1083.33 = 6500 − 6499.98 = 0.02
    expect(pinInstallmentAmount(legacy())).toEqual({
      installmentAmount: 1000, installmentResidue: { amount: 0, forInstallment: 1000, over: 6 },
    });
    expect(pinInstallmentAmount(legacy({ totalAmount: 6500 }))).toEqual({
      installmentAmount: 1083.33, installmentResidue: { amount: 0.02, forInstallment: 1083.33, over: 6 },
    });
  });

  it('قيمة متخزّنة، أو مش قسط، أو مفيش عدد ← مفيش حاجة تتكتب', () => {
    expect(pinInstallmentAmount(legacy({ installmentAmount: 1000 }))).toBeNull();
    expect(pinInstallmentAmount(legacy({ isInstallment: false }))).toBeNull();
    expect(pinInstallmentAmount(legacy({ installmentCount: undefined }))).toBeNull();
    expect(pinInstallmentAmount(legacy({ installmentCount: 0 }))).toBeNull();
  });

  it('المشكلة اللي بيحلها: من غير تثبيت القسط بيتحرك مع العدد، وبالتثبيت لأ', () => {
    const d = legacy();
    const next = installmentCountAfterPayment(d, 700)!;
    expect(next).toBe(7);
    const drifted = { ...d, installmentCount: next, payments: [{ id: 'p', date: '', amount: 700, walletId: 'w' }] };
    expect(installmentValue(drifted)).toBe(857.14);
    expect(installmentValue({ ...drifted, ...pinInstallmentAmount(d)! })).toBe(1000);
  });
});

describe('DataContext: كل عملية ذرية بتكتب عدد الأقساط بتثبّت القيمة', () => {
  const src = readFileSync('context/DataContext.tsx', 'utf8');
  const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const body = (name: string) => {
    const start = code.indexOf(`  async function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    return code.slice(start, code.indexOf('\n  }\n', start));
  };

  it.each(['addDebtPayment', 'deleteDebtPayment', 'addDebtIncrease', 'deleteDebtIncrease'])('%s', (name) => {
    const b = body(name);
    expect(b).toContain('patch.installmentCount = ');
    expect(b).toContain('pinInstallmentAmount(debt)');
  });

  it('stageReconcile (من حالة الرياكت، مش ذرية) مبيثبّتش — عشان ميكتبش فوق قيمة اتعدّلت من جهاز تاني', () => {
    const start = code.indexOf('  function stageReconcile(');
    const b = code.slice(start, code.indexOf('\n  }\n', start));
    expect(b).toContain('patch.installmentCount = ');
    expect(b).not.toContain('pinInstallmentAmount');
  });
});
