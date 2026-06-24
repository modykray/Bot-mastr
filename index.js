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

const entertainment   = require('./commands/entertainment');
const admin           = require('./commands/admin');
const media           = require('./commands/media');
const voices          = require('./commands/voices');
const system          = require('./commands/system');
const extras          = require('./commands/extras');
const { randomEmoji } = require('./utils');

const OWNER_NUMBER = '201227812859';
const AUTH_FOLDER  = path.join(__dirname, 'auth_info');
const SUB_BOTS_DIR = path.join(AUTH_FOLDER, 'sub_bots');
const MAX_SUB_BOTS = 4;

const logger = pino({ level: 'silent' });

// ─── إسكات ضجيج Baileys الداخلي تماماً ────────────────────────────────────
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

// ─── حالة البوت ───────────────────────────────────────────────────────────
let botEnabled      = true;
let currentMainSock = null;
let pairingRequested = false;

// ─── Sub-bot sessions ─────────────────────────────────────────────────────
const subBotSockets = new Map();

// ─── متغيرات الإحصاءات ──────────────────────────────────────────────────
const userStats = new Map();
const groupStats = new Map();

// ─── معالجة الرسائل المشتركة ──────────────────────────────────────────────
async function handleMessage(sock, msg, isSubBot = false) {
  try {
    if (!msg.message) return;
    if (isJidBroadcast(msg.key.remoteJid)) return;

    const from   = msg.key.remoteJid;
    const isGrp  = from?.endsWith('@g.us');
    const sender = isGrp ? msg.key.participant : msg.key.remoteJid;
    const isOwner = msg.key.fromMe === true;
    const body   =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption     ||
      msg.message?.videoMessage?.caption     || '';

    // ── تحديث الإحصاءات ──────────────────────────────────────────────────
    if (sender && !msg.key.fromMe) {
      if (!userStats.has(sender)) {
        userStats.set(sender, { messages: 0, lastMsg: Date.now() });
      }
      const userStat = userStats.get(sender);
      userStat.messages += 1;
      userStat.lastMsg = Date.now();
      userStats.set(sender, userStat);

      if (isGrp) {
        if (!groupStats.has(from)) {
          groupStats.set(from, { members: {}, totalMsgs: 0 });
        }
        const groupStat = groupStats.get(from);
        if (!groupStat.members[sender]) {
          groupStat.members[sender] = 0;
        }
        groupStat.members[sender] += 1;
        groupStat.totalMsgs += 1;
        groupStats.set(from, groupStat);
      }
    }

    // ── فحص منع الروابط ──────────────────────────────────────────────────
    if (!msg.key.fromMe && isGrp) {
      await admin.checkAntiLink(sock, msg, from, sender);
    }

    // ── لو البوت موقوف — الأونر بس يقدر يشغّله تاني ─────────────────────
    if (!botEnabled && !isOwner) return;

    // ── ردود الكلمات التلقائية ────────────────────────────────────────────
    if (body && !body.startsWith('.') && !msg.key.fromMe) {
      const norm  = body.replace(/[أإآ]/g, 'ا').trim();
      const words = norm.split(/\s+/);
      const pick  = (arr) => arr[Math.floor(Math.random() * arr.length)];

      // احا — يبعت صوت aha.m4a
      if (norm.includes('احا')) {
        await sock.sendMessage(from, {
          audio: { url: './assets/aha.m4a' },
          mimetype: 'audio/mp4',
          ptt: true
        }, { quoted: msg });
        return;
      }

      // اصحي — يبعت صوت ashahi.m4a
      if (norm.includes('اصحي')) {
        await sock.sendMessage(from, {
          audio: { url: './assets/ashahi.m4a' },
          mimetype: 'audio/mp4',
          ptt: true
        }, { quoted: msg });
        return;
      }

      // خخخ — خخ أو أكتر
      if (norm.includes('خخ')) {
        await sock.sendMessage(from, {
          text: `خوخ وفاكهة سوق العبور اشخر ع قدك يعرص🐦`,
        }, { quoted: msg });
        return;
      }

      // وه — الكلمة لوحدها أو في جملة
      if (words.includes('وه')) {
        await sock.sendMessage(from, {
          text: pick([`صدمة مش كده😂🎀`, `حياتي بقت احسن بكتير😂🌚`]),
        }, { quoted: msg });
        return;
      }

      // يسطا — الكلمة في أي مكان في الجملة
      if (norm.includes('يسطا')) {
        await sock.sendMessage(from, {
          text: pick([`اي يسطا🌚🫶🏻`, `قلب الاسطي😂🫶🏻`, `يسطا خدتك ع البسطه😂🫶🏻`]),
        }, { quoted: msg });
        return;
      }

      await extras.checkQuizAnswer(sock, from, body);
      return;
    }

    if (!body.startsWith('.')) return;

    const parts   = body.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const ctx     = { sock, msg, from, sender, args: parts, isGroup: isGrp,
                      ownerNumber: OWNER_NUMBER, isOwner, body };

    console.log(`[${isSubBot ? 'SUB' : 'BOT'}] ${sender?.split('@')[0]} → ${command}`);

    switch (command) {

      // ══ قائمة الأوامر الجديدة بالشكل المطلوب ═══════════════════════════════════════════
      case '.اوامر': {
        const helpText = 
`ㅤㅤׄ        (╲︵᷼   ⊹      ⏜✿╱)ㅤㅤ  𝅄ㅤ
 ㅤ               \`𝗂𝗇𝖿𝗈 𝖻𝗈𝗍\` ㅤׅ
 ׅ    ׂ  ⤹⤹᪲  ۪ 𝗈𝗐𝗇𝖾𝗋 : 201227812859
 ׅ    ׂ  ⤹⤹᪲  ۪ 𝖻𝗈𝗍 : ايرن بوت
 ׅ    ׂ  ⤹⤹᪲  ۪ 𝗌𝗍𝖺𝗍𝗎𝗌 : 𝗈𝗇𝗅𝗂𝗇𝖾 24/7
 ㅤ ⊹┉─ׄ───┈‌   ⑅   ‌┈───ׅ─┉⊹

╭᥍╮ ᰨ 𝖼𝗈𝗆𝗆𝖺𝗇𝖽𝗌◝
│  │ ׂ ᩮ⃘᪁ ׅ بنج ⇢ سرعة البوت
│  │ ׂ ᩮ⃘᪁ ׅ تست ⇢ اختبار البوت
│  │ ׂ ᩮ⃘᪁ ׅ المطور ⇢ رقم المطور
│  │ ׂ ᩮ⃘᪁ ׅ تنصيب ⇢ ربط البوت برقمك (.a7a)
╰᥍╯

╭᥍╮ ᰨ 𝗈𝗐𝗇𝖾𝗋◝
│  │ ׂ ᩮ⃘᪁ ׅ رفرش ⇢ إعادة تشغيل البوت
│  │ ׂ ᩮ⃘᪁ ׅ بور_اوف ⇢ إيقاف البوت
│  │ ׂ ᩮ⃘᪁ ׅ موحشتكش ⇢ صوت للأونر
│  │ ׂ ᩮ⃘᪁ ׅ شيل_بوت ⇢ حذف بوت فرعي
╰᥍╯

╭᥍╮ ᰨ 𝗀𝗋𝗈𝗎𝗉 𝗍𝗈𝗈𝗅𝗌◝
│  │ ׂ ᩮ⃘᪁ ׅ انطر ⇢ طرد عضو
│  │ ׂ ᩮ⃘᪁ ׅ رفاعي ⇢ رفع مشرف
│  │ ׂ ᩮ⃘᪁ ׅ شدفيه ⇢ تنزيل مشرف
│  │ ׂ ᩮ⃘᪁ ׅ هنرش مياه ⇢ قفل المجموعة
│  │ ׂ ᩮ⃘᪁ ׅ افتح يبني ⇢ فتح المجموعة
│  │ ׂ ᩮ⃘᪁ ׅ منع روابط ⇢ تفعيل منع الروابط
│  │ ׂ ᩮ⃘᪁ ׅ روابط ايقاف ⇢ إيقاف منع الروابط
│  │ ׂ ᩮ⃘᪁ ׅ منشن/منشنز ⇢ منشن الكل
│  │ ׂ ᩮ⃘᪁ ׅ حذف ⇢ حذف رسالة
│  │ ׂ ᩮ⃘᪁ ׅ انذار/تحذير ⇢ تحذير عضو
│  │ ׂ ᩮ⃘᪁ ׅ الانذارات ⇢ عرض التحذيرات
│  │ ׂ ᩮ⃘᪁ ׅ حذف_انذار ⇢ حذف تحذير
│  │ ׂ ᩮ⃘᪁ ׅ جروب_اسم ⇢ تغيير اسم المجموعة
│  │ ׂ ᩮ⃘᪁ ׅ جروب_وصف ⇢ تغيير وصف المجموعة
╰᥍╯

╭᥍╮ ᰨ 𝖽𝗈𝗐𝗇𝗅𝗈𝖺𝖽◝
│  │ ׂ ᩮ⃘᪁ ׅ شغل ⇢ تشغيل يوتيوب
│  │ ׂ ᩮ⃘᪁ ׅ تيكتوك ⇢ تحميل تيك توك
│  │ ׂ ᩮ⃘᪁ ׅ انستا ⇢ تحميل انستجرام
│  │ ׂ ᩮ⃘᪁ ׅ لصوت ⇢ تحويل فيديو لصوت
│  │ ׂ ᩮ⃘᪁ ׅ لجيف ⇢ تحويل فيديو لجيف
│  │ ׂ ᩮ⃘᪁ ׅ لصوره ⇢ تحويل فيديو لصورة
│  │ ׂ ᩮ⃘᪁ ׅ نسخ ⇢ استخراج نص من صورة
╰᥍╯

╭᥍╮ ᰨ 𝗌𝗈𝗎𝗇𝖽𝗌◝
│  │ ׂ ᩮ⃘᪁ ׅ سمكة ⇢ صوت سمكة
│  │ ׂ ᩮ⃘᪁ ׅ بورعي ⇢ صوت بورعي
│  │ ׂ ᩮ⃘᪁ ׅ ايرن ⇢ صوت ايرن
│  │ ׂ ᩮ⃘᪁ ׅ موحشتكش ⇢ صوت موحشتكش (للأونر)
╰᥍╯

╭᥍╮ ᰨ 𝖿𝗎𝗇◝
│  │ ׂ ᩮ⃘᪁ ׅ جوزني ⇢ زواج وهمي
│  │ ׂ ᩮ⃘᪁ ׅ جمالي ⇢ تقييم جمالك
│  │ ׂ ᩮ⃘᪁ ׅ انوثتي ⇢ تقييم انوثتك
│  │ ׂ ᩮ⃘᪁ ׅ رجولتي ⇢ تقييم رجولتك
│  │ ׂ ᩮ⃘᪁ ׅ حب ⇢ نسبة الحب
│  │ ׂ ᩮ⃘᪁ ׅ بروفايل ⇢ بروفايلك
│  │ ׂ ᩮ⃘᪁ ׅ طقملي ⇢ صورة طقم
│  │ ׂ ᩮ⃘᪁ ׅ ترول ⇢ طقطقة
│  │ ׂ ᩮ⃘᪁ ׅ مزاجي ⇢ مزاجك النهارده
╰᥍╯

╭᥍╮ ᰨ 𝗌𝗍𝖺𝗍𝗌◝
│  │ ׂ ᩮ⃘᪁ ׅ اعضاء ⇢ إحصاءات المجموعة
│  │ ׂ ᩮ⃘᪁ ׅ الادمنية ⇢ قائمة المشرفين
│  │ ׂ ᩮ⃘᪁ ׅ بوت_معلومات ⇢ معلومات البوت
│  │ ׂ ᩮ⃘᪁ ׅ اونر ⇢ رقم الأونر
│  │ ׂ ᩮ⃘᪁ ׅ توب ⇢ أجمد 5 أعضاء
│  │ ׂ ᩮ⃘᪁ ׅ رتبتي ⇢ ترتيبك في المجموعة
│  │ ׂ ᩮ⃘᪁ ׅ رسائلي ⇢ عدد رسائلك
│  │ ׂ ᩮ⃘᪁ ׅ تفاعل ⇢ نسبة تفاعلك
│  │ ׂ ᩮ⃘᪁ ׅ مين_انا ⇢ معلومات حسابك
╰᥍╯

╭᥍╮ ᰨ 𝖻𝗈𝗍 𝖼𝗈𝗇𝗍𝗋𝗈𝗅◝
│  │ ׂ ᩮ⃘᪁ ׅ مسابقه ⇢ مسابقة
│  │ ׂ ᩮ⃘᪁ ׅ قائمة ⇢ قائمة الأوامر القديمة
╰᥍╯

 ╭ဣ ⸼ 𝗉𝗈𝗐𝖾𝗋 𝅄 
 │┄─────────────ׄ─֟╺៶ ‌꒱ 𝅄
 ││⸼ ᧔⃘ᦅ ۫ 24/7 𝗈𝗇𝗅𝗂𝗇𝖾 ⦂ 𝗆𝖽 𝖾𝗇𝗀𝗂𝗇𝖾
 ╰───ׅ ဣ  ׁ ⏜⌢꯭⋒ ۫

 ㅤׄ𐂯◟𝗆𝖺𝖽𝖾 𝖻𝗒 𝗂𝗍𝗌_𝗐𝗁𝗈𝗈𝗈𝗈𝗈𝗈𝗌𝗁`;

        await sock.sendMessage(from, { text: helpText }, { quoted: msg });
        break;
      }

      // ══ ترفيه ════════════════════════════════════════════════════════════
      case '.جوزني':   await entertainment.marry(ctx);                   break;
      case '.جمالي':   await entertainment.beautyRate(ctx, 'جمالك');     break;
      case '.انوثتي':  await entertainment.beautyRate(ctx, 'انوثتك');    break;
      case '.رجولتي':  await entertainment.beautyRate(ctx, 'رجولتك');    break;
      case '.حب':      await entertainment.loveRate(ctx);                break;
      case '.بروفايل': await entertainment.profile(ctx);                 break;
      case '.طقملي':   await entertainment.couplePic(ctx);               break;

      // ══ أدمن ═════════════════════════════════════════════════════════════
      case '.انطر':    await admin.kick(ctx);                            break;
      case '.رفاعي':   await admin.promote(ctx);                         break;
      case '.شدفيه':   await admin.demote(ctx);                          break;
      case '.هنرش':    if (parts[1]==='مياه')  await admin.closeGroup(ctx); break;
      case '.افتح':    if (parts[1]==='يبني')  await admin.openGroup(ctx);  break;
      case '.منع':     if (parts[1]==='روابط') await admin.antiLink(ctx);   break;
      case '.روابط':   if (parts[1]==='ايقاف') await admin.antiLinkOff(ctx); break;
      case '.منشن':
      case '.منشنز':   await extras.mentionAll(ctx);                     break;
      case '.حذف':     await extras.deleteMsg(ctx);                      break;
      case '.انذار':
      case '.تحذير':   await extras.warn(ctx);                           break;
      case '.الانذارات': await extras.warnList(ctx);                     break;
      case '.حذف_انذار': await extras.warnDelete(ctx);                   break;
      case '.جروب_اسم':  await extras.changeGroupName(ctx);              break;
      case '.جروب_وصف':  await extras.changeGroupDesc(ctx);              break;

      // ══ ميديا ════════════════════════════════════════════════════════════
      case '.شغل':     await media.playYouTube(ctx);                     break;
      case '.تيكتوك':  await media.downloadTikTok(ctx);                  break;
      case '.انستا':   await media.downloadInstagram(ctx);               break;
      case '.لصوت':    await extras.toMp3(ctx);                          break;
      case '.لجيف':    await extras.toGif(ctx);                          break;
      case '.لصوره':   await extras.toImage(ctx);                        break;
      case '.نسخ':     await extras.ocr(ctx);                            break;

      // ══ أصوات ════════════════════════════════════════════════════════════
      case '.سمكة':    await voices.playAudio(ctx, 'samaka.mp3');        break;
      case '.بورعي':   await voices.playAudio(ctx, 'bora3i.mp3');        break;
      case '.ايرن':    await voices.playAudio(ctx, 'eren.mp3');          break;

      // ══ أمر موحشتكش (لأونر بس) ══════════════════════════════════════════
      case '.موحشتكش': {
        if (!isOwner) {
          await sock.sendMessage(from, { text: `❌ الأمر ده للأونر بس 🐦` }, { quoted: msg });
          break;
        }
        
        try {
          await sock.sendMessage(from, {
            audio: { url: './assets/mo7ashtkesh.mp3' },
            mimetype: 'audio/mp4',
            ptt: true
          }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: `❌ الملف الصوتي مش موجود` }, { quoted: msg });
        }
        break;
      }

      // ══ نظام ═════════════════════════════════════════════════════════════
      case '.قائمة':   await system.helpMenu(ctx);                       break;
      case '.انا':     if (parts[1]==='ايرن') await system.erenVoice(ctx); break;

      // ══ أمر تست المعدل ════════════════════════════════════════════════
      case '.تست': {
        const testMessages = [
          `شغال يسطا والله 🐦`,
          `ماشي يسطا حاضر🐦`,
          `يعم احا ما قولت شغال🙂`
        ];
        
        const randomTestMsg = testMessages[Math.floor(Math.random() * testMessages.length)];
        
        if (isOwner) {
          await sock.sendMessage(from, {
            audio: { url: './assets/A7A.m4a' },
            mimetype: 'audio/mp4',
            ptt: true
          }, { quoted: msg });
          
          setTimeout(async () => {
            await sock.sendMessage(from, {
              text: randomTestMsg
            }, { quoted: msg });
          }, 1000);
        } 
        else {
          await sock.sendMessage(from, {
            text: randomTestMsg
          }, { quoted: msg });
        }
        break;
      }

      case '.بنج':     await extras.ping(ctx);                           break;
      case '.مسابقه':  await extras.quiz(ctx);                           break;

      // ══ أوامر جديدة ═════════════════════════════════════════════════════

      case '.ترول': {
        const trolls = [
          `@${sender.split('@')[0]} وشك عامل زي البطيخه 🍉😂`,
          `@${sender.split('@')[0]} انت فاكر نفسك مين يا عرص 🐦`,
          `@${sender.split('@')[0]} لو انت حلو كنت جبت سيرتك😂`,
          `@${sender.split('@')[0]} يابو وش الكلب 🐕`,
          `@${sender.split('@')[0]} ربنا يخليك للطزازة😂`,
          `@${sender.split('@')[0]} انت جامد بس في النوم😴`,
          `@${sender.split('@')[0]} شكلك عامل زي الفراخ🍗`,
          `@${sender.split('@')[0]} انت عارف انك وحش؟ لا طبعاً 🤣`,
          `@${sender.split('@')[0]} ضحكتني بجد 😂😂`
        ];
        const random = trolls[Math.floor(Math.random() * trolls.length)];
        await sock.sendMessage(from, {
          text: random,
          mentions: [sender]
        }, { quoted: msg });
        break;
      }

      case '.مزاجي': {
        const moods = [
          `🍃 *هادي* زي البحر الهاديء 🌊`,
          `🔥 *مضروب* زي العندل 😂`,
          `😊 *فرحان* زي العصفور 🐦`,
          `😔 *زعلان* شوية بس هتعدي 🌈`,
          `🤩 *جامد فشخ* كمل كده 💪`,
          `🥱 *نعسان* روح نام 😴`,
          `🤯 *تايه* محتاج تركز 🧠`,
          `💀 *ميت* من الضحك 🤣`
        ];
        const random = moods[Math.floor(Math.random() * moods.length)];
        await sock.sendMessage(from, {
          text: `🌤️ *مزاجك النهارده*\n\n${random}`
        }, { quoted: msg });
        break;
      }

      case '.مين_انا': {
        const number = sender.split('@')[0];
        const isUserOwner = number === OWNER_NUMBER;
        const userStat = userStats.get(sender);
        const msgCount = userStat ? userStat.messages : 0;
        
        let info = `📋 *معلومات حسابك*\n\n`;
        info += `📱 *رقمك:* +${number}\n`;
        info += `👑 *الحالة:* ${isUserOwner ? 'الأونر 👑' : 'عضو عادي'}\n`;
        info += `💬 *عدد رسائلك:* ${msgCount} رسالة\n`;
        info += `🕐 *آخر رسالة:* ${userStat ? new Date(userStat.lastMsg).toLocaleTimeString('ar') : 'مفيش'}\n`;
        info += `\n🐦 *ايرن بوت*`;

        await sock.sendMessage(from, {
          text: info
        }, { quoted: msg });
        break;
      }

      case '.اعضاء': {
        if (!isGrp) {
          await sock.sendMessage(from, { text: `❌ الأمر ده في الجروبات بس` }, { quoted: msg });
          break;
        }
        try {
          const metadata = await sock.groupMetadata(from);
          const members = metadata.participants;
          const admins = members.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
          const owner = members.find(p => p.admin === 'superadmin');
          
          await sock.sendMessage(from, {
            text: `📊 *إحصاءات المجموعة*\n\n` +
                  `👥 *الأعضاء:* ${members.length}\n` +
                  `👑 *المشرفين:* ${admins.length}\n` +
                  `🔒 *الأونر:* ${owner ? `@${owner.id.split('@')[0]}` : 'مش معروف'}\n` +
                  `📝 *اسم المجموعة:* ${metadata.subject}\n` +
                  `📅 *تاريخ الإنشاء:* ${new Date(metadata.creation * 1000).toLocaleDateString('ar')}`,
            mentions: owner ? [owner.id] : []
          }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
        }
        break;
      }

      case '.الادمنية': {
        if (!isGrp) {
          await sock.sendMessage(from, { text: `❌ الأمر ده في الجروبات بس` }, { quoted: msg });
          break;
        }
        try {
          const metadata = await sock.groupMetadata(from);
          const admins = metadata.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
          
          if (admins.length === 0) {
            await sock.sendMessage(from, { text: `📊 مفيش مشرفين في المجموعة` }, { quoted: msg });
            break;
          }
          
          let adminList = `👑 *المشرفين (${admins.length})*\n\n`;
          admins.forEach((p, i) => {
            const role = p.admin === 'superadmin' ? '👑 أونر' : '🛡️ مشرف';
            adminList += `${i+1}. @${p.id.split('@')[0]} - ${role}\n`;
          });
          
          await sock.sendMessage(from, {
            text: adminList,
            mentions: admins.map(p => p.id)
          }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
        }
        break;
      }

      case '.بوت_معلومات': {
        const subCount = subBotSockets.size;
        const info = `🤖 *معلومات ايرن بوت*\n\n` +
                     `📱 *الأونر:* +${OWNER_NUMBER}\n` +
                     `🔄 *الإصدار:* 2.0.0\n` +
                     `📊 *البوتات الفرعية:* ${subCount}/${MAX_SUB_BOTS}\n` +
                     `✅ *الحالة:* ${botEnabled ? '🟢 شغال' : '🔴 موقوف'}\n` +
                     `📅 *تاريخ التشغيل:* ${new Date().toLocaleDateString('ar')}\n` +
                     `\n🐦 *صنع بحب*`;
        await sock.sendMessage(from, {
          text: info
        }, { quoted: msg });
        break;
      }

      case '.اونر': {
        await sock.sendMessage(from, {
          text: `👑 *أونر البوت*\n\n📞 +${OWNER_NUMBER}\n\n🐦 *تواصل معاه لو محتاج حاجة*`
        }, { quoted: msg });
        break;
      }

      case '.توب': {
        if (!isGrp) {
          await sock.sendMessage(from, { text: `❌ الأمر ده في الجروبات بس` }, { quoted: msg });
          break;
        }
        try {
          const groupStat = groupStats.get(from);
          if (!groupStat || Object.keys(groupStat.members).length === 0) {
            await sock.sendMessage(from, { text: `📊 مفيش بيانات كافية للمجموعة` }, { quoted: msg });
            break;
          }

          const sorted = Object.entries(groupStat.members)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

          let topList = `🏆 *أجمد 5 أعضاء*\n\n`;
          sorted.forEach(([user, count], i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
            topList += `${medal} @${user.split('@')[0]} - ${count} رسالة\n`;
          });

          await sock.sendMessage(from, {
            text: topList,
            mentions: sorted.map(s => s[0])
          }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
        }
        break;
      }

      case '.رتبتي': {
        if (!isGrp) {
          await sock.sendMessage(from, { text: `❌ الأمر ده في الجروبات بس` }, { quoted: msg });
          break;
        }
        try {
          const groupStat = groupStats.get(from);
          if (!groupStat || !groupStat.members[sender]) {
            await sock.sendMessage(from, { 
              text: `📊 مفيش رسائل ليك في المجموعة دي\nاكتب عشان تظهر في الترتيب 🐦`
            }, { quoted: msg });
            break;
          }

          const sorted = Object.entries(groupStat.members)
            .sort((a, b) => b[1] - a[1]);
          
          const rank = sorted.findIndex(([user]) => user === sender) + 1;
          const total = sorted.length;
          const myMsgs = groupStat.members[sender];

          await sock.sendMessage(from, {
            text: `📊 *ترتيبك في المجموعة*\n\n` +
                  `👤 *انت:* @${sender.split('@')[0]}\n` +
                  `🏆 *ترتيبك:* #${rank} من ${total}\n` +
                  `💬 *رسائلك:* ${myMsgs} رسالة\n` +
                  `📈 *نسبة التفاعل:* ${Math.round((myMsgs / groupStat.totalMsgs) * 100)}%`,
            mentions: [sender]
          }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
        }
        break;
      }

      case '.رسائلي': {
        const userStat = userStats.get(sender);
        const count = userStat ? userStat.messages : 0;
        await sock.sendMessage(from, {
          text: `💬 *رسائلك*\n\n📊 عدد رسائلك الكلي: *${count}* رسالة\n🐦 *استمر*`
        }, { quoted: msg });
        break;
      }

      case '.تفاعل': {
        if (!isGrp) {
          await sock.sendMessage(from, { text: `❌ الأمر ده في الجروبات بس` }, { quoted: msg });
          break;
        }
        try {
          const groupStat = groupStats.get(from);
          if (!groupStat || !groupStat.members[sender]) {
            await sock.sendMessage(from, { 
              text: `📊 مفيش رسائل ليك في المجموعة دي`
            }, { quoted: msg });
            break;
          }

          const myMsgs = groupStat.members[sender];
          const totalMsgs = groupStat.totalMsgs;
          const percentage = Math.round((myMsgs / totalMsgs) * 100);

          let emoji = '😴';
          let status = 'محتاج تشتغل على نفسك';
          if (percentage > 30) { emoji = '🔥'; status = 'جامد فشخ!'; }
          else if (percentage > 20) { emoji = '💪'; status = 'كويس!'; }
          else if (percentage > 10) { emoji = '👍'; status = 'ماشي حالك'; }

          await sock.sendMessage(from, {
            text: `📊 *نسبة تفاعلك*\n\n` +
                  `👤 @${sender.split('@')[0]}\n` +
                  `📈 نسبة التفاعل: *${percentage}%*\n` +
                  `${emoji} *${status}*\n` +
                  `💬 ${myMsgs} رسالة من ${totalMsgs}`,
            mentions: [sender]
          }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
        }
        break;
      }

      // ══ تشغيل / إيقاف / رفرش ════════════════════════════════════════════
      case '.رفرش': {
        if (!isOwner) {
          await sock.sendMessage(from, { text: `❌ الأمر ده للأونر بس` }, { quoted: msg });
          break;
        }
        botEnabled = true;
        await sock.sendMessage(from, {
          text: `🔄 *جاري إعادة الاتصال...*\nثواني وهيرجع يشتغل ✅`,
        }, { quoted: msg });
        setTimeout(() => {
          try { currentMainSock?.end(new Error('manual_refresh')); } catch {}
        }, 1500);
        break;
      }

      case '.بور_اوف': {
        if (!isOwner) {
          await sock.sendMessage(from, { text: `❌ الأمر ده للأونر بس` }, { quoted: msg });
          break;
        }
        botEnabled = false;
        await sock.sendMessage(from, {
          text: `⛔ *البوت اتوقف*\n\nمش هيرد على أي حد دلوقتي\nاكتب *.رفرش* عشان يرجع يشتغل`,
        }, { quoted: msg });
        break;
      }

      // ══ ربط البوت الفرعي ═════════════════════════════════════════════════
      case '.a7a': {
        if (isGrp) {
          await sock.sendMessage(from, {
            text: `📱 ابعت الأمر ده في المحادثة الخاصة مع البوت عشان يولّد كود ربط لرقمك`,
          }, { quoted: msg });
          break;
        }

        const phone = from.split('@')[0];

        if (isOwner) {
          const list = [...subBotSockets.keys()];
          await sock.sendMessage(from, {
            text: `📊 *البوتات الفرعية:* ${list.length}/${MAX_SUB_BOTS}\n\n` +
                  (list.length === 0 ? '_مفيش بوتات فرعية مربوطة_'
                    : list.map((p, i) => `${i+1}. +${p} ✅`).join('\n')),
          }, { quoted: msg });
          break;
        }

        if (subBotSockets.size >= MAX_SUB_BOTS) {
          await sock.sendMessage(from, {
            text: `❌ الحد الأقصى للبوتات الفرعية (${MAX_SUB_BOTS}) اتوصل\nتواصل مع الأونر 🔒`,
          }, { quoted: msg });
          break;
        }

        if (subBotSockets.has(phone)) {
          await sock.sendMessage(from, {
            text: `⚠️ رقمك +${phone} مربوط بالفعل كبوت فرعي! 🐦`,
          }, { quoted: msg });
          break;
        }

        await sock.sendMessage(from, {
          text: `⏳ بنجهّز كود ربط واتساب لرقمك *+${phone}*...\nثواني بس!`,
        }, { quoted: msg });

        try {
          const subSock = await startSubBotSession(phone);
          await new Promise(r => setTimeout(r, 3000));
          const rawCode = await subSock.requestPairingCode(phone);
          const display = String(rawCode).replace(/(.{4})/g, '$1-').slice(0, -1);

          await sock.sendMessage(from, {
            text:
              `╔══════════════════════╗\n` +
              `║  🔑 *كود ربط واتساب حقيقي*  ║\n` +
              `╠══════════════════════╣\n` +
              `║       *${display}*       ║\n` +
              `╚══════════════════════╝\n\n` +
              `📱 *خطوات الربط:*\n` +
              `1️⃣ افتح واتساب على موبايلك\n` +
              `2️⃣ الإعدادات ← الأجهزة المرتبطة\n` +
              `3️⃣ اضغط *ربط جهاز*\n` +
              `4️⃣ اضغط *ربط برقم الهاتف*\n` +
              `5️⃣ أدخل الكود: *${display}*\n\n` +
              `📊 البوتات الفرعية: ${subBotSockets.size}/${MAX_SUB_BOTS}`,
          }, { quoted: msg });

        } catch (err) {
          const subDir = path.join(SUB_BOTS_DIR, phone);
          if (fs.existsSync(subDir)) fs.rmSync(subDir, { recursive: true, force: true });
          subBotSockets.delete(phone);
          await sock.sendMessage(from, {
            text: `❌ فشل توليد الكود: ${err.message}\nحاول تاني بعد شوية`,
          }, { quoted: msg });
        }
        break;
      }

      // ══ شيل بوت فرعي ════════════════════════════════════════════════════
      case '.شيل_بوت': {
        if (!isOwner) {
          await sock.sendMessage(from, { text: `❌ الأمر ده للأونر بس` }, { quoted: msg });
          break;
        }
        const list2 = [...subBotSockets.keys()];
        if (list2.length === 0) {
          await sock.sendMessage(from, { text: `📊 مفيش بوتات فرعية مربوطة حالياً` }, { quoted: msg });
          break;
        }

        const numArg = parts[1];
        let target = null;
        if (numArg) {
          const idx = parseInt(numArg) - 1;
          if (!isNaN(idx) && list2[idx]) target = list2[idx];
          else target = list2.find(p => p === numArg || p.includes(numArg));
        }

        if (!target) {
          await sock.sendMessage(from, {
            text: `📋 *البوتات الفرعية:*\n\n${list2.map((p,i)=>`${i+1}. +${p}`).join('\n')}\n\nاكتب: *.شيل_بوت [رقم]* زي: .شيل_بوت 1`,
          }, { quoted: msg });
          break;
        }

        try { subBotSockets.get(target)?.end(); } catch {}
        subBotSockets.delete(target);
        const subDir2 = path.join(SUB_BOTS_DIR, target);
        if (fs.existsSync(subDir2)) fs.rmSync(subDir2, { recursive: true, force: true });

        await sock.sendMessage(from, {
          text: `✅ تم شيل البوت الفرعي +${target}\n📊 البوتات الفرعية: ${subBotSockets.size}/${MAX_SUB_BOTS}`,
        }, { quoted: msg });
        break;
      }

      default: break;
    }
  } catch (e) { console.error('msg error:', e.message); }
}

// ─── بدء جلسة بوت فرعي ───────────────────────────────────────────────────
async function startSubBotSession(phone) {
  const dir = path.join(SUB_BOTS_DIR, phone);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version }          = await fetchLatestBaileysVersion();

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
      console.log(`✅ بوت فرعي متصل: +${phone}`);
      subBotSockets.set(phone, subSock);
    } else if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
        console.log(`⚠️ بوت فرعي +${phone} انتهت جلسته — جاري حذفه`);
        subBotSockets.delete(phone);
        const d = path.join(SUB_BOTS_DIR, phone);
        if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
      } else {
        console.log(`🔄 إعادة اتصال البوت الفرعي +${phone}...`);
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

// ─── تحميل البوتات الفرعية ────────────────────────────────────────────────
async function loadSubBots() {
  if (!fs.existsSync(SUB_BOTS_DIR)) return;
  const phones = fs.readdirSync(SUB_BOTS_DIR)
    .filter(f => fs.statSync(path.join(SUB_BOTS_DIR, f)).isDirectory());
  if (phones.length) console.log(`📂 تحميل ${phones.length} بوت فرعي محفوظ...`);
  for (const phone of phones) {
    await startSubBotSession(phone).catch(e => console.error(`خطأ +${phone}:`, e.message));
  }
}

// ─── مسح الجلسة الرئيسية ──────────────────────────────────────────────────
function clearSession() {
  if (!fs.existsSync(AUTH_FOLDER)) return;
  fs.readdirSync(AUTH_FOLDER)
    .filter(f => f !== 'sub_bots' && f !== 'warnings.json')
    .forEach(f => fs.rmSync(path.join(AUTH_FOLDER, f), { recursive: true, force: true }));
}

// ─── البوت الأساسي ────────────────────────────────────────────────────────
async function startBot() {
  pairingRequested = false;
  fs.mkdirSync(AUTH_FOLDER, { recursive: true });
  fs.mkdirSync(SUB_BOTS_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version }          = await fetchLatestBaileysVersion();

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
    // ── طلب كود الربط بالأسلوب الأصلي ──────────────────────────────────
    if (qr && !sock.authState.creds.registered && !pairingRequested) {
      pairingRequested = true;
      try {
        const code    = await sock.requestPairingCode(OWNER_NUMBER);
        const display = String(code).replace(/(.{4})/g, '$1-').slice(0, -1);
        console.log('\n╔══════════════════════════════════════╗');
        console.log(`║   🔑  Pairing Code :  ${display.padEnd(12)}  ║`);
        console.log('╚══════════════════════════════════════╝');
        console.log(`\n📱 الإعدادات → الأجهزة المرتبطة → ربط جهاز → ربط برقم → ${display}\n`);
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
      console.log(`⚠️  انقطع الاتصال (${errCode})`);
      if (errCode === DisconnectReason.loggedOut || errCode === DisconnectReason.badSession) {
        console.log('🗑  جلسة تالفة — إعادة البدء...');
        clearSession();
        setTimeout(startBot, 3000);
      } else {
        console.log('🔄 إعادة الاتصال بعد 5 ثوانٍ...');
        setTimeout(startBot, 5000);
      }
    }
  });

  // ─── حدث دخول عضو جديد مع صورة الترحيب ──────────────────────────────
  sock.ev.on('group-participants.update', async (update) => {
    try {
      if (update.action === 'add') {
        const newMember = update.participants[0];
        const groupId = update.id;
        
        let groupName = 'المجموعة';
        let groupPic = null;
        
        try {
          const groupMetadata = await sock.groupMetadata(groupId);
          groupName = groupMetadata.subject || 'المجموعة';
          
          // محاولة جلب صورة المجموعة
          try {
            const ppUrl = await sock.profilePictureUrl(groupId, 'image');
            groupPic = ppUrl;
          } catch (e) {}
        } catch (e) {}

        const welcomeMessages = [
          `منور البار يقلبي 🐦 @${newMember.split('@')[0]}`,
          `شير البار يقلب اخوك 🐦 @${newMember.split('@')[0]}`,
          `اهلاً بك في ${groupName} يا @${newMember.split('@')[0]} 🐦`,
          `نورت الدنيا يا @${newMember.split('@')[0]} 🐦`,
          `فرحتنا بيك يا @${newMember.split('@')[0]} 🐦`,
          `عيش معانا يا @${newMember.split('@')[0]} 🐦`
        ];
        
        const randomWelcome = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
        
        // لو في صورة للمجموعة، نبعت الترحيب مع الصورة
        if (groupPic) {
          await sock.sendMessage(groupId, {
            image: { url: groupPic },
            caption: randomWelcome,
            mentions: [newMember]
          });
        } else {
          await sock.sendMessage(groupId, {
            text: randomWelcome,
            mentions: [newMember]
          });
        }
      }
    } catch (e) { 
      console.error('welcome error:', e.message); 
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) await handleMessage(sock, m, false);
  });
}

// ─── إقلاع ───────────────────────────────────────────────────────────────
console.log('╔═══════════════════════════════════╗');
console.log('║       🤖  ايرن بوت               ║');
console.log(`║  📞  ${OWNER_NUMBER}   ║`);
console.log('╚═══════════════════════════════════╝');

// ─── فتح بورت وهمي لـ Render ──────────────────────────────────────────
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('🤖 ايرن بوت شغال 24/7 🐦');
}).listen(PORT, () => {
  console.log(`✅ بورت وهمي مفتوح على ${PORT}`);
});

startBot().catch(e => { console.error('Fatal:', e.message); setTimeout(startBot, 5000); });
process.on('uncaughtException',  e => console.error('uncaught:', e.message));
process.on('unhandledRejection', e => console.error('rejection:', String(e)));
