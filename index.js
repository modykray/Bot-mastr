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

const OWNER_NUMBER = '201110302392';
const AUTH_FOLDER  = path.join(__dirname, 'auth_info');
const SUB_BOTS_DIR = path.join(AUTH_FOLDER, 'sub_bots');
const MAX_SUB_BOTS = 4;

const logger = pino({ level: 'silent' });

// ─── إسكات ضجيج Baileys الداخلي ──────────────────────────────────────
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

// ─── حالة البوت ─────────────────────────────────────────────────────────
let botEnabled      = true;
let currentMainSock = null;
let pairingRequested = false;

// ─── Sub-bot sessions ──────────────────────────────────────────────────
const subBotSockets = new Map();

// ─── متغيرات الإحصاءات ──────────────────────────────────────────────────
const userStats = new Map();
const groupStats = new Map();

// ─── معالجة الرسائل المشتركة ──────────────────────────────────────────
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

    if (!botEnabled && !isOwner) return;

    // ── ردود الكلمات التلقائية ──────────────────────────────────────────
    if (body && !body.startsWith('.') && !msg.key.fromMe) {
      const norm  = body.replace(/[أإآ]/g, 'ا').trim();
      const words = norm.split(/\s+/);
      const pick  = (arr) => arr[Math.floor(Math.random() * arr.length)];

      if (norm.includes('احا')) {
        await sock.sendMessage(from, {
          audio: { url: './assets/aha.m4a' },
          mimetype: 'audio/mp4',
          ptt: true
        }, { quoted: msg });
        return;
      }

      if (norm.includes('اصحي')) {
        await sock.sendMessage(from, {
          audio: { url: './assets/ashahi.m4a' },
          mimetype: 'audio/mp4',
          ptt: true
        }, { quoted: msg });
        return;
      }

      if (norm.includes('خخ')) {
        await sock.sendMessage(from, {
          text: `خوخ وفاكهة سوق العبور اشخر ع قدك يعرص🐦`,
        }, { quoted: msg });
        return;
      }

      if (words.includes('وه')) {
        await sock.sendMessage(from, {
          text: pick([`صدمة مش كده😂🎀`, `حياتي بقت احسن بكتير😂🌚`]),
        }, { quoted: msg });
        return;
      }

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

      // ══ قائمة الأوامر ═════════════════════════════════════════════════
      case '.اوامر': {
        const helpText = `📋 *قائمة أوامر ايرن بوت*\n\n` +
          `🎮 *ترفيه*\n` +
          `.جوزني .جمالي .انوثتي .رجولتي .حب .بروفايل .طقملي\n\n` +
          `🛡️ *أدمن*\n` +
          `.انطر .رفاعي .شدفيه .منشن .حذف\n` +
          `.انذار .الانذارات .حذف_انذار .جروب_اسم .جروب_وصف\n\n` +
          `🔊 *أصوات*\n` +
          `.سمكة .بورعي .ايرن\n\n` +
          `⚙️ *نظام*\n` +
          `.تست .بنج .رفرش .بور_اوف\n\n` +
          `😂 *ترول*\n` +
          `.ترول\n\n` +
          `💬 *تفاعل*\n` +
          `.مزاجي\n\n` +
          `📊 *إحصاءات*\n` +
          `.اعضاء .الادمنية .بوت_معلومات .اونر\n` +
          `.توب .رتبتي .رسائلي .تفاعل .مين_انا\n\n` +
          `🐦 *صنع بحب*`;

        await sock.sendMessage(from, { text: helpText }, { quoted: msg });
        break;
      }

      // ══ أمر الربط بـ 8 حروف ═════════════════════════════════════════
      case '.ربط': {
        if (isGrp) {
          await sock.sendMessage(from, {
            text: `📱 ابعت الأمر ده في الخاص عشان تاخد كود الربط`
          }, { quoted: msg });
          break;
        }

        const phone = from.split('@')[0];

        if (subBotSockets.has(phone)) {
          await sock.sendMessage(from, {
            text: `⚠️ رقمك +${phone} مربوط بالفعل كبوت فرعي!`
          }, { quoted: msg });
          break;
        }

        if (subBotSockets.size >= MAX_SUB_BOTS) {
          await sock.sendMessage(from, {
            text: `❌ الحد الأقصى للبوتات الفرعية (${MAX_SUB_BOTS}) اتوصل`
          }, { quoted: msg });
          break;
        }

        await sock.sendMessage(from, {
          text: `⏳ *جاري تجهيز كود الربط...*\n\n` +
                `📱 *خطوات الربط:*\n` +
                `1️⃣ افتح واتساب على موبايلك\n` +
                `2️⃣ الإعدادات ← الأجهزة المرتبطة\n` +
                `3️⃣ اضغط *ربط جهاز*\n` +
                `4️⃣ اختار *ربط برقم الهاتف*\n` +
                `5️⃣ ادخل الكود اللي هيجيلك خلال ثواني\n\n` +
                `⏳ *بنطلب الكود من واتساب...*`
        }, { quoted: msg });

        try {
          // الطريقة الصحيحة لطلب كود 8 حروف من واتساب
          const subSock = await startSubBotSession(phone);
          
          // نطلب الكود من واتساب
          const code = await subSock.requestPairingCode(phone);
          const displayCode = String(code).replace(/(.{4})/g, '$1-').slice(0, -1);

          await sock.sendMessage(from, {
            text:
              `╔══════════════════════════╗\n` +
              `║  🔑 *كود الربط الحقيقي*   ║\n` +
              `╠══════════════════════════╣\n` +
              `║     *${displayCode}*      ║\n` +
              `╚══════════════════════════╝\n\n` +
              `📱 *ادخل الكود ده في واتساب*\n` +
              `⏳ *صلاحية الكود 5 دقايق*\n\n` +
              `✅ بعد ما تدخل الكود، هيجيلك تأكيد`
          }, { quoted: msg });

          // ننتظر التأكيد من واتساب
          subSock.ev.on('connection.update', async ({ connection }) => {
            if (connection === 'open') {
              subBotSockets.set(phone, subSock);
              await sock.sendMessage(from, {
                text: `✅ *تم الربط بنجاح!*\n\n📱 رقمك +${phone} بقى بوت فرعي 🐦`
              }, { quoted: msg });
            }
          });

        } catch (err) {
          const subDir = path.join(SUB_BOTS_DIR, phone);
          if (fs.existsSync(subDir)) fs.rmSync(subDir, { recursive: true, force: true });
          subBotSockets.delete(phone);
          await sock.sendMessage(from, {
            text: `❌ فشل توليد الكود: ${err.message}`
          }, { quoted: msg });
        }
        break;
      }

      // ══ ترفيه ════════════════════════════════════════════════════════
      case '.جوزني':   await entertainment.marry(ctx);                   break;
      case '.جمالي':   await entertainment.beautyRate(ctx, 'جمالك');     break;
      case '.انوثتي':  await entertainment.beautyRate(ctx, 'انوثتك');    break;
      case '.رجولتي':  await entertainment.beautyRate(ctx, 'رجولتك');    break;
      case '.حب':      await entertainment.loveRate(ctx);                break;
      case '.بروفايل': await entertainment.profile(ctx);                 break;
      case '.طقملي':   await entertainment.couplePic(ctx);               break;

      // ══ أدمن ═════════════════════════════════════════════════════════
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

      // ══ ميديا ════════════════════════════════════════════════════════
      case '.شغل':     await media.playYouTube(ctx);                     break;
      case '.تيكتوك':  await media.downloadTikTok(ctx);                  break;
      case '.انستا':   await media.downloadInstagram(ctx);               break;
      case '.لصوت':    await extras.toMp3(ctx);                          break;
      case '.لجيف':    await extras.toGif(ctx);                          break;
      case '.لصوره':   await extras.toImage(ctx);                        break;
      case '.نسخ':     await extras.ocr(ctx);                            break;

      // ══ أصوات ════════════════════════════════════════════════════════
      case '.سمكة':    await voices.playAudio(ctx, 'samaka.mp3');        break;
      case '.بورعي':   await voices.playAudio(ctx, 'bora3i.mp3');        break;
      case '.ايرن':    await voices.playAudio(ctx, 'eren.mp3');          break;

      // ══ نظام ═════════════════════════════════════════════════════════
      case '.قائمة':   await system.helpMenu(ctx);                       break;
      case '.انا':     if (parts[1]==='ايرن') await system.erenVoice(ctx); break;
      
      case '.تست': {
        const testMessages = [
          `شغال يسطا والله 🐦`,
          `ماشي يسطا حاضر🐦`,
          `يعم احا ما قولت شغال🙂`
        ];
        const randomMsg = testMessages[Math.floor(Math.random() * testMessages.length)];
        
        if (isOwner) {
          await sock.sendMessage(from, {
            audio: { url: './assets/aha.m4a' },
            mimetype: 'audio/mp4',
            ptt: true
          }, { quoted: msg });
          setTimeout(async () => {
            await sock.sendMessage(from, { text: randomMsg }, { quoted: msg });
          }, 1000);
        } else {
          await sock.sendMessage(from, { text: randomMsg }, { quoted: msg });
        }
        break;
      }
      
      case '.بنج':     await extras.ping(ctx);                           break;
      case '.مسابقه':  await extras.quiz(ctx);                           break;

      // ══ أوامر جديدة ═════════════════════════════════════════════════

      case '.ترول': {
        const trolls = [
          `@${sender.split('@')[0]} وشك عامل زي البطيخه 🍉😂`,
          `@${sender.split('@')[0]} انت فاكر نفسك مين يا عرص 🐦`,
          `@${sender.split('@')[0]} شكلك عامل زي الفراخ🍗`,
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
          `🤩 *جامد فشخ* كمل كده 💪`,
          `🥱 *نعسان* روح نام 😴`
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
        info += `\n🐦 *ايرن بوت*`;

        await sock.sendMessage(from, { text: info }, { quoted: msg });
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
                     `\n🐦 *صنع بحب*`;
        await sock.sendMessage(from, { text: info }, { quoted: msg });
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
              text: `📊 مفيش رسائل ليك في المجموعة دي`
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
          text: `💬 *رسائلك*\n\n📊 عدد رسائلك الكلي: *${count}* رسالة 🐦`
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

      // ══ تشغيل / إيقاف / رفرش ════════════════════════════════════════
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

      // ══ ربط البوت الفرعي القديم ═════════════════════════════════════
      case '.a7a': {
        if (isGrp) {
          await sock.sendMessage(from, {
            text: `📱 ابعت الأمر ده في الخاص عشان تولّد كود ربط لرقمك`,
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
            text: `❌ الحد الأقصى للبوتات الفرعية (${MAX_SUB_BOTS}) اتوصل`,
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

      // ══ شيل بوت فرعي ════════════════════════════════════════════════
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

// ─── بدء جلسة بوت فرعي ─────────────────────────────────────────────────
async function startSubBotSession(phone) {
  const dir = path.join(SUB_BOTS_DIR, phone);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version }          = await fetchLatestBaileysVersion();

  const subSock = makeWASocket({
    version, logger,
    browser: Browsers.ubuntu('Chrome'),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    printQRInTerminal: false, // مش هنستخدم QR
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
      if (code === DisconnectReason.loggedOut || code === DisconnectReason.b
