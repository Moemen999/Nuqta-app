import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Text, TextInput } from '@/components/AppText';
import { APP_FONT, appFontFamily, setAppFontReady, tabLabelStyle, withAppFont } from '@/lib/appFont';
import { APP_FONT_SOURCES } from '@/lib/appFontSources';

/**
 * خط التطبيق — اتلقى إنه عمره ما اتطبّق: `applyGlobalFont` كان بيلف `Text.render`،
 * وفي RN 0.81 `Text` و`TextInput` دوال عادية فمحدش بينادي `.render`. السويت كلها
 * كانت خضرا والتطبيق كله بخط النظام. دلوقتي الخط بيتحط من غلاف (`components/AppText`)،
 * والاختبارات دي بتثبّت الحاجات اللي ممكن تبوّظه ساكت:
 *   1. ملف يستورد `Text` من `react-native` مباشرة (يفلت من الغلاف)
 *   2. `fontWeight` يفضل في الاستايل ← أندرويد يرسم العريض بخط النظام
 *   3. الغلاف يطلب اسم خط مش متحمّل في `useFonts` ← نفس الرجوع الساكت
 *   4. الخطوط فشلت ← الغلاف ميطلبش أسامي مش متسجّلة ويضيّع العريض
 *   5. نص جوه نص (زي <Money> جوه سطر عريض) ← الجوّاني لازم ياخد وزن اللي بره
 *
 * اللي الاختبارات دي **متقدرش** تثبته: إن الخط اترسم فعلاً على الموبايل —
 * ده بالعين على الـSamsung.
 */

const ROOT = join(__dirname, '..', '..');
const WRAPPER = 'components/AppText.tsx';
const FONT_MODULE = 'lib/appFont.ts';

function sourceFiles(): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') visit(p); }
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  ['app', 'components', 'lib', 'context', 'hooks'].forEach(d => visit(join(ROOT, d)));
  return out;
}

const rel = (p: string) => relative(ROOT, p).split(sep).join('/');
const read = (p: string) => readFileSync(p, 'utf8');
/** من غير تعليقات — الشرح في التعليقات بيذكر الأسامي الممنوعة */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** الأسامي اللي ملف بيستوردها أو بيعيد تصديرها من 'react-native' (أي علامة تنصيص، سطر أو أكتر) */
function reactNativeNames(src: string): string[] {
  return [...src.matchAll(/(?:import|export)\s*(?:type\s*)?(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]react-native['"]/g)]
    .flatMap(m => m[1].split(','))
    .map(s => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
    .filter(Boolean);
}

const files = sourceFiles().filter(f => rel(f) !== WRAPPER);

describe('الجرد: النص كله بيعدّي من الغلاف', () => {
  it('مفيش ملف برّه الغلاف بيستورد أو بيعيد تصدير Text أو TextInput من react-native', () => {
    const offenders = files
      .filter(f => reactNativeNames(code(f)).some(n => n === 'Text' || n === 'TextInput'))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('مفيش طرق تانية تفلت من الجرد: import كله، require، مسار جوه react-native، Animated.Text', () => {
    const bypass = [
      /import\s+(?:\*\s+as\s+)?\w+\s+from\s+['"]react-native['"]/, // import RN / import * as RN
      /require\(\s*['"]react-native['"]\s*\)/,
      /from\s+['"]react-native\/Libraries\/(?:Text|Components\/TextInput)/,
      /\bAnimated\.Text\b|createAnimatedComponent\(\s*(?:Text|TextInput)\b/,
    ];
    const offenders = files.filter(f => bypass.some(re => re.test(code(f)))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('مفيش fontFamily برّه lib/appFont.ts (خط صريح بيتساب بوزنه ويرجع لخط النظام)', () => {
    const offenders = files.filter(f => rel(f) !== FONT_MODULE && /\bfontFamily\b/.test(code(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('الجرد بيلاقي حاجة أصلاً: الشاشات بتستورد من الغلاف', () => {
    const users = files.filter(f => read(f).includes("from '@/components/AppText'"));
    expect(users.length).toBeGreaterThanOrEqual(48);
  });

  it('applyGlobalFont اتشال ومحدش بيناديه', () => {
    const offenders = files.filter(f => /applyGlobalFont\(|lib\/applyGlobalFont['"]/.test(code(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('الوزن ← ملف الخط', () => {
  it.each([
    ['bold', APP_FONT.bold], ['700', APP_FONT.bold], ['800', APP_FONT.bold], ['900', APP_FONT.bold],
    ['500', APP_FONT.medium], ['600', APP_FONT.medium],
    ['400', APP_FONT.regular], ['normal', APP_FONT.regular], ['300', APP_FONT.regular], [undefined, APP_FONT.regular],
  ] as const)('%s ← %s', (weight, family) => {
    expect(appFontFamily(weight)).toBe(family);
  });
});

describe('الخطوط اتحمّلت', () => {
  beforeEach(() => setAppFontReady(true));
  afterAll(() => setAppFontReady(false));

  describe('fontWeight بيتشال من الاستايل (أندرويد بيرجع لخط النظام لو فضل)', () => {
    it.each(['bold', '700', '800', '900', '500', '600', '400', 'normal'] as const)('fontWeight %s ← مش موجود في الناتج', weight => {
      const out = withAppFont({ fontSize: 14, fontWeight: weight, color: 'red' });
      expect(out).not.toHaveProperty('fontWeight');
      expect(out).toEqual({ fontFamily: appFontFamily(weight), fontSize: 14, color: 'red' });
    });

    it('استايل مصفوفة فيها null وfalse ← بيتفرد والوزن من آخر واحد', () => {
      const out = withAppFont([{ fontWeight: '400', fontSize: 12 }, null, false, { fontWeight: '700' }]);
      expect(out).toEqual({ fontFamily: APP_FONT.bold, fontSize: 12 });
    });

    it('من غير استايل ← العادي', () => {
      expect(withAppFont(undefined)).toEqual({ fontFamily: APP_FONT.regular });
    });

    it('fontFamily صريح بيكسب وبيفضل بوزنه (خط تاني مش بتاعنا)', () => {
      expect(withAppFont({ fontFamily: 'monospace', fontWeight: '700' })).toEqual({ fontFamily: 'monospace', fontWeight: '700' });
    });

    it('StyleSheet.create بيتفرد زي الاستايل العادي', () => {
      const s = StyleSheet.create({ t: { fontWeight: '600', fontSize: 13 } });
      expect(withAppFont(s.t)).toEqual({ fontFamily: APP_FONT.medium, fontSize: 13 });
    });
  });

  describe('الغلاف نفسه بيوصّل الاستايل ده للنص الحقيقي', () => {
    it('Text عريض ← العنصر اللي بيترسم فيه ملف العريض ومفيهوش fontWeight', async () => {
      await render(<Text style={{ fontWeight: '700', fontSize: 20 }}>مرحبا</Text>);
      const style = StyleSheet.flatten(screen.getByText('مرحبا').props.style);
      expect(style.fontFamily).toBe(APP_FONT.bold);
      expect(style).not.toHaveProperty('fontWeight');
      expect(style.fontSize).toBe(20);
    });

    it('Text من غير استايل ← العادي', async () => {
      await render(<Text>عادي</Text>);
      expect(StyleSheet.flatten(screen.getByText('عادي').props.style)).toEqual({ fontFamily: APP_FONT.regular });
    });

    it('نص جوه نص عريض من غير وزن ← بياخد ملف العريض (زي Money جوه سطر عريض)', async () => {
      const Amount = () => <Text testID="amount">٥٠</Text>;
      await render(<Text style={{ fontWeight: '700' }}>المتبقي: <Amount /></Text>);
      const inner = StyleSheet.flatten(screen.getByTestId('amount').props.style);
      expect(inner.fontFamily).toBe(APP_FONT.bold);
      expect(inner).not.toHaveProperty('fontWeight');
    });

    it('نص جوه نص بوزنه هو ← وزنه هو يكسب، واللي جوّاه ياخده', async () => {
      await render(
        <Text style={{ fontWeight: '700' }}>
          أ<Text testID="mid" style={{ fontWeight: '500' }}>ب<Text testID="deep">ج</Text></Text>
        </Text>,
      );
      expect(StyleSheet.flatten(screen.getByTestId('mid').props.style).fontFamily).toBe(APP_FONT.medium);
      expect(StyleSheet.flatten(screen.getByTestId('deep').props.style).fontFamily).toBe(APP_FONT.medium);
    });

    it('نص جوه نص عادي ← عادي', async () => {
      await render(<Text>أ<Text testID="in">ب</Text></Text>);
      expect(StyleSheet.flatten(screen.getByTestId('in').props.style).fontFamily).toBe(APP_FONT.regular);
    });

    it('Text بيعدّي باقي الخصايص (numberOfLines، testID)', async () => {
      await render(<Text testID="t" numberOfLines={1}>سطر</Text>);
      expect(screen.getByTestId('t').props.numberOfLines).toBe(1);
    });

    it('TextInput متوسط ← ملف المتوسط ومفيهوش fontWeight، والـplaceholder والقيمة بيعدّوا', async () => {
      await render(<TextInput testID="in" placeholder="0" value="12" style={{ fontWeight: '600' }} />);
      const input = screen.getByTestId('in');
      const style = StyleSheet.flatten(input.props.style);
      expect(style.fontFamily).toBe(APP_FONT.medium);
      expect(style).not.toHaveProperty('fontWeight');
      expect(input.props.placeholder).toBe('0');
      expect(input.props.value).toBe('12');
    });
  });

  describe('اسم التاب (برّه الغلاف)', () => {
    it('ملف المتوسط، ومفيهوش fontWeight، والحجم زي ما كان', () => {
      expect(tabLabelStyle()).toEqual({ fontFamily: APP_FONT.medium, fontSize: 10 });
    });
  });
});

describe('الخطوط فشلت ← خط النظام بأوزانه، عن قصد', () => {
  beforeEach(() => setAppFontReady(false));

  it('الاستايل بيعدّي زي ما هو: مفيش اسم خط مش متسجّل، والعريض فاضل عريض', () => {
    expect(withAppFont({ fontWeight: '700', fontSize: 14 })).toEqual({ fontWeight: '700', fontSize: 14 });
  });

  it('Text عريض بيترسم بوزنه من غير fontFamily', async () => {
    await render(<Text style={{ fontWeight: '700' }}>عريض</Text>);
    const style = StyleSheet.flatten(screen.getByText('عريض').props.style);
    expect(style).toEqual({ fontWeight: '700' });
  });

  it('اسم التاب بحجمه ووزنه، من غير خط', () => {
    expect(tabLabelStyle()).toEqual({ fontSize: 10, fontWeight: '500' });
  });
});

describe('كل اسم بيطلبه الغلاف متحمّل في useFonts', () => {
  const produced = new Set(['bold', '700', '800', '900', '500', '600', '400', 'normal', undefined].map(w => appFontFamily(w as any)));

  it('كل اسم ممكن يطلع من الغلاف مفتاح في APP_FONT_SOURCES', () => {
    for (const family of produced) expect(Object.keys(APP_FONT_SOURCES)).toContain(family);
  });

  it('مفاتيح APP_FONT_SOURCES هي APP_FONT بالظبط، وكل واحد ليه ملف', () => {
    expect(Object.keys(APP_FONT_SOURCES).sort()).toEqual(Object.values(APP_FONT).sort());
    for (const v of Object.values(APP_FONT_SOURCES)) expect(v).toBeTruthy();
  });

  it('app/_layout.tsx بيحمّل APP_FONT_SOURCES نفسه، وبيقول للغلاف النتيجة قبل ما يرسم', () => {
    const src = read(join(ROOT, 'app', '_layout.tsx'));
    expect(src).toContain('useFonts(APP_FONT_SOURCES)');
    expect(src).toContain('setAppFontReady(fontsLoaded && !fontError)');
  });

  it('app/(tabs)/_layout.tsx بيستخدم tabLabelStyle() في tabBarLabelStyle', () => {
    expect(read(join(ROOT, 'app', '(tabs)', '_layout.tsx'))).toContain('tabBarLabelStyle: tabLabelStyle()');
  });
});
