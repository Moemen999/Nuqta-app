import { readFileSync } from 'fs';

/**
 * **حذف سجل بكل عملياته لازم يفضل شغّال من غير نت.**
 *
 * `deleteDebt` و`deleteSubscription` و`deleteGamiya` بيمسحوا كل العمليات
 * المالية المولّدة من السجل وبعدين السجل نفسه. وده كان مكتوب:
 *
 *     await Promise.all(txIds.map(txId => deleteTransactionDoc(txId)));
 *
 * الشكل ده بيقرا كإنه بيستنى تأكيد السيرفر على كل حذفة. وهو عمليًا مكانش
 * بيستنى — `deleteTransactionDoc` كانت بترمي وعد `track` وترجع على طول —
 * بس ده كان **بالصدفة**: أول واحد يعمل "تنضيفة" ويخلي الدالة ترجّع وعدها
 * (وده التعديل الطبيعي اللي أي حد هيعمله) بيولّد على طول مصيدة "الزرار
 * بيفضل بيلف للأبد" المكتوبة في `CLAUDE.md` — والتلات شاشات بتلفّ الحذف في
 * `runBusy`، اللي بيقفل الزرار بـ`ref` وبيفكّه في `finally` مبتوصلش.
 *
 * والشكل ده كان كمان بيسيب الحذف **مش ذري**: العمليات بتتمسح واحدة واحدة،
 * والسجل نفسه في كتابة تالتة منفصلة.
 *
 * الشكل المتفق عليه دلوقتي: دفعة واحدة (`writeBatch`) فيها كل العمليات
 * والسجل، بتتبعت بـ`track(...)` **من غير `await`** — بتتكتب محليًا على طول،
 * والـ`onSnapshot` بيرد فورًا، والرفع بيحصل لوحده لما النت يرجع.
 *
 * الاختبار ده بيقرا `DataContext.tsx` نفسه ويرفض رجوع النمط القديم.
 *
 * **وهو حارس أسماء، مش حارس سلوك.** بيمسك الرجوع الحرفي للنمط القديم —
 * `await Promise.all(...)`، و`await deleteTransactionDoc`، وغياب المساعد.
 * حد يكتب نفس المنطق بأسامي تانية (`await all;` بعد متغيّر وسيط، أو مساعد
 * باسم جديد) هيعدّي منه. ده مقبول لأنه خط الدفاع الأول ضد **الرجوع**، مش
 * إثبات الصحة — بس متعتمدش عليه لوحده وانت بتعيد هيكلة الحذف.
 */

const SOURCE = readFileSync('context/DataContext.tsx', 'utf8');

/**
 * التعليقات بتتشال قبل الفحص. من غير كده الاختبار بيقع على نفسه: التعليق اللي
 * فوق المساعد بيقتبس النمط القديم بالحرف عشان يشرح ليه اتشال
 */
const CODE = SOURCE.split('\n')
  .filter(line => !/^\s*(\/\/|\/\*|\*)/.test(line))
  .join('\n');

const CASCADE_FUNCTIONS = ['deleteDebt', 'deleteSubscription', 'deleteGamiya'] as const;

/** بيجيب نص الدالة من سطر تعريفها لحد أول سطر بيقفل على نفس المستوى */
function bodyOf(name: string): string {
  const start = [`  async function ${name}(`, `  function ${name}(`]
    .map(sig => CODE.indexOf(sig))
    .find(at => at !== -1);
  if (start === undefined) throw new Error(`مالقيتش الدالة ${name} في DataContext.tsx`);
  const end = CODE.indexOf('\n  }\n', start);
  if (end === -1) throw new Error(`مالقيتش نهاية الدالة ${name}`);
  return CODE.slice(start, end);
}

describe('حذف السجل بكل عملياته', () => {
  it.each(CASCADE_FUNCTIONS)('%s مبتستناش تأكيد السيرفر على حذف العمليات', name => {
    const body = bodyOf(name);
    expect(body).not.toMatch(/await\s+Promise\.all/);
    expect(body).not.toMatch(/await\s+deleteTransactionDoc/);
  });

  it.each(CASCADE_FUNCTIONS)('%s بتمسح كله في دفعة واحدة', name => {
    const body = bodyOf(name);
    // دفعة واحدة بتضم العمليات والسجل — كله أو مفيش
    expect(body).toMatch(/deleteWithTransactions\(/);
  });

  it('مفيش أي دالة حذف تانية رجعت لنمط الانتظار القديم', () => {
    expect(CODE).not.toMatch(/await\s+Promise\.all\([^)]*deleteTransactionDoc/);
  });

  it('المساعد بيبعت الدفعة من غير await — الكتابة متستناش السيرفر (قاعدة 7)', () => {
    const helper = bodyOf('deleteWithTransactions');
    expect(helper).toMatch(/track\(batch\.commit\(\)/);
    expect(helper).not.toMatch(/await\s+batch\.commit/);
  });
});
