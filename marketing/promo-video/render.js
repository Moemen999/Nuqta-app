const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
(async () => {
  const mode = process.argv[2] || 'stills'; // stills | video
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  page.on('console', m => console.log('page:', m.text()));
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto('file://' + path.join(__dirname, 'index.html'));
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.fonts].map(f => f.load().catch(() => {}))); });
  const loaded = await page.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').length + '/' + document.fonts.size);
  console.log('fonts', loaded);
  const dur = await page.evaluate(() => window.DURATION);
  if (mode === 'stills') {
    const times = (process.argv[3] || '1.5,4.5,8.8,12.5,14.3,16.8,19.6,22.3,24.3,26.2,28.6,31.5').split(',').map(Number);
    for (const t of times) { await page.evaluate(t => window.render(t), t); await page.screenshot({ path: `stills/s_${t.toFixed(2)}.png` }); }
  } else {
    const fps = 30, N = Math.round(dur * fps);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', 'out/silent.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let i = 0; i < N; i++) {
      await page.evaluate(t => window.render(t), i / fps);
      const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 150 === 0) console.log('frame', i, '/', N);
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
  }
  await browser.close();
})();
