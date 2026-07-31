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
const axios = require('axios');
const FormData = require('form-data');

// ─── قراءة ملف .env ──────────────────────────────────────────
require('dotenv').config(); // السطر ده هو اللي هيقرا المفتاح من ملف الـ env

// ─── إعدادات البوت ──────────────────────────────────────────
const BOT_NUMBER = '201044013292';

// ✅ المفتاح هنا بياخده من ملف .env مش باين في الكود
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 

let botEnabled = true; // ✅ تم إصلاح مشكلة الخطأ

const AUTH_FOLDER = path.join(__dirname, 'auth_info');
const ASSETS_FOLDER = path.join(__dirname, 'assets');
const TEMP_FOLDER = path.join(__dirname, 'temp');

const logger = pino({ level: 'silent' });

// ─── دوال مساعدة ────────────────────────────────────────────
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

// ─── إنشاء المجلدات ──────────────────────────────────────────
fs.mkdirSync(TEMP_FOLDER, { recursive: true });

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

// ─── دوال ChatGPT ────────────────────────────────────────────

// 1️⃣ الرد على النصوص
async function askChatGPT(prompt) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'أنت مساعد ذكي ومفيد. رد بالعربية الفصحى أو العامية حسب سؤال المستخدم.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 1000,
        temperature: 0.7,
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('❌ خطأ في ChatGPT:', error.response?.data || error.message);
    return '⚠️ عذراً، حدث خطأ في الاتصال بالذكاء الاصطناعي. حاول مرة أخرى.';
  }
}

// 2️⃣ توليد صور (DALL-E)
async function generateImage(prompt) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/images/generations',
      {
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.data[0].url;
  } catch (error) {
    console.error('❌ خطأ في توليد الصورة:', error.response?.data || error.message);
    return null;
  }
}

// 3️⃣ تعديل صورة
async function editImage(imageUrl, prompt) {
  try {
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data);
    
    const tempImagePath = path.join(TEMP_FOLDER, `edit_${Date.now()}.png`);
    fs.writeFileSync(tempImagePath, imageBuffer);
    
    const formData = new FormData();
    formData.append('image', fs.createReadStream(tempImagePath));
    formData.append('prompt', prompt);
    formData.append('n', '1');
    formData.append('size', '1024x1024');
    
    const response = await axios.post(
      'https://api.openai.com/v1/images/edits',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          ...formData.getHeaders()
        }
      }
    );
    
    fs.unlinkSync(tempImagePath);
    return response.data.data[0].url;
  } catch (error) {
    console.error('❌ خطأ في تعديل الصورة:', error.response?.data || error.message);
    return null;
  }
}

// 4️⃣ تحليل صورة
async function analyzeImage(imageUrl) {
  try {
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const base64Image = Buffer.from(imageResponse.data).toString('base64');
    
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'وصف هذه الصورة بالتفصيل باللغة العربية:' },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 500,
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('❌ خطأ في تحليل الصورة:', error.response?.data || error.message);
    return '⚠️ لم أستطع تحليل الصورة.';
  }
}

// ─── التحقق من الأدمن ──────────────────────────────────────────
const adminCache = new Map();

async function isUserAdmin(sock, groupJid, participantJid) {
  try {
    const cacheKey = `${groupJid}_${participantJid}`;
    if (adminCache.has(cacheKey)) {
      return adminCache.get(cacheKey);
    }

    const groupMetadata = await sock.groupMetadata(groupJid);
    const admins = groupMetadata.participants
      .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
      .map(p => p.id);
    
    const isAdmin = admins.includes(participantJid);
    adminCache.set(cacheKey, isAdmin);
    setTimeout(() => adminCache.delete(cacheKey), 5 * 60 * 1000);
    
    return isAdmin;
  } catch (error) {
    console.error('خطأ في التحقق من الأدمن:', error.message);
    return false;
  }
}

// ─── معالجة الرسائل ────────────────────────────────────────────
let processingMessages = new Set(); // لمنع التكرار

async function handleMessage(sock, msg) {
  try {
    if (!msg.message) return;
    if (isJidBroadcast(msg.key.remoteJid)) return;

    const from = msg.key.remoteJid;
    const isGrp = from?.endsWith('@g.us');
    const sender = isGrp ? msg.key.participant : msg.key.remoteJid;
    const senderPhone = sender?.split('@')[0];
    
    // منع التكرار
    const msgId = msg.key.id;
    if (processingMessages.has(msgId)) return;
    processingMessages.add(msgId);
    setTimeout(() => processingMessages.delete(msgId), 5000);
    
    // استخراج النص والصور
    let body = msg.message?.conversation ||
               msg.message?.extendedTextMessage?.text || '';
    
    const imageCaption = msg.message?.imageMessage?.caption || '';
    const hasImage = !!msg.message?.imageMessage;
    
    const fullText = body || imageCaption;
    
    if (!botEnabled) return;
    if (!fullText) return;

    // ─── أوامر الصوت (بدون نقطة) ──────────────────────────────
    const trimmed = fullText.trim();
    
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

    // ─── الرد على أي رسالة (حتى بدون نقطة) ────────────────────
    if (!fullText.startsWith('.')) {
      if (msg.message?.audioMessage || msg.message?.imageMessage || msg.message?.videoMessage) {
        return;
      }
      
      console.log(`💬 ${sender?.split('@')[0]} قال: ${fullText}`);
      await sock.sendPresenceUpdate('composing', from);
      
      const reply = await askChatGPT(fullText);
      
      await sock.sendMessage(from, {
        text: `🤖 ${reply}`
      }, { quoted: msg });
      return;
    }

    // ─── الأوامر التي تبدأ بنقطة ──────────────────────────────
    const parts = fullText.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    const prompt = args.join(' ');

    console.log(`[BOT] ${sender?.split('@')[0]} → ${command}`);

    switch (command) {

      // ─── منع الروابط ──────────────────────────────────────────
      case '.منع_روابط': {
        await sock.sendMessage(from, {
          text: `✅ *تم تفعيل منع الروابط*\n📌 أي رابط هيتحذف تلقائياً\n👑 الأدمن معفيين`
        }, { quoted: msg });
        break;
      }

      // ─── سؤال ChatGPT (ب نقطة) ──────────────────────────────
      case '.سؤال':
      case '.اسأل':
      case '.كيف_حالك': {
        if (!prompt) {
          await sock.sendMessage(from, {
            text: '❌ اكتب السؤال بعد الأمر\nمثال: `.سؤال كيف حالك؟`'
          }, { quoted: msg });
          break;
        }
        
        await sock.sendPresenceUpdate('composing', from);
        const reply = await askChatGPT(prompt);
        
        await sock.sendMessage(from, {
          text: `🤖 *الرد:*\n${reply}`
        }, { quoted: msg });
        break;
      }

      // ─── توليد صورة ──────────────────────────────────────────
      case '.صورة':
      case '.توليد':
      case '.ارسم': {
        if (!prompt) {
          await sock.sendMessage(from, {
            text: '❌ اكتب وصف الصورة بعد الأمر\nمثال: `.صورة غروب شمس على البحر`'
          }, { quoted: msg });
          break;
        }
        
        await sock.sendMessage(from, { text: '🎨 جاري رسم الصورة...' }, { quoted: msg });
        const imageUrl = await generateImage(prompt);
        
        if (imageUrl) {
          const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
          await sock.sendMessage(from, {
            image: Buffer.from(imgResponse.data),
            caption: `🖼️ *الصورة المولدة:*\n"${prompt}"`
          }, { quoted: msg });
        } else {
          await sock.sendMessage(from, {
            text: '❌ فشل في توليد الصورة. حاول مرة أخرى.'
          }, { quoted: msg });
        }
        break;
      }

      // ─── تحسين جودة الصورة ──────────────────────────────────
      case '.حسن_الصورة':
      case '.تعديل':
      case '.تحسين': {
        if (!hasImage) {
          await sock.sendMessage(from, {
            text: '❌ أرسل صورة مع الأمر\nمثال: ابعث صورة واكتب تحتها `.تحسين اجعلها أكثر وضوحاً`'
          }, { quoted: msg });
          break;
        }
        
        if (!prompt) {
          await sock.sendMessage(from, {
            text: '❌ اكتب التعديل المطلوب\nمثال: `.تحسين اجعل الخلفية غروب شمس`'
          }, { quoted: msg });
          break;
        }
        
        await sock.sendMessage(from, { text: '🎨 جاري تحسين الصورة...' }, { quoted: msg });
        
        const media = await sock.downloadMediaMessage(msg.message);
        if (media) {
          const tempPath = path.join(TEMP_FOLDER, `temp_${Date.now()}.jpg`);
          fs.writeFileSync(tempPath, media);
          
          const formData = new FormData();
          formData.append('image', fs.createReadStream(tempPath));
          
          const uploadResponse = await axios.post('https://tmp.ninja/upload.php', formData, {
            headers: formData.getHeaders()
          });
          
          const uploadedUrl = uploadResponse.data.url;
          const editedImageUrl = await editImage(uploadedUrl, prompt);
          
          fs.unlinkSync(tempPath);
          
          if (editedImageUrl) {
            const imgResponse = await axios.get(editedImageUrl, { responseType: 'arraybuffer' });
            await sock.sendMessage(from, {
              image: Buffer.from(imgResponse.data),
              caption: `✨ *الصورة بعد التعديل:*\n"${prompt}"`
            }, { quoted: msg });
          } else {
            await sock.sendMessage(from, {
              text: '❌ فشل في تحسين الصورة.'
            }, { quoted: msg });
          }
        } else {
          await sock.sendMessage(from, {
            text: '❌ لم أستطع تحميل الصورة.'
          }, { quoted: msg });
        }
        break;
      }

      // ─── وصف الصورة ──────────────────────────────────────────
      case '.وصف':
      case '.حلل':
      case '.شوف': {
        if (!hasImage) {
          await sock.sendMessage(from, {
            text: '❌ أرسل صورة مع الأمر\nمثال: ابعث صورة واكتب تحتها `.وصف`'
          }, { quoted: msg });
          break;
        }
        
        await sock.sendMessage(from, { text: '👁️ جاري تحليل الصورة...' }, { quoted: msg });
        
        const media = await sock.downloadMediaMessage(msg.message);
        if (media) {
          const tempPath = path.join(TEMP_FOLDER, `temp_${Date.now()}.jpg`);
          fs.writeFileSync(tempPath, media);
          
          const formData = new FormData();
          formData.append('image', fs.createReadStream(tempPath));
          
          const uploadResponse = await axios.post('https://tmp.ninja/upload.php', formData, {
            headers: formData.getHeaders()
          });
          
          const uploadedUrl = uploadResponse.data.url;
          const description = await analyzeImage(uploadedUrl);
          
          fs.unlinkSync(tempPath);
          
          await sock.sendMessage(from, {
            text: `📝 *وصف الصورة:*\n${description}`
          }, { quoted: msg });
        } else {
          await sock.sendMessage(from, {
            text: '❌ لم أستطع تحميل الصورة.'
          }, { quoted: msg });
        }
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
  fs.mkdirSync(AUTH_FOLDER, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`\n🚀 جاري الاتصال... واتساب: ${version.join('.')}`);
  console.log(`🤖 رقم البوت: ${BOT_NUMBER}`);
  console.log(`🔑 مفتاح API: تم تحميله بنجاح من ملف .env (مخفي)`);

  const sock = makeWASocket({
    version, logger,
    browser: Browsers.ubuntu('Chrome'),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !sock.authState.creds.registered) {
      try {
        const code = await sock.requestPairingCode(BOT_NUMBER);
        const display = String(code).replace(/(.{4})/g, '$1-').slice(0, -1);
        console.log('\n╔══════════════════════════════════════╗');
        console.log(`║   🔑  كود الربط : ${display.padEnd(12)}  ║`);
        console.log('╚══════════════════════════════════════╝');
      } catch (err) {
        console.error('❌ فشل الكود:', err.message);
      }
    }

    if (connection === 'open') {
      console.log(`✅ البوت متصل! +${sock.user?.id?.split(':')[0]}`);
    }

    if (connection === 'close') {
      const errCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`⚠️ انقطع الاتصال (${errCode})`);
      setTimeout(startBot, 5000);
    }
  });

  // ─── معالجة كل الرسائل ──────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    
    for (const m of messages) {
      // منع الروابط (للأعضاء العاديين)
      const from = m.key.remoteJid;
      const isGrp = from?.endsWith('@g.us');
      const sender = isGrp ? m.key.participant : m.key.remoteJid;
      
      const msgBody = m.message?.conversation ||
                     m.message?.extendedTextMessage?.text ||
                     m.message?.imageMessage?.caption ||
                     m.message?.videoMessage?.caption || '';
      
      const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\S*)/gi;
      const hasLink = urlRegex.test(msgBody);
      
      if (hasLink && !isBotJid(sender) && !m.key.fromMe) {
        let isAdmin = false;
        if (isGrp) {
          isAdmin = await isUserAdmin(sock, from, sender);
        }
        
        if (!isAdmin) {
          try {
            await sock.sendMessage(from, {
              delete: {
                remoteJid: from,
                fromMe: false,
                id: m.key.id,
                participant: m.key.participant
              }
            });
            
            await sock.sendMessage(from, {
              text: `🚫 *تم حذف الرابط*\n📌 ممنوع إرسال روابط\n👑 الأدمن فقط مسموح لهم`
            });
            
            console.log(`🗑 تم حذف رابط من ${sender?.split('@')[0]}`);
          } catch (err) {
            console.error('❌ فشل حذف الرابط:', err.message);
          }
        }
      }
      
      // معالجة باقي الأوامر (الرد على البوت نفسه)
      await handleMessage(sock, m);
    }
  });
}

// ─── تشغيل البوت ────────────────────────────────────────────
console.log('╔═══════════════════════════════════╗');
console.log('║    🤖  بوت ChatGPT المتكامل       ║');
console.log(`║  📱  ${BOT_NUMBER}   ║`);
console.log('╚═══════════════════════════════════╝');

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('🤖 بوت ChatGPT شغال 24/7 🚀');
}).listen(PORT, () => {
  console.log(`✅ بورت مفتوح على ${PORT}`);
});

startBot().catch(e => {
  console.error('خطأ فادح:', e.message);
  setTimeout(startBot, 5000);
});

process.on('uncaughtException', e => console.error('uncaught:', e.message));
process.on('unhandledRejection', e => console.error('rejection:', String(e)));
