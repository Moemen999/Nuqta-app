import { requestReports, takeReportsRequest } from '@/lib/reportsRequest';

describe('reportsRequest: طلب واحد بيتاخد مرة', () => {
  beforeEach(() => { takeReportsRequest(); });

  it('من غير طلب ← null', () => {
    expect(takeReportsRequest()).toBeNull();
  });
  it('بيرجع مرة واحدة وبعدين مفيش', () => {
    requestReports({ preset: 'thisMonth', clearFilter: true });
    expect(takeReportsRequest()).toEqual({ preset: 'thisMonth', clearFilter: true });
    expect(takeReportsRequest()).toBeNull();
  });
  it('طلب جديد بيحل محل القديم (واحد معلّق بالكتير)', () => {
    requestReports({ preset: 'last7', clearFilter: false });
    requestReports({ preset: 'thisMonth', clearFilter: true });
    expect(takeReportsRequest()).toEqual({ preset: 'thisMonth', clearFilter: true });
    expect(takeReportsRequest()).toBeNull();
  });
  it('تعديل الكائن اللي اتبعت بعد التسجيل مبيغيّرش الطلب', () => {
    const req = { preset: 'thisMonth' as const, clearFilter: true };
    requestReports(req);
    req.clearFilter = false;
    expect(takeReportsRequest()?.clearFilter).toBe(true);
  });
});
