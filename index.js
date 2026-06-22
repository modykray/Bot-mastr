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

// ─── إسكات ضجيج Baileys الداخلي ──────────────────────────────────────────
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

    if (!msg.key.fromMe && isGrp) {
      await admin.checkAntiLink(sock, msg, from, sender);
    }

    if (!botEnabled && !isOwner) return;

    // ── ردود الكلمات التلقائية ────────────────────────────────────────────
    if (body && !body.startsWith('.') && !msg.key.fromMe) {
      const norm  = body.replace(/[أإآ]/g, 'ا').trim();
      const words = norm.split(/\s+/);
      const pick  = (arr) => arr[Math.floor(Math.random() * arr.length)];

      if (norm.includes('خخ')) {
        await sock.sendMessage(from, { text: `خوخ وفاكهة سوق العبور اشخر ع قدك يعرص🐦` }, { quoted: msg });
        return;
      }

      if (words.includes('وه')) {
        await sock.sendMessage(from, { text: pick([`صدمة مش كده😂🎀`, `حياتي بقت احسن بكتير😂🌚`]), }, { quoted: msg });
        return;
      }

      // إضافة الرد الصوتي التلقائي لكلمة "احا"
      if (norm.includes('احا')) {
        await voices.ahaVoice({ sock, from, msg });
        return;
      }

      if (norm.includes('يسطا')) {
        await sock.sendMessage(from, { text: pick([`اي يسطا🌚🫶🏻`, `قلب الاسطي😂🫶🏻`, `يسطا خدتك ع البسطه😂🫶🏻`]), }, { quoted: msg });
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

    switch (command) {
      case '.جوزني':   await entertainment.marry(ctx); break;
      case '.جمالي':   await entertainment.beautyRate(ctx, 'جمالك'); break;
      case '.انوثتي':  await entertainment.beautyRate(ctx, 'انوثتك'); break;
      case '.رجولتي':  await entertainment.beautyRate(ctx, 'رجولتك'); break;
      case '.حب':      await entertainment.loveRate(ctx); break;
      case '.بروفايل': await entertainment.profile(ctx); break;
      case '.طقملي':   await entertainment.couplePic(ctx); break;

      case '.انطر':    await admin.kick(ctx); break;
      case '.رفاعي':   await admin.promote(ctx); break;
      case '.شدفيه':   await admin.demote(ctx); break;
      case '.هنرش':    if (parts[1]==='مياه')  await admin.closeGroup(ctx); break;
      case '.افتح':    if (parts[1]==='يبني')  await admin.openGroup(ctx);  break;
      case '.منع':     if (parts[1]==='روابط') await admin.antiLink(ctx);   break;
      case '.روابط':   if (parts[1]==='ايقاف') await admin.antiLinkOff(ctx); break;
      case '.منشن':
      case '.منشنز':   await extras.mentionAll(ctx); break;
      case '.حذف':     await extras.deleteMsg(ctx); break;
      case '.انذار':
      case '.تحذير':   await extras.warn(ctx); break;
      case '.الانذارات': await extras.warnList(ctx); break;
      case '.حذف_انذار': await extras.warnDelete(ctx); break;
      case '.جروب_اسم':  await extras.changeGroupName(ctx); break;
      case '.جروب_وصف':  await extras.changeGroupDesc(ctx); break;

      case '.شغل':     await media.playYouTube(ctx); break;
      case '.تيكتوك':  await media.downloadTikTok(ctx); break;
      case '.انستا':   await media.downloadInstagram(ctx); break;
      case '.لصوت':    await extras.toMp3(ctx); break;
      case '.لجيف':    await extras.toGif(ctx); break;
      case '.لصوره':   await extras.toImage(ctx); break;
      case '.نسخ':     await extras.ocr(ctx); break;

      case '.سمكة':    await voices.playAudio(ctx, 'samaka.mp3'); break;
      case '.بورعي':   await voices.playAudio(ctx, 'bora3i.mp3'); break;
      case '.ايرن':    await voices.playAudio(ctx, 'eren.mp3'); break;
      case '.اصحي':    await voices.ashahiVoice(ctx); break;
      case '.احا':     await voices.ahaVoice(ctx); break; // أمر مباشر للصوت

      case '.قائمة':   await system.helpMenu(ctx); break;
      case '.انا':     if (parts[1]==='ايرن') await system.erenVoice(ctx); break;
      case '.تست':     await sock.sendMessage(from, { text: `الو حول هل تسمعني 😂` }, { quoted: msg }); break;
      case '.بنج':     await extras.ping(ctx); break;
      case '.مسابقه':  await extras.quiz(ctx); break;

      // ... بقية كود الـ switch (رفرش، بور_اوف، a7a، شيل_بوت) كما هو في ملفك الأصلي ...
    }
  } catch (e) { console.error('msg error:', e.message); }
}
// ... (باقي دوال البوت startSubBotSession, loadSubBots, startBot كما هي)
