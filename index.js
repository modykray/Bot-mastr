'use strict';

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  makeCacheableSignalKeyStore,
  Browsers,
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const http = require('http');

const OWNER_NUMBER = '01110302392';
const AUTH_FOLDER = path.join(__dirname, 'auth_info');
const SUB_BOTS_DIR = path.join(AUTH_FOLDER, 'sub_bots');
const ASSETS_FOLDER = path.join(__dirname, 'assets');
const MAX_SUB_BOTS = 4;

const logger = pino({ level: 'silent' });

// ─── إسكات الضجيج ──────────────────────────────────────────────
const NOISE = ['Closing session', 'Closing open session', 'SessionEntry', 'registrationId',
               'currentRatchet', 'ephemeralKeyPair', 'lastRemoteEphemeralKey', 'indexInfo',
               'pendingPreKey', '_chains', 'baseKey', 'rootKey', 'privKey', 'pubKey'];

const _origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => {
  const s = typeof chunk === 'string' ? chunk : chunk?.toString?.() || '';
  if (NOISE.some(n => s.includes(n))) return true;
  return _origWrite(chunk, ...rest);
};

const _origLog = console.log;
console.log = (...args) => {
  const s = String(args[0] ?? '');
  if (NOISE.some(n => s.includes(n))) return;
  _origLog(...args);
};

// ─── المتغيرات العامة ──────────────────────────────────────────
let botEnabled = true;
let currentMainSock = null;
let pairingRequested = false;
const subBotSockets = new Map();
const userStats = new Map();
const groupStats = new Map();
let autoReactEnabled = false;

// ─── دوال المساعدة ──────────────────────────────────────────────
function getRandomImage() {
  try {
    if (!fs.existsSync(ASSETS_FOLDER)) return null;
    const files = fs.readdirSync(ASSETS_FOLDER);
    const images = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
    if (images.length === 0) return null;
    return path.join(ASSETS_FOLDER, images[Math.floor(Math.random() * images.length)]);
  } catch { return null; }
}

function getRandomAhaSticker() {
  const stickers = ['aha1.webp', 'aha2.webp', 'aha3.webp'];
  return path.join(ASSETS_FOLDER, stickers[Math.floor(Math.random() * stickers.length)]);
}

function getStickerPath(name) {
  return path.join(ASSETS_FOLDER, `${name}.webp`);
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── معالجة الرسائل ────────────────────────────────────────────
async function handleMessage(sock, msg, isSubBot = false) {
  try {
    if (!msg.message) return;
    if (isJidBroadcast(msg.key.remoteJid)) return;

    const from = msg.key.remoteJid;
    const isGrp = from?.endsWith('@g.us');
    const sender = isGrp ? msg.key.participant : msg.key.remoteJid;
    const isOwner = sender === `${OWNER_NUMBER}@s.whatsapp.net` || msg.key.fromMe;
    
    const body = msg.message?.conversation ||
                 msg.message?.extendedTextMessage?.text ||
                 msg.message?.imageMessage?.caption ||
                 msg.message?.videoMessage?.caption || '';

    // تحديث الإحصائيات
    if (sender && !msg.key.fromMe) {
      if (!userStats.has(sender)) {
        userStats.set(sender, { messages: 0, lastMsg: Date.now() });
      }
      const stat = userStats.get(sender);
      stat.messages += 1;
      stat.lastMsg = Date.now();
      userStats.set(sender, stat);

      if (isGrp) {
        if (!groupStats.has(from)) {
          groupStats.set(from, { members: {}, totalMsgs: 0 });
        }
        const gStat = groupStats.get(from);
        if (!gStat.members[sender]) gStat.members[sender] = 0;
        gStat.members[sender] += 1;
        gStat.totalMsgs += 1;
        groupStats.set(from, gStat);
      }
    }

    // منع الروابط
    if (!msg.key.fromMe && isGrp) {
      const antiLinkEnabled = await getAntiLinkStatus(from);
      if (antiLinkEnabled) {
        const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)/i;
        if (urlRegex.test(body)) {
          await sock.sendMessage(from, { delete: msg.key });
          await sock.sendMessage(from, {
            text: `لو انت راجل نزل لينك وهنيكك فل 🐦`,
            mentions: [sender]
          }, { quoted: msg });
          return;
        }
      }
    }

    if (!botEnabled && !isOwner) return;

    // ─── الردود التلقائية على الكلمات ──────────────────────
    if (body && !body.startsWith('.') && !msg.key.fromMe) {
      const norm = body.replace(/[أإآ]/g, 'ا').toLowerCase().trim();
      
      // احا
      if (/احا/.test(norm)) {
        await sock.sendMessage(from, {
          sticker: { url: getRandomAhaSticker() }
        }, { quoted: msg });
        return;
      }

      // حب / عشق
      if (/بحبك|حبك|حبق|روحي|قلبي|بعشقك|يروحي|يقلبي/.test(norm)) {
        await sock.sendMessage(from, {
          sticker: { url: getStickerPath('Mhny') }
        }, { quoted: msg });
        return;
      }

      // متناكه
      if (/ابن.?متناكه|بنت.?متناكه|ولاد.?متناكه|متناكه/.test(norm)) {
        await sock.sendMessage(from, {
          sticker: { url: getStickerPath('Mtnak') }
        }, { quoted: msg });
        return;
      }

      // كارف
      if (/كارف|بتكرف|كارفة|بتكرفي/.test(norm)) {
        await sock.sendMessage(from, {
          sticker: { url: getStickerPath('Karf') }
        }, { quoted: msg });
        return;
      }

      // بتاعي / حنكش
      if (/بتاعي|حنكش|زبي|ظوبري/.test(norm)) {
        await sock.sendMessage(from, {
          sticker: { url: getStickerPath('Hnksh') }
        }, { quoted: msg });
        return;
      }

      // كسمك
      if (/كسمك|يكسمك|بكسمك/.test(norm)) {
        await sock.sendMessage(from, {
          sticker: { url: getStickerPath('Ksomk') }
        }, { quoted: msg });
        return;
      }

      // يسطا
      if (/(?<!\S)يسطا(?!\S)|يا.?اسطي/.test(norm)) {
        await sock.sendMessage(from, {
          sticker: { url: getStickerPath('Ysta') }
        }, { quoted: msg });
        return;
      }

      // جبنة
      if (/جبنة|جبان/.test(norm)) {
        await sock.sendMessage(from, {
          sticker: { url: getStickerPath('Gbnt') }
        }, { quoted: msg });
        return;
      }

      // استر
      if (/استر|متستر|ما.?تستر/.test(norm)) {
        await sock.sendMessage(from, {
          sticker: { url: getStickerPath('Astr') }
        }, { quoted: msg });
        return;
      }

      // منشن على المطور
      if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.includes(`${OWNER_NUMBER}@s.whatsapp.net`)) {
        await sock.sendMessage(from, {
          sticker: { url: getStickerPath('Mnshn') }
        }, { quoted: msg });
        return;
      }

      // تفاعل تلقائي
      if (autoReactEnabled) {
        const emojis = ['🔥', '❤️', '😂', '💀', '🐦', '🫶🏻', '👾'];
        await sock.sendMessage(from, {
          react: { key: msg.key, text: getRandom(emojis) }
        });
      }
      return;
    }

    if (!body.startsWith('.')) return;

    const parts = body.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    // جلب الـ quoted message
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const target = mentionedJid[0] || (quotedMsg ? msg.key.participant || msg.key.remoteJid : null);

    const ctx = { sock, msg, from, sender, args, isGrp, ownerNumber: OWNER_NUMBER, isOwner, body, target, quotedMsg };

    console.log(`[${isSubBot ? 'SUB' : 'BOT'}] ${sender?.split('@')[0]} → ${command}`);

    switch (command) {

      // ─── اوامر ────────────────────────────────────────────
      case '.اوامر': {
        const img = getRandomImage();
        const helpText = 
`ㅤㅤׄ        (╲︵᷼   ⊹      ⏜✿╱)ㅤㅤ  𝅄ㅤ
 ㅤ               \`Erin 𝖻𝗈𝗍\` ㅤׅ
 ׅ    ׂ  ⤹⤹᪲  ۪ 𝗈𝗐𝗇𝖾𝗋 : ${OWNER_NUMBER}
 ׅ    ׂ  ⤹⤹᪲  ۪ 𝖻𝗈𝗍 : ايرن بوت
 ׅ    ׂ  ⤹⤹᪲  ۪ 𝗌𝗍𝖺𝗍𝗎𝗌 : 𝗈𝗇𝗅𝗂𝗇𝖾 24/7
 ㅤ ⊹┉─ׄ───┈‌   ⑅   ‌┈───ׅ─┉⊹

╭᥍╮ ᰨ 𝖼𝗈𝗆𝗆𝖺𝗇𝖽𝗌◝
│  │ ׂ ᩮ⃘᪁ ׅ بنج ⇢ سرعة البوت
│  │ ׂ ᩮ⃘᪁ ׅ تست ⇢ اختبار البوت
│  │ ׂ ᩮ⃘᪁ ׅ المطور ⇢ رقم المطور
│  │ ׂ ᩮ⃘᪁ ׅ تنصيب ⇢ ربط البوت برقمك
│  │ ׂ ᩮ⃘᪁ ׅ زوجني ⇢ زواج وهمي
│  │ ׂ ᩮ⃘᪁ ׅ رجولتي ⇢ نسبة رجولتك
│  │ ׂ ᩮ⃘᪁ ׅ انوثتي ⇢ نسبة انوثتك
│  │ ׂ ᩮ⃘᪁ ׅ حب ⇢ نسبة الحب
│  │ ׂ ᩮ⃘᪁ ׅ مزاجي ⇢ مزاجك النهارده
│  │ ׂ ᩮ⃘᪁ ׅ ترول ⇢ طقطقة
│  │ ׂ ᩮ⃘᪁ ׅ سكس ⇢ كسمك ينجس
│  │ ׂ ᩮ⃘᪁ ׅ بوت ⇢ حالة البوت
│  │ ׂ ᩮ⃘᪁ ׅ بوت_معلومات ⇢ معلومات البوت
╰᥍╯

╭᥍╮ ᰨ 𝗀𝗋𝗈𝗎𝗉 𝗍𝗈𝗈𝗅𝗌◝
│  │ ׂ ᩮ⃘᪁ ׅ انطر ⇢ طرد عضو
│  │ ׂ ᩮ⃘᪁ ׅ رفاعي ⇢ رفع مشرف
│  │ ׂ ᩮ⃘᪁ ׅ شدفيه ⇢ تنزيل مشرف
│  │ ׂ ᩮ⃘᪁ ׅ هنرش مياه ⇢ قفل المجموعة
│  │ ׂ ᩮ⃘᪁ ׅ افتح يبني ⇢ فتح المجموعة
│  │ ׂ ᩮ⃘᪁ ׅ منع روابط ⇢ تفعيل منع الروابط
│  │ ׂ ᩮ⃘᪁ ׅ روابط ايقاف ⇢ إيقاف منع الروابط
│  │ ׂ ᩮ⃘᪁ ׅ منشن ⇢ منشن الكل
│  │ ׂ ᩮ⃘᪁ ׅ حذف ⇢ حذف رسالة
│  │ ׂ ᩮ⃘᪁ ׅ ادمنية ⇢ قائمة المشرفين
│  │ ׂ ᩮ⃘᪁ ׅ توب ⇢ أجمد 5 أعضاء
│  │ ׂ ᩮ⃘᪁ ׅ رسائلي ⇢ عدد رسائلك
│  │ ׂ ᩮ⃘᪁ ׅ تفاعل ⇢ تفعيل التفاعل التلقائي
│  │ ׂ ᩮ⃘᪁ ׅ نو تفاعل ⇢ إيقاف التفاعل
│  │ ׂ ᩮ⃘᪁ ׅ معلومات ⇢ معلومات حسابك
╰᥍╯

╭᥍╮ ᰨ 𝗈𝗐𝗇𝖾𝗋◝
│  │ ׂ ᩮ⃘᪁ ׅ رفرش ⇢ إعادة تشغيل البوت
│  │ ׂ ᩮ⃘᪁ ׅ بور_اوف ⇢ إيقاف البوت
│  │ ׂ ᩮ⃘᪁ ׅ شيل_بوت ⇢ حذف بوت فرعي
╰᥍╯

 ╭ဣ ⸼ 𝗉𝗈𝗐𝖾𝗋 𝅄 
 │┄─────────────ׄ─֟╺៶ ‌꒱ 𝅄
 ││⸼ ᧔⃘ᦅ ۫ 24/7 𝗈𝗇𝗅𝗂𝗇𝖾 ⦂ 𝗆𝖽 𝖾𝗇𝗀𝗂𝗇𝖾
 ╰───ׅ ဣ  ׁ ⏜⌢꯭⋒ ۫

 ㅤׄ𐂯◟𝗆𝖺𝖽𝖾 𝖻𝗒 𝗂𝗍𝗌_𝗐𝗁𝗈𝗈𝗈𝗈𝗈𝗈𝗈𝗌𝗁`;

        if (img) {
          await sock.sendMessage(from, { image: { url: img }, caption: helpText }, { quoted: msg });
        } else {
          await sock.sendMessage(from, { text: helpText }, { quoted: msg });
        }
        break;
      }

      // ─── رفاعي ────────────────────────────────────────────
      case '.رفاعي': {
        if (!isGrp) { await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg }); break; }
        if (!target) { await sock.sendMessage(from, { text: '❌ ارد على الشخص أو منشنه' }, { quoted: msg }); break; }
        
        try {
          await sock.groupParticipantsUpdate(from, [target], 'promote');
          await sock.sendMessage(from, {
            text: `تم اخدك ع رفاعي بنجاح 🐦 @${target.split('@')[0]}`,
            mentions: [target]
          }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
        }
        break;
      }

      // ─── شدفيه ────────────────────────────────────────────
      case '.شدفيه': {
        if (!isGrp) { await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg }); break; }
        if (!target) { await sock.sendMessage(from, { text: '❌ ارد على الشخص أو منشنه' }, { quoted: msg }); break; }
        
        try {
          await sock.groupParticipantsUpdate(from, [target], 'demote');
          await sock.sendMessage(from, {
            text: `نزلت من الرول مصمص بق 🫦 @${target.split('@')[0]}`,
            mentions: [target]
          }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
        }
        break;
      }

      // ─── منشن ─────────────────────────────────────────────
      case '.منشن': {
        if (!isGrp) { await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg }); break; }
        
        try {
          const metadata = await sock.groupMetadata(from);
          const participants = metadata.participants.map(p => p.id);
          const mentions = participants.join(' @');
          
          await sock.sendMessage(from, {
            text: `منشن للكل 🐦\n${mentions}`,
            mentions: participants
          }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
        }
        break;
      }

      // ─── توب ──────────────────────────────────────────────
      case '.توب': {
        if (!isGrp) { await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg }); break; }
        
        const gStat = groupStats.get(from);
        if (!gStat || Object.keys(gStat.members).length === 0) {
          await sock.sendMessage(from, { text: '📊 مفيش بيانات كافية' }, { quoted: msg });
          break;
        }

        const sorted = Object.entries(gStat.members)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);

        const emojis = ['🥇', '🥈', '🥉', '💪', '👏'];
        let text = '🏆 *أجمد 5 أعضاء*\n\n';
        sorted.forEach(([user, count], i) => {
          text += `${emojis[i] || '👤'} @${user.split('@')[0]} - ${count} رسالة\n`;
        });

        await sock.sendMessage(from, {
          text: text,
          mentions: sorted.map(s => s[0])
        }, { quoted: msg });
        break;
      }

      // ─── ترول ─────────────────────────────────────────────
      case '.ترول': {
        const trolls = [
          `وشك ده ولي علبة كبريت 🐦`,
          `انت فاكر نفسك مين يا عرص 🤣`,
          `شكلك عامل زي البطيخه 🍉`,
          `يابو وش الكلب 🐕`,
          `ربنا يخليك للطزازة 😂`,
          `انت جامد بس في النوم 😴`,
          `شكلك عامل زي الفراخ 🍗`,
          `انت عارف انك وحش؟ لا طبعاً 🤣`,
          `ضحكتني بجد 😂😂`,
          `وشك يخوف الاطفال 👻`
        ];
        
        const targetUser = target || sender;
        await sock.sendMessage(from, {
          text: `@${targetUser.split('@')[0]} ${getRandom(trolls)}`,
          mentions: [targetUser]
        }, { quoted: msg });
        break;
      }

      // ─── انطر ─────────────────────────────────────────────
      case '.انطر': {
        if (!isGrp) { await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg }); break; }
        if (!target) { await sock.sendMessage(from, { text: '❌ ارد على الشخص أو منشنه' }, { quoted: msg }); break; }
        
        try {
          await sock.groupParticipantsUpdate(from, [target], 'remove');
          await sock.sendMessage(from, {
            text: `بره يكسمك 👾 @${target.split('@')[0]}`,
            mentions: [target]
          }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
        }
        break;
      }

      // ─── هنرش مياه ────────────────────────────────────────
      case '.هنرش': {
        if (!isGrp) { await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg }); break; }
        if (!isOwner && !await isAdmin(sock, from, sender)) {
          await sock.sendMessage(from, { text: '❌ الأمر ده للمشرفين بس' }, { quoted: msg });
          break;
        }

        try {
          await sock.groupSettingUpdate(from, 'announcement');
          const img = getRandomImage();
          const text = 'هنرش مياة لما البار ينشف هفتحو 🐦🫶🏻';
          
          if (img) {
            await sock.sendMessage(from, { image: { url: img }, caption: text }, { quoted: msg });
          } else {
            await sock.sendMessage(from, { text: text }, { quoted: msg });
          }
        } catch (e) {
          await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
        }
        break;
      }

      // ─── افتح يبني ─────────────────────────────────────────
      case '.افتح': {
        if (!isGrp) { await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg }); break; }
        if (parts[1] !== 'يبني') break;
        if (!isOwner && !await isAdmin(sock, from, sender)) {
          await sock.sendMessage(from, { text: '❌ الأمر ده للمشرفين بس' }, { quoted: msg });
          break;
        }

        try {
          await sock.groupSettingUpdate(from, 'not_announcement');
          const metadata = await sock.groupMetadata(from);
          const participants = metadata.participants.map(p => p.id);
          
          const img = getRandomImage();
          const text = 'المياة نشفت تعالي ارغي يقلبي 🐦';
          
          if (img) {
            await sock.sendMessage(from, {
              image: { url: img },
              caption: text,
              mentions: participants
            }, { quoted: msg });
          } else {
            await sock.sendMessage(from, {
              text: text,
              mentions: participants
            }, { quoted: msg });
          }
        } catch (e) {
          await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
        }
        break;
      }

      // ─── زوجني ─────────────────────────────────────────────
      case '.زوجني': {
        const randomUser = sender;
        const randomWife = args[0] ? `${args[0]}@s.whatsapp.net` : getRandomUser(sock, from);
        const emojis = ['💕', '❤️', '💑', '🥰', '😍', '💘'];
        
        await sock.sendMessage(from, {
          text: `مبروك عروستك زي القمر @${randomWife.split('@')[0]} ${getRandom(emojis)}`,
          mentions: [randomWife]
        }, { quoted: msg });
        break;
      }

      // ─── رجولتي ────────────────────────────────────────────
      case '.رجولتي': {
        const rate = getRandomInt(1, 100);
        let msg2 = '';
        if (rate >= 80) msg2 = '🥇 راجل جدع واصل';
        else if (rate >= 60) msg2 = '💪 راجل محترم';
        else if (rate >= 40) msg2 = '👀 نص راجل نص حاجة';
        else if (rate >= 20) msg2 = '😅 لسه صغير يابني';
        else msg2 = '🤡 خلاص يلا';

        await sock.sendMessage(from, {
          text: `🕺 *نسبة رجولتك: ${rate}%*\n\n${msg2}`
        }, { quoted: msg });
        break;
      }

      // ─── انوثتي ────────────────────────────────────────────
      case '.انوثتي': {
        const rate = getRandomInt(1, 100);
        let msg2 = '';
        if (rate >= 80) msg2 = '👸 ملكة جمال';
        else if (rate >= 60) msg2 = '💃 انيقة ومحترمة';
        else if (rate >= 40) msg2 = '🎀 بنت ناس';
        else if (rate >= 20) msg2 = '🌺 لسه بتتعلمي';
        else msg2 = '🤡 شوفي غيرها';

        await sock.sendMessage(from, {
          text: `👩 *نسبة انوثتك: ${rate}%*\n\n${msg2}`
        }, { quoted: msg });
        break;
      }

      // ─── معلومات ───────────────────────────────────────────
      case '.معلومات': {
        const targetUser = target || sender;
        const stat = userStats.get(targetUser) || { messages: 0, lastMsg: 0 };
        
        let name = targetUser.split('@')[0];
        try {
          const contact = await sock.contactQuery(targetUser);
          name = contact?.name || name;
        } catch {}

        const info = `📋 *معلومات الشخص*\n\n` +
                     `👤 *الاسم:* ${name}\n` +
                     `📱 *الرقم:* +${targetUser.split('@')[0]}\n` +
                     `💬 *الرسائل:* ${stat.messages}\n` +
                     `📅 *آخر رسالة:* ${stat.lastMsg ? new Date(stat.lastMsg).toLocaleString('ar') : 'مفيش'}`;

        await sock.sendMessage(from, {
          text: info,
          mentions: [targetUser]
        }, { quoted: msg });
        break;
      }

      // ─── سكس ───────────────────────────────────────────────
      case '.سكس': {
        await sock.sendMessage(from, { text: 'يكسمك ينجس 👾' }, { quoted: msg });
        break;
      }

      // ─── بوت ───────────────────────────────────────────────
      case '.بوت': {
        await sock.sendMessage(from, { text: `شغال يعم كسمك 🐦` }, { quoted: msg });
        break;
      }

      // ─── تست ───────────────────────────────────────────────
      case '.تست': {
        const messages = [
          'شغال يسطا 🐦',
          'يعم احا بقول شغال 😁',
          'ماشي يا عم حاضر',
          'انا شغال عادي يابني'
        ];

        if (isOwner) {
          try {
            await sock.sendMessage(from, {
              audio: { url: path.join(ASSETS_FOLDER, 'A7A.m4a') },
              mimetype: 'audio/mp4',
              ptt: true
            }, { quoted: msg });
            
            setTimeout(async () => {
              await sock.sendMessage(from, {
                text: getRandom(messages)
              }, { quoted: msg });
            }, 1000);
          } catch {
            await sock.sendMessage(from, { text: getRandom(messages) }, { quoted: msg });
          }
        } else {
          await sock.sendMessage(from, { text: getRandom(messages) }, { quoted: msg });
        }
        break;
      }

      // ─── مزاجي ─────────────────────────────────────────────
      case '.مزاجي': {
        const moods = [
          { emoji: '🌊', text: 'هادي زي البحر الهاديء' },
          { emoji: '🔥', text: 'مضروب زي العندل' },
          { emoji: '😊', text: 'فرحان زي العصفور' },
          { emoji: '😔', text: 'زعلان شوية بس هتعدي' },
          { emoji: '🤩', text: 'جامد فشخ كمل كده' },
          { emoji: '🥱', text: 'نعسان روح نام' },
          { emoji: '🤯', text: 'تايه محتاج تركز' },
          { emoji: '💀', text: 'ميت من الضحك' },
          { emoji: '😎', text: 'جامد ومتحكم' },
          { emoji: '🤪', text: 'مجنون شوية' },
          { emoji: '😇', text: 'ملاك صغير' },
          { emoji: '👿', text: 'شيطان صغير' }
        ];
        const mood = getRandom(moods);
        await sock.sendMessage(from, {
          text: `🌤️ *مزاجك النهارده*\n\n${mood.emoji} ${mood.text}`
        }, { quoted: msg });
        break;
      }

      // ─── منع روابط ─────────────────────────────────────────
      case '.منع': {
        if (parts[1] === 'روابط') {
          await setAntiLinkStatus(from, true);
          await sock.sendMessage(from, {
            text: `تم تفعيل منع الروابط الي هينزل هيتناك 👾🫦`
          }, { quoted: msg });
        }
        break;
      }

      case '.روابط': {
        if (parts[1] === 'ايقاف') {
          await setAntiLinkStatus(from, false);
          await sock.sendMessage(from, {
            text: `تم إيقاف منع الروابط 🐦`
          }, { quoted: msg });
        }
        break;
      }

      // ─── حب ────────────────────────────────────────────────
      case '.حب': {
        const targetUser = target || sender;
        const rate = getRandomInt(1, 100);
        await sock.sendMessage(from, {
          text: `❤️ *نسبة الحب*\n\n@${targetUser.split('@')[0]} بيحبك بنسبة ${rate}% ${rate > 70 ? '😍' : rate > 40 ? '🥰' : '😅'}`,
          mentions: [targetUser]
        }, { quoted: msg });
        break;
      }

      // ─── ادمنية ────────────────────────────────────────────
      case '.ادمنية': {
        if (!isGrp) { await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg }); break; }
        
        try {
          const metadata = await sock.groupMetadata(from);
          const admins = metadata.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
          
          let text = '👑 *المشرفين*\n\n';
          admins.forEach(p => {
            const role = p.admin === 'superadmin' ? '👑 أونر' : '🛡️ مشرف';
            text += `@${p.id.split('@')[0]} - ${role}\n`;
          });

          await sock.sendMessage(from, {
            text: text || 'مفيش مشرفين',
            mentions: admins.map(p => p.id)
          }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
        }
        break;
      }

      // ─── اونر ──────────────────────────────────────────────
      case '.اونر': {
        await sock.sendMessage(from, {
          text: `👑 *أونر البوت*\n\n📞 +${OWNER_NUMBER}\n\nتواصل معاه لو محتاج حاجة 🐦`
        }, { quoted: msg });
        break;
      }

      // ─── رسائلي ────────────────────────────────────────────
      case '.رسائلي': {
        const stat = userStats.get(sender) || { messages: 0 };
        await sock.sendMessage(from, {
          text: `💬 *رسائلك*\n\n📊 عدد رسائلك الكلي: *${stat.messages}* رسالة`
        }, { quoted: msg });
        break;
      }

      // ─── تفاعل / نو تفاعل ────────────────────────────────
      case '.تفاعل': {
        autoReactEnabled = true;
        await sock.sendMessage(from, {
          text: `✅ تم تفعيل التفاعل التلقائي 🔥`
        }, { quoted: msg });
        break;
      }

      case '.نو': {
        if (parts[1] === 'تفاعل') {
          autoReactEnabled = false;
          await sock.sendMessage(from, {
            text: `❌ تم إيقاف التفاعل التلقائي`
          }, { quoted: msg });
        }
        break;
      }

      // ─── حذف ──────────────────────────────────────────────
      case '.حذف': {
        if (!quotedMsg) {
          await sock.sendMessage(from, { text: '❌ ارد على الرسالة اللي عايز تحذفها' }, { quoted: msg });
          break;
        }
        
        try {
          const key = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
          if (key) {
            await sock.sendMessage(from, { delete: { remoteJid: from, fromMe: true, id: key } });
          }
        } catch (e) {
          await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
        }
        break;
      }

      // ─── بنج ──────────────────────────────────────────────
      case '.بنج': {
        const start = Date.now();
        await sock.sendMessage(from, { text: '🏓 بنج...' }, { quoted: msg });
        const end = Date.now();
        await sock.sendMessage(from, {
          text: `🏓 *بونج!*\n⏱️ ${end - start}ms`
        }, { quoted: msg });
        break;
      }

      // ─── بوت معلومات ──────────────────────────────────────
      case '.بوت_معلومات': {
        const info = `🤖 *معلومات ايرن بوت*\n\n` +
                     `📱 *الأونر:* +${OWNER_NUMBER}\n` +
                     `🔄 *الإصدار:* 2.0.0\n` +
                     `📊 *البوتات الفرعية:* ${subBotSockets.size}/${MAX_SUB_BOTS}\n` +
                     `✅ *الحالة:* ${botEnabled ? '🟢 شغال' : '🔴 موقوف'}\n` +
                     `🐦 *صنع بحب*`;
        await sock.sendMessage(from, { text: info }, { quoted: msg });
        break;
      }

      // ─── تنصيب ─────────────────────────────────────────────
      case '.تنصيب': {
        if (isGrp) {
          await sock.sendMessage(from, {
            text: `📱 ابعت الأمر ده في الخاص عشان تولد كود ربط`
          }, { quoted: msg });
          break;
        }

        const phone = from.split('@')[0];

        if (isOwner) {
          const list = [...subBotSockets.keys()];
          await sock.sendMessage(from, {
            text: `📊 *البوتات الفرعية:* ${list.length}/${MAX_SUB_BOTS}\n\n` +
                  (list.length === 0 ? '_مفيش بوتات فرعية_'
                    : list.map((p, i) => `${i+1}. +${p} ✅`).join('\n'))
          }, { quoted: msg });
          break;
        }

        if (subBotSockets.size >= MAX_SUB_BOTS) {
          await sock.sendMessage(from, {
            text: `❌ الحد الأقصى ${MAX_SUB_BOTS} بوتات فرعية`
          }, { quoted: msg });
          break;
        }

        if (subBotSockets.has(phone)) {
          await sock.sendMessage(from, {
            text: `⚠️ رقمك +${phone} مربوط بالفعل`
          }, { quoted: msg });
          break;
        }

        await sock.sendMessage(from, {
          text: `⏳ بنجهز كود الربط لرقم +${phone}...`
        }, { quoted: msg });

        try {
          const subSock = await startSubBotSession(phone);
          await new Promise(r => setTimeout(r, 3000));
          const rawCode = await subSock.requestPairingCode(phone);
          const display = String(rawCode).replace(/(.{4})/g, '$1-').slice(0, -1);

          await sock.sendMessage(from, {
            text:
              `╔══════════════════════╗\n` +
              `║  🔑 *كود الربط*  ║\n` +
              `╠══════════════════════╣\n` +
              `║       *${display}*       ║\n` +
              `╚══════════════════════╝\n\n` +
              `📱 *الخطوات:*\n` +
              `1️⃣ افتح واتساب\n` +
              `2️⃣ الإعدادات ← الأجهزة المرتبطة\n` +
              `3️⃣ اضغط *ربط برقم الهاتف*\n` +
              `4️⃣ أدخل الكود: *${display}*`
          }, { quoted: msg });

        } catch (err) {
          const subDir = path.join(SUB_BOTS_DIR, phone);
          if (fs.existsSync(subDir)) fs.rmSync(subDir, { recursive: true, force: true });
          subBotSockets.delete(phone);
          await sock.sendMessage(from, {
            text: `❌ فشل: ${err.message}`
          }, { quoted: msg });
        }
        break;
      }

      // ─── رفرش ──────────────────────────────────────────────
      case '.رفرش': {
        if (!isOwner) break;
        botEnabled = true;
        await sock.sendMessage(from, { text: `🔄 جاري إعادة الاتصال...` }, { quoted: msg });
        setTimeout(() => {
          try { currentMainSock?.end(new Error('manual_refresh')); } catch {}
        }, 1500);
        break;
      }

      // ─── بور_اوف ──────────────────────────────────────────
      case '.بور_اوف': {
        if (!isOwner) break;
        botEnabled = false;
        await sock.sendMessage(from, {
          text: `⛔ البوت اتوقف\nاكتب .رفرش عشان يرجع`
        }, { quoted: msg });
        break;
      }

      // ─── شيل_بوت ──────────────────────────────────────────
      case '.شيل_بوت': {
        if (!isOwner) break;
        const list = [...subBotSockets.keys()];
        if (list.length === 0) {
          await sock.sendMessage(from, { text: '📊 مفيش بوتات فرعية' }, { quoted: msg });
          break;
        }

        const numArg = args[0];
        let target2 = null;
        if (numArg) {
          const idx = parseInt(numArg) - 1;
          if (!isNaN(idx) && list[idx]) target2 = list[idx];
        }

        if (!target2) {
          await sock.sendMessage(from, {
            text: `📋 *البوتات الفرعية:*\n\n${list.map((p,i)=>`${i+1}. +${p}`).join('\n')}\n\nاكتب: .شيل_بوت [رقم]`
          }, { quoted: msg });
          break;
        }

        try { subBotSockets.get(target2)?.end(); } catch {}
        subBotSockets.delete(target2);
        const subDir = path.join(SUB_BOTS_DIR, target2);
        if (fs.existsSync(subDir)) fs.rmSync(subDir, { recursive: true, force: true });

        await sock.sendMessage(from, {
          text: `✅ تم شيل البوت +${target2}`
        }, { quoted: msg });
        break;
      }

      default: break;
    }
  } catch (e) {
    console.error('خطأ:', e.message);
  }
}

// ─── دوال مساعدة للجروب ─────────────────────────────────────
async function isAdmin(sock, groupId, userJid) {
  try {
    const metadata = await sock.groupMetadata(groupId);
    const member = metadata.participants.find(p => p.id === userJid);
    return member && (member.admin === 'admin' || member.admin === 'superadmin');
  } catch { return false; }
}

function getRandomUser(sock, groupId) {
  try {
    const users = [...userStats.keys()].filter(u => u !== `${OWNER_NUMBER}@s.whatsapp.net`);
    return users[Math.floor(Math.random() * users.length)] || `${OWNER_NUMBER}@s.whatsapp.net`;
  } catch { return `${OWNER_NUMBER}@s.whatsapp.net`; }
}

// ─── تخزين حالة منع الروابط ────────────────────────────────
const antiLinkStatus = new Map();

async function getAntiLinkStatus(groupId) {
  return antiLinkStatus.get(groupId) || false;
}

async function setAntiLinkStatus(groupId, status) {
  antiLinkStatus.set(groupId, status);
}

// ─── بدء البوت الفرعي ──────────────────────────────────────
async function startSubBotSession(phone) {
  const dir = path.join(SUB_BOTS_DIR, phone);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const subSock = makeWASocket({
    version, logger,
    browser: Browsers.ubuntu('Chrome'),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  subSock.ev.on('creds.update', saveCreds);

  subSock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log(`✅ بوت فرعي: +${phone}`);
      subBotSockets.set(phone, subSock);
    } else if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
        console.log(`⚠️ بوت فرعي +${phone} انتهى`);
        subBotSockets.delete(phone);
        const d = path.join(SUB_BOTS_DIR, phone);
        if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
      } else {
        setTimeout(() => startSubBotSession(phone).catch(console.error), 5000);
      }
    }
  });

  subSock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) await handleMessage(subSock, m, true);
  });

  subBotSockets.set(phone, subSock);
  return subSock;
}

// ─── تحميل البوتات الفرعية ──────────────────────────────────
async function loadSubBots() {
  if (!fs.existsSync(SUB_BOTS_DIR)) return;
  const phones = fs.readdirSync(SUB_BOTS_DIR)
    .filter(f => fs.statSync(path.join(SUB_BOTS_DIR, f)).isDirectory());
  for (const phone of phones) {
    await startSubBotSession(phone).catch(e => console.error(`خطأ +${phone}:`, e.message));
  }
}

// ─── البوت الأساسي ──────────────────────────────────────────
async function startBot() {
  pairingRequested = false;
  fs.mkdirSync(AUTH_FOLDER, { recursive: true });
  fs.mkdirSync(SUB_BOTS_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`\n🚀 جاري الاتصال... واتساب: ${version.join('.')}`);

  const sock = makeWASocket({
    version, logger,
    browser: Browsers.ubuntu('Chrome'),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  currentMainSock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !sock.authState.creds.registered && !pairingRequested) {
      pairingRequested = true;
      try {
        const code = await sock.requestPairingCode(OWNER_NUMBER);
        const display = String(code).replace(/(.{4})/g, '$1-').slice(0, -1);
        console.log('\n╔══════════════════════════════════════╗');
        console.log(`║   🔑  كود الربط : ${display.padEnd(12)}  ║`);
        console.log('╚══════════════════════════════════════╝');
      } catch (err) {
        console.error('❌ فشل الكود:', err.message);
        pairingRequested = false;
      }
    }

    if (connection === 'open') {
      pairingRequested = false;
      botEnabled = true;
      console.log(`✅ البوت متصل! +${sock.user?.id?.split(':')[0]}`);
      if (subBotSockets.size === 0) await loadSubBots();
    }

    if (connection === 'close') {
      const errCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`⚠️ انقطع الاتصال (${errCode})`);
      if (errCode === DisconnectReason.loggedOut || errCode === DisconnectReason.badSession) {
        console.log('🗑 جلسة تالفة — إعادة بدء...');
        if (fs.existsSync(AUTH_FOLDER)) {
          fs.readdirSync(AUTH_FOLDER)
            .filter(f => f !== 'sub_bots')
            .forEach(f => fs.rmSync(path.join(AUTH_FOLDER, f), { recursive: true, force: true }));
        }
        setTimeout(startBot, 3000);
      } else {
        setTimeout(startBot, 5000);
      }
    }
  });

  // ─── ترحيب الأعضاء الجدد ──────────────────────────────────
  sock.ev.on('group-participants.update', async (update) => {
    try {
      if (update.action === 'add') {
        const newMember = update.participants[0];
        const groupId = update.id;

        let groupLink = '';
        let groupImage = null;

        try {
          const code = await sock.groupInviteCode(groupId);
          if (code) groupLink = `https://chat.whatsapp.com/${code}`;
        } catch {}

        try {
          const ppUrl = await sock.profilePictureUrl(groupId, 'image');
          groupImage = ppUrl;
        } catch {}

        // صوت الترحيب
        try {
          await sock.sendMessage(groupId, {
            audio: { url: path.join(ASSETS_FOLDER, 'eren_welcome.mp3') },
            mimetype: 'audio/mp4',
            ptt: true
          });
        } catch {}

        const welcomeText = `نورت البار يقلبي 🐦 @${newMember.split('@')[0]}\nشير البار يقلبي 🐦 ${groupLink}`;

        if (groupImage) {
          await sock.sendMessage(groupId, {
            image: { url: groupImage },
            caption: welcomeText,
            mentions: [newMember]
          });
        } else {
          await sock.sendMessage(groupId, {
            text: welcomeText,
            mentions: [newMember]
          });
        }
      }
    } catch (e) {
      console.error('خطأ في الترحيب:', e.message);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) await handleMessage(sock, m, false);
  });
}

// ─── تشغيل البوت ────────────────────────────────────────────
console.log('╔═══════════════════════════════════╗');
console.log('║       🤖  ايرن بوت               ║');
console.log(`║  📞  ${OWNER_NUMBER}   ║`);
console.log('╚═══════════════════════════════════╝');

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('🤖 ايرن بوت شغال 24/7 🐦');
}).listen(PORT, () => {
  console.log(`✅ بورت مفتوح على ${PORT}`);
});

startBot().catch(e => {
  console.error('خطأ فادح:', e.message);
  setTimeout(startBot, 5000);
});

process.on('uncaughtException', e => console.error('uncaught:', e.message));
process.on('unhandledRejection', e => console.error('rejection:', String(e)));
