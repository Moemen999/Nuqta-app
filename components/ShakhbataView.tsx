import FoldedSection from '@/components/FoldedSection';
import { categoriesPhrase } from '@/lib/archiving';
import { MONTH_NAMES } from '@/lib/recurringIncome';
import { cardElevation, MIN_TOUCH, categoryIconSize, radius, space, typeScale } from '@/lib/tokens';
import { CategoryIcon, categoryInlineRow } from '@/components/CategoryIcon';
import { useChartColors } from '@/hooks/use-chart-colors';

import { useNotice } from '@/components/NoticeProvider';
import { WRITE_ERROR_TITLE, writeErrorBody } from '@/lib/writeError';
import { Money } from '@/components/Money';
import { usePrivacy } from '@/context/PrivacyContext';
import { spendingExpenses, transferTransactionIds } from '@/lib/spending';
import { SpendLoading, TransfersFailedNote } from '@/components/SpendStatus';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionA11y, quietSelectionStyle } from '@/lib/selection';
import {
  AMOUNT_CLEARED_BODY, AMOUNT_REJECT_TITLE, AUTOSAVE_HINT, INCOME_FIELD_NAME, NO_CATEGORIES_TEXT, PERCENTS_NOT_READY_BODY, PERCENTS_NOT_READY_TITLE,
  PERCENTS_UNSAVED_BODY, PERCENTS_UNSAVED_TITLE, amountClearedTitle, amountRejectBody,
  categoryLabel, currentMonth, parsePercentInput, percentInvalidBody, percentInvalidTitle, percentSumOff, percentSumText,
  planIncomeCommit, snapPiastre,
} from '@/lib/finance';
import { budgetLevel, budgetLevelColor, type BudgetLevel } from '@/lib/budgetForecast';
import { moneyText, speakable } from '@/lib/money';
import { useAmountDrafts } from '@/lib/useAmountDrafts';
import { useBusy } from '@/lib/useBusy';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import CountedText from '@/components/CountedText';
import { useFabScroll } from '@/context/FabScrollContext';
import { PressableScale } from '@/components/PressableScale';

const BUCKET_META = [
  { key: 'needs', label: 'احتياجات' },
  { key: 'wants', label: 'رفاهيات' },
  { key: 'future', label: 'خطط مستقبلية' },
] as const;

/** درجة القسم بالكلام — «خلص» (دهبي) للصرف = المخطط، و«عدّى» (أحمر) للتعدّي بس، زي الميزانية (قرار مؤمن 2026-11-16) */
const BUCKET_CUE: Record<BudgetLevel, string> = { under: '', near: 'قرّب يخلص — ', at: 'خلص — ', over: 'عدّى — ' };
const PERCENTS_LOAD_ERROR = 'نسبك المحفوظة ما وصلتش من السيرفر، فاللي ظاهر هنا ممكن يكون الافتراضي (50/30/20) مش نسبك. تعديل النسب مقفول لحد ما توصل — دوس «جرّب تاني» فوق.';
const INCOME_LOAD_ERROR = 'دخل الشهر المحفوظ ما وصلش من السيرفر، فممكن يبان فاضي وهو مش فاضي. الخانة مقفولة لحد ما يوصل.';
const PERCENT_HINT = 'من 0 لـ100';

/** القسم: المخطط صفر وفيه صرف = «عدّى» (`budgetLevel` بيرجّع 'under' للسقف صفر — هنا الصفر مقصود مش «مفيش هدف») */
function bucketLevel(spend: number, target: number): BudgetLevel {
  if (target > 0) return budgetLevel(spend, target);
  return snapPiastre(spend) > 0 ? 'over' : 'under';
}

export default function ShakhbataView() {
  const fabScroll = useFabScroll();
  const { colors } = useTheme();
  const notice = useNotice();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { categoryColors } = useChartColors();
  const {
    categories: allCategories, transactions, shakhbataIncome, shakhbataPercents, updateCategory, setMonthlyIncome, setShakhbataPercents,
    debts, gamiyas, transfersStatus, loadErrors = [], figuresPending = [], percentsReady, incomeReady,
  } = useData();
  // الميزة 6: النسب الافتراضية (50/30/20) كانت بتتعرض كأنها المحفوظة لو المستند ما وصلش، و«حفظ النسب» كان بيكتب فوق
  // نسب المستخدم الحقيقية. التعديل مقفول لحد ما المستند يوصل
  const percentsFailed = loadErrors.includes('shakhbata_settings');
  const incomeFailed = loadErrors.includes('shakhbata_income');
  // الدخل لسه ما اتشافش (snapshot فاضي من الكاش بس) ← الخانة مقفولة برضه (الجولة الأخيرة، بند 1)
  const incomeEditable = incomeReady === true && !incomeFailed;
  // بند 11: "اتصرف" مبيظهرش لحد ما الديون والجمعية يوصلوا
  // والعمليات نفسها لسه ما وصلتش ← «بنحمّل» مش «اتصرف 0» (زي الميزانية والرئيسية، الميزة 6)
  const spendLoading = transfersStatus === 'loading' || figuresPending.includes('transactions');
  // السلفة والجمعية مش مصروف (خطوة 8) — حتى لو اتعدّلت واتدّت فئة
  const transfers = useMemo(() => transferTransactionIds(debts, gamiyas), [debts, gamiyas]);
  const { money, amountsHidden } = usePrivacy();
  // المؤرشفة مش بتتوزّع على الدلاء — هي مش جزء من خطة الشهر الجاي
  const categories = useMemo(() => allCategories.filter(c => !c.archived), [allCategories]);

  const { busy: savingPercents, run: runSavePercents } = useBusy();

  const nowMonth = currentMonth();
  const [percentDrafts, setPercentDrafts] = useState<{ needs: string; wants: string; future: string } | null>(null);

  // الدخل كان `Number(raw) || 0` مع حفظ تلقائي بعد ثانية **من غير ما يستنى
  // الخروج من الخانة** — يعني نص رقم أو لصقة غلط كانت بتتكتب صفر في
  // فايربيز لوحدها، وكل أهداف الشهر تتصفّر من غير أي رسالة. نفس الباگ
  // اللي اتصلح في المحافظ، عاش هنا لأن الكود كان متكرر. دلوقتي نفس الهوك
  // بنفس القواعد: الكلام اللي مش رقم مترفوض والخانة بترجع للمحفوظ.
  // الميزة 6: «٢٠٠٠» و«1,500» بيتقروا، المرفوض بيتقال، والفاضي مبيتحفظش لوحده وانت لسه بتكتب
  const sayIncomeRejected = () => notice(AMOUNT_REJECT_TITLE, amountRejectBody(INCOME_FIELD_NAME));
  const incomeDrafts = useAmountDrafts(
    month => shakhbataIncome[month] || 0,
    (month, value) => {
      void Promise.resolve(setMonthlyIncome(month, value)).then(ok => {
        if (ok) AccessibilityInfo.announceForAccessibility('اتحفظ دخل الشهر');
      }).catch(() => notice(WRITE_ERROR_TITLE, writeErrorBody('دخل الشهر')));
    },
    {
      plan: planIncomeCommit, blankWhenZero: true, autosaveBlank: false, onReject: sayIncomeRejected, onDroppedReject: sayIncomeRejected,
      onBlankCleared: () => notice(amountClearedTitle(INCOME_FIELD_NAME), AMOUNT_CLEARED_BODY),
    },
  );
  const income = incomeDrafts.numberFor(nowMonth, shakhbataIncome[nowMonth] || 0);

  // المعاينة وانت بتعدّل: النسبة الغلط بتوري المحفوظ، مش صفر
  const percents = useMemo(() => {
    if (!percentDrafts) return shakhbataPercents;
    const pick = (k: 'needs' | 'wants' | 'future') => {
      const v = parsePercentInput(percentDrafts[k]);
      return v === null ? shakhbataPercents[k] : v;
    };
    return { needs: pick('needs'), wants: pick('wants'), future: pick('future') };
  }, [percentDrafts, shakhbataPercents]);
  const percentSum = percents.needs + percents.wants + percents.future;

  // تعديل نسب ما اتحفظش والشاشة اتشالت (تاب فرعي تاني، تاب تاني) — كان بيضيع ساكت. الرسالة برّه الشاشة (`notice` في الجذر)
  // المقارنة بالقيم اللي التعديل اتفتح بيها (مقرّبة)، مش المحفوظ دلوقتي: نسب قديمة 33.333، أو نسب اتغيّرت من جهاز تاني
  // وانت فاتح من غير ما تكتب، كانوا بيطلّعوا الرسالة ومفيش حاجة اتغيّرت (الجولة الأخيرة، بند 3)
  const openedWith = useRef<{ needs: number; wants: number; future: number } | null>(null);
  const unsaved = useRef({ percentDrafts, notice });
  unsaved.current = { percentDrafts, notice };
  useEffect(() => () => {
    const { percentDrafts: d, notice: say } = unsaved.current;
    const opened = openedWith.current;
    if (d && opened && BUCKET_META.some(b => parsePercentInput(d[b.key]) !== opened[b.key])) say(PERCENTS_UNSAVED_TITLE, PERCENTS_UNSAVED_BODY);
  }, []);

  function startEditingPercents() {
    if (!percentsReady) return;
    const r = (v: number) => Math.round(v * 100) / 100;
    const opened = { needs: r(shakhbataPercents.needs), wants: r(shakhbataPercents.wants), future: r(shakhbataPercents.future) };
    openedWith.current = opened;
    setPercentDrafts({ needs: String(opened.needs), wants: String(opened.wants), future: String(opened.future) });
  }

  /**
   * النسب ليها زرار حفظ صريح (مش حفظ تلقائي زي الدخل)، فالتحقق بيحصل هنا
   * مرة واحدة على التلاتة: أي واحدة برّه 0-100 بتوقف الحفظ كله وتتسمّى
   * بالاسم. المجموع لسه تحذير ناعم — شوف `parsePercentInput`.
   *
   * **ومفيش `onBlur` بيصلّح الخانة لوحده.** جربنا كده وطلع بيبلع الرسالة:
   * في React Native الضغط على "حفظ النسب" بيعمل blur للخانة الأول، فالخانة
   * كانت بترجع للمحفوظ بصمت قبل ما التحقق ده يشتغل أصلاً — فالمستخدم يشوف
   * رقمه بيختفي من غير ما حد يقوله إيه الغلط. دلوقتي الرقم بيفضل قدامه
   * لحد ما الرسالة تقوله بالاسم إيه اللي مش مظبوط.
   */
  function savePercents() {
    if (!percentDrafts) return;
    // النسب المحفوظة بطّلت ظاهرة بعد ما فتحت التعديل (رفض، حساب اتبدّل) ← منكتبش فوقها، والمسوّدة بتفضل (الجولة الأخيرة، بند 1)
    if (!percentsReady) {
      notice(PERCENTS_NOT_READY_TITLE, PERCENTS_NOT_READY_BODY);
      return;
    }
    const parsed = {
      needs: parsePercentInput(percentDrafts.needs),
      wants: parsePercentInput(percentDrafts.wants),
      future: parsePercentInput(percentDrafts.future),
    };
    const bad = BUCKET_META.filter(b => parsed[b.key] === null).map(b => b.label);
    if (bad.length > 0) {
      notice(percentInvalidTitle(bad.length), percentInvalidBody(bad));
      return;
    }
    runSavePercents(async () => {
      const sent = await setShakhbataPercents({
        needs: parsed.needs as number,
        wants: parsed.wants as number,
        future: parsed.future as number,
      });
      // ما اتبعتش (مفيش حساب — الرسالة اتقالت) ← النسب اللي كتبتها بتفضل قدامك
      if (!sent) return;
      setPercentDrafts(null);
      AccessibilityInfo.announceForAccessibility('اتحفظت النسب');
    });
  }

  // L5 (معروف ومتساب): مصروف الشهر على فئة اتأرشفت بيخرج من القسم — `categories` من غير المؤرشف
  const spendByBucket = useMemo(() => {
    const map = new Map<string, number>();
    BUCKET_META.forEach(b => {
      const ids = categories.filter(c => c.bucket === b.key).map(c => c.id);
      const total = spendingExpenses(transactions, transfers)
        .filter(t => t.date.slice(0, 7) === nowMonth && ids.includes(t.categoryId || ''))
        .reduce((s, t) => s + t.amount, 0);
      map.set(b.key, total);
    });
    return map;
  }, [categories, transactions, transfers, nowMonth]);

  const unassigned = categories.filter(c => !c.bucket);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content} {...fabScroll.scrollProps} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {/* «توزيع الدخل» (دراسة الشكل، قرار مؤمن 2026-11-06): الاسم بيقول هي إيه؛ «شخبطة» فاضلة في السطر عشان اللي متعوّد عليها */}
      <Text style={styles.title} accessibilityRole="header">توزيع الدخل</Text>
      <Text style={styles.subtitle}>قسّم دخلك الشهري على حسب النسب اللي انت حددتها (الشاشة دي كان اسمها شخبطة)</Text>

      {/* الشهر باسمه مش "2026-11" (دراسة الشكل) */}
      <Text style={styles.label}>دخل شهر {MONTH_NAMES[Number(nowMonth.slice(5, 7)) - 1]} {nowMonth.slice(0, 4)}</Text>
      <TextInput
        style={styles.incomeInput}
        accessibilityLabel={`دخل شهر ${MONTH_NAMES[Number(nowMonth.slice(5, 7)) - 1]}`}
        accessibilityHint={AUTOSAVE_HINT}
        editable={incomeEditable}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={colors.textSecondary}
        value={incomeDrafts.valueFor(nowMonth, shakhbataIncome[nowMonth] || 0)}
        onChangeText={v => incomeDrafts.onChange(nowMonth, v)}
        onBlur={() => incomeDrafts.onBlur(nowMonth)}
        textAlign="right"
      />
      {incomeFailed && <Text testID="shakhbata_income_load_error" style={styles.loadError}>{INCOME_LOAD_ERROR}</Text>}

      <View style={styles.percentHead}>
        {percentDrafts ? (
          <View style={styles.percentActions}>
            {/* الاسم ثابت والحالة في `accessibilityState` (a11y-architect) — مش «...» بيتقري نقط */}
            <PressableScale style={styles.textBtn} accessibilityRole="button" accessibilityLabel="حفظ النسب"
              accessibilityState={{ disabled: savingPercents, busy: savingPercents }} onPress={savePercents} disabled={savingPercents}>
              <Text style={[styles.textBtnLabel, { opacity: savingPercents ? 0.6 : 1 }]}>حفظ النسب</Text>
            </PressableScale>
            <PressableScale style={styles.textBtn} accessibilityRole="button" accessibilityLabel="إلغاء تعديل النسب"
              accessibilityState={{ disabled: savingPercents }} onPress={() => setPercentDrafts(null)} disabled={savingPercents}>
              <Text style={[styles.textBtnLabel, { color: colors.textSecondary }]}>إلغاء</Text>
            </PressableScale>
          </View>
        ) : (
          <PressableScale style={styles.textBtn} accessibilityRole="button" accessibilityLabel="عدّل النسب"
            accessibilityState={{ disabled: !percentsReady }} onPress={startEditingPercents} disabled={!percentsReady}>
            <Text style={[styles.textBtnLabel, { opacity: percentsReady ? 1 : 0.5 }]}>عدّل النسب</Text>
          </PressableScale>
        )}
        <Text style={styles.label}>نسبك الحالية</Text>
      </View>
      {percentsFailed && <Text testID="shakhbata_load_error" style={styles.loadError}>{PERCENTS_LOAD_ERROR}</Text>}

      {percentDrafts ? (
        <View style={styles.percentEditRow}>
          {BUCKET_META.map(b => (
            <View key={b.key} style={{ flex: 1 }}>
              {/* نفس اسم الخانة — قارئ الشاشة بيسمعه منها (a11y-architect) */}
              <Text style={styles.microLabel} importantForAccessibility="no" accessibilityElementsHidden>{b.label} %</Text>
              <TextInput
                style={styles.percentInput}
                accessibilityLabel={`نسبة ${b.label}`}
                accessibilityHint={PERCENT_HINT}
                keyboardType="numeric"
                value={percentDrafts[b.key]}
                onChangeText={v => setPercentDrafts(d => d ? { ...d, [b.key]: v } : d)}
                textAlign="center"
              />
            </View>
          ))}
        </View>
      ) : null}
      {/* مقارنة بفرق التقريب والعرض مقرّب: 10.1+20.2+30.3 كانت «60.599999%» */}
      <View accessibilityLiveRegion="polite">
        {percentDrafts && percentSumOff(percentSum) && (
          <Text testID="shakhbata_sum_warn" style={styles.warnText}>{`مجموع النسب دلوقتي ${percentSumText(percentSum)}% — الأحسن يبقى 100%، بس تقدر تسيبه كده لو ده قصدك`}</Text>
        )}
      </View>

      {!(income > 0) && (
        <Text testID="shakhbata_income_hint" style={styles.hintLine}>
          {`اكتب دخل الشهر فوق عشان نوزّعه على النسب: ${BUCKET_META.map(b => `${b.label} ${percentSumText(percents[b.key])}%`).join(' · ')}`}
        </Text>
      )}

      {income > 0 && (
        <View style={styles.bucketsWrap}>
          {BUCKET_META.map(b => {
            const pct = percents[b.key] / 100;
            const target = income * pct;
            const spend = spendByBucket.get(b.key) || 0;
            // نفس درجات الميزانية بالظبط (`budgetLevel` بنص قرش): الصرف = المخطط «خلص» دهبي، والتعدّي بس أحمر
            const level = bucketLevel(spend, target);
            const usagePct = level === 'at' || level === 'over' ? 100 : target > 0 ? Math.min(100, (spend / target) * 100) : 0;
            const color = budgetLevelColor(level, colors, colors.textSecondary);
            const diff = snapPiastre(target - spend);
            const diffText = `${diff < 0 ? 'زيادة' : 'متبقي'} ${money(Math.abs(diff))} ج.م`;
            const pctText = percentSumText(percents[b.key]);
            // وصف واحد للكارت (a11y-architect): «احتياجات 50%، المخطط …، اتصرف …، متبقي …»
            const cardLabel = speakable(spendLoading
              ? `${b.label} ${pctText}%، المخطط ${moneyText(target, amountsHidden)}`
              : `${b.label} ${pctText}%، المخطط ${moneyText(target, amountsHidden)}، اتصرف ${moneyText(spend, amountsHidden)}، ${diff < 0 ? 'زيادة' : 'متبقي'} ${moneyText(Math.abs(diff), amountsHidden)}${level === 'under' ? '' : `، ${BUCKET_CUE[level].replace(' — ', '')}`}`);
            return (
              <View key={b.key} testID={`shakhbata_bucket_${b.key}`} style={styles.bucketCard} accessible={!spendLoading} accessibilityLabel={cardLabel}>
                <View style={styles.bucketHead}>
                  <CountedText title={b.label} count={pctText} suffix="%" style={styles.bucketLabel} />
                  <Money value={target} style={styles.bucketTarget} />
                </View>
                {spendLoading ? <SpendLoading testID={`shakhbata_loading_${b.key}`} shape="line" style={styles.bucketSpend} /> : (
                  <>
                    <View style={styles.track} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                      <View style={[styles.fill, { width: `${usagePct}%`, backgroundColor: color }]} />
                    </View>
                    <Text testID={`shakhbata_spend_${b.key}`} style={[styles.bucketSpend, { color }]}>
                      {BUCKET_CUE[level]}{'اتصرف: '}<Money value={spend} />{` (${diffText})`}
                    </Text>
                  </>
                )}
              </View>
            );
          })}
          {transfersStatus === 'failed' && <TransfersFailedNote testID="shakhbata_transfers_failed" />}
        </View>
      )}

      {/* التصنيف كان 30 زرار صغير لـ10 فئات على الشاشة كلها (دراسة الشكل) ← مطوي، والعنوان بيقول فاضل كام */}
      <FoldedSection testID="shakhbata_classify" count={categories.length}
        title={unassigned.length > 0 ? `صنّف فئاتك — ${categoriesPhrase(unassigned.length)} من غير تصنيف` : 'صنّف فئاتك'} showCount={false}
        // مفتوح من الأول لو فيه فئات من غير تصنيف والدخل متسجل — غير كده الأقسام فوق صفر والحل مستخبي (a11y-architect)
        defaultOpen={unassigned.length > 0 && income > 0}
        a11yLabel={unassigned.length > 0 ? `صنّف فئاتك، ${categoriesPhrase(unassigned.length)} لسه من غير تصنيف` : 'صنّف فئاتك، كلها متصنّفة'}>
        <Text style={styles.hint}>حدد كل فئة تبع أنهي قسم من التلاتة (دوس تاني عشان تشيل التصنيف)</Text>
        {categories.map(c => (
          <View key={c.id} style={styles.catRow}>
            <View style={[categoryInlineRow, { marginBottom: space.sm }]}>
              <CategoryIcon icon={c.icon} size={categoryIconSize.row} tint={categoryColors.get(c.id)} />
              <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.catName, { flexShrink: 1, marginBottom: 0 }]}>{categoryLabel(c, { icon: false })}</Text>
            </View>
            <View style={styles.catBtns}>
              {BUCKET_META.map(b => {
                const active = c.bucket === b.key;
                return (
                  <PressableScale {...selectionA11y(active)}
                    key={b.key}
                    accessibilityLabel={`${categoryLabel(c, { icon: false })} — ${b.label}`}
                    onPress={() => updateCategory(c.id, { bucket: active ? '' : b.key })}
                    style={[styles.catBtn, quietSelectionStyle(colors, active)]}>
                    <Text style={{ color: active ? colors.text : colors.textSecondary, fontSize: typeScale.caption }}>{b.label}</Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>
        ))}
      </FoldedSection>

      {categories.length === 0 && !loadErrors.includes('categories') && (
        <Text testID="shakhbata_no_categories" style={styles.hintLine}>{NO_CATEGORIES_TEXT}</Text>
      )}

      {unassigned.length > 0 && income > 0 && (
        <Text style={styles.warnText}>
          {`فيه ${categoriesPhrase(unassigned.length)} لسه من غير تصنيف، مصاريفها مش هتتحسب في أي قسم فوق`}
        </Text>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 40 },
    title: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right' },
    subtitle: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: 4, marginBottom: 16, lineHeight: 18 },
    label: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginBottom: space.xs },
    incomeInput: {
      backgroundColor: c.surface2, borderWidth: 1.5, borderColor: c.controlEdge, borderRadius: radius.lg,
      color: c.text, fontSize: typeScale.hero, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16,
    },
    percentHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
    percentEditRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 8 },
    microLabel: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'center', marginBottom: 4 },
    percentInput: { backgroundColor: c.surface2, borderWidth: 1.5, borderColor: c.controlEdge, borderRadius: radius.sm, color: c.text, minHeight: MIN_TOUCH, fontSize: typeScale.body, fontWeight: '700' },
    percentActions: { flexDirection: 'row-reverse', gap: space.sm },
    // زرار نصي بمساحة لمس كاملة (a11y-architect): كان hitSlop فوق وتحت بس
    textBtn: { minHeight: MIN_TOUCH, paddingHorizontal: space.md, justifyContent: 'center' },
    textBtnLabel: { color: c.accentText, fontSize: typeScale.caption, fontWeight: '700' },
    loadError: { color: c.dangerText, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xs, marginBottom: space.sm, lineHeight: 18 },
    hintLine: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.md, lineHeight: 18 },
    warnText: { color: c.accentText, fontSize: typeScale.caption, textAlign: 'right', marginTop: 8, lineHeight: 17 },
    bucketsWrap: { marginTop: 16, marginBottom: 10 },
    bucketCard: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xxl, marginBottom: space.md, ...cardElevation(c) },
    bucketHead: { flexDirection: 'row-reverse', justifyContent: 'space-between' },
    bucketLabel: { color: c.text, fontSize: typeScale.body, fontWeight: '700' },
    bucketTarget: { color: c.textSecondary, fontSize: typeScale.body },
    track: { height: 4, backgroundColor: c.borderStrong, borderRadius: radius.track, marginTop: space.md, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: radius.track },
    bucketSpend: { fontSize: typeScale.caption, marginTop: space.xs, textAlign: 'right' },
    sectionTitle: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginTop: 16, marginBottom: 4 },
    hint: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginBottom: 10, lineHeight: 16 },
    catRow: { backgroundColor: c.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.sm },
    catName: { color: c.text, fontSize: typeScale.body, fontWeight: '500', textAlign: 'right', marginBottom: 8 },
    catBtns: { flexDirection: 'row-reverse', gap: 6 },
    catBtn: { flex: 1, borderWidth: 1.5, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH },
  });
}