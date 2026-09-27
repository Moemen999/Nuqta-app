import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { parseWalletAmountInput } from '@/lib/finance';
import {
  CATEGORY_OPTIONS, PRESELECTED_CATEGORIES, PRESELECTED_WALLETS, SETUP_FAIL_MESSAGE, SETUP_NAME_MAX, SETUP_OTHER_MESSAGE, SKIP_SETUP,
  normalizeAmountInput,
  WALLET_OPTIONS, validateSetupChoice, type SetupChoice,
} from '@/lib/firstRunSetup';
import { selectionStyle, selectionTextColor } from '@/lib/selection';
import { MIN_TOUCH, stickyFooterStyle } from '@/lib/tokens';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * "نبدأ بإيه؟" — أول تجهيز للحساب الجديد (بتظهر بس لما السيرفر يأكد إنه
 * جديد، شوف `detectSetup`). المستخدم بيختار محافظه بأرصدتها وفئاته، أو "تخطي"
 * لمجموعة صغيرة معقولة.
 *
 * الحفظ بيستنى السيرفر (`completeSetup`): يا اتحفظ كله والتطبيق بيفتح، يا
 * رسالة واضحة و"جرّب تاني" — ومفيش حاجة اتسجلت نص نص. الشاشة مبتتقفلش لوحدها
 * على فشل، فمفيش حساب بيطلع من غير محافظ ومن غير كلمة.
 */

type Step = 'welcome' | 'wallets' | 'categories';
type Fail = { kind: 'no-connection' | 'failed' | 'unconfirmed'; choice: SetupChoice };

export default function FirstRunSetup() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { completeSetup } = useData();

  const [step, setStep] = useState<Step>('welcome');
  const [pickedWallets, setPickedWallets] = useState<Set<string>>(new Set(PRESELECTED_WALLETS));
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [customWallets, setCustomWallets] = useState<string[]>([]);
  const [newWallet, setNewWallet] = useState('');
  const [pickedCats, setPickedCats] = useState<Set<string>>(new Set(PRESELECTED_CATEGORIES));
  const [customCats, setCustomCats] = useState<string[]>([]);
  const [newCat, setNewCat] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [fail, setFail] = useState<Fail | null>(null);
  const savingRef = useRef(false);

  // قارئ الشاشة: role="alert" مبيعلنش لوحده، وliveRegion أندرويد بس — فكل تغيير
  // مهم بيتقال صريح (a11y-architect). الزرار اللي اتداس بيختفي مع تغيير الخطوة،
  // فمن غير الإعلان مفيش حاجة تقول إن الشاشة اتغيّرت
  useEffect(() => {
    const title = step === 'welcome' ? 'نبدأ بإيه؟' : step === 'wallets' ? 'محافظك' : 'بتصرف على إيه؟';
    AccessibilityInfo.announceForAccessibility(title);
  }, [step]);
  useEffect(() => { if (saving) AccessibilityInfo.announceForAccessibility('بنجهّز حسابك'); }, [saving]);
  useEffect(() => {
    if (fail) AccessibilityInfo.announceForAccessibility(`${SETUP_FAIL_MESSAGE[fail.kind].title}. ${SETUP_FAIL_MESSAGE[fail.kind].body}`);
  }, [fail]);
  useEffect(() => { if (error) AccessibilityInfo.announceForAccessibility(error); }, [error]);

  const walletRows = [
    ...WALLET_OPTIONS.map(o => ({ key: o.key as string, name: o.name, custom: false, idx: 0 })),
    ...customWallets.map((n, i) => ({ key: `custom:${n}`, name: n, custom: true, idx: i })),
  ];

  function toggle(set: Set<string>, key: string) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }

  function addCustomWallet() {
    const name = newWallet.trim();
    if (!name) return;
    if (walletRows.some(r => r.name.trim().toLocaleLowerCase('ar') === name.toLocaleLowerCase('ar'))) {
      setError(`فيه محفظة اسمها "${name}" خلاص.`); return;
    }
    setCustomWallets(w => [...w, name]);
    setPickedWallets(p => new Set(p).add(`custom:${name}`));
    setNewWallet(''); setError('');
  }

  function addCustomCat() {
    const name = newCat.trim();
    if (!name) return;
    const all = [...CATEGORY_OPTIONS, ...customCats];
    if (all.some(c => c.toLocaleLowerCase('ar') === name.toLocaleLowerCase('ar'))) {
      setError(`فيه فئة اسمها "${name}" خلاص.`); return;
    }
    setCustomCats(c => [...c, name]);
    setPickedCats(p => new Set(p).add(name));
    setNewCat(''); setError('');
  }

  /** المحافظ المختارة بأرصدتها — أو رسالة لو فيه رصيد مش رقم */
  function buildWallets(): { wallets: SetupChoice['wallets'] } | { error: string } {
    const wallets: SetupChoice['wallets'] = [];
    for (const r of walletRows) {
      if (!pickedWallets.has(r.key)) continue;
      const amount = parseWalletAmountInput(normalizeAmountInput(balances[r.key] ?? ''));
      if (amount === null) return { error: `رصيد "${r.name}" مش رقم.` };
      wallets.push({ name: r.name, openingBalance: amount });
    }
    return { wallets };
  }

  function goToCategories() {
    const built = buildWallets();
    if ('error' in built) { setError(built.error); return; }
    if (built.wallets.length === 0) { setError('اختار محفظة واحدة على الأقل — من غيرها مش هتقدر تسجل ولا عملية.'); return; }
    setError(''); setStep('categories');
  }

  async function save(choice: SetupChoice) {
    // دوستين ورا بعض قبل ما شاشة التحميل تظهر (silent-failure-hunter)
    if (savingRef.current) return;
    const invalid = validateSetupChoice(choice);
    if (invalid) { setError(invalid); return; }
    setError(''); setFail(null); setSaving(true); savingRef.current = true;
    let outcome: Awaited<ReturnType<typeof completeSetup>>;
    try {
      outcome = await completeSetup(choice);
    } catch (e) {
      // completeSetup مبترميش — بس لو رمت يومًا الزرار ميفضلش مقفول للأبد (زي useBusy)
      console.warn('[setup] completeSetup رمى', (e as Error)?.message);
      outcome = 'failed';
    } finally {
      savingRef.current = false; setSaving(false);
    }
    if (outcome === 'done' || outcome === 'already-done') {
      // الشاشة بتتقفل لوحدها (setupStatus بقى done) — قارئ الشاشة يعرف ليه
      AccessibilityInfo.announceForAccessibility('حسابك اتجهّز');
      return;
    }
    if (outcome === 'already-done-other') {
      // الحساب اتجهّز باختيارات تانية (محاولة قديمة وصلت متأخر، أو موبايل تاني).
      // Alert مش شاشة: الشاشة دي بتتقفل على طول (setupStatus بقى done)، والـAlert
      // بيفضل ظاهر فوق التطبيق. ممنوع نقول "اتحفظ" على أرقام مش هي اللي اتكتبت
      Alert.alert(SETUP_OTHER_MESSAGE.title, SETUP_OTHER_MESSAGE.body, [{ text: 'تمام' }]);
      return;
    }
    setFail({ kind: outcome, choice });
  }

  function finish() {
    const built = buildWallets();
    if ('error' in built) { setError(built.error); setStep('wallets'); return; }
    const categories = [...CATEGORY_OPTIONS, ...customCats].filter(c => pickedCats.has(c));
    save({ wallets: built.wallets, categories });
  }

  if (saving) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.centerText}>بنجهّز حسابك…</Text>
      </View>
    );
  }

  if (fail) {
    const msg = SETUP_FAIL_MESSAGE[fail.kind];
    return (
      <View style={[styles.center, { paddingTop: insets.top }]} testID="setup_error">
        <Text style={styles.failTitle} accessibilityRole="alert">{msg.title}</Text>
        <Text style={styles.centerText}>{msg.body}</Text>
        <TouchableOpacity testID="setup_retry" style={[styles.primaryBtn, styles.wideBtn]} onPress={() => save(fail.choice)}
          accessibilityRole="button">
          <Text style={styles.primaryText}>جرّب تاني</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="setup_error_back" style={[styles.ghostBtn, styles.wideBtn]} onPress={() => setFail(null)}
          accessibilityRole="button">
          <Text style={styles.ghostText}>رجوع للاختيارات</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'welcome') {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.bigEmoji}>👋</Text>
        <Text style={styles.title}>نبدأ بإيه؟</Text>
        <Text style={styles.centerText}>
          اختار المحافظ اللي بتصرف منها ورصيد كل واحدة دلوقتي، والفئات اللي بتصرف عليها. تقدر تغيّر أي حاجة بعدين من الإعدادات.
        </Text>
        <TouchableOpacity testID="setup_start" style={[styles.primaryBtn, styles.wideBtn]} onPress={() => setStep('wallets')}
          accessibilityRole="button">
          <Text style={styles.primaryText}>يلا نجهّز</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="setup_skip" style={[styles.ghostBtn, styles.wideBtn]} onPress={() => save(SKIP_SETUP)}
          accessibilityRole="button" accessibilityHint="هنعملك محفظة كاش وفئات أساسية">
          <Text style={styles.ghostText}>تخطي</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>{'"تخطي" بيعملك محفظة كاش رصيدها صفر وفئات أساسية.'}</Text>
        {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]} keyboardShouldPersistTaps="handled">
        {step === 'wallets' ? (
          <>
            <Text style={styles.title}>محافظك</Text>
            <Text style={styles.sub}>علّم على اللي عندك، واكتب الرصيد اللي فيها دلوقتي (فاضي = صفر). للكارت: لو عليه فلوس اكتبها بالسالب (مثلاً -500).</Text>
            {walletRows.map(r => {
              const on = pickedWallets.has(r.key);
              return (
                <View key={r.key} style={[styles.row, selectionStyle(colors, on)]}>
                  <TouchableOpacity testID={`setup_wallet_${r.custom ? `custom_${r.idx}` : r.key}`} style={styles.rowToggle}
                    onPress={() => setPickedWallets(p => toggle(p, r.key))}
                    accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={r.name}>
                    <Text style={[styles.rowName, { color: selectionTextColor(colors, on) }, on && styles.bold]}>
                      {on ? '✓ ' : ''}{r.name}
                    </Text>
                  </TouchableOpacity>
                  {on && (
                    <TextInput testID={`setup_balance_${r.custom ? `custom_${r.idx}` : r.key}`} style={styles.balanceInput}
                      value={balances[r.key] ?? ''} onChangeText={v => setBalances(b => ({ ...b, [r.key]: v }))}
                      placeholder="0" placeholderTextColor={colors.textMuted}
                      // أندرويد: numeric في RN بيسمح بالسالب؛ iOS: لوحة الأرقام مفيهاش "-" (كارت الائتمان)
                      keyboardType={Platform.select({ ios: 'numbers-and-punctuation', default: 'numeric' })}
                      textAlign="right" accessibilityLabel={`رصيد ${r.name}`} />
                  )}
                </View>
              );
            })}
            <View style={styles.addRow}>
              <TextInput testID="setup_custom_wallet_input" style={styles.addInput} value={newWallet} onChangeText={setNewWallet}
                placeholder="محفظة تانية (اكتب اسمها)" placeholderTextColor={colors.textMuted} maxLength={SETUP_NAME_MAX}
                textAlign="right" onSubmitEditing={addCustomWallet} accessibilityLabel="اسم محفظة تانية" />
              <TouchableOpacity testID="setup_custom_wallet_add" style={styles.addBtn} onPress={addCustomWallet}
                accessibilityRole="button" accessibilityLabel="ضيف المحفظة">
                <Text style={styles.addBtnText}>ضيف</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.title}>بتصرف على إيه؟</Text>
            <Text style={styles.sub}>علّم على الفئات اللي تنفعك. تقدر تضيف غيرها أو تشيل بعدين.</Text>
            <View style={styles.chips}>
              {[...CATEGORY_OPTIONS, ...customCats].map((c, i) => {
                const on = pickedCats.has(c);
                return (
                  <TouchableOpacity key={c} testID={`setup_cat_${i}`} style={[styles.chip, selectionStyle(colors, on)]}
                    accessibilityLabel={c}
                    onPress={() => setPickedCats(p => toggle(p, c))}
                    accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                    <Text style={[styles.chipText, { color: selectionTextColor(colors, on) }, on && styles.bold]}>{on ? '✓ ' : ''}{c}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.addRow}>
              <TextInput testID="setup_custom_cat_input" style={styles.addInput} value={newCat} onChangeText={setNewCat}
                placeholder="فئة تانية (اكتب اسمها)" placeholderTextColor={colors.textMuted} maxLength={SETUP_NAME_MAX}
                textAlign="right" onSubmitEditing={addCustomCat} accessibilityLabel="اسم فئة تانية" />
              <TouchableOpacity testID="setup_custom_cat_add" style={styles.addBtn} onPress={addCustomCat}
                accessibilityRole="button" accessibilityLabel="ضيف الفئة">
                <Text style={styles.addBtnText}>ضيف</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
        {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
      </ScrollView>

      <View style={stickyFooterStyle(colors, colors.bg, insets.bottom)}>
        {step === 'wallets' ? (
          <TouchableOpacity testID="setup_next" style={[styles.primaryBtn, styles.flexBtn]} onPress={goToCategories} accessibilityRole="button">
            <Text style={styles.primaryText}>التالي</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity testID="setup_finish" style={[styles.primaryBtn, styles.flexBtn]} onPress={finish} accessibilityRole="button">
            <Text style={styles.primaryText}>خلّصنا</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity testID="setup_back" style={[styles.ghostBtn, styles.flexBtn]}
          onPress={() => { setError(''); setStep(step === 'wallets' ? 'welcome' : 'wallets'); }} accessibilityRole="button">
          <Text style={styles.ghostText}>رجوع</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 24 },
    center: { flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
    bigEmoji: { fontSize: 56 },
    title: { color: c.text, fontSize: 22, fontWeight: '700', textAlign: 'right', alignSelf: 'stretch' },
    sub: { color: c.textSecondary, fontSize: 13, textAlign: 'right', marginTop: 6, marginBottom: 14, lineHeight: 20 },
    centerText: { color: c.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 22 },
    hint: { color: c.textMuted, fontSize: 12, textAlign: 'center' },
    failTitle: { color: c.danger, fontSize: 18, fontWeight: '700', textAlign: 'center' },
    row: {
      flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderWidth: 1,
      borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, marginBottom: 8, minHeight: MIN_TOUCH + 8,
    },
    rowToggle: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 10, minHeight: MIN_TOUCH },
    rowName: { color: c.text, fontSize: 15, textAlign: 'right' },
    balanceInput: {
      width: 120, minHeight: MIN_TOUCH, borderWidth: 1, borderColor: c.border, borderRadius: 10,
      color: c.text, backgroundColor: c.bg, paddingHorizontal: 10, fontSize: 15,
    },
    chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: {
      borderWidth: 1, borderColor: c.border, borderRadius: 20, paddingHorizontal: 14, minHeight: MIN_TOUCH,
      justifyContent: 'center', backgroundColor: c.surface,
    },
    chipText: { fontSize: 14 },
    bold: { fontWeight: '700' },
    addRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 12 },
    addInput: {
      flex: 1, minHeight: MIN_TOUCH, borderWidth: 1, borderColor: c.border, borderRadius: 10, color: c.text,
      backgroundColor: c.surface, paddingHorizontal: 12, fontSize: 14,
    },
    addBtn: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH + 16, borderRadius: 10, borderWidth: 1, borderColor: c.accent, alignItems: 'center', justifyContent: 'center' },
    addBtnText: { color: c.accent, fontSize: 14, fontWeight: '700' },
    error: { color: c.danger, fontSize: 13, textAlign: 'right', marginTop: 12 },
    primaryBtn: { backgroundColor: c.accent, borderRadius: 12, minHeight: MIN_TOUCH + 4, alignItems: 'center', justifyContent: 'center' },
    primaryText: { color: c.onAccent, fontSize: 16, fontWeight: '700' },
    ghostBtn: { borderWidth: 1, borderColor: c.border, borderRadius: 12, minHeight: MIN_TOUCH + 4, alignItems: 'center', justifyContent: 'center' },
    ghostText: { color: c.textSecondary, fontSize: 15 },
    wideBtn: { alignSelf: 'stretch', marginTop: 4 },
    flexBtn: { flex: 1 },
  });
}
