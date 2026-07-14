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

// ─── رقم الأونر الوحيد ──────────────────────────────────────
const OWNER_NUMBER = '201044013292'; // حط رقمك هنا

const AUTH_FOLDER = path.join(__dirname, 'auth_info');
const SUB_BOTS_DIR = path.join(AUTH_FOLDER, 'sub_bots');
const ASSETS_FOLDER = path.join(__dirname, 'assets');
const MAX_SUB_BOTS = 4;
const SUB_BOTS_LIST_FILE = path.join(AUTH_FOLDER, 'sub_bots_list.json');

const logger = pino({ level: 'silent' });

// ─── دوال مساعدة للأونر ────────────────────────────────────
function isOwnerNumber(phone) {
  if (!phone) return false;
  const cleanPhone = phone.split('@')[0];
  return cleanPhone === OWNER_NUMBER;
}

function isOwnerJid(jid) {
  if (!jid) return false;
  const phone = jid.split('@')[0];
  return phone === OWNER_NUMBER;
}

function getOwnerDisplay() {
  return `+${OWNER_NUMBER}`;
}

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

// ─── دوال حفظ وإدارة البوتات الفرعية ──────────────────────────
function saveSubBotNumber(phone) {
  try {
    let list = [];
    if (fs.existsSync(SUB_BOTS_LIST_FILE)) {
      list = JSON.parse(fs.readFileSync(SUB_BOTS_LIST_FILE, 'utf8'));
    }
    if (!list.includes(phone)) {
      list.push(phone);
      fs.writeFileSync(SUB_BOTS_LIST_FILE, JSON.stringify(list, null, 2));
    }
  } catch (e) {
    console.error('خطأ في حفظ البوت الفرعي:', e.message);
  }
}

function removeSubBotNumber(phone) {
  try {
    if (fs.existsSync(SUB_BOTS_LIST_FILE)) {
      let list = JSON.parse(fs.readFileSync(SUB_BOTS_LIST_FILE, 'utf8'));
      list = list.filter(p => p !== phone);
      fs.writeFileSync(SUB_BOTS_LIST_FILE, JSON.stringify(list, null, 2));
    }
  } catch (e) {
    console.error('خطأ في حذف البوت الفرعي:', e.message);
  }
}

function getSubBotNumbers() {
  try {
    if (fs.existsSync(SUB_BOTS_LIST_FILE)) {
      return JSON.parse(fs.readFileSync(SUB_BOTS_LIST_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('خطأ في قراءة البوتات الفرعية:', e.message);
  }
  return [];
}

// ─── إيقاف كل البوتات الفرعية ──────────────────────────────
async function stopAllSubBots() {
  console.log('🛑 جاري إيقاف كل البوتات الفرعية...');
  for (const [phone, subSock] of subBotSockets) {
    try {
      if (subSock && typeof subSock.end === 'function') {
        subSock.end(new Error('main_bot_stopped'));
      }
    } catch (e) {
      console.error(`خطأ في إيقاف بوت +${phone}:`, e.message);
    }
  }
  subBotSockets.clear();
  console.log('✅ تم إيقاف كل البوتات الفرعية');
}

// ─── تحميل البوتات الفرعية من القائمة المحفوظة ──────────────
async function loadSubBotsFromList(mainSock) {
  const numbers = getSubBotNumbers();
  if (numbers.length === 0) {
    console.log('📂 مفيش بوتات فرعية محفوظة');
    return;
  }
  
  console.log(`📂 جاري تحميل ${numbers.length} بوت فرعي محفوظ...`);
  for (const phone of numbers) {
    if (!subBotSockets.has(phone)) {
      await startSubBotSession(phone, mainSock).catch(e => {
        console.error(`خطأ في تحميل بوت +${phone}:`, e.message);
      });
    }
  }
}

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

// ─── متغيرات لتتبع آخر مرة تم فيها إرسال الصوت ────────────────
let lastAudioTimes = {
  'بتيجي': 0,
  'ععع': 0
};

// ─── دوال إرسال الصوت ──────────────────────────────────────────
async function sendAudio(sock, from, command) {
  const now = Date.now();
  
  // التأكد من مرور 60 ثانية لكل أمر
  if (now - lastAudioTimes[command] < 60000) {
    return;
  }
  
  lastAudioTimes[command] = now;
  
  let audioFile;
  if (command === 'بتيجي') {
    audioFile = 'bt7.m4a';
  } else if (command === 'ععع') {
    audioFile = 'aaa3.m4a';
  }
  
  const audioPath = path.join(ASSETS_FOLDER, audioFile);
  
  if (fs.existsSync(audioPath)) {
    try {
      await sock.sendMessage(from, {
        audio: { url: audioPath },
        mimetype: 'audio/mp4',
        ptt: true
      });
      console.log(`✅ تم إرسال الصوت ${audioFile}`);
    } catch (e) {
      console.error(`❌ فشل إرسال الصوت ${audioFile}:`, e.message);
    }
  } else {
    console.log(`❌ ملف ${audioFile} مش موجود في assets`);
  }
}

// ─── معالجة الرسائل ────────────────────────────────────────────
async function handleMessage(sock, msg, isSubBot = false) {
  try {
    if (!msg.message) return;
    if (isJidBroadcast(msg.key.remoteJid)) return;

    const from = msg.key.remoteJid;
    const isGrp = from?.endsWith('@g.us');
    const sender = isGrp ? msg.key.participant : msg.key.remoteJid;
    const senderPhone = sender?.split('@')[0];
    
    const isOwner = isOwnerJid(sender) || msg.key.fromMe;
    const isLinked = subBotSockets.has(senderPhone) || isOwner;
    
    // لو الرقم مش مربوط - يتجاهل
    if (!isLinked && !isGrp && !isOwner) {
      return;
    }
    
    const body = msg.message?.conversation ||
                 msg.message?.extendedTextMessage?.text ||
                 msg.message?.imageMessage?.caption ||
                 msg.message?.videoMessage?.caption || '';

    if (!botEnabled && !isOwner) return;

    // ─── أوامر الصوت ────────────────────────────────────────────
    // البوت يسمع نفسه فقط والكلمات بدون نقطة
    if (body && msg.key.fromMe) {
      const trimmed = body.trim();
      
      if (trimmed === 'بتيجي') {
        await sendAudio(sock, from, 'بتيجي');
        return;
      }
      
      if (trimmed === 'ععع') {
        await sendAudio(sock, from, 'ععع');
        return;
      }
    }

    if (!body.startsWith('.')) return;

    const parts = body.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    console.log(`[${isSubBot ? 'SUB' : 'BOT'}] ${sender?.split('@')[0]} → ${command}`);

    switch (command) {

      // ─── أمر تشغيل البوت (تنصيب) ────────────────────────────
      case '.تنصيب': {
        // بس الأونر يقدر يشغل البوت
        if (!isOwner) {
          await sock.sendMessage(from, { 
            text: '❌ الأمر ده للأونر بس' 
          }, { quoted: msg });
          break;
        }

        if (isGrp) {
          await sock.sendMessage(from, {
            text: `📱 ابعت الأمر ده في الخاص عشان تولد كود ربط`
          }, { quoted: msg });
          break;
        }

        const phone = from.split('@')[0];
        const list = getSubBotNumbers();
        
        if (list.length >= MAX_SUB_BOTS) {
          await sock.sendMessage(from, {
            text: `❌ العدد الأقصى ${MAX_SUB_BOTS} أجهزة مرتبطة`
          }, { quoted: msg });
          break;
        }

        if (subBotSockets.has(phone)) {
          await sock.sendMessage(from, {
            text: `⚠️ رقمك +${phone} مربوط بالفعل!`
          }, { quoted: msg });
          break;
        }

        await sock.sendMessage(from, {
          text: `⏳ جاري تجهيز كود الربط لرقم *+${phone}*...`
        }, { quoted: msg });

        try {
          const rawCode = await sock.requestPairingCode(phone);
          const display = String(rawCode).replace(/(.{4})/g, '$1-').slice(0, -1);

          saveSubBotNumber(phone);
          subBotSockets.set(phone, { phone: phone });

          await sock.sendMessage(from, {
            text:
              `╔═══════════════════════════════════╗\n` +
              `║      🔑 *كود ربط واتساب*           ║\n` +
              `╠═══════════════════════════════════╣\n` +
              `║                                   ║\n` +
              `║         *${display}*              ║\n` +
              `║                                   ║\n` +
              `╚═══════════════════════════════════╝\n\n` +
              `📱 *خطوات الربط:*\n` +
              `1️⃣ افتح واتساب على الموبايل\n` +
              `2️⃣ اذهب إلى الإعدادات ← الأجهزة المرتبطة\n` +
              `3️⃣ اضغط *ربط جهاز*\n` +
              `4️⃣ اختار *ربط برقم الهاتف*\n` +
              `5️⃣ أدخل الكود: *${display}*`
          }, { quoted: msg });

        } catch (err) {
          removeSubBotNumber(phone);
          subBotSockets.delete(phone);
          
          await sock.sendMessage(from, {
            text: `❌ *فشل الربط:* ${err.message}`
          }, { quoted: msg });
        }
        break;
      }

      // ─── رفرش ──────────────────────────────────────────────
      case '.رفرش': {
        if (!isOwner) {
          await sock.sendMessage(from, { text: '❌ الأمر ده للأونر بس' }, { quoted: msg });
          break;
        }
        
        botEnabled = true;
        await sock.sendMessage(from, {
          text: `🔄 *جاري إعادة التشغيل...*`
        }, { quoted: msg });
        
        setTimeout(() => {
          try { 
            currentMainSock?.end(new Error('manual_refresh')); 
          } catch {}
        }, 1500);
        break;
      }

      // ─── بور_اوف ──────────────────────────────────────────
      case '.بور_اوف': {
        if (!isOwner) {
          await sock.sendMessage(from, { text: '❌ الأمر ده للأونر بس' }, { quoted: msg });
          break;
        }
        
        botEnabled = false;
        await stopAllSubBots();
        
        await sock.sendMessage(from, {
          text: `⛔ *البوت اتوقف*\nاكتب *.رفرش* عشان يرجع يشتغل`
        }, { quoted: msg });
        break;
      }

      default: break;
    }
  } catch (e) {
    console.error('خطأ:', e.message);
  }
}

// ─── بدء البوت الفرعي ──────────────────────────────────────
async function startSubBotSession(phone, mainSock) {
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
        removeSubBotNumber(phone);
        const d = path.join(SUB_BOTS_DIR, phone);
        if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
      } else {
        console.log(`🔄 إعادة اتصال البوت الفرعي +${phone}...`);
        setTimeout(() => startSubBotSession(phone, mainSock).catch(console.error), 5000);
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

// ─── البوت الأساسي ──────────────────────────────────────────
async function startBot() {
  pairingRequested = false;
  fs.mkdirSync(AUTH_FOLDER, { recursive: true });
  fs.mkdirSync(SUB_BOTS_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`\n🚀 جاري الاتصال... واتساب: ${version.join('.')}`);
  console.log(`👑 الأونر: ${getOwnerDisplay()}`);

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
      
      if (subBotSockets.size === 0) {
        await loadSubBotsFromList(sock);
      }
    }

    if (connection === 'close') {
      const errCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`⚠️ انقطع الاتصال (${errCode})`);
      
      if (errCode === DisconnectReason.loggedOut || errCode === DisconnectReason.badSession) {
        console.log('🗑 جلسة تالفة — إعادة بدء...');
        if (fs.existsSync(AUTH_FOLDER)) {
          fs.readdirSync(AUTH_FOLDER)
            .filter(f => f !== 'sub_bots' && f !== 'sub_bots_list.json')
            .forEach(f => fs.rmSync(path.join(AUTH_FOLDER, f), { recursive: true, force: true }));
        }
        setTimeout(startBot, 3000);
      } else {
        if (!botEnabled) {
          await stopAllSubBots();
        }
        setTimeout(startBot, 5000);
      }
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
console.log(`║  👑  ${getOwnerDisplay()}   ║`);
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
