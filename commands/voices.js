module.exports = {
  playAudio: async (ctx, filename) => {
    const { sock, from, msg } = ctx;
    try {
      await sock.sendMessage(from, {
        audio: { url: `./assets/${filename}` },
        mimetype: 'audio/mp4',
        ptt: true
      }, { quoted: msg });
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ الملف الصوتي مش موجود` }, { quoted: msg });
    }
  }
};
