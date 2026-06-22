'use strict';

const path = require('path');
const fs   = require('fs');
const { randomEmoji } = require('../utils');

const AUDIO_DIR = path.join(__dirname, '..', 'audio');

// واتساب يقبل PTT بصيغة OGG/Opus فقط — نحاول .ogg أولاً ثم .mp3 كاحتياط
function resolveAudio(filename) {
  const base = filename.replace(/\.(mp3|ogg|wav)$/i, '');
  const ogg  = path.join(AUDIO_DIR, `${base}.ogg`);
  const mp3  = path.join(AUDIO_DIR, `${base}.mp3`);
  if (fs.existsSync(ogg)) return { filePath: ogg, mime: 'audio/ogg; codecs=opus' };
  if (fs.existsSync(mp3)) return { filePath: mp3, mime: 'audio/mpeg' };
  return null;
}

async function playAudio(ctx, filename) {
  const { sock, msg, from } = ctx;

  const resolved = resolveAudio(filename);
  if (!resolved) {
    return sock.sendMessage(from, {
      text: `❌ ملف الصوت غير موجود في مجلد audio/ ${randomEmoji()}`,
    }, { quoted: msg });
  }

  try {
    const buffer = fs.readFileSync(resolved.filePath);
    await sock.sendMessage(from, {
      audio   : buffer,
      mimetype: resolved.mime,
      ptt     : true,
    }, { quoted: msg });
  } catch (err) {
    console.error('Voice error:', err.message);
    await sock.sendMessage(from, {
      text: `❌ مش قادر أشغّل الصوت ${randomEmoji()}`,
    }, { quoted: msg });
  }
}

module.exports = { playAudio };
