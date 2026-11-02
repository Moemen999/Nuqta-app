import { readFileSync } from 'fs';
import { everyDaysLabel, frequencyLabel } from '@/lib/frequencyLabel';

describe('everyDaysLabel — العدد بالعامية', () => {
  it.each([
    [1, 'كل يوم'],
    [2, 'كل يومين'],
    [3, 'كل 3 أيام'],
    [10, 'كل 10 أيام'],
    [11, 'كل 11 يوم'],
    [45, 'كل 45 يوم'],
    [365, 'كل 365 يوم'],
  ])('%s ← %s', (n, label) => expect(everyDaysLabel(n)).toBe(label));

  it.each([0, -3, 2.5, NaN, Infinity])('قيمة متخزّنة غلط (%s) ← "تكرار بالأيام" مش رقم غلط ولا سؤال', n => {
    expect(everyDaysLabel(n)).toBe('تكرار بالأيام');
  });
});

describe('frequencyLabel', () => {
  it('شهري / سنوي / عدد الأيام', () => {
    expect(frequencyLabel('monthly')).toBe('شهري');
    expect(frequencyLabel('yearly')).toBe('سنوي');
    expect(frequencyLabel('custom', 14)).toBe('كل 14 يوم');
    expect(frequencyLabel('custom')).toBe('تكرار بالأيام');
  });
});

it('شاشة الاشتراكات مبقاش فيها "مخصص" (الكارت والفورمين)', () => {
  expect(readFileSync('components/SubscriptionsView.tsx', 'utf8')).not.toMatch(/['>]مخصص[<']/);
});
