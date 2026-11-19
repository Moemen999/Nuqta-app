import { auth, db } from '@/firebaseConfig';
import {
    createUserWithEmailAndPassword,
    deleteUser,
    EmailAuthProvider,
    reauthenticateWithCredential,
    signOut as firebaseSignOut,
    GoogleAuthProvider,
    onAuthStateChanged,
    sendEmailVerification,
    sendPasswordResetEmail,
    signInWithCredential,
    signInWithEmailAndPassword,
    updateProfile,
    type User,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { markUserSignOut } from '@/lib/outboxStore';
import { sweepExportFiles } from '@/lib/exportFiles';
import { reportAtomicFailure } from '@/lib/atomicFailure';

type AuthContextType = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogleCredential: (idToken: string) => Promise<void>;
  /**
   * `clearOutbox`: الخروج من الإعدادات بس (اللي بيحذّر بعدد العمليات اللي هتضيع). «نسيت الكود؟» بيخرّج من غيره عن قصد —
   * رسالته بتقول إن البيانات في أمان، فالعمليات اللي مستنية النت بتفضل لنفس الحساب
   */
  logOut: (opts?: { clearOutbox?: boolean }) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /** مسح الحساب — قبل أي مسح: فايربيز بتطلب دخول حديث لـ`deleteUser`، فبنعيده **الأول** عشان ميطلعش بعد ما البيانات راحت */
  reauthenticate: (proof: ReauthProof) => Promise<ReauthOutcome>;
  /** مسح الحساب — آخر خطوة، بعد `deleteAllMyData`: حساب الدخول نفسه (بيخرّج المستخدم) */
  deleteSignInAccount: () => Promise<DeleteSignInOutcome>;
};

export type ReauthProof = { kind: 'password'; password: string } | { kind: 'google'; idToken: string };
/** `mismatch` = حساب جوجل تاني غير اللي فاتح التطبيق */
export type ReauthOutcome = 'done' | 'wrong-password' | 'mismatch' | 'too-many-requests' | 'no-connection' | 'failed';
export type DeleteSignInOutcome = 'done' | 'requires-recent-login' | 'no-connection' | 'failed';

const authCode = (e: unknown) => (e as { code?: string })?.code ?? '';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // أول ما التطبيق يفتح على حساب داخل: كنس مرة واحدة — على أندرويد ملف التصدير بيفضل بعد المشاركة (المستقبِل لسه
    // بيقراه، `lib/exportFiles.ts`)، فاللي فاضل من جلسة قبل كده بيتمسح هنا. مش مع كل تسجيل دخول في نفس الجلسة
    let sweptAtStart = false;
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      // الخروج ومسح الحساب (deleteUser بيخرّج): أي ملف تصدير فاضل في الكاش بيتمسح (Feature 9 بند 3) — مبيرميش
      if (!u) { sweptAtStart = true; void sweepExportFiles(); }
      else if (!sweptAtStart) { sweptAtStart = true; void sweepExportFiles(); }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  async function signIn(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function signUp(email: string, password: string, displayName: string) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // الاسم لوحده (الميزة 11، بند 12): كان `await` من غير try، فوقوعه (النت) كان بيرمي **بعد** ما الحساب اتعمل — فلا بيانات
    // المستخدم اتكتبت ولا إيميل التأكيد اتبعت، والشاشة بتقول "حصل خطأ" على حساب موجود. الاسم بيتحفظ في users/{uid} برضه
    try { await updateProfile(cred.user, { displayName }); }
    catch (e) { reportAtomicFailure('التسجيل: الاسم', e); }
    // مش بنستنى تأكيد السيرفر على الكتابة دي: الحساب اتعمل خلاص، وفايربيز بتكتب
    // محليًا وبترفع لوحدها أول ما النت يسمح. لو استنيناها والنت واقف، المستخدم
    // كان بيفضل قاعد قدام "بيحمّل" وإيميل التأكيد نفسه (اللي تحت) مكانش بيتبعت
    // أصلاً لأننا واقفين مستنيين تأكيد مش جاي.
    setDoc(doc(db, 'users', cred.user.uid), {
      displayName,
      email,
      createdAt: serverTimestamp(),
    }, { merge: true }).catch(e => {
      // البيانات دي تكميلية — مش شرط لدخول المستخدم. الرفض (مش النت) بيوصل Sentry بالكود بس (بند 12)
      reportAtomicFailure('التسجيل: بيانات المستخدم', e);
    });
    try {
      await sendEmailVerification(cred.user);
    } catch (err) {
      // لو إرسال إيميل التأكيد فشل لأي سبب، الحساب لسه اتعمل بنجاح، منمنعش المستخدم من الاستخدام (بانر الإيميل بيعيد).
      // console.error مبيوصلش Sentry (الـbreadcrumbs بتتشال) — الكود بس بيوصل (بند 12)
      reportAtomicFailure('التسجيل: إيميل التأكيد', err);
    }
  }

  async function signInWithGoogleCredential(idToken: string) {
    const credential = GoogleAuthProvider.credential(idToken);
    const cred = await signInWithCredential(auth, credential);
    // أول مرة يسجل بيها بجوجل، نسجل بياناته في نفس مكان مستخدمين الإيميل/الباسورد (merge عشان منمسحش علامة seeded)
    // وزي التسجيل بالإيميل: من غير انتظار تأكيد السيرفر، تسجيل الدخول خلص خلاص
    setDoc(doc(db, 'users', cred.user.uid), {
      displayName: cred.user.displayName || '',
      email: cred.user.email || '',
      createdAt: serverTimestamp(),
    }, { merge: true }).catch(e => {
      // نفس الكلام: بيانات تكميلية — الرفض بيوصل Sentry بالكود بس
      reportAtomicFailure('دخول جوجل: بيانات المستخدم', e);
    });
  }

  async function logOut(opts?: { clearOutbox?: boolean }) {
    // خروج الإعدادات (بعد التحذير بالعدد) ← الطابور المتشفّر بيتمسح (قرار مؤمن 1). «نسيت الكود؟» والخروج الغصب ← بيفضل
    markUserSignOut(opts?.clearOutbox ? auth.currentUser?.uid : null);
    try { await firebaseSignOut(auth); }
    catch (e) { markUserSignOut(null); throw e; }
  }

  /**
   * "نسيت الباسورد؟" في شاشة الدخول.
   *
   * مش رفاهية: مخرج "نسيت الكود؟" في شاشة القفل بيخرّج المستخدم من حسابه،
   * وبيفترض إنه يقدر يدخل تاني. اللي سجّل بإيميل وباسورد ونسي الاتنين
   * (كود القفل وباسورد الحساب) مكانش قدامه أي طريق يرجع لبياناته.
   *
   * بيتستنى فعلاً (`await`) — ده مش كتابة في فايرستور، ده طلب للسيرفر
   * ولازم نعرف نجح ولا لأ عشان نقول للمستخدم حاجة قاطعة.
   */
  async function resetPassword(email: string) {
    await sendPasswordResetEmail(auth, email);
  }

  /**
   * مسح الحساب — إعادة الدخول. **بتتستنى** (طلب للسيرفر، ونتيجته بتقرر نمسح ولا لأ). الأكواد من فايربيز Auth؛ أي حاجة
   * تانية `failed` باسمها في اللوج (من غير الباسورد ولا التوكن).
   */
  async function reauthenticate(proof: ReauthProof): Promise<ReauthOutcome> {
    const u = auth.currentUser;
    if (!u) return 'failed';
    try {
      const credential = proof.kind === 'password'
        ? EmailAuthProvider.credential(u.email ?? '', proof.password)
        : GoogleAuthProvider.credential(proof.idToken);
      await reauthenticateWithCredential(u, credential);
      return 'done';
    } catch (e) {
      const code = authCode(e);
      console.warn('[auth] reauthenticate failed', code || (e instanceof Error ? e.name : 'unknown'));
      // جوجل مالوش باسورد: توكن منتهي أو مش صالح بيرجع invalid-credential — مش "الباسورد مش صح" (silent-failure-hunter)
      if (proof.kind === 'password' && (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials')) return 'wrong-password';
      if (code === 'auth/too-many-requests') return 'too-many-requests';
      if (code === 'auth/user-mismatch') return 'mismatch';
      if (code === 'auth/network-request-failed') return 'no-connection';
      return 'failed';
    }
  }

  /** مسح الحساب — حساب الدخول نفسه. `requires-recent-login` = إعادة الدخول اتأخرت (الشاشة بتطلبها تاني) */
  async function deleteSignInAccount(): Promise<DeleteSignInOutcome> {
    const u = auth.currentUser;
    if (!u) return 'failed';
    try {
      await deleteUser(u);
      // deleteUser بيخرّج المستخدم — لو لسه داخل، منقولش "اتمسح" (silent-failure-hunter)
      if (auth.currentUser) { console.warn('[auth] deleteUser resolved but still signed in'); return 'failed'; }
      return 'done';
    } catch (e) {
      const code = authCode(e);
      console.warn('[auth] deleteUser failed', code || (e instanceof Error ? e.name : 'unknown'));
      if (code === 'auth/requires-recent-login') return 'requires-recent-login';
      if (code === 'auth/network-request-failed') return 'no-connection';
      return 'failed';
    }
  }

  async function resendVerificationEmail() {
    // مفيش مستخدم ← رمية (بند 12): كانت بترجع عادي والشاشة تقول "بعتنالك" ومفيش حاجة اتبعتت
    if (!auth.currentUser) throw Object.assign(new Error('no current user'), { code: 'auth/no-current-user' });
    await sendEmailVerification(auth.currentUser);
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signInWithGoogleCredential, logOut, resendVerificationEmail, resetPassword, reauthenticate, deleteSignInAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
