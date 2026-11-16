# فيديو نقطة التسويقي

نسخة 2026-11-16 (مؤمن وافق على الشكل المبدئي). رأسي 1080×1920، 30fps، ~32.6 ثانية.

- `index.html` — المشاهد كلها، و`window.render(t)` بيرسم اللحظة `t` بالثانية.
  **البيانات وهمية بالكامل** (أحمد، سارة، «جمعية الشغل»، محافظ كاش/المحفظة/البنك) —
  ممنوع أي اسم أو رقم من حساب حقيقي. والنصوص اللي جوه الشاشات مطابقة لنصوص التطبيق
  (اتراجعت بـ`arabic-copy-reviewer`)، ومجموع المحافظ = الإجمالي في كل مشهد.
- `render.js` — Playwright بيصوّر كل إطار ويبعته لـffmpeg ← `out/silent.mp4` (~12 دقيقة).
- `music.py` — موسيقى هادية بتتولّد محليًا ← `out/music.wav`.

## التشغيل
```
cd marketing/promo-video
npm install            # الخط IBM Plex Sans Arabic من @fontsource
mkdir -p out stills
node render.js
python3 music.py
ffmpeg -y -i out/silent.mp4 -i out/music.wav -c:v copy -c:a aac -b:a 128k -shortest out/nuqta-promo.mp4
```
محتاج Playwright (Chromium) وffmpeg. قبل التسليم: طلّع إطارات بـ`ffmpeg -ss <ثانية>` وبص عليها
(العربي متصل، الأرقام صح، مفيش حاجة مقطوعة).
