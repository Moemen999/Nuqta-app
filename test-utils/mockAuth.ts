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
