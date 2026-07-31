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

// ─── رقم البوت الوحيد ──────────────────────────────────────
const BOT_NUMBER = '201044013292'; // رقم البوت

const AUTH_FOLDER = path.join(__dirname, 'auth_info');
const ASSETS_FOLDER = path.join(__dirname, 'assets');

const logger = pino({ level: 'silent' });

// ─── دوال مساعدة للبوت ────────────────────────────────────
function isBotNumber(phone) {
  if (!phone) return false;
  const cleanPhone = phone.split('@')[0];
  return cleanPhone === BOT_NUMBER;
}

function isBotJid(jid) {
  if (!jid) return false;
  const phone = jid.split('@')[0];
  return phone === BOT_NUMBER;
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

// ─── تخزين أرقام الأدمن لكل مجموعة ──────────────────────────
const adminCache = new Map();

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

// ─── دوال إرسال الصوت ──────────────────────────────────────────
let lastAudioTimes = {
  'بتيجي': 0,
  'ععع': 0,
  'وه': 0,
  'ترو': 0
};

async function sendAudio(sock, from, command) {
  const now = Date.now();
  if (now - lastAudioTimes[command] < 60000) return;
  lastAudioTimes[command] = now;
  
  let audioFile;
  if (command === 'بتيجي') audioFile = 'bt7.m4a';
  else if (command === 'ععع') audioFile = 'aaa3.m4a';
  else if (command === 'وه') audioFile = 'T3.m4p';
  else if (command === 'ترو') audioFile = 'Ym3.m4a';
  
  const audioPath = path.join(ASSETS_FOLDER, audioFile);
  if (fs.existsSync(audioPath)) {
    try {
      await sock.sendMessage(from, {
        audio: { url: audioPath },
        mimetype: 'audio/mp4',
        ptt: true
      });
    } catch (e) {
      console.error(`❌ فشل إرسال الصوت:`, e.message);
    }
  }
}

// ─── التحقق من أن العضو أدمن ──────────────────────────────────
async function isUserAdmin(sock, groupJid, participantJid) {
  try {
    // التحقق من الكاش أولاً
    const cacheKey = `${groupJid}_${participantJid}`;
    if (adminCache.has(cacheKey)) {
      return adminCache.get(cacheKey);
    }

    // جلب معلومات المجموعة
    const groupMetadata = await sock.groupMetadata(groupJid);
    const admins = groupMetadata.participants
      .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
      .map(p => p.id);
    
    const isAdmin = admins.includes(participantJid);
    
    // تخزين في الكاش لمدة 5 دقائق
    adminCache.set(cacheKey, isAdmin);
    setTimeout(() => adminCache.delete(cacheKey), 5 * 60 * 1000);
    
    return isAdmin;
  } catch (error) {
    console.error('خطأ في التحقق من الأدمن:', error.message);
    return false;
  }
}

// ─── معالجة الرسائل ────────────────────────────────────────────
async function handleMessage(sock, msg) {
  try {
    if (!msg.message) return;
    if (isJidBroadcast(msg.key.remoteJid)) return;

    const from = msg.key.remoteJid;
    const isGrp = from?.endsWith('@g.us');
    const sender = isGrp ? msg.key.participant : msg.key.remoteJid;
    const senderPhone = sender?.split('@')[0];
    
    // التحقق من أن المرسل هو البوت نفسه فقط
    const isBot = isBotJid(sender) || msg.key.fromMe;
    if (!isBot) return; // تجاهل أي رسالة من غير البوت
    
    const body = msg.message?.conversation ||
                 msg.message?.extendedTextMessage?.text ||
                 msg.message?.imageMessage?.caption ||
                 msg.message?.videoMessage?.caption || '';

    if (!botEnabled) return;

    // ─── أوامر الصوت ────────────────────────────────────────────
    if (body) {
      const trimmed = body.trim();
      
      if (trimmed === 'بتيجي') {
        await sendAudio(sock, from, 'بتيجي');
        return;
      }
      if (trimmed === 'ععع') {
        await sendAudio(sock, from, 'ععع');
        return;
      }
      if (trimmed === 'وه') {
        await sendAudio(sock, from, 'وه');
        return;
      }
      if (trimmed === 'ترو') {
        await sendAudio(sock, from, 'ترو');
        return;
      }
    }

    if (!body.startsWith('.')) return;

    const parts = body.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    console.log(`[BOT] ${sender?.split('@')[0]} → ${command}`);

    switch (command) {

      // ─── الأمر الوحيد: منع روابط ────────────────────────────
      case '.منع_روابط': {
        // فقط البوت يقدر يستخدم الأمر
        if (!isBot) {
          await sock.sendMessage(from, { 
            text: '❌ الأمر ده للبوت بس' 
          }, { quoted: msg });
          break;
        }

        await sock.sendMessage(from, {
          text: `✅ *تم تفعيل منع الروابط*\n📌 أي رابط هيتحذف تلقائياً\n🔒 البوت هو المتحكم الوحيد\n👑 الأدمن معفيين من المنع`
        }, { quoted: msg });
        
        break;
      }

      default: break;
    }
  } catch (e) {
    console.error('خطأ:', e.message);
  }
}

// ─── البوت الأساسي ──────────────────────────────────────────
async function startBot() {
  pairingRequested = false;
  fs.mkdirSync(AUTH_FOLDER, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`\n🚀 جاري الاتصال... واتساب: ${version.join('.')}`);
  console.log(`🤖 رقم البوت: ${BOT_NUMBER}`);

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
        const code = await sock.requestPairingCode(BOT_NUMBER);
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
    }

    if (connection === 'close') {
      const errCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`⚠️ انقطع الاتصال (${errCode})`);
      
      if (errCode === DisconnectReason.loggedOut || errCode === DisconnectReason.badSession) {
        console.log('🗑 جلسة تالفة — إعادة بدء...');
        if (fs.existsSync(AUTH_FOLDER)) {
          fs.readdirSync(AUTH_FOLDER)
            .forEach(f => fs.rmSync(path.join(AUTH_FOLDER, f), { recursive: true, force: true }));
        }
        setTimeout(startBot, 3000);
      } else {
        setTimeout(startBot, 5000);
      }
    }
  });

  // ─── معالجة كل الرسائل (للكشف عن الروابط) ──────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    
    for (const m of messages) {
      const from = m.key.remoteJid;
      const isGrp = from?.endsWith('@g.us');
      const sender = isGrp ? m.key.participant : m.key.remoteJid;
      
      // التحقق من وجود رابط في الرسالة
      const msgBody = m.message?.conversation ||
                     m.message?.extendedTextMessage?.text ||
                     m.message?.imageMessage?.caption ||
                     m.message?.videoMessage?.caption || '';
      
      // الكشف عن الروابط (regex بسيط)
      const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\S*)/gi;
      const hasLink = urlRegex.test(msgBody);
      
      // إذا كان في رابط والمرسل مش البوت
      if (hasLink && !isBotJid(sender) && !m.key.fromMe) {
        // التحقق من أن المرسل مش أدمن (في حالة المجموعة)
        let isAdmin = false;
        if (isGrp) {
          isAdmin = await isUserAdmin(sock, from, sender);
        }
        
        // إذا كان أدمن، نسمح له بإرسال الرابط
        if (isAdmin) {
          console.log(`👑 أدمن ${sender?.split('@')[0]} أرسل رابط - تم السماح`);
          continue; // تخطي الحذف
        }
        
        // حذف الرسالة (لغير الأدمن)
        try {
          await sock.sendMessage(from, {
            delete: {
              remoteJid: from,
              fromMe: false,
              id: m.key.id,
              participant: m.key.participant
            }
          });
          
          // إرسال تحذير
          await sock.sendMessage(from, {
            text: `🚫 *تم حذف الرابط*\n📌 ممنوع إرسال روابط في هذه المجموعة\n👑 الأدمن فقط مسموح لهم`
          });
          
          console.log(`🗑 تم حذف رابط من ${sender?.split('@')[0]}`);
        } catch (err) {
          console.error('❌ فشل حذف الرابط:', err.message);
        }
      }
      
      // معالجة باقي الأوامر
      await handleMessage(sock, m);
    }
  });
}

// ─── تشغيل البوت ────────────────────────────────────────────
console.log('╔═══════════════════════════════════╗');
console.log('║       🤖  بوت منع الروابط         ║');
console.log(`║  📱  ${BOT_NUMBER}   ║`);
console.log('╚═══════════════════════════════════╝');

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('🤖 بوت منع الروابط شغال 24/7 🚫');
}).listen(PORT, () => {
  console.log(`✅ بورت مفتوح على ${PORT}`);
});

startBot().catch(e => {
  console.error('خطأ فادح:', e.message);
  setTimeout(startBot, 5000);
});

process.on('uncaughtException', e => console.error('uncaught:', e.message));
process.on('unhandledRejection', e => console.error('rejection:', String(e)));
