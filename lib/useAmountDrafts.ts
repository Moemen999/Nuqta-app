import { planWalletAmountCommit, type WalletAmountPlan } from '@/lib/finance';
import { useEffect, useRef, useState } from 'react';
import { useConfirm } from '@/components/ConfirmProvider';

export const NEGATIVE_CONFIRM_TITLE = 'رصيد بالسالب؟';
export const NEGATIVE_CONFIRM_BODY = 'ده معناه إن عليك فلوس في المحفظة دي، زي كارت الائتمان.';
export const NEGATIVE_CONFIRM_YES = 'أيوه، سالب';
export const NEGATIVE_CONFIRM_NO = 'عدّل الرقم';

/** نفس مهلة BudgetView — بنحفظ بعد ثانية من آخر حرف */
export const AUTOSAVE_DELAY_MS = 1000;

/** الفروق المسموح بيها بين خانة وخانة — أي حاجة غير دي بتبقى نسخة تانية */
export type AmountDraftOptions = {
  /**
   * القاعدة اللي بتقرر الخانة تعمل إيه. الافتراضي قاعدة المحفظة (سالب
   * بتأكيد). الميزانية وشخبطة بيبعتوا قواعدهم — ودي **الفرق الحقيقي
   * الوحيد** اللي كان مانع توحيد التلات نسخ.
   */
  plan?: (draft: string | undefined, stored: number) => WalletAmountPlan;
  /**
   * صفر محفوظ يتعرض خانة فاضية بدل "0".
   *
   * رصيد محفظة بصفر هو صفر فعلاً، فبيتعرض "0". لكن ميزانية بصفر أو دخل
   * شهر بصفر معناهم "لسه ماتحددش" — و"0" هناك بيبان كأن المستخدم اختاره.
   */
  blankWhenZero?: boolean;
  /**
   * نص التأكيد لما الخطة ترجّع `confirm` — الافتراضي سؤال "رصيد بالسالب؟". الرصيد الابتدائي بيبعت نصه هو (أي تغيير
   * بيسأل، الاختبار العنيف 2026-11-07: دوسة غلط كانت بتغيّر الرصيد كله ساكت)
   */
  confirmCopy?: (id: string, value: number, stored: number) => { title: string; body: string; yes: string; no: string };
  /**
   * مسوّدة مستنية تأكيد والشاشة اتشالت (رجوع، تاب تاني) — مبتتكتبش، فالشاشة لازم تقول (رسالة برّه الشاشة) بدل ما
   * تضيع ساكت (silent-failure-hunter + money-reviewer 2026-11-07)
   */
  onDroppedConfirm?: (id: string, value: number) => void;
};

/**
 * خانة رقم فلوس بتتحفظ لوحدها — رصيد محفظة، سقف ميزانية، دخل شهر، نسبة.
 *
 * كل المنطق هنا مش في الشاشة، لسببين: الأول إنه يتختبر من غير ما نعمل render
 * لأي شاشة، والتاني إن الخانات دي كلها بتستخدم نفس الكلام بالظبط.
 *
 * كان فيه **تلات نسخ** من نفس الفكرة (هنا، وBudgetView، وShakhbataView)،
 * وكل نسخة اتصلحت لوحدها — عشان كده باگ `Number(x) || 0` عاش في شخبطة بعد
 * ما اتصلح في المحافظ. دلوقتي نسخة واحدة، والفرق الحقيقي الوحيد (قاعدة
 * التحقق) بقى بارامتر مش نسخة تانية من الملف.
 *
 * بتجمّع تلات قواعد مع بعض:
 *
 * 1. **الخروج من الخانة مبيكتبش لو مفيش تغيير.** لا مسوّدة أصلاً، ولا رقم
 *    طالع زي المحفوظ — الاتنين مفيش كتابة. قبل كده كان كل خروج من الخانة
 *    بيبعت كتابة لفايربيز حتى لو مفيش حاجة اتغيرت.
 *
 * 2. **الكلام اللي مش رقم مترفوض مش متحوّل لصفر.** الخانة بترجع لآخر قيمة
 *    محفوظة، والمستخدم يشوف إن اللي كتبه مادخلش.
 *
 * 3. **القاعدة نفسها بارامتر.** المحفظة بتسمح بالسالب بتأكيد
 *    (`planWalletAmountCommit`)، والميزانية والدخل بيرفضوا السالب من أصله
 *    (`planBudgetCommit`). والنسب في شخبطة ليها زرار حفظ صريح فبتتحقق
 *    هناك بـ`parsePercentInput` مش عن طريق الهوك.
 *
 * وعلى نمط BudgetView: المسوّدة بتتحفظ لوحدها بعد ثانية من آخر حرف، وأي
 * مسوّدة فاضلة بتتحفظ وقت ما الشاشة تتشال — عشان تبديل التاب أو الرجوع
 * وانت لسه كاتب مايضيعش الرقم (React Native مبيبعتش onBlur وقت الإزالة).
 *
 * الحفظ التلقائي ده **مبيلفش حوالين قاعدة 3**: بيكتب الأكيد بس. رقم لسه ناقص
 * ("-" لوحدها) مش غلط — هو نص طريق، فمنمسحوش من تحت إيد المستخدم وهو بيكتب.
 * والسالب بيستنى إجابة المستخدم، مبيتكتبش ورا ضهره ولا بيفتح ديالوج فجأة وهو
 * لسه بيكتب.
 */
export function useAmountDrafts(
  storedFor: (id: string) => number,
  write: (id: string, value: number) => void,
  opts: AmountDraftOptions = {},
) {
  const plan = opts.plan ?? planWalletAmountCommit;
  const blankWhenZero = opts.blankWhenZero ?? false;
  const confirm = useConfirm();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const pending = useRef<Record<string, string>>({});

  // المؤقت وflush الخروج بيشتغلوا بعد ما الـrender اللي عملهم يخلص، فلو
  // قفلوا على نسخة قديمة من المحافظ هيقارنوا بقيمة قديمة. الـref بيخليهم
  // يقروا آخر نسخة دايمًا.
  // `plan` داخل الـref كمان: الاستدعاءات الحالية كلها بتبعت دوال ثابتة من
  // `lib/finance.ts`، بس لو حد بعدين بعت دالة متعرّفة جوه الكومبوننت،
  // المؤقّت وflush الخروج كانوا هيمسكوا نسخة قديمة منها من غير ما حد ياخد باله.
  const latest = useRef({ storedFor, write, plan, onDroppedConfirm: opts.onDroppedConfirm });
  useEffect(() => { latest.current = { storedFor, write, plan, onDroppedConfirm: opts.onDroppedConfirm }; });

  function clearDraft(id: string) {
    setDrafts(d => {
      if (d[id] === undefined) return d;
      const next = { ...d };
      delete next[id];
      return next;
    });
  }

  /** الكتابة دايمًا بتشيل المسوّدة معاها، فالخانة ترجع تقرا من المصدر الحقيقي */
  function commitWrite(id: string, value: number) {
    clearDraft(id);
    latest.current.write(id, value);
  }

  /** الحفظ التلقائي. بيرجّع true لو خلص الموضوع فعلاً */
  function autoCommit(id: string, raw: string): boolean {
    const p = latest.current.plan(raw, latest.current.storedFor(id));
    if (p.action !== 'write') return false;
    commitWrite(id, p.value);
    return true;
  }

  useEffect(() => {
    const entries = Object.entries(pending.current);
    if (entries.length === 0) return;
    const t = setTimeout(() => {
      entries.forEach(([id, raw]) => {
        if (autoCommit(id, raw)) delete pending.current[id];
      });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts]);

  useEffect(() => {
    const held = pending;
    return () => {
      Object.entries(held.current).forEach(([id, raw]) => {
        // مفيش setState ولا ديالوج والشاشة بتتشال — فبنكتب الأكيد بس
        const p = latest.current.plan(raw, latest.current.storedFor(id));
        if (p.action === 'write') latest.current.write(id, p.value);
        else if (p.action === 'confirm') latest.current.onDroppedConfirm?.(id, p.value);
      });
      held.current = {};
    };
  }, []);

  /** صفر محفوظ بيتعرض "0" — مش خانة فاضية تخلي المستخدم يحزر (إلا لو `blankWhenZero`) */
  function valueFor(id: string, stored: number) {
    if (drafts[id] !== undefined) return drafts[id];
    const value = isFinite(stored) ? stored : 0;
    if (blankWhenZero && value === 0) return '';
    return String(value);
  }

  /**
   * الرقم اللي المستخدم شايفه دلوقتي: المسوّدة لو صالحة، وإلا المحفوظ.
   *
   * مسوّدة نص طريق أو كلام مش رقم **مبتديش صفر** — بتسيب المحفوظ زي ما هو.
   * ده مهم للمعاينة الحيّة (شريط الميزانية، دلاء شخبطة): قبل كده كانت
   * `Number(draft) || 0` بتوري المستخدم أهداف بصفر وهو لسه بيمسح الرقم.
   */
  function numberFor(id: string, stored: number) {
    const current = isFinite(stored) ? stored : 0;
    const raw = drafts[id];
    if (raw === undefined) return current;
    const p = plan(raw, current);
    return p.action === 'write' || p.action === 'confirm' ? p.value : current;
  }

  function onChange(id: string, raw: string) {
    setDrafts(d => ({ ...d, [id]: raw }));
    pending.current[id] = raw;
  }

  function onBlur(id: string) {
    delete pending.current[id];
    const raw = drafts[id];
    if (raw === undefined) return;

    const p = plan(raw, latest.current.storedFor(id));
    if (p.action === 'none' || p.action === 'reject') { clearDraft(id); return; }
    if (p.action === 'write') { commitWrite(id, p.value); return; }

    const confirmed = p.value;
    // حد معروف (silent-failure-hunter): التطبيق اتقفل والتأكيد مفتوح، أو الـblur جه من القفل نفسه ←
    // التأكيد بيتلغي فـ"لأ" بتمسح المسوّدة السالبة. مفيش كتابة، والخانة بترجع للرقم المتخزّن
    const shownStored = latest.current.storedFor(id);
    const copy = opts.confirmCopy?.(id, confirmed, shownStored)
      ?? { title: NEGATIVE_CONFIRM_TITLE, body: NEGATIVE_CONFIRM_BODY, yes: NEGATIVE_CONFIRM_YES, no: NEGATIVE_CONFIRM_NO };
    confirm(copy.title, copy.body, [
      { text: copy.no, style: 'cancel', onPress: () => clearDraft(id) },
      {
        text: copy.yes,
        onPress: () => {
          // الرقم اتغيّر من جهاز تاني والتأكيد مفتوح ← منكتبش على كلام المستخدم اللي اتبنى على رقم قديم (money-reviewer)
          const now = latest.current.storedFor(id);
          if (!(Object.is(now, shownStored) || now === shownStored)) return;
          commitWrite(id, confirmed);
        },
      },
      // اتقفل لوحده (قفل التطبيق، رجوع) ← المسوّدة **بتفضل** في الخانة ومعاها سطر "لسه ما اتحفظش"
    ], { key: `confirm_${id}`, onDismiss: () => {} });
  }

  /** فيه رقم مكتوب مستني تأكيد (عشان الشاشة تكتب "لسه ما اتحفظش") */
  function pendingConfirm(id: string) {
    const raw = drafts[id];
    return raw !== undefined && plan(raw, latest.current.storedFor(id)).action === 'confirm';
  }

  return { valueFor, numberFor, onChange, onBlur, pendingConfirm };
}
