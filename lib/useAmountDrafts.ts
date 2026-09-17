import { planWalletAmountCommit } from '@/lib/finance';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

export const NEGATIVE_CONFIRM_TITLE = 'رصيد بالسالب؟';
export const NEGATIVE_CONFIRM_BODY = 'ده معناه إن عليك فلوس في المحفظة دي، زي كارت الائتمان.';
export const NEGATIVE_CONFIRM_YES = 'أيوه، سالب';
export const NEGATIVE_CONFIRM_NO = 'عدّل الرقم';

/** نفس مهلة BudgetView — بنحفظ بعد ثانية من آخر حرف */
export const AUTOSAVE_DELAY_MS = 1000;

/**
 * خانة رقم فلوس في المحفظة (الرصيد الابتدائي أو حد التنبيه).
 *
 * كل المنطق هنا مش في الشاشة، لسببين: الأول إنه يتختبر من غير ما نعمل render
 * لشاشة الإعدادات كلها، والتاني إن الخانتين بيستخدموا نفس الكلام بالظبط.
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
 * 3. **السالب مسموح بتأكيد.** والتأكيد من موجب لسالب بس (شوف
 *    `planWalletAmountCommit`).
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
) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const pending = useRef<Record<string, string>>({});

  // المؤقت وflush الخروج بيشتغلوا بعد ما الـrender اللي عملهم يخلص، فلو
  // قفلوا على نسخة قديمة من المحافظ هيقارنوا بقيمة قديمة. الـref بيخليهم
  // يقروا آخر نسخة دايمًا.
  const latest = useRef({ storedFor, write });
  useEffect(() => { latest.current = { storedFor, write }; });

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
    const plan = planWalletAmountCommit(raw, latest.current.storedFor(id));
    if (plan.action !== 'write') return false;
    commitWrite(id, plan.value);
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
        const plan = planWalletAmountCommit(raw, latest.current.storedFor(id));
        if (plan.action === 'write') latest.current.write(id, plan.value);
      });
      held.current = {};
    };
  }, []);

  /** صفر محفوظ بيتعرض "0" — مش خانة فاضية تخلي المستخدم يحزر */
  function valueFor(id: string, stored: number) {
    if (drafts[id] !== undefined) return drafts[id];
    return String(isFinite(stored) ? stored : 0);
  }

  function onChange(id: string, raw: string) {
    setDrafts(d => ({ ...d, [id]: raw }));
    pending.current[id] = raw;
  }

  function onBlur(id: string) {
    delete pending.current[id];
    const raw = drafts[id];
    if (raw === undefined) return;

    const plan = planWalletAmountCommit(raw, latest.current.storedFor(id));
    if (plan.action === 'none' || plan.action === 'reject') { clearDraft(id); return; }
    if (plan.action === 'write') { commitWrite(id, plan.value); return; }

    Alert.alert(NEGATIVE_CONFIRM_TITLE, NEGATIVE_CONFIRM_BODY, [
      { text: NEGATIVE_CONFIRM_NO, style: 'cancel', onPress: () => clearDraft(id) },
      { text: NEGATIVE_CONFIRM_YES, onPress: () => commitWrite(id, plan.value) },
    ]);
  }

  return { valueFor, onChange, onBlur };
}
