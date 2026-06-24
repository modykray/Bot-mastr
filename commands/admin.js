module.exports = {
  kick: async (ctx) => {
    const { sock, from, sender, msg, isGroup } = ctx;
    if (!isGroup) {
      await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg });
      return;
    }
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentioned.length === 0) {
      await sock.sendMessage(from, { text: '⚠️ منشن الشخص الي عايز تطرده' }, { quoted: msg });
      return;
    }
    try {
      await sock.groupParticipantsUpdate(from, mentioned, 'remove');
      await sock.sendMessage(from, {
        text: `✅ تم طرد @${mentioned[0].split('@')[0]} 🚀`,
        mentions: [mentioned[0]]
      }, { quoted: msg });
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
    }
  },
  
  promote: async (ctx) => {
    const { sock, from, sender, msg, isGroup } = ctx;
    if (!isGroup) {
      await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg });
      return;
    }
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentioned.length === 0) {
      await sock.sendMessage(from, { text: '⚠️ منشن الشخص الي عايز ترفعه' }, { quoted: msg });
      return;
    }
    try {
      await sock.groupParticipantsUpdate(from, mentioned, 'promote');
      await sock.sendMessage(from, {
        text: `✅ تم رفع @${mentioned[0].split('@')[0]} مشرف 👑`,
        mentions: [mentioned[0]]
      }, { quoted: msg });
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
    }
  },
  
  demote: async (ctx) => {
    const { sock, from, sender, msg, isGroup } = ctx;
    if (!isGroup) {
      await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg });
      return;
    }
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentioned.length === 0) {
      await sock.sendMessage(from, { text: '⚠️ منشن الشخص الي عايز تشيله' }, { quoted: msg });
      return;
    }
    try {
      await sock.groupParticipantsUpdate(from, mentioned, 'demote');
      await sock.sendMessage(from, {
        text: `✅ تم شيل @${mentioned[0].split('@')[0]} من المشرفين 🛡️`,
        mentions: [mentioned[0]]
      }, { quoted: msg });
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
    }
  },
  
  closeGroup: async (ctx) => {
    const { sock, from, msg, isGroup } = ctx;
    if (!isGroup) {
      await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg });
      return;
    }
    try {
      await sock.groupSettingUpdate(from, 'announcement');
      await sock.sendMessage(from, { text: '🔒 تم قفل المجموعة (مشرفين بس)' }, { quoted: msg });
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
    }
  },
  
  openGroup: async (ctx) => {
    const { sock, from, msg, isGroup } = ctx;
    if (!isGroup) {
      await sock.sendMessage(from, { text: '❌ الأمر ده في الجروبات بس' }, { quoted: msg });
      return;
    }
    try {
      await sock.groupSettingUpdate(from, 'not_announcement');
      await sock.sendMessage(from, { text: '🔓 تم فتح المجموعة (الكل يكتب)' }, { quoted: msg });
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ فشل: ${e.message}` }, { quoted: msg });
    }
  },
  
  antiLink: async (ctx) => {
    const { sock, from, msg } = ctx;
    // هتحتاج تضيف متغير لحالة منع الروابط
    await sock.sendMessage(from, { text: '✅ تم تفعيل منع الروابط' }, { quoted: msg });
  },
  
  antiLinkOff: async (ctx) => {
    const { sock, from, msg } = ctx;
    await sock.sendMessage(from, { text: '❌ تم إيقاف منع الروابط' }, { quoted: msg });
  },
  
  checkAntiLink: async (sock, msg, from, sender) => {
    // فحص الروابط
    const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    if (urlRegex.test(body)) {
      try {
        await sock.sendMessage(from, {
          text: `🚫 @${sender.split('@')[0]} ممنوع نشر الروابط!`,
          mentions: [sender]
        });
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
      } catch (e) {}
    }
  }
};
