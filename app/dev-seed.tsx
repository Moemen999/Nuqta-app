import BackButton from '@/components/BackButton';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { db } from '@/firebaseConfig';
import { todayStr } from '@/lib/finance';
import {
  SEED_CATEGORIES, SEED_WALLETS, documentsPhrase,
  seedDebts, seedDocs, seedGamiya, seedIncome, seedMissing, seedSubscription, seedTransactions, type SeedIds,
} from '@/scripts/seedTestAccount';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { doc, writeBatch } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * تعبئة حساب الاختبار ببيانات وهمية ثابتة — **في نسخ التطوير بس** (`__DEV__`).
 * في نسخة الإنتاج الشاشة بترجع للرئيسية على طول.
 *
 * الأمان:
 * - الـuid **لازم ييجي في اللينك** (`/dev-seed?uid=...`) — مفيش "المستخدم
 *   الحالي" كافتراضي. لو مش هو الحساب المفتوح، الشاشة بترفض ومبتكتبش حاجة.
 * - قبل أي كتابة أو مسح: رسالة فيها الـuid والإيميل، ومفيش حاجة بتحصل غير بعد
 *   التأكيد.
 * - الكتابة بدوال `DataContext`، فالقواعد بتمنعها من أي حساب غير المفتوح.
 *
 * "خلصت" بتتقال بس لما `seedMissing` يبقى فاضي — يعني كل حاجة ظهرت فعلاً في
 * الـlistener، مش إن الكتابات اتبعتت. والحالة (فاضي/كاملة/ناقصة) بتبان أول
 * ما الشاشة تتفتح، فالتعبئة اللي اتقطعت في النص مبتستخباش.
 *
 * التشغيل والمسح: CLAUDE.md، قسم "حساب الاختبار".
 */

type Phase = 'idle' | 'base' | 'linked' | 'done' | 'failed' | 'wiping';
const PHASE_TIMEOUT_MS = 20_000;

export default function DevSeedScreen() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DevSeed />;
}

function DevSeed() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { uid: uidParam } = useLocalSearchParams<{ uid?: string }>();
  const { user } = useAuth();
  const data = useData();
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('');
  const today = useRef(todayStr()).current;
  // الـeffect بيتنادى مع كل تغيير في البيانات؛ الكتابة لازم تحصل مرة واحدة بس
  const linkedStarted = useRef(false);

  const existing = useMemo(() => seedDocs(data), [data]);
  // مصدر الحقيقة: إيه اللي ناقص فعلاً في الـlistener
  const missing = useMemo(() => seedMissing(data), [data]);
  const missingRef = useRef(missing);
  missingRef.current = missing;
  const matches = !!uidParam && !!user && user.uid === uidParam;

  // المرحلة 1 ← 2: المحافظ والفئات وصلوا من الـlistener، فنقدر نعرف معرّفاتهم
  useEffect(() => {
    if (phase !== 'base' || linkedStarted.current) return;
    const wallets = Object.fromEntries(data.wallets.filter(w => SEED_WALLETS.some(s => s.name === w.name)).map(w => [w.name, w.id]));
    const categories = Object.fromEntries(data.categories.filter(c => (SEED_CATEGORIES as readonly string[]).includes(c.name)).map(c => [c.name, c.id]));
    if (Object.keys(wallets).length < SEED_WALLETS.length || Object.keys(categories).length < SEED_CATEGORIES.length) return;
    const ids: SeedIds = { wallets, categories };
    linkedStarted.current = true;
    SEED_WALLETS.forEach(w => data.updateWallet(ids.wallets[w.name], { openingBalance: w.openingBalance, lowAlert: w.lowAlert }));
    seedTransactions(ids, today).forEach(tx => data.addTransaction(tx));
    seedDebts(ids, today).forEach(d => data.addDebt(d));
    data.addSubscription(seedSubscription(ids, today));
    data.addGamiya(seedGamiya(ids, today));
    data.addIncome(seedIncome(ids, today));
    setStatus('المحافظ والفئات اتعملوا — بنضيف العمليات والديون والاشتراك والجمعية والدخل…');
    setPhase('linked');
  }, [phase, data, today]);

  // المرحلة 2 ← خلص: **كل** حاجة ظهرت — العمليات العشرة والأرصدة كمان
  useEffect(() => {
    if (phase === 'linked' && missing.length === 0) {
      setPhase('done');
      setStatus('خلصت التعبئة — كل حاجة وصلت.');
    }
  }, [phase, missing]);

  // كل مرحلة ليها سقف: لو حاجة ما ظهرتش، نقول بالظبط إيه اللي ناقص. والمسح
  // كمان — النت ممكن يقع في النص، والدفعة ساعتها بتفضل مستنية من غير ما ترفض
  useEffect(() => {
    if (phase !== 'base' && phase !== 'linked' && phase !== 'wiping') return;
    const t = setTimeout(() => {
      setPhase('failed');
      setStatus(phase === 'wiping'
        ? 'المسح اتطبّق على الجهاز بس، وما وصلش السيرفر في 20 ثانية. لو قفلت التطبيق قبل ما النت يرجع، البيانات هترجع.'
        : `التعبئة ما كملتش في 20 ثانية. الناقص: ${missingRef.current.join('، ')}. امسح اللي اتعمل وجرب تاني.`);
    }, PHASE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  function confirmThen(title: string, actionLabel: string, action: () => void) {
    Alert.alert(title, `هيتكتب في الحساب ده:\n\nuid: ${user!.uid}\nالإيميل: ${user!.email ?? '(مفيش إيميل)'}\n\nده حساب الاختبار؟`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: actionLabel, style: 'destructive', onPress: action },
    ]);
  }

  function startSeed() {
    if (existing.length > 0) {
      Alert.alert('فيه بيانات تجربة موجودة', `لقيت ${documentsPhrase(existing.length)} من التعبئة اللي فاتت. امسحهم الأول وبعدين عبّي من جديد.`);
      return;
    }
    confirmThen('تعبئة بيانات التجربة', 'عبّيها', () => {
      linkedStarted.current = false;
      SEED_WALLETS.forEach(w => data.addWallet(w.name));
      SEED_CATEGORIES.forEach(c => data.addCategory(c));
      setStatus('بنعمل المحافظ والفئات…');
      setPhase('base');
    });
  }

  function wipe() {
    if (existing.length === 0) { Alert.alert('مفيش حاجة تتمسح', 'مفيش أي مستند من بيانات التجربة في الحساب ده.'); return; }
    // الدفعة مبترفضش وانت أوفلاين، بتفضل مستنية — فنرفض من الأول بدل ما الشاشة تستنى
    if (!data.serverReachable) { Alert.alert('مفيش نت', 'المسح محتاج نت عشان نتأكد إنه وصل. جرب تاني لما النت يرجع.'); return; }
    const n = existing.length;
    confirmThen(`مسح ${documentsPhrase(n)} من بيانات التجربة`, 'امسحها نهائي', () => {
      const batch = writeBatch(db);
      existing.forEach(r => batch.delete(doc(db, 'users', user!.uid, r.collection, r.id)));
      setPhase('wiping');
      setStatus(`بيتمسح ${documentsPhrase(n)}…`);
      // من غير await (قاعدة 7): الشاشة مبتقفش. بس "اتمسح" مبتتقالش غير لما
      // السيرفر يأكّد — لحد كده الكلام "بيتمسح"
      batch.commit().then(() => {
        setPhase('idle');
        setStatus(`اتمسح ${documentsPhrase(n)} ووصل السيرفر.`);
      }).catch(e => {
        setPhase('failed');
        setStatus(`المسح ما وصلش السيرفر: ${e?.code ?? e?.message ?? 'خطأ'}. البيانات ممكن ترجع لما الشاشة تتحدّث.`);
      });
    });
  }

  const busy = phase === 'base' || phase === 'linked' || phase === 'wiping';

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title}>بيانات التجربة (للمطوّر)</Text>
      </View>

      {!uidParam ? (
        <Text testID="dev_seed_refused" style={styles.error}>لازم الـuid ييجي في اللينك: /dev-seed?uid=...</Text>
      ) : !matches ? (
        <Text testID="dev_seed_mismatch" style={styles.error}>
          الـuid اللي في اللينك مش هو الحساب المفتوح ({user?.email ?? 'مفيش حساب'}). مفيش أي حاجة هتتكتب.
        </Text>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>uid</Text>
            <Text testID="dev_seed_uid" style={styles.value} selectable>{user!.uid}</Text>
            <Text style={styles.label}>الإيميل</Text>
            <Text testID="dev_seed_email" style={styles.value}>{user!.email ?? '(مفيش إيميل)'}</Text>
            <Text style={styles.label}>مستندات تجربة موجودة</Text>
            <Text testID="dev_seed_existing" style={styles.value}>{existing.length}</Text>
            <Text style={styles.label}>الحالة</Text>
            {existing.length === 0 ? (
              <Text testID="dev_seed_state_empty" style={styles.value}>فاضي</Text>
            ) : missing.length === 0 ? (
              <Text testID="dev_seed_state_complete" style={styles.value}>كاملة</Text>
            ) : (
              <Text testID="dev_seed_state_partial" style={styles.errorValue}>ناقصة: {missing.join('، ')}</Text>
            )}
          </View>

          <TouchableOpacity testID="dev_seed_start" style={[styles.btn, busy && styles.btnBusy]} onPress={startSeed} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.btnText}>عبّي بيانات التجربة</Text>}
          </TouchableOpacity>
          <TouchableOpacity testID="dev_seed_wipe" style={[styles.btnDanger, busy && styles.btnBusy]} onPress={wipe} disabled={busy}>
            <Text style={styles.btnDangerText}>امسح بيانات التجربة</Text>
          </TouchableOpacity>

          {!!status && (
            <Text testID={`dev_seed_status_${phase}`} style={phase === 'failed' ? styles.error : styles.status}>{status}</Text>
          )}
          {data.pendingWrites > 0 && <Text style={styles.status}>لسه بيرفع: {data.pendingWrites}</Text>}
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 40 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    title: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right' },
    card: { backgroundColor: c.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: c.border, marginBottom: 16 },
    label: { color: c.textSecondary, fontSize: 13, textAlign: 'right', marginTop: 6 },
    value: { color: c.text, fontSize: 15, textAlign: 'right' },
    errorValue: { color: c.danger, fontSize: 15, textAlign: 'right' },
    btn: { backgroundColor: c.accent, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10 },
    btnBusy: { opacity: 0.6 },
    btnText: { color: c.onAccent, fontSize: 16, fontWeight: '700' },
    btnDanger: { borderColor: c.dangerBorder, borderWidth: 1, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10 },
    btnDangerText: { color: c.danger, fontSize: 16, fontWeight: '700' },
    status: { color: c.textSecondary, fontSize: 14, textAlign: 'right', marginTop: 8 },
    error: { color: c.danger, fontSize: 14, textAlign: 'right', marginTop: 8 },
  });
}
