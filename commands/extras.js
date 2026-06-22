'use strict';

const path     = require('path');
const fs       = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const axios    = require('axios');
const FormData = require('form-data');

const { downloadMediaMessage } = require('baileys');
const { randomEmoji } = require('../utils');

const WARNINGS_FILE = path.join(__dirname, '..', 'auth_info', 'warnings.json');
const TMP_DIR       = path.join(__dirname, '..', 'tmp');

function loadWarnings() {
  try { return JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveWarnings(data) {
  fs.mkdirSync(path.dirname(WARNINGS_FILE), { recursive: true });
  fs.writeFileSync(WARNINGS_FILE, JSON.stringify(data, null, 2));
}

async function dlQuoted(sock, msg) {
  try {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage) return null;
    const fakeMsg = {
      key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
      message: ctx.quotedMessage,
    };
    return await downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: { info(){}, error(){} } });
  } catch (e) { console.error('dlQuoted:', e.message); return null; }
}

// ── بنج ──────────────────────────────────────────────────────────────────────
async function ping(ctx) {
  const { sock, msg, from } = ctx;
  const t = Date.now();
  await sock.sendMessage(from, { text: `🏓 *بنج!*\n⚡ ${Date.now() - t} ms` }, { quoted: msg });
}

// ── منشن الكل ────────────────────────────────────────────────────────────────
async function mentionAll(ctx) {
  const { sock, msg, from, isGroup } = ctx;
  if (!isGroup) return sock.sendMessage(from, { text: `❌ الأمر ده للجروبات بس ${randomEmoji()}` }, { quoted: msg });

  const meta    = await sock.groupMetadata(from);
  const members = meta.participants.map(p => p.id);
  let text = `📢 *منشن الكل — ${meta.subject}*\n\n`;
  members.forEach((id, i) => { text += `${i + 1}. @${id.split('@')[0]}\n`; });

  await sock.sendMessage(from, { text, mentions: members });
}

// ── حذف رسالة ─────────────────────────────────────────────────────────────────
async function deleteMsg(ctx) {
  const { sock, msg, from } = ctx;
  const qCtx = msg.message?.extendedTextMessage?.contextInfo;
  if (!qCtx?.stanzaId) return sock.sendMessage(from, { text: `❌ رد على الرسالة اللي عايز تحذفها ${randomEmoji()}` }, { quoted: msg });

  try {
    await sock.sendMessage(from, {
      delete: { remoteJid: from, fromMe: false, id: qCtx.stanzaId, participant: qCtx.participant },
    });
  } catch {
    await sock.sendMessage(from, { text: `❌ مش قادر أحذف، تأكد إن البوت أدمن ${randomEmoji()}` }, { quoted: msg });
  }
}

// ── نظام الإنذارات ────────────────────────────────────────────────────────────
async function warn(ctx) {
  const { sock, msg, from, sender, isGroup, isOwner } = ctx;
  if (!isGroup) return;

  const meta   = await sock.groupMetadata(from);
  const admins = meta.participants.filter(p => p.admin).map(p => p.id);
  if (!isOwner && !admins.includes(sender))
    return sock.sendMessage(from, { text: `❌ الأمر ده للأدمنز بس ${randomEmoji()}` }, { quoted: msg });

  const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (!target) return sock.sendMessage(from, { text: `❌ رد على رسالة الشخص ${randomEmoji()}` }, { quoted: msg });

  const warnings = loadWarnings();
  const key = `${from}::${target}`;
  warnings[key] = (warnings[key] || 0) + 1;
  saveWarnings(warnings);
  const count = warnings[key];

  if (count >= 3) {
    await sock.sendMessage(from, {
      text: `🚫 @${target.split('@')[0]} وصل لـ 3 إنذارات وهيتطرد! ${randomEmoji()}`,
      mentions: [target],
    }, { quoted: msg });
    try { await sock.groupParticipantsUpdate(from, [target], 'remove'); } catch {}
    warnings[key] = 0;
    saveWarnings(warnings);
  } else {
    await sock.sendMessage(from, {
      text: `⚠️ إنذار لـ @${target.split('@')[0]}\n📊 الإنذارات: ${count}/3`,
      mentions: [target],
    }, { quoted: msg });
  }
}

async function warnDelete(ctx) {
  const { sock, msg, from, sender, isGroup, isOwner } = ctx;
  if (!isGroup) return;

  const meta   = await sock.groupMetadata(from);
  const admins = meta.participants.filter(p => p.admin).map(p => p.id);
  if (!isOwner && !admins.includes(sender))
    return sock.sendMessage(from, { text: `❌ الأمر ده للأدمنز بس ${randomEmoji()}` }, { quoted: msg });

  const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (!target) return sock.sendMessage(from, { text: `❌ رد على رسالة الشخص ${randomEmoji()}` }, { quoted: msg });

  const warnings = loadWarnings();
  delete warnings[`${from}::${target}`];
  saveWarnings(warnings);
  await sock.sendMessage(from, { text: `✅ تم مسح إنذارات @${target.split('@')[0]} ${randomEmoji()}`, mentions: [target] }, { quoted: msg });
}

async function warnList(ctx) {
  const { sock, msg, from, isGroup } = ctx;
  if (!isGroup) return;

  const warnings  = loadWarnings();
  const meta      = await sock.groupMetadata(from);
  const groupWarn = Object.entries(warnings).filter(([k, v]) => k.startsWith(from) && v > 0);

  if (!groupWarn.length)
    return sock.sendMessage(from, { text: `✅ مفيش إنذارات في ${meta.subject} ${randomEmoji()}` }, { quoted: msg });

  const mentions = [];
  let text = `📋 *الإنذارات — ${meta.subject}:*\n\n`;
  groupWarn.forEach(([k, c]) => {
    const jid = k.split('::')[1];
    mentions.push(jid);
    text += `• @${jid.split('@')[0]}: ${c}/3 ⚠️\n`;
  });
  await sock.sendMessage(from, { text, mentions }, { quoted: msg });
}

// ── إعدادات الجروب ────────────────────────────────────────────────────────────
async function changeGroupName(ctx) {
  const { sock, msg, from, sender, args, isGroup, isOwner } = ctx;
  if (!isGroup) return;

  const meta   = await sock.groupMetadata(from);
  const admins = meta.participants.filter(p => p.admin).map(p => p.id);
  if (!isOwner && !admins.includes(sender))
    return sock.sendMessage(from, { text: `❌ الأمر ده للأدمنز بس ${randomEmoji()}` }, { quoted: msg });

  const name = args.slice(1).join(' ');
  if (!name) return sock.sendMessage(from, { text: `❌ اكتب الاسم الجديد بعد الأمر ${randomEmoji()}` }, { quoted: msg });

  await sock.groupUpdateSubject(from, name);
  await sock.sendMessage(from, { text: `✅ تم تغيير اسم الجروب لـ *${name}* ${randomEmoji()}` }, { quoted: msg });
}

async function changeGroupDesc(ctx) {
  const { sock, msg, from, sender, args, isGroup, isOwner } = ctx;
  if (!isGroup) return;

  const meta   = await sock.groupMetadata(from);
  const admins = meta.participants.filter(p => p.admin).map(p => p.id);
  if (!isOwner && !admins.includes(sender))
    return sock.sendMessage(from, { text: `❌ الأمر ده للأدمنز بس ${randomEmoji()}` }, { quoted: msg });

  const desc = args.slice(1).join(' ');
  if (!desc) return sock.sendMessage(from, { text: `❌ اكتب الوصف الجديد بعد الأمر ${randomEmoji()}` }, { quoted: msg });

  await sock.groupUpdateDescription(from, desc);
  await sock.sendMessage(from, { text: `✅ تم تغيير وصف الجروب ${randomEmoji()}` }, { quoted: msg });
}

// ── لصوت (فيديو → MP3) ───────────────────────────────────────────────────────
async function toMp3(ctx) {
  const { sock, msg, from } = ctx;
  const qMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const hasMedia = qMsg?.videoMessage || qMsg?.audioMessage;
  if (!hasMedia) return sock.sendMessage(from, { text: `❌ رد على فيديو أو صوت ${randomEmoji()}` }, { quoted: msg });

  await sock.sendMessage(from, { text: `⏳ بحوّل لـ MP3...` }, { quoted: msg });
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  const buffer = await dlQuoted(sock, msg);
  if (!buffer) return sock.sendMessage(from, { text: `❌ فشل التحميل ${randomEmoji()}` }, { quoted: msg });

  const id   = Date.now();
  const inF  = path.join(TMP_DIR, `${id}_in`);
  const outF = path.join(TMP_DIR, `${id}.mp3`);

  try {
    fs.writeFileSync(inF, buffer);
    await execAsync(`ffmpeg -i "${inF}" -vn -acodec libmp3lame -q:a 2 "${outF}" -y`);
    const audio = fs.readFileSync(outF);
    await sock.sendMessage(from, { audio, mimetype: 'audio/mpeg' }, { quoted: msg });
  } finally {
    if (fs.existsSync(inF)) fs.unlinkSync(inF);
    if (fs.existsSync(outF)) fs.unlinkSync(outF);
  }
}

// ── لجيف (فيديو → GIF) ───────────────────────────────────────────────────────
async function toGif(ctx) {
  const { sock, msg, from } = ctx;
  const qMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!qMsg?.videoMessage) return sock.sendMessage(from, { text: `❌ رد على فيديو ${randomEmoji()}` }, { quoted: msg });

  const buffer = await dlQuoted(sock, msg);
  if (!buffer) return sock.sendMessage(from, { text: `❌ فشل التحميل ${randomEmoji()}` }, { quoted: msg });

  await sock.sendMessage(from, { video: buffer, gifPlayback: true }, { quoted: msg });
}

// ── لصوره (استيكر/وسائط → صورة) ─────────────────────────────────────────────
async function toImage(ctx) {
  const { sock, msg, from } = ctx;
  const qMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const hasMedia = qMsg?.stickerMessage || qMsg?.imageMessage || qMsg?.videoMessage;
  if (!hasMedia) return sock.sendMessage(from, { text: `❌ رد على استيكر أو صورة ${randomEmoji()}` }, { quoted: msg });

  const buffer = await dlQuoted(sock, msg);
  if (!buffer) return sock.sendMessage(from, { text: `❌ فشل التحميل ${randomEmoji()}` }, { quoted: msg });

  await sock.sendMessage(from, { image: buffer }, { quoted: msg });
}

// ── نسخ (OCR) ─────────────────────────────────────────────────────────────────
async function ocr(ctx) {
  const { sock, msg, from } = ctx;
  const qMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!qMsg?.imageMessage) return sock.sendMessage(from, { text: `❌ رد على صورة ${randomEmoji()}` }, { quoted: msg });

  await sock.sendMessage(from, { text: `⏳ بستخرج الكلام من الصورة...` }, { quoted: msg });

  const buffer = await dlQuoted(sock, msg);
  if (!buffer) return sock.sendMessage(from, { text: `❌ فشل التحميل ${randomEmoji()}` }, { quoted: msg });

  const form = new FormData();
  form.append('image', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' });

  const res = await axios.post('https://emam-api.web.id/home/sections/Tools/api/ocr-image', form, {
    headers: form.getHeaders(), timeout: 20000,
  });

  const text = res.data?.result || '❌ مش لاقي نص في الصورة';
  await sock.sendMessage(from, { text }, { quoted: msg });
}

// ── مسابقة ────────────────────────────────────────────────────────────────────
const quizGames = {};

async function quiz(ctx) {
  const { sock, msg, from } = ctx;

  if (quizGames[from]) {
    clearTimeout(quizGames[from].timeout);
    delete quizGames[from];
  }

  try {
    const data = await axios.get(
      'https://raw.githubusercontent.com/Xov445447533/Xov11111/master/src/JSON/venom-%D9%83%D8%AA%D8%A7%D8%A8%D9%87.json',
      { timeout: 10000 }
    );
    const questions = data.data;
    const q = questions[Math.floor(Math.random() * questions.length)];

    await sock.sendMessage(from, {
      text: `╭─────────────────╮\n┃ 🎯 *${q.question}*\n╰─────────────────╯\n\n_اكتب الإجابة خلال 30 ثانية!_`,
    }, { quoted: msg });

    quizGames[from] = {
      answer: q.response,
      timeout: setTimeout(async () => {
        if (quizGames[from]) {
          delete quizGames[from];
          await sock.sendMessage(from, { text: `⏰ انتهى الوقت!\n✅ الإجابة كانت: *${q.response}*` });
        }
      }, 30000),
    };
  } catch {
    await sock.sendMessage(from, { text: `❌ مش قادر أجيب سؤال دلوقتي ${randomEmoji()}` }, { quoted: msg });
  }
}

async function checkQuizAnswer(sock, from, text) {
  if (!quizGames[from]) return false;
  if (text.trim().toLowerCase() !== quizGames[from].answer.trim().toLowerCase()) return false;

  clearTimeout(quizGames[from].timeout);
  delete quizGames[from];
  await sock.sendMessage(from, { text: `🎉 صح! إجابة صحيحة ${randomEmoji()}` });
  return true;
}

module.exports = {
  ping, mentionAll, deleteMsg,
  warn, warnDelete, warnList,
  changeGroupName, changeGroupDesc,
  toMp3, toGif, toImage, ocr,
  quiz, checkQuizAnswer,
};
