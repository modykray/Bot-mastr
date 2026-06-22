'use strict';

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { randomEmoji, randomInt, reactTo } = require('../utils');

const beautyComments = {
  high: [
    'انت والله اشبه بـ نجم هوليود 🌟',
    'ربنا اوفر فيك الجمال كله 😍',
    'الناس تتفرج عليك زي المتحف 🎨',
    'وجهك مثل القمر في ليلة البدر ✨',
    'انت جاهز تشتغل موديل من غير فوتوشوب 📸',
  ],
  mid: [
    'ماشي... مش وحش بس مش عبقري كمان 😅',
    'في ناس اعلى منك وفي ناس اوطن، انت النص 😂',
    'الله يحسن الاحوال على كل حال 🤲',
    'انت تعيش بالكاريزما مش الشكل 😆',
    'لو حطيت فلتر ممكن تبقى حلو 📱',
  ],
  low: [
    'الجمال من الداخل يا صديقي... من الداخل جداً 😭',
    'اوعى تتصور من غير فلترات كتير 😬',
    'ربنا بيحب الناس الصح مش بس الحلوين 😇',
    'الشخصية اهم... ده اللي بقول بيه دايما 😅',
    'كل واحد له نصيب... والجمال مش كل حاجة 🤷',
  ],
};

const masculinityComments = [
  'الرجالة مش في الشكل، بس انت مالكش رجالة ولا شكل 😂',
  'شوارزنيجر بعد ما شاف نتيجتك ضحك جداً 💪😂',
  'انت رجل... بس من صنف الرجال اللي بيبكوا في الافلام 😅',
  'نسبة رجولة محترمة! الباقي هيجي مع الخبرة 😏',
  'رجل جداً! شايل الهم بنفسك... وبيبكي في الحمام 😂',
];

const femininityComments = [
  'الانوثة مش بس في الشكل، بس انتي عندك التنين! 💃',
  'كليوباترا كانت هتغار منك 👑',
  'الورود بتتعلم منك كيف تبقى حلوة 🌹',
  'انوثتك زي البحر... واسعة وعميقة 🌊😂',
  'رتبتك في انوثة جوازتي والله 😅💅',
];

const coupleImages = [
  'https://i.imgur.com/Ry0GH8P.jpg',
  'https://i.imgur.com/NpFkF2O.jpg',
  'https://i.imgur.com/SXfpBTO.jpg',
  'https://i.imgur.com/bNQXVmW.jpg',
  'https://i.imgur.com/xhK6n4A.jpg',
];

const donkeyImageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Donkey_1_arp_750px.jpg/800px-Donkey_1_arp_750px.jpg';

async function marry(ctx) {
  const { sock, msg, from, sender, isGroup } = ctx;
  if (!isGroup) {
    return sock.sendMessage(from, { text: `هذا الأمر للمجموعات فقط ${randomEmoji()}` }, { quoted: msg });
  }

  const metadata = await sock.groupMetadata(from);
  const members = metadata.participants.map(p => p.id);
  const others = members.filter(m => m !== sender);

  if (others.length === 0) {
    return sock.sendMessage(from, { text: `مفيش حد تاني في المجموعة! ${randomEmoji()}` }, { quoted: msg });
  }

  const partner = others[Math.floor(Math.random() * others.length)];

  const text = `مبروك لكم الزواج السعيد اصحي يمنطقة 💍\n\n@${sender.split('@')[0]} و @${partner.split('@')[0]} ${randomEmoji()}`;
  await sock.sendMessage(from, {
    text,
    mentions: [sender, partner],
  }, { quoted: msg });
}

async function beautyRate(ctx, type) {
  const { sock, msg, from, sender } = ctx;
  const percent = randomInt(1, 100);
  let comments;
  if (type === 'رجولتك') {
    comments = masculinityComments;
  } else if (type === 'انوثتك') {
    comments = femininityComments;
  } else {
    comments = percent >= 70 ? beautyComments.high : percent >= 40 ? beautyComments.mid : beautyComments.low;
  }

  const comment = comments[Math.floor(Math.random() * comments.length)];
  const text = `@${sender.split('@')[0]}\n\n${type}: *${percent}%* 🎯\n\n${comment} ${randomEmoji()}`;

  await sock.sendMessage(from, { text, mentions: [sender] }, { quoted: msg });
}

async function loveRate(ctx) {
  const { sock, msg, from, sender } = ctx;
  const quoted = msg.message?.extendedTextMessage?.contextInfo;

  if (!quoted?.participant) {
    return sock.sendMessage(from, { text: `رد على شخص عشان اشوف نسبة الحب بينكم ${randomEmoji()}` }, { quoted: msg });
  }

  const target = quoted.participant;
  const percent = randomInt(1, 100);
  const heart = percent >= 80 ? '❤️🔥' : percent >= 50 ? '💛' : '💔';

  const text = `💘 نسبة الحب\n\n@${sender.split('@')[0]} + @${target.split('@')[0]}\n\n${heart} *${percent}%* ${heart} ${randomEmoji()}`;
  await sock.sendMessage(from, { text, mentions: [sender, target] }, { quoted: msg });
}

async function profile(ctx) {
  const { sock, msg, from, sender, isOwner, isGroup } = ctx;
  const quoted = msg.message?.extendedTextMessage?.contextInfo;

  if (!isOwner) {
    await sock.sendMessage(from, {
      image: { url: donkeyImageUrl },
      caption: `انت اما انا 🫏 ${randomEmoji()}`,
    }, { quoted: msg });
    return;
  }

  const target = quoted?.participant || sender;
  try {
    const ppUrl = await sock.profilePictureUrl(target, 'image');
    await sock.sendMessage(from, {
      image: { url: ppUrl },
      caption: `صورة بروفايل @${target.split('@')[0]} ${randomEmoji()}`,
      mentions: [target],
    }, { quoted: msg });
  } catch {
    await sock.sendMessage(from, {
      text: `مفيش صورة بروفايل لـ @${target.split('@')[0]} ${randomEmoji()}`,
      mentions: [target],
    }, { quoted: msg });
  }
}

async function couplePic(ctx) {
  const { sock, msg, from } = ctx;
  const imageUrl = coupleImages[Math.floor(Math.random() * coupleImages.length)];

  await sock.sendMessage(from, {
    image: { url: imageUrl },
    caption: `زوجكم الكارتوني المثالي 💕 ${randomEmoji()}`,
  }, { quoted: msg });
}

module.exports = { marry, beautyRate, loveRate, profile, couplePic };
