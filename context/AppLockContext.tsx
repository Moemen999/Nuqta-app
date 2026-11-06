import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { reportAtomicFailure } from '@/lib/atomicFailure';

type LockType = 'pin' | 'password';
/**
 * نتيجة التحقق من الكود (بند A، مراجعة المشروع 2026-11-05): `error` = التخزين الآمن نفسه فشل — مش "الكود غلط".
 * قبل كده الاتنين كانوا `false`، فالمستخدم كان بيتقاله "غلط" على كود صح
 */
export type VerifyResult = 'ok' | 'wrong' | 'error';
type LockFrequency = 'onOpen' | 'everyResume';

type AppLockContextType = {
  enabled: boolean;
  lockType: LockType;
  frequency: LockFrequency;
  isLocked: boolean;
  loading: boolean;
  /**
   * قراية إعدادات القفل وقت الفتح فشلت (بعد محاولات). التطبيق **بيفضل مقفول** (fail closed — OWASP) وشاشة القفل
   * بتقول كده وفيها "جرّب تاني" و"نسيت الكود؟". قبل كده كان بيتفتح من غير قفل ساكت (بند A)
   */
  readFailed: boolean;
  /** `true` = اتقرت، `false` = فشلت تاني، `null` = قراية تانية كانت شغالة (مفيش نتيجة جديدة) */
  retryRead: () => Promise<boolean | null>;
  /** بيرمي لو الحفظ فشل — والشاشة بتقول. مفيش حالة نص-نص: علم "مفعّل" آخر حاجة بتتكتب */
  setupLock: (type: LockType, code: string) => Promise<void>;
  disableLock: (code: string) => Promise<VerifyResult>;
  /**
   * بيشيل القفل **من غير** الكود — لمسار "نسيت الكود؟" بس.
   *
   * القفل بيتحط قدام التطبيق كله قبل حتى شاشة الدخول، فالمستخدم اللي بينسى
   * كوده مكانش قدامه أي طريق غير إنه يمسح التطبيق. ودي مش حماية، دي حبسة:
   * بياناته في فايرستور ورا حساب فايربيز، والقفل ده طبقة راحة فوقيها مش
   * هو اللي حاميها.
   *
   * عشان كده الخروج من الحبسة بيمشي مع تسجيل الخروج: المستخدم بيرجع يدخل
   * بباسورد حسابه. يعني الاسترجاع مربوط بكلمة سر الحساب، وهي أقوى من الكود
   * المحلي — مش أضعف منه.
   */
  clearLock: () => Promise<void>;
  /**
   * مسح الحساب (`app/settings-screens/delete-account.tsx`): كل أثر للقفل **ومعاه مهلة السماح**. `clearLock` ("نسيت الكود؟")
   * بيسيب المهلة لأنها اختيار نفس المستخدم؛ هنا الحساب اتمسح، واللي يسجّل على نفس الموبايل ميلاقيش قفل أو مهلة حد تاني
   * (بحث rnd-researcher 2026-11-03 + قرار مؤمن على الترشيح)
   */
  wipeLockForDeletedAccount: () => Promise<void>;
  changeCode: (oldCode: string, newCode: string, newType: LockType) => Promise<VerifyResult>;
  /** `false` لو الحفظ فشل — الشاشة بتقول، والاختيار القديم بيفضل ظاهر */
  setFrequency: (f: LockFrequency) => Promise<boolean>;
  graceMinutes: number;
  setGraceMinutes: (m: number) => Promise<boolean>;
  verify: (code: string) => Promise<VerifyResult>;
  unlock: () => void;
};

const AppLockContext = createContext<AppLockContextType | undefined>(undefined);

/**
 * البوابة في `app/_layout.tsx` (بند A — security-reviewer BLOCKER): كانت `enabled && isLocked`، وفشل القراية بيسيب
 * `enabled` بـ false — فالتطبيق كان بيتفتح برضه. فشل القراية لوحده كفاية عشان يقفل
 */
export function shouldShowLock(s: { enabled: boolean; isLocked: boolean; readFailed: boolean }): boolean {
  return s.isLocked && (s.enabled || s.readFailed);
}

const K_ENABLED = 'nuqta_lock_enabled';
const K_TYPE = 'nuqta_lock_type';
const K_FREQ = 'nuqta_lock_freq';
const K_HASH = 'nuqta_lock_hash';
const K_GRACE = 'nuqta_lock_grace';

/** محاولات قراية الإعدادات وقت الفتح قبل ما نعتبرها فشلت — الـkeystore ساعات بيرمي مرة ويرجع */
const READ_ATTEMPTS = 3;
const READ_RETRY_MS = 300;

async function hash(code: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, code);
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [lockType, setLockType] = useState<LockType>('pin');
  const [frequency, setFrequencyState] = useState<LockFrequency>('onOpen');
  const [isLocked, setIsLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [graceMinutes, setGraceMinutesState] = useState(0);
  const appState = useRef(AppState.currentState);
  const backgroundedAt = useRef<number | null>(null);
  // كل قراية ليها رقم؛ القراية الأقدم أو اللي جت بعد فتح/تفعيل/مسح مبتكتبش فوق الحالة الأحدث (security-reviewer)
  const readSeq = useRef(0);
  const reading = useRef(false);

  /**
   * قراية الإعدادات. **فشلها = مقفول** (بند A — كانت "يكمل من غير قفل"): مش عارفين القفل مفعّل ولا لأ، والغلط في اتجاه
   * "مفتوح" معناه التطبيق كله من غير كود. المخرج موجود: "جرّب تاني"، و"نسيت الكود؟" (خروج من الحساب).
   * `allowBackup: false` (app.config.js) فمفيش مفاتيح بتبوظ بعد استرجاع باك أب — `null` هنا = "مفيش قفل" فعلاً.
   */
  async function readSettings(): Promise<boolean | null> {
    if (reading.current) return null; // دوستين على "جرب تاني" مبيعملوش قرايتين مع بعض
    reading.current = true;
    const seq = ++readSeq.current;
    try {
      // **علم "مفعّل" بس هو الحرج**: الباقي (النوع، امتى، المهلة) فشله بيرجع للافتراضي — مستخدم مالوش قفل
      // ميتقفلش برّه عشان مفتاح ثانوي (security-reviewer)
      let en: string | null = null;
      let lastError: unknown;
      let ok = false;
      for (let attempt = 0; attempt < READ_ATTEMPTS && !ok; attempt++) {
        try { en = await SecureStore.getItemAsync(K_ENABLED); ok = true; }
        catch (e) { lastError = e; if (attempt < READ_ATTEMPTS - 1) await new Promise(r => setTimeout(r, READ_RETRY_MS)); }
      }
      if (seq !== readSeq.current) return null;
      const fail = (e: unknown) => {
        reportAtomicFailure('قراية القفل', e);
        setReadFailed(true);
        setIsLocked(true);
        return false;
      };
      if (!ok) return fail(lastError);
      const isEnabled = en === '1';
      // القفل مفعّل ← النوع وامتى يقفل **حرجين** كمان: نوع غلط = لوحة أرقام لصاحب باسورد (مقفول برّه)، وامتى غلط = قفل أضعف
      // من غير ما حد يعرف (security-reviewer + silent-failure-hunter جولة 2). المهلة بس بترجع للافتراضي — وبتتبلّغ
      let t: string | null = null; let f: string | null = null; let g: string | null = null;
      try { t = await SecureStore.getItemAsync(K_TYPE); f = await SecureStore.getItemAsync(K_FREQ); }
      catch (e) { if (isEnabled) { if (seq === readSeq.current) return fail(e); return null; } reportAtomicFailure('قراية القفل', e); }
      try { g = await SecureStore.getItemAsync(K_GRACE); } catch (e) { reportAtomicFailure('قراية القفل', e); }
      if (seq !== readSeq.current) return null;
      setEnabled(isEnabled);
      if (t === 'pin' || t === 'password') setLockType(t);
      if (f === 'onOpen' || f === 'everyResume') setFrequencyState(f);
      if (g !== null) setGraceMinutesState(Number(g) || 0);
      setIsLocked(isEnabled);
      setReadFailed(false);
      return true;
    } finally {
      reading.current = false;
    }
  }

  useEffect(() => {
    readSettings().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- مرة واحدة وقت الفتح؛ "جرّب تاني" بينادي retryRead
  }, []);

  async function retryRead() {
    return readSettings();
  }

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const wasBackground = appState.current.match(/inactive|background/);
      if (next.match(/inactive|background/)) {
        backgroundedAt.current = Date.now();
      }
      if (enabled && frequency === 'everyResume' && wasBackground && next === 'active') {
        // لو المستخدم حدد مهلة، منقفلش إلا لو عدّت المهلة دي وهو بره التطبيق
        const awayMs = backgroundedAt.current ? Date.now() - backgroundedAt.current : Infinity;
        if (awayMs >= graceMinutes * 60 * 1000) {
          setIsLocked(true);
        }
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [enabled, frequency, graceMinutes]);

  /**
   * **علم "مفعّل" آخر حاجة** (بند A): كان أول حاجة، فوقوع في النص كان بيسيب قفل مفعّل من غير هاش — مقفول برّه من غير
   * كود يفتح. دلوقتي الوقوع قبل العلم = "مفيش قفل" (القديم زي ما هو)، والشاشة بتقول إن التفعيل ما اتمش
   */
  async function setupLock(type: LockType, code: string) {
    try {
      const h = await hash(code);
      await SecureStore.setItemAsync(K_HASH, h);
      await SecureStore.setItemAsync(K_TYPE, type);
      const existingFreq = await SecureStore.getItemAsync(K_FREQ);
      if (!existingFreq) await SecureStore.setItemAsync(K_FREQ, 'onOpen');
      await SecureStore.setItemAsync(K_ENABLED, '1');
    } catch (e) {
      reportAtomicFailure('حفظ القفل', e);
      throw e;
    }
    readSeq.current++;
    setEnabled(true);
    setReadFailed(false);
    setLockType(type);
  }

  /**
   * بيمسح كل أثر للقفل من التخزين الآمن ومن الحالة. **العلم الأول والهاش بعده** (عكس التفعيل): وقوع في النص بيسيب
   * "مفيش قفل" مش "مفعّل من غير هاش". لو رمى بيرمي — الشاشة بتقول
   */
  async function wipeLock() {
    // العلم بس هو اللي فشله بيرمي (القفل لسه شغال). بعده القفل اتشال فعلاً، فالباقي محاولة لوحده ومبيرميش —
    // وإلا التخزين يقول "مفيش قفل" والحالة تقول "مقفول" (silent-failure-hunter)
    await SecureStore.deleteItemAsync(K_ENABLED);
    readSeq.current++;
    setEnabled(false);
    setIsLocked(false);
    setReadFailed(false);
    for (const k of [K_TYPE, K_HASH, K_FREQ]) {
      try { await SecureStore.deleteItemAsync(k); } catch (e) { reportAtomicFailure('مسح القفل', e); }
    }
  }

  async function disableLock(code: string): Promise<VerifyResult> {
    const res = await verify(code);
    if (res !== 'ok') return res;
    try { await wipeLock(); } catch (e) { reportAtomicFailure('حفظ القفل', e); return 'error'; }
    return 'ok';
  }

  async function clearLock() {
    await wipeLock();
  }

  async function wipeLockForDeletedAccount() {
    // الحالة الأول (silent-failure-hunter): لو التخزين رمى في النص، الحالة القديمة (enabled=true) كانت هتطلّع شاشة القفل
    // على شاشة الدخول لحساب اتمسح. وكل مفتاح في محاولة لوحده — رمية واحدة متوقّفش مسح الباقي
    readSeq.current++;
    setEnabled(false);
    setIsLocked(false);
    setReadFailed(false);
    setGraceMinutesState(0);
    for (const key of [K_ENABLED, K_TYPE, K_HASH, K_FREQ, K_GRACE]) {
      try { await SecureStore.deleteItemAsync(key); }
      catch (e) { console.warn('[lock] wipe key failed', key, e instanceof Error ? e.name : 'unknown'); }
    }
  }

  /**
   * الهاش والنوع لازم يتغيّروا مع بعض: لو النوع وقع بعد الهاش، الكود الجديد هيتكتب على كيبورد النوع القديم
   * (باسورد بحروف على لوحة أرقام = مقفول برّه). فلو التاني فشل بنرجّع الهاش القديم ونقول "ما اتغيّرش"
   */
  async function changeCode(oldCode: string, newCode: string, newType: LockType): Promise<VerifyResult> {
    const res = await verify(oldCode);
    if (res !== 'ok') return res;
    let oldHash: string | null = null;
    try {
      oldHash = await SecureStore.getItemAsync(K_HASH);
      await SecureStore.setItemAsync(K_HASH, await hash(newCode));
      await SecureStore.setItemAsync(K_TYPE, newType);
    } catch (e) {
      reportAtomicFailure('حفظ القفل', e);
      // الرجوع نفسه فشل ← الهاش الجديد بالنوع القديم؛ بيتبلّغ، والمخرج "نسيت الكود؟" لسه موجود
      if (oldHash) { try { await SecureStore.setItemAsync(K_HASH, oldHash); } catch (e2) { reportAtomicFailure('حفظ القفل', e2); } }
      return 'error';
    }
    setLockType(newType);
    return 'ok';
  }

  async function setGraceMinutes(m: number) {
    try { await SecureStore.setItemAsync(K_GRACE, String(m)); }
    catch (e) { reportAtomicFailure('حفظ القفل', e); return false; }
    setGraceMinutesState(m);
    return true;
  }

  async function setFrequency(f: LockFrequency) {
    try { await SecureStore.setItemAsync(K_FREQ, f); }
    catch (e) { reportAtomicFailure('حفظ القفل', e); return false; }
    setFrequencyState(f);
    return true;
  }

  async function verify(code: string): Promise<VerifyResult> {
    try {
      const stored = await SecureStore.getItemAsync(K_HASH);
      // مفعّل من غير هاش (مفروض ميحصلش بعد ترتيب التفعيل) ← "غلط": المخرج "نسيت الكود؟"
      if (!stored) return 'wrong';
      const h = await hash(code);
      return h === stored ? 'ok' : 'wrong';
    } catch (e) {
      reportAtomicFailure('التحقق من كود القفل', e);
      return 'error';
    }
  }

  function unlock() {
    readSeq.current++; // قراية لسه شغالة مترجعش تقفل بعد ما فتح
    setIsLocked(false);
    setReadFailed(false);
  }

  return (
    <AppLockContext.Provider value={{ enabled, lockType, frequency, isLocked, loading, readFailed, retryRead, setupLock, disableLock, clearLock, wipeLockForDeletedAccount, changeCode, setFrequency, graceMinutes, setGraceMinutes, verify, unlock }}>
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be used within AppLockProvider');
  return ctx;
}