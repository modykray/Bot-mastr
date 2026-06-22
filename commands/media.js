'use strict';

const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const { randomEmoji } = require('../utils');

const TEMP_DIR = path.join(os.tmpdir(), 'wabot-media');
fs.mkdirSync(TEMP_DIR, { recursive: true });

// ─── تشغيل yt-dlp وإرجاع المسار الفعلي للملف الناتج ─────────────────────────
function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { timeout: 180000 });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => reject(new Error(
      err.code === 'ENOENT' ? 'yt-dlp غير موجود على السيرفر' : err.message
    )));
    proc.on('close', code => {
      if (code === 0) return resolve(stdout.trim());
      // استخرج السطر الأخير من الخطأ فقط
      const lastErr = stderr.split('\n').filter(l => l.trim() && !l.startsWith('WARNING')).pop() || 'خطأ غير معروف';
      reject(new Error(lastErr.replace(/^ERROR:\s*/i, '')));
    });
  });
}

async function reactToMsg(sock, msg, emoji) {
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: { text: emoji, key: msg.key },
    });
  } catch (_) {}
}

// ─── إيجاد أحدث ملف في مجلد مؤقت ──────────────────────────────────────────
function findLatestFile(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix))
    .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  return files.length ? path.join(dir, files[0].name) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// .شغل — يوتيوب صوت
// ═══════════════════════════════════════════════════════════════════════════
async function playYouTube(ctx) {
  const { sock, msg, from, args } = ctx;
  const query = args.slice(1).join(' ').trim();

  if (!query) {
    return sock.sendMessage(from, {
      text: `🎵 اكتب اسم الأغنية بعد الأمر\nمثال: .شغل عمرو دياب ${randomEmoji()}`,
    }, { quoted: msg });
  }

  await reactToMsg(sock, msg, '⌚');

  const prefix  = `yt_${Date.now()}`;
  const outTmpl = path.join(TEMP_DIR, `${prefix}.%(ext)s`);

  try {
    await runYtDlp([
      `ytsearch1:${query}`,
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '5',
      // Android Music client يتجاوز قيود SABR وSignature
      '--extractor-args', 'youtube:player_client=android_music',
      '--no-playlist',
      '--max-filesize', '49m',
      '--no-warnings',
      '-o', outTmpl,
    ]);

    const outFile = findLatestFile(TEMP_DIR, prefix);
    if (!outFile || !fs.existsSync(outFile)) throw new Error('لم يُنشأ الملف الصوتي');

    const buffer = fs.readFileSync(outFile);
    fs.unlinkSync(outFile);

    await reactToMsg(sock, msg, '✅');
    await sock.sendMessage(from, {
      audio   : buffer,
      mimetype: 'audio/mpeg',
      ptt     : false,
    }, { quoted: msg });

  } catch (err) {
    findLatestFile(TEMP_DIR, prefix) && fs.unlinkSync(findLatestFile(TEMP_DIR, prefix));
    console.error('YouTube error:', err.message);
    await sock.sendMessage(from, {
      text: `❌ مش قادر أجيب الأغنية دي\n${err.message} ${randomEmoji()}`,
    }, { quoted: msg });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// .تيكتوك — تنزيل بدون علامة مائية
// ═══════════════════════════════════════════════════════════════════════════
async function downloadTikTok(ctx) {
  const { sock, msg, from, args } = ctx;
  const url = args[1];

  if (!url || !/tiktok\.com/i.test(url)) {
    return sock.sendMessage(from, {
      text: `🎵 حط رابط تيك توك صح\nمثال: .تيكتوك https://vm.tiktok.com/xxx ${randomEmoji()}`,
    }, { quoted: msg });
  }

  await reactToMsg(sock, msg, '⌚');

  const prefix  = `tt_${Date.now()}`;
  const outTmpl = path.join(TEMP_DIR, `${prefix}.%(ext)s`);

  try {
    await runYtDlp([
      url,
      '--no-playlist',
      '--max-filesize', '49m',
      '--no-warnings',
      '-o', outTmpl,
    ]);

    const outFile = findLatestFile(TEMP_DIR, prefix);
    if (!outFile || !fs.existsSync(outFile)) throw new Error('لم يُنشأ ملف الفيديو');

    const buffer = fs.readFileSync(outFile);
    fs.unlinkSync(outFile);

    await reactToMsg(sock, msg, '✅');
    await sock.sendMessage(from, {
      video   : buffer,
      mimetype: 'video/mp4',
      caption : `تيك توك بدون علامة مائية ${randomEmoji()}`,
    }, { quoted: msg });

  } catch (err) {
    console.error('TikTok error:', err.message);
    await sock.sendMessage(from, {
      text: `❌ مش قادر أنزل الفيديو\n${err.message} ${randomEmoji()}`,
    }, { quoted: msg });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// .انستا — ريلز انستاغرام
// ═══════════════════════════════════════════════════════════════════════════
async function downloadInstagram(ctx) {
  const { sock, msg, from, args } = ctx;
  const url = args[1];

  if (!url || !/instagram\.com/i.test(url)) {
    return sock.sendMessage(from, {
      text: `📸 حط رابط انستاغرام صح\nمثال: .انستا https://www.instagram.com/reel/xxx ${randomEmoji()}`,
    }, { quoted: msg });
  }

  await reactToMsg(sock, msg, '⌚');

  const prefix  = `ig_${Date.now()}`;
  const outTmpl = path.join(TEMP_DIR, `${prefix}.%(ext)s`);

  try {
    await runYtDlp([
      url,
      '--no-playlist',
      '--max-filesize', '49m',
      '--no-warnings',
      '-o', outTmpl,
    ]);

    const outFile = findLatestFile(TEMP_DIR, prefix);
    if (!outFile || !fs.existsSync(outFile)) throw new Error('لم يُنشأ ملف الريلز');

    const buffer = fs.readFileSync(outFile);
    fs.unlinkSync(outFile);

    await reactToMsg(sock, msg, '✅');
    await sock.sendMessage(from, {
      video   : buffer,
      mimetype: 'video/mp4',
      caption : `ريلز انستاغرام ${randomEmoji()}`,
    }, { quoted: msg });

  } catch (err) {
    console.error('Instagram error:', err.message);
    await sock.sendMessage(from, {
      text: `❌ مش قادر أنزل الريلز\n${err.message} ${randomEmoji()}`,
    }, { quoted: msg });
  }
}

module.exports = { playYouTube, downloadTikTok, downloadInstagram };
