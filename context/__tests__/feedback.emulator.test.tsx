import { db } from '@/firebaseConfig';
import { clearFirestore, settle, signInTestUser } from '@/test-utils/emulator';
import { setMockUid } from '@/test-utils/mockAuth';
import { renderDataProvider } from '@/test-utils/renderDataProvider';
import {
  addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: require('@/test-utils/mockAuth').getMockUid() } }),
}));

/**
 * مجموعة `feedback` هي الحاجة الوحيدة في التطبيق اللي برّه `users/{uid}`،
 * يعني القواعد هي الحاجة الوحيدة اللي بتمنع مستخدم من إنه يقرا آراء غيره أو
 * يزوّر رأي باسم حد تاني. كل شرط فيها ليه اختبار.
 */

async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toMatchObject({ code: 'permission-denied' });
}

function validDoc(uid: string, over: Record<string, unknown> = {}) {
  return {
    uid, type: 'bug', text: 'فيه مشكلة في الشاشة دي',
    appVersion: '1.0.0', buildNumber: '007', fullVersion: '1.0.0.007',
    platform: 'android', deviceModel: 'samsung SM-A546B', osVersion: '14',
    createdAt: serverTimestamp(),
    ...over,
  };
}

beforeEach(async () => {
  await clearFirestore();
});

describe('قواعد مجموعة الآراء', () => {
  it('الرأي الصح بيتقبل', async () => {
    const uid = await signInTestUser();
    await expect(addDoc(collection(db, 'feedback'), validDoc(uid))).resolves.toBeDefined();
  });

  it('كل الأنواع التلاتة مقبولة', async () => {
    const uid = await signInTestUser();
    for (const type of ['bug', 'idea', 'praise']) {
      await expect(addDoc(collection(db, 'feedback'), validDoc(uid, { type }))).resolves.toBeDefined();
    }
  });

  it('نوع برّه القايمة مرفوض', async () => {
    const uid = await signInTestUser();
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc(uid, { type: 'spam' })));
  });

  it('uid مختلف عن المستخدم الحالي مرفوض — محدش يكتب باسم حد تاني', async () => {
    await signInTestUser();
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc('uid-tany')));
  });

  it('النص الفاضي مرفوض', async () => {
    const uid = await signInTestUser();
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc(uid, { text: '' })));
  });

  it('نص أطول من 1000 مرفوض', async () => {
    const uid = await signInTestUser();
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc(uid, { text: 'ا'.repeat(1001) })));
  });

  it('1000 بالظبط مقبول', async () => {
    const uid = await signInTestUser();
    await expect(
      addDoc(collection(db, 'feedback'), validDoc(uid, { text: 'ا'.repeat(1000) }))
    ).resolves.toBeDefined();
  });

  it('نص مش string مرفوض', async () => {
    const uid = await signInTestUser();
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc(uid, { text: 123 })));
  });

  it('تاريخ من العميل مرفوض — لازم ييجي من السيرفر', async () => {
    const uid = await signInTestUser();
    await expectDenied(
      addDoc(collection(db, 'feedback'), validDoc(uid, { createdAt: '2020-01-01T00:00:00.000Z' }))
    );
    await expectDenied(
      addDoc(collection(db, 'feedback'), validDoc(uid, { createdAt: new Date(2020, 0, 1) }))
    );
  });

  it('حقول الجهاز لازم تبقى نصوص قصيرة', async () => {
    const uid = await signInTestUser();
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc(uid, { appVersion: 1 })));
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc(uid, { platform: 'x'.repeat(33) })));
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc(uid, { deviceModel: 'x'.repeat(65) })));
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc(uid, { osVersion: 'x'.repeat(33) })));
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc(uid, { osVersion: 14 })));
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc(uid, { buildNumber: 7 })));
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc(uid, { buildNumber: 'x'.repeat(17) })));
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc(uid, { fullVersion: 1 })));
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc(uid, { fullVersion: 'x'.repeat(49) })));
  });

  it('رقم البناء لازم يكون موجود — من غيره مش هنعرف الرأي جه من أنهي APK', async () => {
    const uid = await signInTestUser();
    const { buildNumber, ...withoutBuild } = validDoc(uid);
    await expectDenied(addDoc(collection(db, 'feedback'), withoutBuild));
    const { fullVersion, ...withoutFull } = validDoc(uid);
    await expectDenied(addDoc(collection(db, 'feedback'), withoutFull));
  });

  it('"dev" مقبول — بناء من جهاز مطوّر', async () => {
    const uid = await signInTestUser();
    await expect(
      addDoc(collection(db, 'feedback'), validDoc(uid, { buildNumber: 'dev', fullVersion: '1.0.0.dev' }))
    ).resolves.toBeDefined();
  });

  it('رقم بناء بأربع خانات (بعد 999) مقبول', async () => {
    const uid = await signInTestUser();
    await expect(
      addDoc(collection(db, 'feedback'), validDoc(uid, { buildNumber: '1000', fullVersion: '1.0.0.1000' }))
    ).resolves.toBeDefined();
  });

  it('موديل حقيقي طويل شوية بيعدّي — 64 حرف مساحة كفاية', async () => {
    const uid = await signInTestUser();
    await expect(
      addDoc(collection(db, 'feedback'), validDoc(uid, { deviceModel: 'Xiaomi Redmi Note 13 Pro Plus 5G' }))
    ).resolves.toBeDefined();
  });

  it('"غير معروف" مقبولة — الجهاز اللي مش راضي يقول موديله', async () => {
    const uid = await signInTestUser();
    await expect(
      addDoc(collection(db, 'feedback'), validDoc(uid, { deviceModel: 'غير معروف', osVersion: 'غير معروف' }))
    ).resolves.toBeDefined();
  });

  it('حقل ناقص مرفوض', async () => {
    const uid = await signInTestUser();
    const { platform, ...withoutPlatform } = validDoc(uid);
    await expectDenied(addDoc(collection(db, 'feedback'), withoutPlatform));
    const { osVersion, ...withoutOs } = validDoc(uid);
    await expectDenied(addDoc(collection(db, 'feedback'), withoutOs));
  });

  it('مستخدم مش مسجّل دخول مبيقدرش يكتب', async () => {
    const uid = await signInTestUser();
    const { signOut, getAuth } = require('firebase/auth');
    await signOut(getAuth());
    await expectDenied(addDoc(collection(db, 'feedback'), validDoc(uid)));
  });

  it('القراية ممنوعة — حتى على رأيك انت', async () => {
    const uid = await signInTestUser();
    await addDoc(collection(db, 'feedback'), validDoc(uid));
    await expectDenied(getDocs(collection(db, 'feedback')));
  });

  it('التعديل والحذف ممنوعين', async () => {
    const uid = await signInTestUser();
    const ref = await addDoc(collection(db, 'feedback'), validDoc(uid));
    await expectDenied(updateDoc(ref, { text: 'اتغير' }));
    await expectDenied(deleteDoc(ref));
    await expectDenied(setDoc(doc(db, 'feedback', ref.id), validDoc(uid)));
  });
});

describe('submitFeedback من الكونتكست', () => {
  let harness: Awaited<ReturnType<typeof renderDataProvider>>;

  beforeEach(async () => {
    setMockUid(await signInTestUser());
    harness = await renderDataProvider();
    await harness.waitForReady();
  });

  afterEach(async () => {
    await harness.unmount();
  });

  it('بيبعت ويرجّع sent لما السيرفر يأكد', async () => {
    expect(await harness.api().submitFeedback('idea', '  اقتراح حلو  ')).toBe('sent');
  });

  /**
   * الاختبار ده عن **التقليم**، مش عن سرعة السيرفر.
   *
   * كان بيتأكد من `'sent'`، ودي بتحتاج تأكيد السيرفر يكسب سباق الـ8 ثواني
   * (`FEEDBACK_ACK_MS`). تحت حمل المحاكي السباق ده بيتكسب أحيانًا وبيتخسر
   * أحيانًا، فالاختبار كان بيرمش من غير ما يكون فيه حاجة غلط: `'pending'`
   * معناها "اتبعتت ولسه مستنيين"، مش "اترفضت".
   *
   * اللي بيهمنا إن القواعد **قبلت** النص بعد التقليم. الرفض ليه قيمة
   * مختلفة تمامًا (`'failed'`) — والاختبار اللي تحته بيثبّت ده بالظبط
   * بالنص الفاضي.
   */
  it('النص بيتقلّم قبل ما يتبعت — لو مااتقلمش القواعد كانت هترفضه', async () => {
    expect(await harness.api().submitFeedback('bug', '   فيه باگ   ')).not.toBe('failed');
    await settle();
  });

  it('النص الفاضي بيترفض من القواعد فبيرجّع failed', async () => {
    expect(await harness.api().submitFeedback('bug', '    ')).toBe('failed');
  });
});
