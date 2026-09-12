import type { Debt } from '@/context/DataContext';
import { findPersonGroup, groupDebtsByPerson } from '@/lib/finance';

function debt(p: Partial<Debt> & { personName: string }): Debt {
  return {
    id: Math.random().toString(36).slice(2),
    direction: 'owed_to_me',
    totalAmount: 100,
    date: '2026-03-10',
    isInstallment: false,
    createdAt: '2026-03-10T10:00:00.000Z',
    payments: [],
    increases: [],
    ...p,
  } as Debt;
}

const names = (gs: ReturnType<typeof groupDebtsByPerson>) => gs.map(g => g.displayName);
const sizes = (gs: ReturnType<typeof groupDebtsByPerson>) => gs.map(g => g.debts.length);

describe('groupDebtsByPerson — الحالات اللي كانت بتقسّم حساب الشخص', () => {
  it('مسافة زايدة في الاسم مبقتش تعمل شخصين', () => {
    const gs = groupDebtsByPerson([debt({ personName: 'أحمد' }), debt({ personName: 'أحمد ' })]);
    expect(gs).toHaveLength(1);
    expect(sizes(gs)).toEqual([2]);
    expect(names(gs)).toEqual(['أحمد']);
  });

  it('مسافات جوّا الاسم بتتوحّد', () => {
    const gs = groupDebtsByPerson([debt({ personName: 'أحمد  محمد' }), debt({ personName: 'أحمد محمد' })]);
    expect(gs).toHaveLength(1);
  });

  it('نفس جهة الاتصال باسمين مختلفين = شخص واحد', () => {
    // بيحصل لما المستخدم يعدّل اسم الدين بعد ما اختاره من جهات الاتصال
    const gs = groupDebtsByPerson([
      debt({ personName: 'أحمد', personContactId: 'c1' }),
      debt({ personName: 'أحمد محمد', personContactId: 'c1' }),
    ]);
    expect(gs).toHaveLength(1);
    expect(sizes(gs)).toEqual([2]);
    expect(gs[0].personContactId).toBe('c1');
  });

  it('دين مكتوب بالإيد بيلتحق بجهة الاتصال اللي بنفس الاسم', () => {
    const gs = groupDebtsByPerson([
      debt({ personName: 'منى سعيد', personContactId: 'c9' }),
      debt({ personName: 'منى سعيد' }),
    ]);
    expect(gs).toHaveLength(1);
    expect(gs[0].personContactId).toBe('c9');
    expect(sizes(gs)).toEqual([2]);
  });

  it('بيلتحق بيها كمان لو الدين المكتوب بالإيد جه الأول', () => {
    const gs = groupDebtsByPerson([
      debt({ personName: 'منى سعيد' }),
      debt({ personName: 'منى سعيد', personContactId: 'c9' }),
    ]);
    expect(gs).toHaveLength(1);
    expect(gs[0].personContactId).toBe('c9');
  });
});

describe('groupDebtsByPerson — اللي لازم يفضل منفصل', () => {
  it('اسمين مختلفين فعلاً بيفضلوا شخصين', () => {
    const gs = groupDebtsByPerson([debt({ personName: 'أحمد' }), debt({ personName: 'خالد' })]);
    expect(gs).toHaveLength(2);
  });

  it('جهتين اتصال مختلفين بيفضلوا اتنين حتى لو الاسم واحد', () => {
    // شخصين بنفس الاسم فعلاً — منقدرش ندمجهم
    const gs = groupDebtsByPerson([
      debt({ personName: 'أحمد', personContactId: 'c1' }),
      debt({ personName: 'أحمد', personContactId: 'c2' }),
    ]);
    expect(gs).toHaveLength(2);
  });

  it('بيجمّع الاتجاهين مع بعض في نفس الشخص', () => {
    const gs = groupDebtsByPerson([
      debt({ personName: 'أحمد', direction: 'owed_to_me' }),
      debt({ personName: 'أحمد', direction: 'i_owe' }),
    ]);
    expect(gs).toHaveLength(1);
    expect(sizes(gs)).toEqual([2]);
  });

  it('ليست فاضية بترجّع مفيش مجموعات', () => {
    expect(groupDebtsByPerson([])).toEqual([]);
  });
});

describe('findPersonGroup', () => {
  it('بيلاقي الشخص بمفتاحه', () => {
    const list = [debt({ personName: 'أحمد', personContactId: 'c1' }), debt({ personName: 'خالد' })];
    const gs = groupDebtsByPerson(list);
    for (const g of gs) {
      expect(findPersonGroup(list, g.key)?.displayName).toBe(g.displayName);
    }
  });

  it('المفتاح بيبقى ثابت مهما اتغيّر ترتيب الديون', () => {
    const a = debt({ personName: 'أحمد', personContactId: 'c1' });
    const b = debt({ personName: 'أحمد' });
    const k1 = groupDebtsByPerson([a, b])[0].key;
    const k2 = groupDebtsByPerson([b, a])[0].key;
    expect(k1).toBe(k2);
    expect(k1).toBe('contact:c1');
  });

  it('بيرجّع undefined لو الشخص مالوش ديون خلاص', () => {
    expect(findPersonGroup([], 'name:أحمد')).toBeUndefined();
    expect(findPersonGroup([debt({ personName: 'خالد' })], 'name:أحمد')).toBeUndefined();
  });
});
