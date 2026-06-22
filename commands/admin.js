'use strict';

const fs   = require('fs');
const path = require('path');
const { randomEmoji, randomErenImage } = require('../utils');

const ANTI_LINK_FILE = path.join(__dirname, '..', 'auth_info', 'anti_link.json');

// رابط detector — يمسك http/https/www وأي دومين مشهور
const URL_REGEX = /(?:https?:\/\/|www\.)\S+|(?:[a-zA-Z0-9\-]+\.(?:com|net|org|io|gg|me|ly|tk|co|app|dev|tv|live|xyz|shop|link|site|online|store|info|chat)(?:\/\S*)?)/gi;

function loadAntiLink() {
  try { return JSON.parse(fs.readFileSync(ANTI_LINK_FILE, 'utf8')); }
  catch { return {}; }
}
function saveAntiLink(data) {
  fs.mkdirSync(path.dirname(ANTI_LINK_FILE), { recursive: true });
  fs.writeFileSync(ANTI_LINK_FILE, JSON.stringify(data, null, 2));
}

// ── تفعيل منع الروابط ────────────────────────────────────────────────────────
async function antiLink(ctx) {
  const { sock, msg, from, sender, isGroup, isOwner } = ctx;
  if (!isGroup) return sock.sendMessage(from, { text: `❌ الأمر ده للجروبات بس ${randomEmoji()}` }, { quoted: msg });

  const { isAdmin } = await getGroupContext(sock, from, sender, isOwner);
  if (!isAdmin) return sock.sendMessage(from, { text: `❌ الأمر ده للأدمنز بس ${randomEmoji()}` }, { quoted: msg });

  const data = loadAntiLink();
  data[from] = true;
  saveAntiLink(data);

  await sock.sendMessage(from, {
    text: `🔗🚫 المح راجل ينزل لينك هنيكو بما يرضي الله 😈\n\n_أي رابط من غير الأدمنز هيتحذف فوراً_\nلإيقاف: *.روابط ايقاف*`,
  }, { quoted: msg });
}

// ── إيقاف منع الروابط ────────────────────────────────────────────────────────
async function antiLinkOff(ctx) {
  const { sock, msg, from, sender, isGroup, isOwner } = ctx;
  if (!isGroup) return sock.sendMessage(from, { text: `❌ الأمر ده للجروبات بس ${randomEmoji()}` }, { quoted: msg });

  const { isAdmin } = await getGroupContext(sock, from, sender, isOwner);
  if (!isAdmin) return sock.sendMessage(from, { text: `❌ الأمر ده للأدمنز بس ${randomEmoji()}` }, { quoted: msg });

  const data = loadAntiLink();
  delete data[from];
  saveAntiLink(data);

  await sock.sendMessage(from, {
    text: `انا هاخد بريك يرجالة 😴✌️\n\n_منع الروابط اتوقف، الكل يقدر يبعت روابط دلوقتي_`,
  }, { quoted: msg });
}

// ── فحص الرسائل (بيتنادى من index.js على كل رسالة) ──────────────────────────
async function checkAntiLink(sock, msg, from, sender) {
  try {
    const data = loadAntiLink();
    if (!data[from]) return; // مش مفعّل في الجروب ده

    // استخراج نص الرسالة بكل أنواعها
    const body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption     ||
      msg.message?.videoMessage?.caption     || '';

    // فحص الرسائل اللي فيها رابط مباشر أو preview
    const hasLink =
      URL_REGEX.test(body) ||
      !!msg.message?.extendedTextMessage?.contextInfo?.externalAdReply ||
      !!msg.message?.extendedTextMessage?.matchedText;

    URL_REGEX.lastIndex = 0; // reset لأن الـ regex stateful مع /g

    if (!hasLink) return;

    // تحقق إذا المرسِل أدمن
    const meta   = await sock.groupMetadata(from);
    const admins = meta.participants.filter(p => p.admin).map(p => p.id);
    if (admins.includes(sender)) return; // الأدمن مسموح له

    // احذف الرسالة
    try {
      await sock.sendMessage(from, {
        delete: {
          remoteJid  : from,
          fromMe     : false,
          id         : msg.key.id,
          participant: sender,
        },
      });
    } catch {}

    // أرسل تحذير
    const mention = `@${sender.split('@')[0]}`;
    await sock.sendMessage(from, {
      text: `🚫 ${mention} الروابط ممنوعة في المجموعة دي! ${randomEmoji()}`,
      mentions: [sender],
    });
  } catch (e) {
    console.error('checkAntiLink error:', e.message);
  }
}

async function getGroupContext(sock, from, sender, isOwner) {
  const metadata = await sock.groupMetadata(from);
  const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
  const isAdmin = isOwner || admins.includes(sender);
  return { metadata, admins, isAdmin };
}

async function kick(ctx) {
  const { sock, msg, from, sender, isGroup, isOwner } = ctx;
  if (!isGroup) return;

  const { isAdmin } = await getGroupContext(sock, from, sender, isOwner);
  if (!isAdmin) {
    return sock.sendMessage(from, { text: `الأمر ده للأدمنز بس يا عم ${randomEmoji()}` }, { quoted: msg });
  }

  const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (!target) {
    return sock.sendMessage(from, { text: `ارد على الشخص اللي عايز تطرده ${randomEmoji()}` }, { quoted: msg });
  }

  try {
    await sock.groupParticipantsUpdate(from, [target], 'remove');
    await sock.sendMessage(from, {
      text: `تم طرد @${target.split('@')[0]} من المجموعة ${randomEmoji()}`,
      mentions: [target],
    }, { quoted: msg });
  } catch {
    await sock.sendMessage(from, { text: `مش قادر أطرده، تأكد إني أدمن ${randomEmoji()}` }, { quoted: msg });
  }
}

async function promote(ctx) {
  const { sock, msg, from, sender, isGroup, isOwner } = ctx;
  if (!isGroup) return;

  const { admins, isAdmin, metadata } = await getGroupContext(sock, from, sender, isOwner);
  if (!isAdmin) {
    return sock.sendMessage(from, { text: `ريح يعرص 😂 لما تبقي رول ابقي اتكلم` }, { quoted: msg });
  }

  const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (!target) {
    return sock.sendMessage(from, { text: `ارد على الشخص اللي عايز تعمله أدمن ${randomEmoji()}` }, { quoted: msg });
  }

  // الشخص أدمن بالفعل؟
  if (admins.includes(target)) {
    return sock.sendMessage(from, {
      text: `انت اعمي يعم 🙄 م هو رول قدامك اهو! @${target.split('@')[0]}`,
      mentions: [target],
    }, { quoted: msg });
  }

  try {
    await sock.groupParticipantsUpdate(from, [target], 'promote');
    await sock.sendMessage(from, {
      text: `تم اخدك ع رفاعي بنجاح 🐦\n@${target.split('@')[0]}`,
      mentions: [target],
    }, { quoted: msg });
  } catch {
    await sock.sendMessage(from, { text: `مش قادر أرقيه، تأكد إني أدمن ${randomEmoji()}` }, { quoted: msg });
  }
}

async function demote(ctx) {
  const { sock, msg, from, sender, isGroup, isOwner } = ctx;
  if (!isGroup) return;

  const { admins, isAdmin } = await getGroupContext(sock, from, sender, isOwner);
  if (!isAdmin) {
    return sock.sendMessage(from, { text: `ريح يعرص 😂 لما تبقي رول ابقي اتكلم` }, { quoted: msg });
  }

  const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (!target) {
    return sock.sendMessage(from, { text: `ارد على الأدمن اللي عايز تشيله ${randomEmoji()}` }, { quoted: msg });
  }

  // الشخص مش أدمن أصلاً؟
  if (!admins.includes(target)) {
    return sock.sendMessage(from, {
      text: `حسبي الله ونعم الوكيل فيك 😒 م هو مش رول هتنزلو ازاي؟! @${target.split('@')[0]}`,
      mentions: [target],
    }, { quoted: msg });
  }

  try {
    await sock.groupParticipantsUpdate(from, [target], 'demote');
    await sock.sendMessage(from, {
      text: `اوف انت شديتو جامد 😩\n@${target.split('@')[0]}`,
      mentions: [target],
    }, { quoted: msg });
  } catch {
    await sock.sendMessage(from, { text: `مش قادر أشيله، تأكد إني أدمن ${randomEmoji()}` }, { quoted: msg });
  }
}

async function closeGroup(ctx) {
  const { sock, msg, from, sender, isGroup, isOwner } = ctx;
  if (!isGroup) return;

  const { isAdmin } = await getGroupContext(sock, from, sender, isOwner);
  if (!isAdmin) {
    return sock.sendMessage(from, { text: `الأمر ده للأدمنز بس يا عم ${randomEmoji()}` }, { quoted: msg });
  }

  try {
    await sock.groupSettingUpdate(from, 'announcement');
    const erenImg1 = randomErenImage();
    if (erenImg1) {
      await sock.sendMessage(from, { image: erenImg1, caption: `🐦 كد هنرش مياه\nلما الأرض تنشف هنفتح البار 🔒` }, { quoted: msg });
    } else {
      await sock.sendMessage(from, { text: `🐦 كد هنرش مياه\nلما الأرض تنشف هنفتح البار 🔒` }, { quoted: msg });
    }
  } catch {
    await sock.sendMessage(from, { text: `مش قادر أقفل المجموعة ${randomEmoji()}` }, { quoted: msg });
  }
}

async function openGroup(ctx) {
  const { sock, msg, from, sender, isGroup, isOwner } = ctx;
  if (!isGroup) return;

  const { isAdmin } = await getGroupContext(sock, from, sender, isOwner);
  if (!isAdmin) {
    return sock.sendMessage(from, { text: `الأمر ده للأدمنز بس يا عم ${randomEmoji()}` }, { quoted: msg });
  }

  try {
    await sock.groupSettingUpdate(from, 'not_announcement');
    const erenImg2 = randomErenImage();
    if (erenImg2) {
      await sock.sendMessage(from, { image: erenImg2, caption: `🐦 يارب صبّحنا وربّحنا\nوبين عبادك ما تفضحنا 🔓` }, { quoted: msg });
    } else {
      await sock.sendMessage(from, { text: `🐦 يارب صبّحنا وربّحنا\nوبين عبادك ما تفضحنا 🔓` }, { quoted: msg });
    }
  } catch {
    await sock.sendMessage(from, { text: `مش قادر أفتح المجموعة ${randomEmoji()}` }, { quoted: msg });
  }
}

module.exports = { kick, promote, demote, closeGroup, openGroup, antiLink, antiLinkOff, checkAntiLink };
