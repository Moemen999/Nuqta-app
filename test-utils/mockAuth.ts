/**
 * مستخدم مزيّف للاختبارات. DataProvider بياخد الـ uid من useAuth، والاختبارات
 * محتاجة تغيّره بين اختبار والتاني، فبنحطه هنا عشان الـ mock يقراه وقت النداء
 * (jest.mock مبيسمحش للمصنع يمسك متغيرات من برّه، بس السطر ده بيتقرا وقت
 * الاستدعاء مش وقت التعريف).
 */
let uid = 'test_user';

export function setMockUid(value: string) {
  uid = value;
}

export function getMockUid() {
  return uid;
}

/**
 * `user.metadata.creationTime` للمستخدم المزيّف — `undefined` افتراضيًا، فالفحص
 * بيعدّي على السيرفر زي حساب اتعمل بعد SETUP_FEATURE_CUTOFF. الاختبار اللي
 * محتاجه بيحطه ويرجّعه.
 */
let creationTime: string | undefined;

export function setMockCreationTime(value: string | undefined) {
  creationTime = value;
}

export function getMockUser() {
  return { uid, metadata: { creationTime } };
}
