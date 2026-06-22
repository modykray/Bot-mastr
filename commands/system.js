'use strict';

const fs   = require('fs');
const path = require('path');
const { randomEmoji, randomErenImage } = require('../utils');

const EREN_AUDIO = path.join(__dirname, '..', 'assets', 'eren_welcome.m4a');

const BOT_NAME = '🤖 ايرن بوت';

const helpMenu = async (ctx) => {
  const { sock, msg, from } = ctx;

  const menu = `
╔══════════════════════════╗
║    ${BOT_NAME}    ║
╚══════════════════════════╝

🎭 *ترفيه*
┣ .جوزني — تجوز عضو عشوائي
┣ .جمالي — نسبة جمالك
┣ .انوثتي — نسبة انوثتك
┣ .رجولتي — نسبة رجولتك
┣ .حب — نسبة الحب (رد على شخص)
┣ .بروفايل — صورة بروفايل
┗ .طقملي — زوج كارتوني عشوائي

👑 *أدمن*
┣ .انطر — طرد (رد على شخص)
┣ .رفاعي — ترقية لأدمن (رد على شخص)
┣ .شدفيه — إزالة أدمن (رد على شخص)
┣ .هنرش مياه — إغلاق المجموعة
┣ .افتح يبني — فتح المجموعة
┣ .منشن — منشن جميع الأعضاء
┣ .حذف — حذف رسالة (رد عليها)
┣ .انذار — إنذار (رد على شخص)
┣ .الانذارات — قائمة الإنذارات
┣ .حذف_انذار — مسح إنذارات (رد على شخص)
┣ .جروب_اسم [اسم] — تغيير اسم الجروب
┣ .جروب_وصف [وصف] — تغيير وصف الجروب
┣ .منع روابط — منع الروابط على غير الأدمنز
┗ .روابط ايقاف — إيقاف منع الروابط

🎵 *ميديا*
┣ .شغل [اسم] — تشغيل أغنية يوتيوب
┣ .تيكتوك [رابط] — تنزيل تيك توك
┗ .انستا [رابط] — تنزيل انستاغرام

🔊 *أصوات*
┣ .سمكة — صوت السمكة
┣ .بورعي — صوت بورعي
┣ .ايرن — صوت ايرن
┗ .اصحي — صوت اصحي

🛠️ *أدوات*
┣ .لصوت — فيديو/صوت → MP3 (رد عليه)
┣ .لجيف — فيديو → GIF (رد عليه)
┣ .لصوره — استيكر/وسائط → صورة (رد عليه)
┗ .نسخ — استخراج نص من صورة (رد عليها)

🎮 *ألعاب*
┗ .مسابقه — لعبة أسئلة وأجوبة

ℹ️ *نظام*
┣ .قائمة — هذه القائمة
┣ .بنج — اختبار السرعة
┗ .تست — اختبار الاتصال

${randomEmoji()} *${BOT_NAME}* — مطور بكل حب
`.trim();

  const erenImg = randomErenImage();
  if (erenImg) {
    await sock.sendMessage(from, { image: erenImg, caption: menu }, { quoted: msg });
  } else {
    await sock.sendMessage(from, { text: menu }, { quoted: msg });
  }
};

const handleWelcome = async (sock, update) => {
  const { id: groupId, participants, action } = update;
  if (action !== 'add') return;

  try {
    const metadata = await sock.groupMetadata(groupId);
    const toJid = p => (typeof p === 'string' ? p : p?.participant || p?.jid || '');
    const mentions = participants.map(toJid).filter(Boolean);
    const mentionText = mentions.map(p => `@${p.split('@')[0]}`).join('\n');

    let inviteLink = '';
    try {
      const code = await sock.groupInviteCode(groupId);
      inviteLink = `https://chat.whatsapp.com/${code}`;
    } catch {}

    const text =
      `منور البار يقلبي 🐦\n` +
      `${mentionText}\n` +
      `شير البار يقلب اخوك\n` +
      (inviteLink ? inviteLink : '');

    const erenImg = randomErenImage();
    if (erenImg) {
      await sock.sendMessage(groupId, { image: erenImg, caption: text.trim(), mentions });
    } else {
      await sock.sendMessage(groupId, { text: text.trim(), mentions });
    }

    // ── إرسال صوت ايرن تلقائي مع الترحيب ───────────────────────────────
    try {
      if (fs.existsSync(EREN_AUDIO)) {
        await sock.sendMessage(groupId, {
          audio: fs.readFileSync(EREN_AUDIO),
          mimetype: 'audio/mp4',
          ptt: true,
        });
      }
    } catch {}

  } catch (err) {
    console.error('Welcome error:', err.message);
  }
};

const erenVoice = async (ctx) => {
  const { sock, from, msg } = ctx;
  try {
    if (!fs.existsSync(EREN_AUDIO)) {
      return sock.sendMessage(from, { text: `❌ ملف الصوت مش موجود` }, { quoted: msg });
    }
    await sock.sendMessage(from, {
      audio: fs.readFileSync(EREN_AUDIO),
      mimetype: 'audio/mp4',
      ptt: true,
    }, { quoted: msg });
  } catch (err) {
    console.error('erenVoice error:', err.message);
  }
};

module.exports = { helpMenu, handleWelcome, erenVoice };
