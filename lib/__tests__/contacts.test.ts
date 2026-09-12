import { filterContacts, type ContactEntry } from '@/lib/contacts';

function c(name: string, phone = ''): ContactEntry {
  return { id: name, name, phone };
}

const LIST = [
  c('أحمد محمد', '01001234567'),
  c('Ahmed Aly', '+20 100 987 6543'),
  c('منى سعيد', '0100-111-2222'),
  c('Sara', ''),
];

describe('filterContacts — بحث بالاسم', () => {
  it('بحث فاضي بيرجّع نفس الليست من غير نسخة جديدة', () => {
    expect(filterContacts(LIST, '')).toBe(LIST);
    expect(filterContacts(LIST, '   ')).toBe(LIST);
  });

  it('بيلاقي الأسماء العربية بجزء من الاسم', () => {
    expect(filterContacts(LIST, 'أحمد').map(x => x.name)).toEqual(['أحمد محمد']);
    expect(filterContacts(LIST, 'محمد').map(x => x.name)).toEqual(['أحمد محمد']);
  });

  it('مش بيفرّق بين الكابيتال والسمول في الإنجليزي', () => {
    expect(filterContacts(LIST, 'ahmed').map(x => x.name)).toEqual(['Ahmed Aly']);
    expect(filterContacts(LIST, 'SARA').map(x => x.name)).toEqual(['Sara']);
  });

  it('بيتجاهل المسافات الزايدة حوالين البحث', () => {
    expect(filterContacts(LIST, '  منى  ').map(x => x.name)).toEqual(['منى سعيد']);
  });

  it('بيرجّع ليست فاضية لو مفيش نتيجة', () => {
    expect(filterContacts(LIST, 'خالد')).toEqual([]);
  });
});
