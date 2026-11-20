import {
  HERO_LOADING_TEXT, HERO_WAITING_TEXT, RECENT_EMPTY_TEXT, figuresSettled, figuresUnsure, heroFailedText, heroFigures, heroLabel,
  outboxLinePhrase, recentEmptyText,
} from '@/lib/homeFigures';

/**
 * رقم الرئيسية البطل وشرايح المحافظ (مراجعة التطبيق كله، الميزة 7 — HIGH): الرصيد بيتحسب من المحافظ **والعمليات**،
 * فلو العمليات لسه ما وصلتش كان الرصيد الافتتاحي بيتعرض على إنه الرصيد دلوقتي، ولو listener وقع كان الرقم الغلط
 * بيفضل من غير علامة متتقفلش. الحالات هنا بتقرر إيه اللي يتعرض مكان الرقم.
 */
describe('heroFigures', () => {
  it('كاش بارد ← قديم (بيكسب على «بنحمّل» و«مستنيين النت»: آخر أرقام معروفة أحسن من فاضي)', () => {
    expect(heroFigures({ cold: true, loadErrors: [], figuresPending: ['transactions'] })).toEqual({ kind: 'cold' });
    expect(heroFigures({ cold: true, loadErrors: [], figuresPending: ['transactions'], waitingNet: true })).toEqual({ kind: 'cold' });
  });
  it('M1 (جولة 2): العمليات أو المحافظ وقعت ← «ناقص» حتى لو فيه كاش (الفشل قبل الكاش)', () => {
    expect(heroFigures({ cold: true, loadErrors: ['transactions'], figuresPending: ['transactions'] })).toEqual({ kind: 'failed', missing: ['transactions'] });
    expect(heroFigures({ cold: true, loadErrors: ['wallets'], figuresPending: [] })).toEqual({ kind: 'failed', missing: ['wallets'] });
    expect(heroFigures({ cold: true, loadErrors: ['debts'], figuresPending: [] })).toEqual({ kind: 'cold' });
  });
  it('H1-A (جولة 2): العمليات ما وصلتش من السيرفر ومفيش نت ومفيش كاش ← «مستنيين النت» مش 0', () => {
    expect(heroFigures({ cold: false, loadErrors: [], figuresPending: ['transactions'], waitingNet: true })).toEqual({ kind: 'waiting' });
    // النت شغال ← لسه بنحمّل
    expect(heroFigures({ cold: false, loadErrors: [], figuresPending: ['transactions'], waitingNet: false })).toEqual({ kind: 'loading' });
    // وصلت ← الرقم حتى من غير نت (اتشافت من السيرفر في الجلسة دي)
    expect(heroFigures({ cold: false, loadErrors: [], figuresPending: [], waitingNet: true })).toEqual({ kind: 'live' });
    expect(heroLabel({ kind: 'waiting' }, true)).toBe('إجمالي رصيدك');
    expect(HERO_WAITING_TEXT).toBe('مستنيين النت عشان نجيب رصيدك');
  });
  it('العمليات أو المحافظ وقعت ← ناقص بأساميهم (الديون مش جوه الرصيد)', () => {
    expect(heroFigures({ cold: false, loadErrors: ['transactions'], figuresPending: [] })).toEqual({ kind: 'failed', missing: ['transactions'] });
    expect(heroFigures({ cold: false, loadErrors: ['debts', 'wallets'], figuresPending: ['wallets'] })).toEqual({ kind: 'failed', missing: ['wallets'] });
    expect(heroFigures({ cold: false, loadErrors: ['debts'], figuresPending: [] })).toEqual({ kind: 'live' });
  });
  it('العمليات أو المحافظ لسه بتوصل ← بنحمّل (مش رصيد افتتاحي على إنه الرصيد)', () => {
    expect(heroFigures({ cold: false, loadErrors: [], figuresPending: ['transactions'] })).toEqual({ kind: 'loading' });
    expect(heroFigures({ cold: false, loadErrors: [], figuresPending: ['wallets', 'transactions'] })).toEqual({ kind: 'loading' });
  });
  it('الاتنين وصلوا ← الرقم. figuresPending مش موجود (اختبارات قديمة) = وصلوا', () => {
    expect(heroFigures({ cold: false, loadErrors: [], figuresPending: [] })).toEqual({ kind: 'live' });
    expect(heroFigures({ cold: false, loadErrors: [], figuresPending: undefined })).toEqual({ kind: 'live' });
  });
});

describe('heroLabel — علامة جنب الإجمالي متتقفلش', () => {
  it('قديم / ناقص / ممكن يكون قديم / من غير', () => {
    expect(heroLabel({ kind: 'cold' }, false)).toBe('إجمالي رصيدك (قديم)');
    expect(heroLabel({ kind: 'failed', missing: ['transactions'] }, false)).toBe('إجمالي رصيدك (ناقص)');
    expect(heroLabel({ kind: 'live' }, true)).toBe('إجمالي رصيدك (ممكن يكون قديم)');
    expect(heroLabel({ kind: 'live' }, false)).toBe('إجمالي رصيدك');
    expect(heroLabel({ kind: 'loading' }, false)).toBe('إجمالي رصيدك');
  });
  it('نص الفشل بيسمّي اللي ما وصلش، والتحميل', () => {
    expect(heroFailedText(['wallets', 'transactions'])).toBe('مقدرناش نجيب المحافظ والعمليات');
    expect(heroFailedText(['transactions'])).toBe('مقدرناش نجيب العمليات');
    expect(HERO_LOADING_TEXT).toBe('بنحمّل…');
  });
});

describe('figuresUnsure / figuresSettled', () => {
  it('unsure: واحد منهم وقع أو لسه بيوصل', () => {
    expect(figuresUnsure([], [])).toBe(false);
    expect(figuresUnsure(undefined as never, undefined)).toBe(false);
    expect(figuresUnsure(['transactions'], [])).toBe(true);
    expect(figuresUnsure(['wallets'], [])).toBe(true);
    expect(figuresUnsure([], ['transactions'])).toBe(true);
    expect(figuresUnsure(['debts'], [])).toBe(false);
  });
  it('«الأرقام اتحدّثت» بس لما الأرقام من السيرفر والاتنين وصلوا ومفيش حاجة وقعت', () => {
    expect(figuresSettled({ figuresFromServer: true, loadErrors: [], figuresPending: [] })).toBe(true);
    expect(figuresSettled({ figuresFromServer: false, loadErrors: [], figuresPending: [] })).toBe(false);
    expect(figuresSettled({ figuresFromServer: true, loadErrors: [], figuresPending: ['transactions'] })).toBe(false);
    expect(figuresSettled({ figuresFromServer: true, loadErrors: ['transactions'], figuresPending: [] })).toBe(false);
  });
});

describe('outboxLinePhrase — عمليات على الموبايل ولسه ما اترفعتش', () => {
  it.each([
    [1, 'عندك عملية واحدة متسجلة على الموبايل ولسه ما اترفعتش'],
    [2, 'عندك عمليتين متسجلين على الموبايل ولسه ما اترفعوش'],
    [3, 'عندك 3 عمليات متسجلة على الموبايل ولسه ما اترفعتش'],
    [11, 'عندك 11 عملية متسجلة على الموبايل ولسه ما اترفعتش'],
  ])('%d ← %s', (n, text) => {
    expect(outboxLinePhrase(n)).toBe(text);
  });
  it('صفر ← مفيش سطر', () => { expect(outboxLinePhrase(0)).toBe(''); expect(outboxLinePhrase(0, { online: true })).toBe(''); });
  it('M4 (جولة 2): والنت شغال (الإعادة وقفت) ← مفيش «مفيش نت»، وبنقول إننا هنجرب تاني', () => {
    expect(outboxLinePhrase(1, { online: true })).toBe('عندك عملية واحدة متسجلة على الموبايل ولسه ما اترفعتش — هنجرب نرفعها تاني لما تفتح التطبيق');
    expect(outboxLinePhrase(2, { online: true })).toBe('عندك عمليتين متسجلين على الموبايل ولسه ما اترفعوش — هنجرب نرفعهم تاني لما تفتح التطبيق');
    expect(outboxLinePhrase(4, { online: true })).toBe('عندك 4 عمليات متسجلة على الموبايل ولسه ما اترفعتش — هنجرب نرفعهم تاني لما تفتح التطبيق');
    expect(outboxLinePhrase(4, { online: true })).not.toMatch(/نت/);
  });
});

describe('recentEmptyText — «آخر العمليات» فاضية', () => {
  const base = { loadWindowPassed: true, txFailed: false, offlineEmpty: false, txPending: false };
  it('قبل مهلة التحميل أو العمليات لسه بتوصل ← ولا كلمة', () => {
    expect(recentEmptyText({ ...base, loadWindowPassed: false })).toBeNull();
    expect(recentEmptyText({ ...base, txPending: true })).toBeNull();
  });
  it('العمليات وقعت ← ما وصلتش (مش «لسه ما سجلتش»)', () => {
    expect(recentEmptyText({ ...base, txFailed: true })).toBe(RECENT_EMPTY_TEXT.failed);
    expect(RECENT_EMPTY_TEXT.failed).toBe('عملياتك ما وصلتش من السيرفر — مش ضايعة. دوس "جرّب تاني" فوق.');
  });
  it('مفيش نت ← مستنيين النت؛ غير كده ← لسه ما سجلتش', () => {
    expect(recentEmptyText({ ...base, offlineEmpty: true })).toBe('مستنيين النت عشان نجيب عملياتك');
    expect(recentEmptyText(base)).toBe('لسه ما سجلتش أي عملية');
  });
});
