import fs from 'fs';
import path from 'path';
import { DEFAULT_CATEGORY_ICON, categoryLabel, categoryLabelById } from '@/lib/finance';

/**
 * الباج (بناء 1.0.0.000): شريحة الفئة بتبان فيها الأيقونة من غير الاسم —
 * في مودال العملية والتقارير، مش في كل الشاشات مع بعض، ومش كل مرة، وإعادة
 * تشغيل التطبيق بتصلّحها. الاسم في فايرستور سليم.
 *
 * قبل الأيقونات، الاسم كان كلمة واحدة («أكل») — مفيش مكان يتكسر فيه السطر.
 * `f05ee86` خلّى النص «🏷️ أكل»: **فيه مسافة عادية**، يعني مكان كسر سطر. لو
 * عرض النص اتقاس أقل بكام بكسل من اللي بيترسم، السطر بيتكسر عند المسافة:
 * الأيقونة في السطر الأول، والاسم في سطر تاني الشريحة طولها متقاس على سطر
 * واحد فبيتقص. ده بالظبط «أيقونة من غير اسم».
 *
 * **اللي مش متأكد منه:** سبب فرق المقاس نفسه. المرشّح الأقرب إن الإيموجي
 * بيترسم من خط احتياطي (Noto Color Emoji) والقياس والرسم على أندرويد مش
 * بيتفقوا عليه دايمًا — بس ده ماتشافش على الجهاز. الإصلاح مش معتمد على
 * السبب: من غير مكان كسر، أي فرق مقاس أقصى أثره قصّة صغيرة، مش اسم كامل
 * بيختفي.
 */
describe('اسم الفئة ميتفصلش عن أيقونتها', () => {
  it('بين الأيقونة والاسم مسافة مبتتكسرش (U+00A0) مش مسافة عادية', () => {
    const label = categoryLabel({ name: 'أكل', icon: '🍔' });
    expect(label).toBe('🍔\u00A0أكل');
    expect(label).not.toMatch(/^\S+ /);
  });

  it('نفس الكلام للأيقونة الافتراضية ولـ categoryLabelById', () => {
    expect(categoryLabel({ name: 'أكل' })).toBe(`${DEFAULT_CATEGORY_ICON}\u00A0أكل`);
    expect(categoryLabelById([{ id: 'c1', name: 'سفر', icon: '✈️' }], 'c1')).toBe('✈️\u00A0سفر');
  });

  it('التصدير من غير أيقونة مفيهوش أي مسافة غريبة', () => {
    expect(categoryLabel({ name: 'أكل', icon: '🍔' }, { icon: false })).toBe('أكل');
  });
});

const ROOT = path.join(__dirname, '..', '..');
const SOURCE_DIRS = ['app', 'components'];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(p);
    return /\.tsx$/.test(e.name) ? [p] : [];
  });
}
/**
 * الحزام التاني: حتى لو الاسم نفسه كلمتين («فواتير البيت») وفيه مسافة جواه،
 * الشريحة بتقص بـ«…» بدل ما سطر كامل يختفي.
 *
 * والقص **من النص** مش من الآخر: اللاحقة «(مؤرشفة)» في آخر النص، والفئة
 * المؤرشفة بتظهر في الاختيار لو هي المختارة في سجل قديم. قص من الآخر كان
 * هيشيل اللاحقة ويخلي المؤرشفة شكلها عادية — والأيقونة في الأول، فالنص هو
 * أقل حتة معلومة.
 *
 * **حدود الفحص:** بيمسك `<Text ...>{categoryLabel(` المكتوبة مباشرة بس. لو
 * الاسم اتحط في متغيّر الأول، أو اتعرض بـ `categoryLabelById` (سطور الرئيسية
 * والأرشيف والديون — دي سطور بتلف لسطر تاني مش شرايح بطول ثابت)، الفحص ده
 * مش هيشوفه.
 */
describe('نص شريحة الفئة المكتوب مباشرة: سطر واحد، والقص من النص', () => {
  const offenders: string[] = [];
  for (const d of SOURCE_DIRS) {
    for (const file of sourceFiles(path.join(ROOT, d))) {
      const src = fs.readFileSync(file, 'utf8');
      const re = /<Text\b([^>]*)>\{categoryLabel\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (!/numberOfLines=\{1\}/.test(m[1]) || !/ellipsizeMode="middle"/.test(m[1])) {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${path.relative(ROOT, file)}:${line}`);
        }
      }
    }
  }
  it('كل واحدة فيها numberOfLines={1} و ellipsizeMode="middle"', () => {
    expect(offenders).toEqual([]);
  });
  it('الفحص لقى شرايح أصلاً (مش بيعدّي عشان مفيش حاجة يفحصها)', () => {
    const count = SOURCE_DIRS.flatMap(d => sourceFiles(path.join(ROOT, d)))
      .map(f => (fs.readFileSync(f, 'utf8').match(/>\{categoryLabel\(/g) || []).length)
      .reduce((a, b) => a + b, 0);
    expect(count).toBeGreaterThanOrEqual(7);
  });
});
