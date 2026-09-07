// إعدادات إضافية لاختبارات المحاكي بس

// الـ SDK بتاع Firestore بيتكلم مع السيرفر عن طريق XMLHttpRequest، وهو موجود في
// الموبايل والمتصفح لكن مش موجود في بيئة الاختبار (node). بنوفّره من xhr2 عشان
// نفضل شغالين في نفس بيئة jest-expo اللي بتحاكي React Native — لو رحنا لـ jsdom
// كنا هنجيب نسخة المتصفح من firebase/auth اللي مافيهاش getReactNativePersistence.
if (typeof global.XMLHttpRequest === 'undefined') {
  global.XMLHttpRequest = require('xhr2');
}

// بنقفل اتصال Firestore بعد ما الملف يخلص. من غير كده بتفضل في الخلفية قنوات
// بتحاول توصل وتكتب في الكونسول بعد ما جيست يقفل البيئة، وجيست بيعتبر ده فشل
// ويخرج بكود 1 حتى لو كل الاختبارات عدّت.
afterAll(async () => {
  const { terminate } = require('firebase/firestore');
  const { db } = require('@/firebaseConfig');
  await terminate(db);
});
