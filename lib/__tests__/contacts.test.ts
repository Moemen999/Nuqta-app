import { filterContacts, makeContactEntry, normalizePhone, phoneForDisplay } from '@/lib/contacts';

const LIST = [
  makeContactEntry('1', 'أحمد محمد', ['01001234567']),
  makeContactEntry('2', 'Ahmed Aly', ['+20 100 987 6543']),
  makeContactEntry('3', 'منى سعيد', ['0100-123-4567']),
  makeContactEntry('4', 'Sara', []),
  makeContactEntry('5', 'خالد (شغل)', ['(0122) 555 0000', '+20 111 222 3333']),
  makeContactEntry('6', 'Omar KSA', ['+966 50 765 4321']),
];

const names = (q: string) => filterContacts(LIST, q).map(x => x.name);

describe('normalizePhone', () => {
  it('بيشيل المسافات والشرط والأقواس', () => {
    expect(normalizePhone('0100-123-4567')).toBe('01001234567');
    expect(normalizePhone('(0100) 123 4567')).toBe('01001234567');
    expect(normalizePhone('0100 123 4567')).toBe('01001234567');
  });

  it('بيحوّل كود مصر للصفر المحلي', () => {
    expect(normalizePhone('+20 100 123 4567')).toBe('01001234567');
    expect(normalizePhone('0020 100 123 4567')).toBe('01001234567');
    expect(normalizePhone('201001234567')).toBe('01001234567');
  });

  it('كل الصيغ بترجّع نفس الرقم', () => {
    const forms = ['+20 100 123 4567', '01001234567', '0100-123-4567', '+201001234567'];
    const out = forms.map(normalizePhone);
    expect(new Set(out).size).toBe(1);
    expect(out[0]).toBe('01001234567');
  });

  it('بيقرا الأرقام العربية والفارسية', () => {
    expect(normalizePhone('٠١٠٠١٢٣٤٥٦٧')).toBe('01001234567');
    expect(normalizePhone('۰۱۰۰۱۲۳۴۵۶۷')).toBe('01001234567');
  });

  it('بيسيب أكواد الدول التانية زي ما هي', () => {
    expect(normalizePhone('+966 50 765 4321')).toBe('966507654321');
  });

  it('بيرجّع نص فاضي لو مفيش أرقام خالص', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('مش رقم')).toBe('');
  });
});

describe('filterContacts — بحث بالاسم', () => {
  it('بحث فاضي بيرجّع نفس الليست من غير نسخة جديدة', () => {
    expect(filterContacts(LIST, '')).toBe(LIST);
    expect(filterContacts(LIST, '   ')).toBe(LIST);
  });

  it('بيلاقي الأسماء العربية بجزء من الاسم', () => {
    expect(names('محمد')).toEqual(['أحمد محمد']);
  });

  it('مش بيفرّق بين الكابيتال والسمول في الإنجليزي', () => {
    expect(names('SARA')).toEqual(['Sara']);
  });

  it('بيتجاهل المسافات الزايدة حوالين البحث', () => {
    expect(names('  منى  ')).toEqual(['منى سعيد']);
  });

  it('بيرجّع ليست فاضية لو مفيش نتيجة', () => {
    expect(filterContacts(LIST, 'زينب')).toEqual([]);
  });
});

describe('filterContacts — بحث بالرقم', () => {
  it('رقم مكتوب عادي بيلاقي المحفوظ بأي صيغة', () => {
    // نفس الرقم محفوظ مرة 01001234567 ومرة 0100-123-4567
    expect(names('01001234567')).toEqual(['أحمد محمد', 'منى سعيد']);
  });

  it('بيلاقي المحفوظ بكود الدولة لما تكتبه محلي', () => {
    expect(names('01009876543')).toEqual(['Ahmed Aly']);
  });

  it('بيلاقي المكتوب بكود الدولة لما المحفوظ محلي', () => {
    expect(names('+201001234567')).toEqual(['أحمد محمد', 'منى سعيد']);
  });

  it('بيشيل الشرط والمسافات من اللي المستخدم بيكتبه', () => {
    expect(names('0100 123 4567')).toEqual(['أحمد محمد', 'منى سعيد']);
    expect(names('0100-1234')).toEqual(['أحمد محمد', 'منى سعيد']);
  });

  it('جزء من الرقم كفاية', () => {
    expect(names('9876543')).toEqual(['Ahmed Aly']);
  });

  it('بيدوّر في كل أرقام الشخص مش الأول بس', () => {
    expect(names('01112223333')).toEqual(['خالد (شغل)']);
    expect(names('01225550000')).toEqual(['خالد (شغل)']);
  });

  it('بيلاقي رقم دولة تانية لما تكتبه محلي', () => {
    expect(names('0507654321')).toEqual(['Omar KSA']);
  });

  it('اللي مالوش رقم مبيظهرش في بحث بالأرقام', () => {
    expect(names('0100')).not.toContain('Sara');
  });

  it('الأرقام العربية في البحث بتشتغل', () => {
    expect(names('٠١٠٠٩٨٧٦٥٤٣')).toEqual(['Ahmed Aly']);
  });
});

describe('phoneForDisplay', () => {
  it('بيحطّ علامة LTR قبل الرقم عشان ميتقلبش في واجهة عربية', () => {
    expect(phoneForDisplay('+20 100 123 4567')).toBe('‎+20 100 123 4567');
  });

  it('الرقم الفاضي بيرجع فاضي من غير علامة', () => {
    expect(phoneForDisplay('')).toBe('');
  });
});
