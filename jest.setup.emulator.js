// إعدادات إضافية لاختبارات المحاكي بس

// الـ SDK بتاع Firestore بيتكلم مع السيرفر عن طريق XMLHttpRequest، وهو موجود في
// الموبايل والمتصفح لكن مش موجود في بيئة الاختبار (node). بنوفّره من xhr2 عشان
// نفضل شغالين في نفس بيئة jest-expo اللي بتحاكي React Native — لو رحنا لـ jsdom
// كنا هنجيب نسخة المتصفح من firebase/auth اللي مافيهاش getReactNativePersistence.
if (typeof global.XMLHttpRequest === 'undefined') {
  global.XMLHttpRequest = require('xhr2');
}

// من غير keep-alive (2026-11-17 — سبب الوقعات المتقلّبة في `test:db`): Node 19+ بيخلّي
// http.globalAgent يعيد استخدام السوكت، والمحاكي بيقفل السوكت من ناحيته، فطلب بييجي على
// سوكت ميت بيقع ECONNRESET ("socket hang up"، reusedSocket=true — اتقاس: آلاف المرات في
// التشغيلة). لو وقع على أول طلب في Listen، الـWebChannel بيقول ERROR ← الـSDK بيعلّم نفسه
// Offline من أول فشل (MAX_WATCH_STREAM_FAILURES = 1) ← getDocFromServer بيرجع `unavailable`
// بدل `permission-denied`، وrunTransaction/Commit بيفشلوا ← setupStatus=unknown وكتابة
// معلّقة. على الموبايل الـHTTP بتاع النظام (OkHttp) بيعيد المحاولة على السوكت الميت لوحده،
// فده عيب في بيئة الاختبار (xhr2 على Node) مش في التطبيق. سوكت جديد لكل طلب = زي الموبايل.
require('xhr2').prototype.nodejsHttpAgent = new (require('http').Agent)({ keepAlive: false });

// بنقفل اتصال Firestore بعد ما الملف يخلص. من غير كده بتفضل في الخلفية قنوات
// بتحاول توصل وتكتب في الكونسول بعد ما جيست يقفل البيئة، وجيست بيعتبر ده فشل
// ويخرج بكود 1 حتى لو كل الاختبارات عدّت.
afterAll(async () => {
  const { terminate } = require('firebase/firestore');
  const { db } = require('@/firebaseConfig');
  await terminate(db);
});
