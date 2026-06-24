module.exports = {
  marry: async (ctx) => {
    const { sock, from, sender, msg } = ctx;
    await sock.sendMessage(from, {
      text: `مبروك يا @${sender.split('@')[0]} اتجوزت نفسك 😂🎉`,
      mentions: [sender]
    }, { quoted: msg });
  },
  
  beautyRate: async (ctx, type) => {
    const { sock, from, sender, msg } = ctx;
    const rate = Math.floor(Math.random() * 101);
    await sock.sendMessage(from, {
      text: `📊 *${type}:* ${rate}%\n${rate > 70 ? '🔥 انت جامد!' : rate > 40 ? '👍 ماشي حالك' : '😅 شد حيلك'}`,
      mentions: [sender]
    }, { quoted: msg });
  },
  
  loveRate: async (ctx) => {
    const { sock, from, sender, msg } = ctx;
    const rate = Math.floor(Math.random() * 101);
    await sock.sendMessage(from, {
      text: `❤️ *نسبة الحب:* ${rate}%\n${rate > 70 ? '😍 حب كبير!' : rate > 40 ? '💕 حب متوسط' : '💔 محتاج تشتغل على نفسك'}`,
      mentions: [sender]
    }, { quoted: msg });
  },
  
  profile: async (ctx) => {
    const { sock, from, sender, msg } = ctx;
    await sock.sendMessage(from, {
      text: `📋 *بروفايلك*\n\n👤 @${sender.split('@')[0]}\n🎂 تاريخ الانضمام: ${new Date().toLocaleDateString('ar')}\n🐦 صنع بحب`,
      mentions: [sender]
    }, { quoted: msg });
  },
  
  couplePic: async (ctx) => {
    const { sock, from, msg } = ctx;
    await sock.sendMessage(from, {
      text: `🖼️ *طقملي*\n\nصورتك الجاية هتبقى حلوة 🐦`
    }, { quoted: msg });
  }
};
