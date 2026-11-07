import { db } from '@/firebaseConfig';
import { clearFirestore, signInTestUser, writeLegacyDoc, writeRawDoc } from '@/test-utils/emulator';
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

/**
 * بناءات 15–17 سبتمبر (قبل ad4a339) كانت بتخزّن عدد الأقساط من غير تحقق
 * (`Number(اللي اتكتب) || undefined`) — فممكن يكون فيه دين متخزّن فيه -2 أو 3.5.
 * القاعدة بتتحقق من المستند **بعد الدمج**، فلو فحصت الحقل على طول، الدين ده
 * كان هيتقفل: لا دفعة ولا تعديل. القاعدة بتفحص الحقل بس لما يتغيّر.
 */
describe('ديون قديمة فيها عدد أقساط غلط مبتتقفلش', () => {
  const base = { personName: 'صاحبي', totalAmount: 900, direction: 'i_owe' };

  it.each([[-2], [3.5], [0]])('دين متخزّن فيه installmentCount = %p ← تعديل الاسم أو إضافة دفعة بيعدّي', async (bad) => {
    const uid = await signInTestUser();
    await writeLegacyDoc(`users/${uid}/debts/legacy`, { ...base, isInstallment: 'x', installmentCount: bad });
    const ref = doc(db, 'users', uid, 'debts', 'legacy');
    await updateDoc(ref, { personName: 'صاحبي (اتعدّل)' });
    await updateDoc(ref, { note: 'دفعة' });
  });

  it('بس لو الكتابة نفسها غيّرت العدد لقيمة غلط ← مرفوضة', async () => {
    const uid = await signInTestUser();
    await writeLegacyDoc(`users/${uid}/debts/legacy`, { ...base, installmentCount: -2 });
    const ref = doc(db, 'users', uid, 'debts', 'legacy');
    await expectDenied(updateDoc(ref, { installmentCount: -3 }));
    await expectDenied(updateDoc(ref, { installmentCount: 2.5 }));
    await updateDoc(ref, { installmentCount: 3 }); // التصليح مسموح
  });

  it('دين جديد بعدد غلط ← مرفوض زي الأول', async () => {
    const uid = await signInTestUser();
    await expectDenied(setDoc(doc(db, 'users', uid, 'debts', 'n1'), { ...base, installmentCount: -2 }));
    await expectDenied(setDoc(doc(db, 'users', uid, 'debts', 'n2'), { ...base, installmentCount: 3.5 }));
    await expectDenied(setDoc(doc(db, 'users', uid, 'debts', 'n3'), { ...base, installmentAmount: 0 }));
  });

  it('installmentAmount = 0 متخزّن من قبل ← التعديلات التانية بتعدّي', async () => {
    const uid = await signInTestUser();
    await writeLegacyDoc(`users/${uid}/debts/legacy`, { ...base, installmentCount: 200, installmentAmount: 0 });
    await updateDoc(doc(db, 'users', uid, 'debts', 'legacy'), { personName: 'صاحبي ب' });
  });
});

/**
 * تشديد القواعد بعد الاختبار العنيف (2026-11-07): القيم البايظة جوه حساب الواحد نفسه بتترفض وقت الكتابة —
 * وكانت كلها بتتقبل (attackProbe). وكمان: مستند قديم فيه قيمة بايظة **لسه بيتعدّل** في حقل تاني (`unchangedField`)،
 * عشان التشديد ميقفلش حد على بياناته القديمة.
 */
describe('تشديد القيم (الاختبار العنيف)', () => {
  const tx = { type: 'expense', amount: 10, walletId: 'w1', date: '2026-01-01' };
  const deniedCases: [string, string, Record<string, unknown>][] = [
    ['عملية مبلغها Infinity', 'transactions', { ...tx, amount: Infinity }],
    ['عملية مبلغها NaN', 'transactions', { ...tx, amount: NaN }],
    ['عملية تاريخها مش YYYY-MM-DD', 'transactions', { ...tx, date: '1/9/2026' }],
    ['عملية ملاحظتها أطول من 5000', 'transactions', { ...tx, note: 'x'.repeat(5001) }],
    ['عملية ملاحظتها مش نص', 'transactions', { ...tx, note: { a: 1 } }],
    ['عملية toWalletId رقم', 'transactions', { ...tx, toWalletId: 5 }],
    ['عملية createdAt رقم', 'transactions', { ...tx, createdAt: 12345 }],
    ['محفظة رصيدها Infinity', 'wallets', { name: 'x', openingBalance: Infinity, lowAlert: 0 }],
    ['محفظة حد التنبيه NaN', 'wallets', { name: 'x', openingBalance: 0, lowAlert: NaN }],
    ['محفظة اسمها أطول من 500', 'wallets', { name: 'x'.repeat(501), openingBalance: 0, lowAlert: 0 }],
    ['دين اسمه فاضي', 'debts', { personName: '', totalAmount: 1, direction: 'i_owe' }],
    ['دين مبلغه Infinity', 'debts', { personName: 'x', totalAmount: Infinity, direction: 'i_owe' }],
    ['دين payments مش مصفوفة', 'debts', { personName: 'x', totalAmount: 1, direction: 'i_owe', payments: { a: 1 } }],
    ['دين increases نص', 'debts', { personName: 'x', totalAmount: 1, direction: 'i_owe', increases: 'x' }],
    ['اشتراك اسمه فاضي', 'subscriptions', { name: '', amount: 1 }],
    ['اشتراك مبلغه Infinity', 'subscriptions', { name: 'x', amount: Infinity }],
    ['جمعية مبلغها سالب', 'gamiyas', { name: 'x', monthlyAmount: -5 }],
    ['جمعية months مش مصفوفة', 'gamiyas', { name: 'x', monthlyAmount: 5, months: 'x' }],
    ['ميزانية Infinity', 'budgets', { limit: Infinity }],
    ['دخل شخبطة Infinity', 'shakhbata_income', { income: Infinity }],
    ['نسب شخبطة سالبة', 'shakhbata_settings', { needs: 50, wants: -50, future: 20 }],
    ['نسب شخبطة NaN', 'shakhbata_settings', { needs: NaN, wants: 30, future: 20 }],
  ];
  it.each(deniedCases)('%s بيترفض', async (_label, coll, data) => {
    const uid = await signInTestUser();
    await expectDenied(setDoc(doc(db, 'users', uid, coll, 'bad'), data));
  });

  it('ملاحظة 5000 بالظبط واسم 500 بالظبط بيتقبلوا (الحد مش أقل من اللي الخانة بتسمح بيه)', async () => {
    const uid = await signInTestUser();
    await setDoc(doc(db, 'users', uid, 'transactions', 'ok'), { ...tx, note: 'x'.repeat(5000) });
    await setDoc(doc(db, 'users', uid, 'wallets', 'ok'), { name: 'x'.repeat(500), openingBalance: 0, lowAlert: 0 });
  });

  it('محفظة قديمة رصيدها Infinity لسه بتتعدّل في الاسم (القيمة البايظة زي ما هي)', async () => {
    const uid = await signInTestUser();
    await writeRawDoc(`users/${uid}/wallets/old`, { name: 'قديمة', openingBalance: Infinity, lowAlert: 0 });
    await updateDoc(doc(db, 'users', uid, 'wallets', 'old'), { name: 'قديمة 2' });
    // بس متتكتبش قيمة بايظة جديدة
    await expectDenied(updateDoc(doc(db, 'users', uid, 'wallets', 'old'), { openingBalance: NaN }));
  });

  it('عملية قديمة تاريخها بايظ بتتصلّح بتاريخ صح، ومتتعدّلش لتاريخ بايظ تاني', async () => {
    const uid = await signInTestUser();
    await writeRawDoc(`users/${uid}/transactions/old`, { ...tx, date: '1/9/2026' });
    await updateDoc(doc(db, 'users', uid, 'transactions', 'old'), { note: 'لسه بتتعدّل' });
    await expectDenied(updateDoc(doc(db, 'users', uid, 'transactions', 'old'), { date: '2/9/2026' }));
    await updateDoc(doc(db, 'users', uid, 'transactions', 'old'), { date: '2026-09-01' });
  });

  it('دين قديم اسمه فاضي لسه بيتعدّل في حقل تاني', async () => {
    const uid = await signInTestUser();
    await writeRawDoc(`users/${uid}/debts/old`, { personName: '', totalAmount: 100, direction: 'i_owe', payments: [], increases: [] });
    await updateDoc(doc(db, 'users', uid, 'debts', 'old'), { note: 'تعديل' });
  });
});

describe('تشديد القيم — جولة المراجعة (البيانات القديمة متتقفلش)', () => {
  const tx = { type: 'expense', amount: 10, walletId: 'w1', date: '2026-01-01' };
  const debt = { personName: 'صاحبي', totalAmount: 100, direction: 'i_owe', payments: [], increases: [] };

  it('دين قديم ملاحظته أطول من 5000 لسه بياخد دفعة (التعديل مبيلمسش الملاحظة)', async () => {
    const uid = await signInTestUser();
    await writeRawDoc(`users/${uid}/debts/old`, { ...debt, note: 'x'.repeat(6000) });
    await updateDoc(doc(db, 'users', uid, 'debts', 'old'), { payments: [{ amount: 10, date: '2026-01-02' }] });
    // بس ملاحظة طويلة جديدة لأ
    await expectDenied(updateDoc(doc(db, 'users', uid, 'debts', 'old'), { note: 'y'.repeat(6000) }));
  });

  it('عملية قديمة ملاحظتها مش نص لسه بتتعدّل في حقل تاني', async () => {
    const uid = await signInTestUser();
    await writeRawDoc(`users/${uid}/transactions/old`, { ...tx, note: { a: 1 } });
    await updateDoc(doc(db, 'users', uid, 'transactions', 'old'), { categoryId: 'c1' });
  });

  it('عملية قديمة مبلغها Infinity لسه بتتعدّل في حقل تاني، ومتتكتبش Infinity جديدة', async () => {
    const uid = await signInTestUser();
    await writeRawDoc(`users/${uid}/transactions/old`, { ...tx, amount: Infinity });
    await updateDoc(doc(db, 'users', uid, 'transactions', 'old'), { categoryId: 'c1' });
    await expectDenied(setDoc(doc(db, 'users', uid, 'transactions', 'new'), { ...tx, amount: Infinity }));
  });

  // NaN مبيساويش نفسه في أغلب اللغات — لو القواعد كده، المحفظة القديمة اللي رصيدها NaN هتتقفل للأبد
  it('محفظة قديمة رصيدها NaN: نتيجة التعديل في الاسم', async () => {
    const uid = await signInTestUser();
    await writeRawDoc(`users/${uid}/wallets/old`, { name: 'قديمة', openingBalance: NaN, lowAlert: 0 });
    await updateDoc(doc(db, 'users', uid, 'wallets', 'old'), { name: 'قديمة 2' });
  });
});

it('محفظة قديمة رصيدها NaN: مينفعش تتحط NaN في محفظة سليمة بالتعديل', async () => {
  const uid = await signInTestUser();
  await setDoc(doc(db, 'users', uid, 'wallets', 'ok'), { name: 'سليمة', openingBalance: 5, lowAlert: 0 });
  await expectDenied(updateDoc(doc(db, 'users', uid, 'wallets', 'ok'), { openingBalance: NaN }));
});
