import { db } from '@/firebaseConfig';
import { clearFirestore, signInTestUser } from '@/test-utils/emulator';
import { addDoc, collection, deleteDoc, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

/**
 * اختبارات مباشرة على قواعد Firestore نفسها (من غير ما تمر بـ DataProvider)،
 * عشان تغطي حاجتين محدش لازم يقدر يتلاعب فيهم من الواجهة أو من نداء API مباشر:
 * عزل بيانات المستخدمين عن بعض، والتحقق من شكل البيانات وقت الكتابة. دي أهم
 * حاجة في تطبيق فيه فلوس ناس.
 */

async function expectDenied(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ code: 'permission-denied' });
}

beforeEach(async () => {
  await clearFirestore();
});

describe('عزل بيانات المستخدمين عن بعض', () => {
  it('مستخدم مقدرش يقرا محافظ مستخدم تاني', async () => {
    const uidA = await signInTestUser();
    await addDoc(collection(db, 'users', uidA, 'wallets'), { name: 'CIB', openingBalance: 0, lowAlert: 100 });

    await signInTestUser(); // مستخدم تاني (B) — وده بيسجل خروج A تلقائيًا
    await expectDenied(getDocs(collection(db, 'users', uidA, 'wallets')));
  });

  it('مستخدم مقدرش يكتب في محافظ مستخدم تاني', async () => {
    const uidA = await signInTestUser();
    await signInTestUser(); // B
    await expectDenied(
      addDoc(collection(db, 'users', uidA, 'wallets'), { name: 'حساب دخيل', openingBalance: 0, lowAlert: 0 })
    );
  });

  it('مستخدم مقدرش يمسح عملية مستخدم تاني', async () => {
    const uidA = await signInTestUser();
    const txRef = await addDoc(collection(db, 'users', uidA, 'transactions'), {
      type: 'expense', amount: 100, walletId: 'w1', date: '2026-03-10',
    });

    await signInTestUser(); // B
    await expectDenied(deleteDoc(doc(db, 'users', uidA, 'transactions', txRef.id)));
  });

  it('مستخدم مقدرش يعدل مستند المستخدم الأساسي بتاع مستخدم تاني', async () => {
    const uidA = await signInTestUser();
    await signInTestUser(); // B
    await expectDenied(setDoc(doc(db, 'users', uidA), { seeded: true }, { merge: true }));
  });
});

describe('التحقق من شكل البيانات وقت الكتابة', () => {
  it('عملية بمبلغ سالب ترفض', async () => {
    const uid = await signInTestUser();
    await expectDenied(
      addDoc(collection(db, 'users', uid, 'transactions'), {
        type: 'expense', amount: -100, walletId: 'w1', date: '2026-03-10',
      })
    );
  });

  it('عملية بنوع مش من الأنواع المسموحة ترفض', async () => {
    const uid = await signInTestUser();
    await expectDenied(
      addDoc(collection(db, 'users', uid, 'transactions'), {
        type: 'transfer', amount: 100, walletId: 'w1', date: '2026-03-10',
      })
    );
  });

  it('فئة باسم فاضي ترفض', async () => {
    const uid = await signInTestUser();
    await expectDenied(addDoc(collection(db, 'users', uid, 'categories'), { name: '' }));
  });

  it('محفظة باسم فاضي ترفض', async () => {
    const uid = await signInTestUser();
    await expectDenied(
      addDoc(collection(db, 'users', uid, 'wallets'), { name: '', openingBalance: 0, lowAlert: 0 })
    );
  });

  it('دين بمبلغ إجمالي صفر يترفض', async () => {
    const uid = await signInTestUser();
    await expectDenied(
      addDoc(collection(db, 'users', uid, 'debts'), {
        direction: 'owed_to_me', personName: 'أحمد', totalAmount: 0, date: '2026-03-10',
        isInstallment: false, payments: [], increases: [], createdAt: new Date().toISOString(),
      })
    );
  });

  it('عملية شكلها صح تتقبل عادي (ضبط تأكيدي إن الرفض فوق بسبب الشكل مش حاجة تانية)', async () => {
    const uid = await signInTestUser();
    await expect(
      addDoc(collection(db, 'users', uid, 'transactions'), {
        type: 'expense', amount: 100, walletId: 'w1', date: '2026-03-10',
      })
    ).resolves.toBeDefined();
  });

  /**
   * دين بالاتجاه العكسي لنفس الشخص (زرار "سجّل فلوس ليا عنده"/"سجّل فلوس
   * ليه عندي" في كارت الدين، و"دين جديد" في كشف الحساب) بيبعت شخص بنفس
   * personContactId ودايركشن مختلف عن دين موجود. القاعدة مش بتفرّق أصلاً
   * بين المستندات (مفيش تحقق cross-document على personName/personContactId)،
   * بس ده افتراض ضمني — الاختبار ده بيتأكد منه صراحة عشان محدش يضيف قيد
   * زي "دين واحد بس لكل شخص" من غير ما يلاحظ إنه بيكسر الميزة دي.
   */
  it('دين بالاتجاه العكسي لنفس الشخص (نفس personContactId) بيتقبل عادي', async () => {
    const uid = await signInTestUser();
    const base = {
      personName: 'أحمد', personContactId: 'contact-1', totalAmount: 100, date: '2026-03-10',
      isInstallment: false, payments: [], increases: [], createdAt: new Date().toISOString(),
    };
    await expect(
      addDoc(collection(db, 'users', uid, 'debts'), { ...base, direction: 'owed_to_me' })
    ).resolves.toBeDefined();
    await expect(
      addDoc(collection(db, 'users', uid, 'debts'), { ...base, direction: 'i_owe', totalAmount: 50 })
    ).resolves.toBeDefined();

    const snap = await getDocs(collection(db, 'users', uid, 'debts'));
    const directions = snap.docs.map(d => d.data().direction).sort();
    expect(directions).toEqual(['i_owe', 'owed_to_me']);
    expect(snap.docs.every(d => d.data().personContactId === 'contact-1')).toBe(true);
  });
});

/**
 * حقول الأرشفة. أهم حاجة هنا مش إن الشكل الغلط يترفض — دي المعتاد — لكن إن
 * **المستند القديم يفضل شغّال**: القواعد بتتحقق من المستند بعد الدمج، فلو
 * الحقلين اتكتبوا إجباريين كل محفظة وفئة موجودة من قبل التحديث كانت هتبقى
 * غير قابلة للتعديل، والمستخدم يلاقي نفسه مش قادر يغيّر اسم محفظته.
 */
describe('حقول الأرشفة في المحافظ والفئات', () => {
  it('محفظة من غير حقول أرشفة خالص بتتقبل — ده وضع كل المحافظ القديمة', async () => {
    const uid = await signInTestUser();
    await expect(
      addDoc(collection(db, 'users', uid, 'wallets'), { name: 'CIB', openingBalance: 0, lowAlert: 0 })
    ).resolves.toBeDefined();
  });

  it('تعديل محفظة قديمة (من غير حقول أرشفة) لسه بيعدّي', async () => {
    const uid = await signInTestUser();
    const ref = await addDoc(collection(db, 'users', uid, 'wallets'), {
      name: 'CIB', openingBalance: 0, lowAlert: 0,
    });
    await expect(updateDoc(ref, { name: 'CIB الجديد' })).resolves.toBeUndefined();
  });

  it('archived منطقي و archivedAt نص بيتقبلوا', async () => {
    const uid = await signInTestUser();
    await expect(
      addDoc(collection(db, 'users', uid, 'wallets'), {
        name: 'توفير', openingBalance: 0, lowAlert: 0,
        archived: true, archivedAt: '2026-09-17T10:00:00.000Z',
      })
    ).resolves.toBeDefined();
  });

  it('أرشفة محفظة موجودة بالتعديل بتعدّي', async () => {
    const uid = await signInTestUser();
    const ref = await addDoc(collection(db, 'users', uid, 'wallets'), {
      name: 'توفير', openingBalance: 0, lowAlert: 0,
    });
    await expect(
      updateDoc(ref, { archived: true, archivedAt: new Date().toISOString() })
    ).resolves.toBeUndefined();
  });

  it('archived بنص بدل منطقي بيترفض', async () => {
    const uid = await signInTestUser();
    await expectDenied(
      addDoc(collection(db, 'users', uid, 'wallets'), {
        name: 'توفير', openingBalance: 0, lowAlert: 0, archived: 'true',
      })
    );
  });

  it('archived برقم بيترفض', async () => {
    const uid = await signInTestUser();
    await expectDenied(
      addDoc(collection(db, 'users', uid, 'wallets'), {
        name: 'توفير', openingBalance: 0, lowAlert: 0, archived: 1,
      })
    );
  });

  it('archivedAt برقم بدل نص بيترفض', async () => {
    const uid = await signInTestUser();
    await expectDenied(
      addDoc(collection(db, 'users', uid, 'wallets'), {
        name: 'توفير', openingBalance: 0, lowAlert: 0, archivedAt: 1758100000000,
      })
    );
  });

  it('حقول الأرشفة مبتلغيش باقي التحقق — محفظة من غير اسم لسه بترفض', async () => {
    const uid = await signInTestUser();
    await expectDenied(
      addDoc(collection(db, 'users', uid, 'wallets'), {
        openingBalance: 0, lowAlert: 0, archived: true,
      })
    );
  });

  it('حقول الأرشفة مبتلغيش التحقق من الأرقام — محفظة من غير openingBalance بترفض', async () => {
    const uid = await signInTestUser();
    await expectDenied(
      addDoc(collection(db, 'users', uid, 'wallets'), { name: 'توفير', lowAlert: 0, archived: false })
    );
  });

  it('نفس القواعد بالظبط على الفئات', async () => {
    const uid = await signInTestUser();
    await expect(
      addDoc(collection(db, 'users', uid, 'categories'), { name: 'أكل' })
    ).resolves.toBeDefined();
    await expect(
      addDoc(collection(db, 'users', uid, 'categories'), {
        name: 'ترفيه', archived: true, archivedAt: '2026-09-17T10:00:00.000Z',
      })
    ).resolves.toBeDefined();
    await expectDenied(
      addDoc(collection(db, 'users', uid, 'categories'), { name: 'ترفيه', archived: 'yes' })
    );
    await expectDenied(
      addDoc(collection(db, 'users', uid, 'categories'), { name: 'ترفيه', archivedAt: 5 })
    );
  });

  it('فئة مؤرشفة لسه بترفض الاسم الفاضي', async () => {
    const uid = await signInTestUser();
    await expectDenied(
      addDoc(collection(db, 'users', uid, 'categories'), { name: '', archived: true })
    );
  });
});

/**
 * الدخل الثابت مجموعة جديدة (بند 6) — نفس عزل الأخوات، والاختبار ده بيثبته
 * بدل ما يبقى افتراض إن القاعدة "شبه" اللي جنبها.
 */
describe('الدخل الثابت معزول بين المستخدمين', () => {
  const income = { name: 'المرتب', amount: 8000, walletId: 'w', frequency: 'monthly', mode: 'confirm', status: 'active', dayOfMonth: 25 };

  it('مستخدم مقدرش يقرا ولا يعدّل ولا يمسح دخل مستخدم تاني', async () => {
    const uidA = await signInTestUser();
    await setDoc(doc(db, 'users', uidA, 'incomes', 'i1'), income);
    await signInTestUser();
    await expectDenied(getDocs(collection(db, 'users', uidA, 'incomes')));
    await expectDenied(updateDoc(doc(db, 'users', uidA, 'incomes', 'i1'), { amount: 1 }));
    await expectDenied(deleteDoc(doc(db, 'users', uidA, 'incomes', 'i1')));
  });

  it('ومقدرش يزرع دخل في حساب مستخدم تاني', async () => {
    const uidA = await signInTestUser();
    await signInTestUser();
    await expectDenied(setDoc(doc(db, 'users', uidA, 'incomes', 'evil'), income));
  });
});
