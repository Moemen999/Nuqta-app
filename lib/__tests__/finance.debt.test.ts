import type { Debt, DebtEntry, DebtPayment } from '@/context/DataContext';
import { debtExcess, debtPaidLabel, debtRemaining, overpayCheck } from '@/lib/finance';

/**
 * الزيادة فوق المتبقي — الباج اللي روبو لقاه.
 *
 * روبو (Firebase Test Lab) سجّل دفعة 35,630 على دين 550، فالرصيد اتحرك بالمبلغ
 * كله والكارت بان "اتسدد 35,630 من 550 ج.م". التحقق الوحيد اللي كان موجود هو
 * إن المبلغ أكبر من صفر — مفيش سقف خالص.
 *
 * القرار كان **تحذير مش منع** (دفع أكتر شوية شرعي)، فالاختبارات دي بتثبّت
 * حاجتين: إن التحذير بيتحسب صح، وإن العرض مبيقولش رقم مستحيل.
 */

function debt(totalAmount: number, payments: number[] = [], increases: number[] = []): Debt {
  return {
    id: 'd1',
    direction: 'owed_to_me',
    personName: 'أحمد',
    totalAmount,
    date: '2026-03-10',
    isInstallment: false,
    createdAt: '2026-03-10',
    payments: payments.map((amount, i): DebtPayment => ({
      id: 'p' + i, date: '2026-03-11', amount, walletId: 'w1',
    })),
    increases: increases.map((amount, i): DebtEntry => ({
      id: 'e' + i, date: '2026-03-12', amount,
    })),
  };
}

describe('debtRemaining — المتبقي على الدين', () => {
  it('دين من غير دفعات: المتبقي هو الإجمالي', () => {
    expect(debtRemaining(debt(550))).toBe(550);
  });

  it('الدفعات بتنقّص المتبقي', () => {
    expect(debtRemaining(debt(550, [200]))).toBe(350);
  });

  it('الزيادات بتكبّر المتبقي', () => {
    expect(debtRemaining(debt(550, [200], [100]))).toBe(450);
  });

  it('الدفع بالظبط بيصفّر المتبقي', () => {
    expect(debtRemaining(debt(550, [550]))).toBe(0);
  });

  it('الدفع الزيادة بيخلّي المتبقي بالسالب', () => {
    expect(debtRemaining(debt(550, [35630]))).toBe(-35080);
  });
});

describe('debtExcess — الزيادة فوق الإجمالي', () => {
  it('مفيش زيادة في الحالة العادية', () => {
    expect(debtExcess(debt(550, [200]))).toBe(0);
  });

  it('مفيش زيادة لما الدفع يساوي الإجمالي بالظبط', () => {
    expect(debtExcess(debt(550, [550]))).toBe(0);
  });

  it('حالة روبو: 35,630 على دين 550 = زيادة 35,080', () => {
    expect(debtExcess(debt(550, [35630]))).toBe(35080);
  });

  it('بيحسب الزيادة على الإجمالي بعد الزيادات مش على المبلغ الأصلي', () => {
    // 550 + 450 زيادة = 1000، فدفعة 1200 زيادتها 200 مش 650
    expect(debtExcess(debt(550, [1200], [450]))).toBe(200);
  });
});

describe('overpayCheck — إمتى نسأل المستخدم', () => {
  it('مبلغ أقل من المتبقي بيعدّي من غير سؤال', () => {
    expect(overpayCheck(300, 550)).toBe('none');
  });

  it('المبلغ المساوي للمتبقي بالظبط بيعدّي من غير سؤال', () => {
    // ده أهم حد: التسديد الكامل هو الحالة الطبيعية، ولازم ميتسألش عليه
    expect(overpayCheck(550, 550)).toBe('none');
  });

  it('أي زيادة حقيقية فوق المتبقي بتطلب تأكيد — مفيش نسبة سماح', () => {
    expect(overpayCheck(550.01, 550)).toBe('exceeds');
    expect(overpayCheck(560, 550)).toBe('exceeds');
    expect(overpayCheck(35630, 550)).toBe('exceeds');
  });

  it('دين متسدد بالكامل بيطلب تأكيد مختلف', () => {
    expect(overpayCheck(100, 0)).toBe('settled');
  });

  it('دين مدفوع زيادة بالفعل بيتعامل كمتسدد', () => {
    expect(overpayCheck(100, -35080)).toBe('settled');
  });

  it('كسور الفاصلة العشرية مبتطلعش تحذير من العدم', () => {
    // 0.1 + 0.2 = 0.30000000000000004 في JS
    expect(overpayCheck(0.1 + 0.2, 0.3)).toBe('none');
  });
});

describe('debtPaidLabel — سطر التقدّم', () => {
  it('الحالة العادية بتعرض المدفوع من الإجمالي', () => {
    expect(debtPaidLabel(debt(550, [200]))).toBe('اتسدد 200 من 550 ج.م');
  });

  it('التسديد الكامل بيفضل كسر صحيح', () => {
    expect(debtPaidLabel(debt(550, [550]))).toBe('اتسدد 550 من 550 ج.م');
  });

  it('مع الزيادة بيقول الحقيقة بدل الكسر المستحيل', () => {
    expect(debtPaidLabel(debt(550, [35630]))).toBe('اتسدد بالكامل · زيادة 35,080 ج.م');
  });

  it('عمرها ما تعرض مدفوع أكبر من الإجمالي', () => {
    // الباج الأصلي بالظبط: "اتسدد 35,630 من 550 ج.م"
    const label = debtPaidLabel(debt(550, [35630]));
    expect(label).not.toMatch(/اتسدد 35,630 من 550/);
  });
});
