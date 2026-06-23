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

const OWNER_NUMBER = '201110302392';
const AUTH_FOLDER = path.join(__dirname, 'auth_info');

const logger = pino({ level: 'silent' });

let botEnabled = true;
let currentMainSock = null;

// ─── معالجة الرسائل ──────────────────────────────────────────────────────
async function handleMessage(sock, msg) {
  try {
    if (!msg.message) return;
    if (isJidBroadcast(msg.key.remoteJid)) return;

    const from = msg.key.remoteJid;
    const isGrp = from?.endsWith('@g.us');
    const sender = isGrp ? msg.key.participant : msg.key.remoteJid;
    const isOwner = msg.key.fromMe === true;
    const body = msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption || '';

    if (!botEnabled && !isOwner) return;

    // ── ردود الكلمات التلقائية ──────────────────────────────────────────
    if (body && !body.startsWith('.') && !msg.key.fromMe) {
      const norm = body.replace(/[أإآ]/g, 'ا').trim();
      const words = norm.split(/\s+/);
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

      if (norm.includes('احا')) {
        await sock.sendMessage(from, {
          audio: { url: './assets/aha.m4a' },
          mimetype: 'audio/mp4',
          ptt: true
        }, { quoted: msg });
        return;
      }

      if (norm.includes('يسطا')) {
        await sock.sendMessage(from, {
          text: pick(['اي يسطا🌚🫶🏻', 'قلب الاسطي😂🫶🏻', 'يسطا خدتك ع البسطه😂🫶🏻'])
        }, { quoted: msg });
        return;
      }
    }

    if (!body || !body.startsWith('.')) return;

    const parts = body.trim().split(/\s+/);
    const command = parts[0].toLowerCase();

    console.log(`[BOT] ${sender?.split('@')[0]} → ${command}`);

    switch (command) {

      case '.اوامر': {
        const helpText = `📋 *قائمة أوامر ايرن بوت*\n\n` +
          `🎮 *ترفيه*\n` +
          `.جوزني .جمالي .انوثتي .رجولتي .حب\n\n` +
          `🛡️ *أدمن*\n` +
          `.انطر .رفاعي .شدفيه .منشن .حذف\n\n` +
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
          `.توب .رتبتي .رسائلي .مين_انا\n\n` +
          `🐦 *صنع بحب*`;

        await sock.sendMessage(from, { text: helpText }, { quoted: msg });
        break;
      }

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

      case '.ترول': {
        const trolls = [
          `@${sender.split('@')[0]} وشك عامل زي البطيخه 🍉😂`,
          `@${sender.split('@')[0]} انت فاكر نفسك مين يا عرص 🐦`,
          `@${sender.split('@')[0]} شكلك عامل زي الفراخ🍗`
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

        let info = `📋 *معلومات حسابك*\n\n`;
        info += `📱 *رقمك:* +${number}\n`;
        info += `👑 *الحالة:* ${isUserOwner ? 'الأونر 👑' : 'عضو عادي'}\n`;
        info += `\n🐦 *ايرن بوت*`;

        await sock.sendMessage(from, { text: info }, { quoted: msg });
        break;
      }

      case '.بوت_معلومات': {
        const info = `🤖 *معلومات ايرن بوت*\n\n` +
          `📱 *الأونر:* +${OWNER_NUMBER}\n` +
          `🔄 *الإصدار:* 2.0.0\n` +
          `✅ *الحالة:* ${botEnabled ? '🟢 شغال' : '🔴 موقوف'}\n` +
          `\n🐦 *صنع بحب*`;
        await sock.sendMessage(from, { text: info }, { quoted: msg });
        break;
      }

      case '.اونر': {
        await sock.sendMessage(from, {
          text: `👑 *أونر البوت*\n\n📞 +${OWNER_NUMBER}`
        }, { quoted: msg });
        break;
      }

      case '.بنج': {
        const start = Date.now();
        await sock.sendMessage(from, { text: '🏓 *جاري حساب البينج...*' }, { quoted: msg });
        const end = Date.now();
        await sock.sendMessage(from, { text: `🏓 *البينج:* ${end - start}ms` }, { quoted: msg });
        break;
      }

      // ══ تشغيل / إيقاف ═════════════════════════════════════════════════
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

      // ═══ أصوات ════════════════════════════════════════════════════════
      case '.ايرن': {
        try {
          await sock.sendMessage(from, {
            audio: { url: './assets/eren.mp3' },
            mimetype: 'audio/mp4',
            ptt: true
          }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(from, { text: '❌ الملف الصوتي مش موجود' }, { quoted: msg });
        }
        break;
      }

      default: {
        await sock.sendMessage(from, {
          text: `❌ الأمر *${command}* مش موجود\n\n📋 اكتب *.اوامر* عشان تشوف القائمة كاملة`
        }, { quoted: msg });
        break;
      }
    }
  } catch (e) {
    console.error('msg error:', e.message);
  }
}

// ─── بدء البوت ────────────────────────────────────────────────────────────
async function startBot() {
  fs.mkdirSync(AUTH_FOLDER, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`\n🚀 جاري الاتصال... واتساب: ${version.join('.')}`);

  const sock = makeWASocket({
    version,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  currentMainSock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      botEnabled = true;
      console.log(`✅ البوت متصل! +${sock.user?.id?.split(':')[0]}`);
    }

    if (connection === 'close') {
      const errCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`⚠️ انقطع الاتصال (${errCode})`);
      if (errCode === DisconnectReason.loggedOut || errCode === DisconnectReason.badSession) {
        console.log('🗑 جلسة تالفة — إعادة البدء...');
        if (fs.existsSync(AUTH_FOLDER)) {
          fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        }
        setTimeout(startBot, 3000);
      } else {
        console.log('🔄 إعادة الاتصال بعد 5 ثوانٍ...');
        setTimeout(startBot, 5000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) await handleMessage(sock, m);
  });

  // ── طلب كود الربط ──────────────────────────────────────────────────────
  if (!state.creds.registered) {
    try {
      const code = await sock.requestPairingCode(OWNER_NUMBER);
      const display = String(code).replace(/(.{4})/g, '$1-').slice(0, -1);
      console.log('\n╔══════════════════════════════════════╗');
      console.log(`║   🔑  كود الربط :  ${display.padEnd(12)}  ║`);
      console.log('╚══════════════════════════════════════╝');
      console.log(`\n📱 افتح واتساب ← الإعدادات ← الأجهزة المرتبطة ← ربط جهاز ← ربط برقم ← ${display}\n`);
    } catch (err) {
      console.error('❌ فشل الكود:', err.message);
    }
  }
}

// ─── إقلاع ──────────────────────────────────────────────────────────────
console.log('╔═══════════════════════════════════╗');
console.log('║       🤖  ايرن بوت               ║');
console.log(`║  📞  ${OWNER_NUMBER}   ║`);
console.log('╚═══════════════════════════════════╝');

startBot().catch(e => {
  console.error('❌ خطأ:', e.message);
  setTimeout(startBot, 5000);
});

process.on('uncaughtException', e => console.error('uncaught:', e.message));
process.on('unhandledRejection', e => console.error('rejection:', String(e)));
