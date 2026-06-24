module.exports = {
  playYouTube: async (ctx) => {
    const { sock, from, args, msg } = ctx;
    const query = args.slice(1).join(' ');
    if (!query) {
      await sock.sendMessage(from, { text: '⚠️ اكتب اسم الاغنية بعد .شغل' }, { quoted: msg });
      return;
    }
    await sock.sendMessage(from, { text: `🔍 جاري البحث عن: ${query}` }, { quoted: msg });
    // هتحتاج تضيف مكتبة ytdl-core
  },
  
  downloadTikTok: async (ctx) => {
    const { sock, from, args, msg } = ctx;
    const url = args[1];
    if (!url) {
      await sock.sendMessage(from, { text: '⚠️ حط رابط التيكتوك بعد .تيكتوك' }, { quoted: msg });
      return;
    }
    await sock.sendMessage(from, { text: `⏳ جاري تحميل التيكتوك...` }, { quoted: msg });
  },
  
  downloadInstagram: async (ctx) => {
    const { sock, from, args, msg } = ctx;
    const url = args[1];
    if (!url) {
      await sock.sendMessage(from, { text: '⚠️ حط رابط الانستا بعد .انستا' }, { quoted: msg });
      return;
    }
    await sock.sendMessage(from, { text: `⏳ جاري تحميل الانستا...` }, { quoted: msg });
  }
};
