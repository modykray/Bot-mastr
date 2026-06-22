'use strict';

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  makeCacheableSignalKeyStore,
  Browsers,
} = require('baileys');

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
let botEnabled      = true;   // false = إيقاف مؤقت
let currentMainSock = null;   // مرجع للسوكيت الحالي (للـ refresh)
let pairingRequested = false;

// ─── Sub-bot sessions ─────────────────────────────────────────────────────
const subBotSockets = new Map();

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

    // ── فحص منع الروابط ──────────────────────────────────────────────────
    if (!msg.key.fromMe && isGrp) {
      await admin.checkAntiLink(sock, msg, from, sender);
    }

    // ── لو البوت موقوف — الأونر بس يقدر يشغّله تاني ─────────────────────
    if (!botEnabled && !isOwner) return;

    // ── ردود الكلمات التلقائية ────────────────────────────────────────────
    if (body && !body.startsWith('.') && !msg.key.fromMe) {
      // تطبيع الحروف: توحيد كل أشكال الألف والهمزة
      const norm  = body.replace(/[أإآ]/g, 'ا').trim();
      const words = norm.split(/\s+/);
      const pick  = (arr) => arr[Math.floor(Math.random() * arr.length)];

      // خخخ — خخ أو أكتر (حرف خ مكرر مرتين فأكتر)
      if (norm.includes('خخ')) {
        await sock.sendMessage(from, {
          text: `خوخ وفاكهة سوق العبور اشخر ع قدك يعرص🐦`,
        }, { quoted: msg });
        return;
      }

      // وه — الكلمة لوحدها أو في جملة (بدون تطبيع لأن وه ما فيهاش همزة)
      if (words.includes('وه')) {
        await sock.sendMessage(from, {
          text: pick([`صدمة مش كده😂🎀`, `حياتي بقت احسن بكتير😂🌚`]),
        }, { quoted: msg });
        return;
      }

      // احا / أحا — بعد التطبيع بتبقى احا دايماً
      if (norm.includes('احا')) {
        await sock.sendMessage(from, {
          text: pick([`اقلع وشلحها🐦`, `خليني ارقعها🐦`]),
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
      case '.اصحي':    await voices.playAudio(ctx, 'as7a.mp3');          break;

      // ══ نظام ═════════════════════════════════════════════════════════════
      case '.قائمة':   await system.helpMenu(ctx);                       break;
      case '.انا':     if (parts[1]==='ايرن') await system.erenVoice(ctx); break;
      case '.تست':     await sock.sendMessage(from, { text: `الو حول هل تسمعني 😂` }, { quoted: msg }); break;
      case '.بنج':     await extras.ping(ctx);                           break;
      case '.مسابقه':  await extras.quiz(ctx);                           break;

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
        // أغلق السوكيت الحالي → سيُشغَّل startBot تلقائياً
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

// ─── مسح الجلسة الرئيسية (مع حفظ sub_bots) ──────────────────────────────
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
      // تحميل البوتات الفرعية مرة واحدة فقط عند أول اتصال
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

  sock.ev.on('group-participants.update', async (update) => {
    try { if (update.action === 'add') await system.handleWelcome(sock, update); }
    catch (e) { console.error('welcome error:', e.message); }
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

startBot().catch(e => { console.error('Fatal:', e.message); setTimeout(startBot, 5000); });
process.on('uncaughtException',  e => console.error('uncaught:', e.message));
process.on('unhandledRejection', e => console.error('rejection:', String(e)));
