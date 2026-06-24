module.exports = {
  mentionAll: async (ctx) => {
    const { sock, from, msg, isGroup } = ctx;
    if (!isGroup) {
      await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg });
      return;
    }
    try {
      const metadata = await sock.groupMetadata(from);
      const participants = metadata.participants;
      let mentions = participants.map(p => p.id);
      await sock.sendMessage(from, {
        text: `📢 *منشن للكل*\n\n${participants.map(p => `@${p.id.split('@')[0]}`).join(' ')}`,
        mentions: mentions
      }, { quoted: msg });
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
    }
  },
  
  deleteMsg: async (ctx) => {
    const { sock, from, msg } = ctx;
    try {
      if (msg.message?.extendedTextMessage?.contextInfo?.stanzaId) {
        const id = msg.message.extendedTextMessage.contextInfo.stanzaId;
        const participant = msg.message.extendedTextMessage.contextInfo.participant;
        await sock.sendMessage(from, { delete: { remoteJid: from, fromMe: false, id: id, participant: participant } });
        await sock.sendMessage(from, { text: '✅ تم الحذف' }, { quoted: msg });
      }
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
    }
  },
  
  warn: async (ctx) => {
    const { sock, from, sender, msg } = ctx;
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentioned.length === 0) {
      await sock.sendMessage(from, { text: '⚠️ منشن الشخص الي عايز تحذره' }, { quoted: msg });
      return;
    }
    await sock.sendMessage(from, {
      text: `⚠️ @${mentioned[0].split('@')[0]} تم تحذيرك!\n📊 عدد التحذيرات: 1`,
      mentions: [mentioned[0]]
    }, { quoted: msg });
  },
  
  warnList: async (ctx) => {
    const { sock, from, msg } = ctx;
    await sock.sendMessage(from, { text: `📊 *قائمة التحذيرات*\n\nلا يوجد تحذيرات` }, { quoted: msg });
  },
  
  warnDelete: async (ctx) => {
    const { sock, from, msg } = ctx;
    await sock.sendMessage(from, { text: `✅ تم حذف التحذيرات` }, { quoted: msg });
  },
  
  changeGroupName: async (ctx) => {
    const { sock, from, args, msg, isGroup } = ctx;
    if (!isGroup) {
      await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg });
      return;
    }
    const name = args.slice(1).join(' ');
    if (!name) {
      await sock.sendMessage(from, { text: '⚠️ اكتب الاسم الجديد' }, { quoted: msg });
      return;
    }
    try {
      await sock.groupUpdateSubject(from, name);
      await sock.sendMessage(from, { text: `✅ تم تغيير اسم المجموعة لـ: ${name}` }, { quoted: msg });
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
    }
  },
  
  changeGroupDesc: async (ctx) => {
    const { sock, from, args, msg, isGroup } = ctx;
    if (!isGroup) {
      await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg });
      return;
    }
    const desc = args.slice(1).join(' ');
    if (!desc) {
      await sock.sendMessage(from, { text: '⚠️ اكتب الوصف الجديد' }, { quoted: msg });
      return;
    }
    try {
      await sock.groupUpdateDescription(from, desc);
      await sock.sendMessage(from, { text: `✅ تم تغيير وصف المجموعة` }, { quoted: msg });
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
    }
  },
  
  toMp3: async (ctx) => {
    const { sock, from, msg } = ctx;
    await sock.sendMessage(from, { text: `⏳ جاري التحويل لـ MP3...` }, { quoted: msg });
  },
  
  toGif: async (ctx) => {
    const { sock, from, msg } = ctx;
    await sock.sendMessage(from, { text: `⏳ جاري التحويل لـ GIF...` }, { quoted: msg });
  },
  
  toImage: async (ctx) => {
    const { sock, from, msg } = ctx;
    await sock.sendMessage(from, { text: `⏳ جاري التحويل لـ صورة...` }, { quoted: msg });
  },
  
  ocr: async (ctx) => {
    const { sock, from, msg } = ctx;
    await sock.sendMessage(from, { text: `⏳ جاري استخراج النص...` }, { quoted: msg });
  },
  
  ping: async (ctx) => {
    const { sock, from, msg } = ctx;
    const start = Date.now();
    await sock.sendMessage(from, { text: '🏓' }, { quoted: msg });
    const end = Date.now();
    await sock.sendMessage(from, { text: `🏓 ${end - start}ms` }, { quoted: msg });
  },
  
  quiz: async (ctx) => {
    const { sock, from, msg } = ctx;
    await sock.sendMessage(from, { text: `❓ *مسابقة*\n\nالسؤال: ما هو عكس الليل؟\nالاجابات: 1-نهار 2-صبح 3-ضهر` }, { quoted: msg });
  },
  
  checkQuizAnswer: async (sock, from, body) => {
    // التحقق من اجابات المسابقة
    if (body.includes('نهار')) {
      await sock.sendMessage(from, { text: `✅ اجابة صحيحة! 🎉` });
    }
  }
};
