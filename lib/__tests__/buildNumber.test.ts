import { fullVersionLabel } from '@/lib/appInfo';

/**
 * رقم البناء = run_number بتاع GitHub Actions ناقص إزاحة، بصفر على الشمال.
 *
 * أوتو-إنكريمنت بتاع EAS مبيشتغلش مع `eas build --local` (ردّ Expo:
 * "the `local` flag isn't intended to support all `remote` features")،
 * فالعدّاد بقى عدّاد GitHub. المنطق نفسه في `app.config.js` عشان يشتغل وقت
 * البناء قبل ما التطبيق يشتغل، والاختبارات دي بتستدعيه من هناك مباشرةً.
 */

// نفس المنطق اللي في app.config.js — بنستدعيه بدل ما نعيد كتابته
function loadConfig(runNumber?: string) {
  jest.resetModules();
  const prev = process.env.NUQTA_RUN_NUMBER;
  if (runNumber === undefined) delete process.env.NUQTA_RUN_NUMBER;
  else process.env.NUQTA_RUN_NUMBER = runNumber;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../../app.config.js')({ config: {} });
  } finally {
    if (prev === undefined) delete process.env.NUQTA_RUN_NUMBER;
    else process.env.NUQTA_RUN_NUMBER = prev;
  }
}

describe('versionCode ورقم البناء المعروض', () => {
  it('versionCode هو run_number زي ما هو — بيزيد مع كل بناء', () => {
    expect(loadConfig('5').android.versionCode).toBe(5);
    expect(loadConfig('6').android.versionCode).toBe(6);
    expect(loadConfig('120').android.versionCode).toBe(120);
  });

  it('أول بناء بعد الربط بيطلع 000', () => {
    expect(loadConfig('5').extra.buildNumber).toBe('000');
  });

  it('بيعدّ واحد واحد بعد كده', () => {
    expect(loadConfig('6').extra.buildNumber).toBe('001');
    expect(loadConfig('7').extra.buildNumber).toBe('002');
    expect(loadConfig('15').extra.buildNumber).toBe('010');
  });

  it('الصفر على الشمال بيكبر لوحده بعد 999 — مبيقصّش', () => {
    expect(loadConfig('1004').extra.buildNumber).toBe('999');
    expect(loadConfig('1005').extra.buildNumber).toBe('1000');
    expect(loadConfig('10005').extra.buildNumber).toBe('10000');
  });

  it('أقل من الإزاحة مرفوض — العدّاد اترجّع، والأرقام هتتكرر مع بناءات قديمة', () => {
    expect(() => loadConfig('4')).toThrow();
    expect(() => loadConfig('1')).toThrow();
    expect(() => loadConfig('0')).toThrow();
  });

  it('أي حاجة مش رقم صحيح مرفوضة', () => {
    expect(() => loadConfig('abc')).toThrow();
    expect(() => loadConfig('7.5')).toThrow();
  });

  it('من غير المتغيّر (جهاز مطوّر) بيرجّع dev من غير ما يقع', () => {
    const c = loadConfig(undefined);
    expect(c.extra.buildNumber).toBe('dev');
    expect(c.android.versionCode).toBe(1);
  });

  it('الإعدادات الأصلية بتفضل زي ما هي', () => {
    jest.resetModules();
    process.env.NUQTA_RUN_NUMBER = '9';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const c = require('../../app.config.js')({ config: { name: 'نقطة', android: { package: 'com.nuqta.app' } } });
    expect(c.name).toBe('نقطة');
    expect(c.android.package).toBe('com.nuqta.app');
    delete process.env.NUQTA_RUN_NUMBER;
  });
});

describe('fullVersionLabel', () => {
  it('الإصدار والبناء في رقم واحد', () => {
    expect(fullVersionLabel('1.0.0', '000')).toBe('1.0.0.000');
    expect(fullVersionLabel('1.2.3', '017')).toBe('1.2.3.017');
  });

  it('العدّاد مبيترجعش لما الإصدار يتغيّر — هو رقم بناء مش رقم إصدار', () => {
    expect(fullVersionLabel('1.0.0', '042')).toBe('1.0.0.042');
    expect(fullVersionLabel('2.0.0', '043')).toBe('2.0.0.043');
  });

  it('على جهاز مطوّر بيبان dev بدل رقم', () => {
    expect(fullVersionLabel('1.0.0', 'dev')).toBe('1.0.0.dev');
  });
});
