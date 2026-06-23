'use strict';

const venom = require('venom-bot');
const fs = require('fs');
const path = require('path');

const OWNER_NUMBER = '201110302392';
const SESSION_FOLDER = path.join(__dirname, 'sessions');

// ─── متغيرات الإحصاءات ──────────────────────────────────────────────────
const userStats = new Map();
const groupStats = new Map();
let botEnabled = true;

// ─── إنشاء مجلد الجلسات ────────────────────────────────────────────────
if (!fs.existsSync(SESSION_FOLDER)) {
  fs.mkdirSync(SESSION_FOLDER, { recursive: true });
}

// ─── بدء البوت ──────────────────────────────────────────────────────────
console.log('╔═══════════════════════════════════╗');
console.log('║       🤖  ايرن بوت (Venom)       ║');
console.log(`║  📞  ${OWNER_NUMBER}   ║`);
console.log('╚═══════════════════════════════════╝');

venom
  .create({
    session: 'eren-bot',
    multidevice: true,
    folderNameToken: SESSION_FOLDER,
    headless: true,
    browserArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
    
    // ─── طريقة الربط بـ 8 حروف ──────────────────────────────────────
    // هنخلي البوت يستنى الكود من المستخدم بدل QR
    catchQR: (qrCode, asciiQR) => {
      // مش هنعمل حاجة بالـ QR، هنستنى الكود
      console.log('⏳ جاري انتظار كود الربط من واتساب...');
    },
    
    // لما واتساب يطلب الكود، هنبعته للمستخدم
    statusFind: (statusSession, session) => {
      console.log('📱 حالة الجلسة:', statusSession);
    }
  })
  .then((client) => startBot(client))
  .catch((error) => {
    console.error('❌ فشل بدء البوت:', error);
    setTimeout(() => process.exit(1), 3000);
  });

// ─── تشغيل البوت ────────────────────────────────────────────────────────
function startBot(client) {
  console.log('✅ البوت متصل!');

  // ── تحديث الإحصاءات ──────────────────────────────────────────────────
  client.onMessage(async (message) => {
    try {
      const from = message.from;
      const sender = message.author || message.from;
      const isGrp = message.isGroupMsg;
      const isOwner = sender === OWNER_NUMBER + '@c.us';
      const body = message.body || '';

      // تحديث الإحصاءات
      if (sender && !message.isMe) {
        if (!userStats.has(sender)) {
          userStats.set(sender, { messages: 0, lastMsg: Date.now() });
        }
        const userStat = userStats.get(sender);
        userStat.messages += 1;
        userStat.lastMsg = Date.now();
        userStats.set(sender, userStat);

        if (isGrp) {
          if (!groupStats.has(from)) {
            groupStats.set(from, { members: {}, totalMsgs: 0 });
          }
          const groupStat = groupStats.get(from);
          if (!groupStat.members[sender]) {
            groupStat.members[sender] = 0;
          }
          groupStat.members[sender] += 1;
          groupStat.totalMsgs += 1;
          groupStats.set(from, groupStat);
        }
      }

      // لو البوت موقوف
      if (!botEnabled && !isOwner) return;

      // ── ردود الكلمات التلقائية ──────────────────────────────────────
      if (body && !body.startsWith('.') && !message.isMe) {
        const norm = body.replace(/[أإآ]/g, 'ا').trim();
        const words = norm.split(/\s+/);
        const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

        if (norm.includes('احا')) {
          await client.sendAudio(from, './assets/aha.m4a', { ptt: true });
          return;
        }

        if (norm.includes('خخ')) {
          await client.sendText(from, 'خوخ وفاكهة سوق العبور اشخر ع قدك يعرص🐦');
          return;
        }

        if (norm.includes('يسطا')) {
          await client.sendText(from, pick([
            'اي يسطا🌚🫶🏻',
            'قلب الاسطي😂🫶🏻',
            'يسطا خدتك ع البسطه😂🫶🏻'
          ]));
          return;
        }
      }

      if (!body.startsWith('.')) return;

      const parts = body.trim().split(/\s+/);
      const command = parts[0].toLowerCase();
      const senderNumber = sender.split('@')[0];

      console.log(`[BOT] ${senderNumber} → ${command}`);

      // ── أوامر البوت ──────────────────────────────────────────────────
      switch (command) {

        // ══ قائمة الأوامر ═══════════════════════════════════════════════
        case '.اوامر': {
          const helpText = `📋 *قائمة أوامر ايرن بوت*\n\n` +
            `🎮 *ترفيه*\n` +
            `.جوزني .جمالي .انوثتي .رجولتي .حب .بروفايل .طقملي\n\n` +
            `🛡️ *أدمن*\n` +
            `.انطر .رفاعي .شدفيه .منشن .حذف\n` +
            `.انذار .الانذارات .حذف_انذار .جروب_اسم .جروب_وصف\n\n` +
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
            `.توب .رتبتي .رسائلي .تفاعل .مين_انا\n\n` +
            `🐦 *صنع بحب*`;

          await client.sendText(from, helpText);
          break;
        }

        // ══ أمر الربط بـ 8 حروف ════════════════════════════════════════
        case '.ربط': {
          if (isGrp) {
            await client.sendText(from, '📱 ابعت الأمر ده في الخاص عشان تاخد كود الربط');
            break;
          }

          // نتأكد إن الرقم مش مربوط قبل كده
          // (هتحتاج تعمل نظام لتخزين البوتات الفرعية زي ما كان في Baileys)

          await client.sendText(from, 
            `🔐 *جاري تجهيز كود الربط...*\n\n` +
            `📱 *خطوات الربط:*\n` +
            `1️⃣ افتح واتساب على موبايلك\n` +
            `2️⃣ الإعدادات ← الأجهزة المرتبطة\n` +
            `3️⃣ اضغط *ربط جهاز*\n` +
            `4️⃣ اختار *ربط برقم الهاتف*\n` +
            `5️⃣ استنى الكود هيجيلك خلال ثواني\n\n` +
            `⏳ *بنطلب الكود من واتساب...*`
          );

          try {
            // في Venom، الكود بيظهر في console تلقائياً
            // هنستخدم حدث عشان ناخد الكود ونبعته للمستخدم
            const qrCode = await client.getPairingCode(sender);
            
            // الكود اللي رجع هو كود 8 حروف حقيقي
            await client.sendText(from,
              `╔══════════════════════════╗\n` +
              `║  🔑 *كود الربط*          ║\n` +
              `╠══════════════════════════╣\n` +
              `║     *${qrCode}*           ║\n` +
              `╚══════════════════════════╝\n\n` +
              `📱 *ادخل الكود ده في واتساب*\n` +
              `⏳ *صلاحية الكود 5 دقايق*\n\n` +
              `✅ بعد ما تدخل الكود، هيجيلك تأكيد إن البوت اتضاف`
            );

          } catch (err) {
            await client.sendText(from, `❌ فشل توليد الكود: ${err.message}`);
          }
          break;
        }

        // ══ تست ════════════════════════════════════════════════════════
        case '.تست': {
          const testMessages = [
            `شغال يسطا والله 🐦`,
            `ماشي يسطا حاضر🐦`,
            `يعم احا ما قولت شغال🙂`
          ];
          const randomMsg = testMessages[Math.floor(Math.random() * testMessages.length)];

          if (isOwner) {
            await client.sendAudio(from, './assets/aha.m4a', { ptt: true });
            setTimeout(async () => {
              await client.sendText(from, randomMsg);
            }, 1500);
          } else {
            await client.sendText(from, randomMsg);
          }
          break;
        }

        // ══ ترول ════════════════════════════════════════════════════════
        case '.ترول': {
          const trolls = [
            `@${senderNumber} وشك عامل زي البطيخه 🍉😂`,
            `@${senderNumber} انت فاكر نفسك مين يا عرص 🐦`,
            `@${senderNumber} شكلك عامل زي الفراخ🍗`,
            `@${senderNumber} ضحكتني بجد 😂😂`
          ];
          const random = trolls[Math.floor(Math.random() * trolls.length)];
          await client.sendText(from, random);
          break;
        }

        // ══ مزاجي ═══════════════════════════════════════════════════════
        case '.مزاجي': {
          const moods = [
            `🍃 *هادي* زي البحر الهاديء 🌊`,
            `🔥 *مضروب* زي العندل 😂`,
            `😊 *فرحان* زي العصفور 🐦`,
            `🤩 *جامد فشخ* كمل كده 💪`,
            `🥱 *نعسان* روح نام 😴`
          ];
          const random = moods[Math.floor(Math.random() * moods.length)];
          await client.sendText(from, `🌤️ *مزاجك النهارده*\n\n${random}`);
          break;
        }

        // ══ مين انا ════════════════════════════════════════════════════
        case '.مين_انا': {
          const userStat = userStats.get(sender);
          const msgCount = userStat ? userStat.messages : 0;

          let info = `📋 *معلومات حسابك*\n\n`;
          info += `📱 *رقمك:* +${senderNumber}\n`;
          info += `👑 *الحالة:* ${isOwner ? 'الأونر 👑' : 'عضو عادي'}\n`;
          info += `💬 *عدد رسائلك:* ${msgCount} رسالة\n`;
          info += `\n🐦 *ايرن بوت*`;

          await client.sendText(from, info);
          break;
        }

        // ══ اعضاء ══════════════════════════════════════════════════════
        case '.اعضاء': {
          if (!isGrp) {
            await client.sendText(from, '❌ الأمر ده في الجروبات بس');
            break;
          }
          try {
            const group = await client.getGroupInfo(from);
            const members = group.participants || [];
            const admins = members.filter(p => p.isAdmin || p.isSuperAdmin);

            await client.sendText(from,
              `📊 *إحصاءات المجموعة*\n\n` +
              `👥 *الأعضاء:* ${members.length}\n` +
              `👑 *المشرفين:* ${admins.length}\n` +
              `📝 *اسم المجموعة:* ${group.name}`
            );
          } catch (e) {
            await client.sendText(from, `❌ فشل: ${e.message}`);
          }
          break;
        }

        // ══ الادمنية ════════════════════════════════════════════════════
        case '.الادمنية': {
          if (!isGrp) {
            await client.sendText(from, '❌ الأمر ده في الجروبات بس');
            break;
          }
          try {
            const group = await client.getGroupInfo(from);
            const admins = group.participants.filter(p => p.isAdmin || p.isSuperAdmin);

            if (admins.length === 0) {
              await client.sendText(from, '📊 مفيش مشرفين في المجموعة');
              break;
            }

            let adminList = `👑 *المشرفين (${admins.length})*\n\n`;
            admins.forEach((p, i) => {
              const role = p.isSuperAdmin ? '👑 أونر' : '🛡️ مشرف';
              const num = p.id.split('@')[0];
              adminList += `${i+1}. ${num} - ${role}\n`;
            });

            await client.sendText(from, adminList);
          } catch (e) {
            await client.sendText(from, `❌ فشل: ${e.message}`);
          }
          break;
        }

        // ══ بوت_معلومات ════════════════════════════════════════════════
        case '.بوت_معلومات': {
          const info = `🤖 *معلومات ايرن بوت*\n\n` +
                       `📱 *الأونر:* +${OWNER_NUMBER}\n` +
                       `🔄 *الإصدار:* 3.0.0 (Venom)\n` +
                       `✅ *الحالة:* ${botEnabled ? '🟢 شغال' : '🔴 موقوف'}\n` +
                       `\n🐦 *صنع بحب*`;
          await client.sendText(from, info);
          break;
        }

        // ══ اونر ════════════════════════════════════════════════════════
        case '.اونر': {
          await client.sendText(from, `👑 *أونر البوت*\n\n📞 +${OWNER_NUMBER}\n\n🐦 *تواصل معاه لو محتاج حاجة*`);
          break;
        }

        // ══ توب ════════════════════════════════════════════════════════
        case '.توب': {
          if (!isGrp) {
            await client.sendText(from, '❌ الأمر ده في الجروبات بس');
            break;
          }
          try {
            const groupStat = groupStats.get(from);
            if (!groupStat || Object.keys(groupStat.members).length === 0) {
              await client.sendText(from, '📊 مفيش بيانات كافية للمجموعة');
              break;
            }

            const sorted = Object.entries(groupStat.members)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5);

            let topList = `🏆 *أجمد 5 أعضاء*\n\n`;
            sorted.forEach(([user, count], i) => {
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
              const userNum = user.split('@')[0];
              topList += `${medal} ${userNum} - ${count} رسالة\n`;
            });

            await client.sendText(from, topList);
          } catch (e) {
            await client.sendText(from, `❌ فشل: ${e.message}`);
          }
          break;
        }

        // ══ رتبتي ══════════════════════════════════════════════════════
        case '.رتبتي': {
          if (!isGrp) {
            await client.sendText(from, '❌ الأمر ده في الجروبات بس');
            break;
          }
          try {
            const groupStat = groupStats.get(from);
            if (!groupStat || !groupStat.members[sender]) {
              await client.sendText(from, '📊 مفيش رسائل ليك في المجموعة دي');
              break;
            }

            const sorted = Object.entries(groupStat.members)
              .sort((a, b) => b[1] - a[1]);

            const rank = sorted.findIndex(([user]) => user === sender) + 1;
            const total = sorted.length;
            const myMsgs = groupStat.members[sender];

            await client.sendText(from,
              `📊 *ترتيبك في المجموعة*\n\n` +
              `👤 *انت:* ${senderNumber}\n` +
              `🏆 *ترتيبك:* #${rank} من ${total}\n` +
              `💬 *رسائلك:* ${myMsgs} رسالة`
            );
          } catch (e) {
            await client.sendText(from, `❌ فشل: ${e.message}`);
          }
          break;
        }

        // ══ رسائلي ═════════════════════════════════════════════════════
        case '.رسائلي': {
          const userStat = userStats.get(sender);
          const count = userStat ? userStat.messages : 0;
          await client.sendText(from, `💬 *رسائلك*\n\n📊 عدد رسائلك الكلي: *${count}* رسالة 🐦`);
          break;
        }

        // ══ تفاعل ══════════════════════════════════════════════════════
        case '.تفاعل': {
          if (!isGrp) {
            await client.sendText(from, '❌ الأمر ده في الجروبات بس');
            break;
          }
          try {
            const groupStat = groupStats.get(from);
            if (!groupStat || !groupStat.members[sender]) {
              await client.sendText(from, '📊 مفيش رسائل ليك في المجموعة دي');
              break;
            }

            const myMsgs = groupStat.members[sender];
            const totalMsgs = groupStat.totalMsgs;
            const percentage = Math.round((myMsgs / totalMsgs) * 100);

            let emoji = '😴';
            let status = 'محتاج تشتغل على نفسك';
            if (percentage > 30) { emoji = '🔥'; status = 'جامد فشخ!'; }
            else if (percentage > 20) { emoji = '💪'; status = 'كويس!'; }
            else if (percentage > 10) { emoji = '👍'; status = 'ماشي حالك'; }

            await client.sendText(from,
              `📊 *نسبة تفاعلك*\n\n` +
              `👤 ${senderNumber}\n` +
              `📈 نسبة التفاعل: *${percentage}%*\n` +
              `${emoji} *${status}*\n` +
              `💬 ${myMsgs} رسالة من ${totalMsgs}`
            );
          } catch (e) {
            await client.sendText(from, `❌ فشل: ${e.message}`);
          }
          break;
        }

        // ══ رفرش ═══════════════════════════════════════════════════════
        case '.رفرش': {
          if (!isOwner) {
            await client.sendText(from, '❌ الأمر ده للأونر بس');
            break;
          }
          botEnabled = true;
          await client.sendText(from, '🔄 *جاري إعادة الاتصال...*\nثواني وهيرجع يشتغل ✅');
          break;
        }

        // ══ بور_اوف ════════════════════════════════════════════════════
        case '.بور_اوف': {
          if (!isOwner) {
            await client.sendText(from, '❌ الأمر ده للأونر بس');
            break;
          }
          botEnabled = false;
          await client.sendText(from, '⛔ *البوت اتوقف*\n\nمش هيرد على أي حد دلوقتي\nاكتب *.رفرش* عشان يرجع يشتغل');
          break;
        }

        // ═══ أصوات ═════════════════════════════════════════════════════
        case '.سمكة': {
          await client.sendAudio(from, './assets/samaka.mp3', { ptt: true });
          break;
        }
        case '.بورعي': {
          await client.sendAudio(from, './assets/bora3i.mp3', { ptt: true });
          break;
        }
        case '.ايرن': {
          await client.sendAudio(from, './assets/eren.mp3', { ptt: true });
          break;
        }

        // ═══ بينج ══════════════════════════════════════════════════════
        case '.بنج': {
          const start = Date.now();
          await client.sendText(from, '🏓 *جاري حساب البينج...*');
          const end = Date.now();
          await client.sendText(from, `🏓 *البينج:* ${end - start}ms`);
          break;
        }

        default: {
          await client.sendText(from, `❌ الأمر *${command}* مش موجود\n\n📋 اكتب *.اوامر* عشان تشوف القائمة كاملة`);
          break;
        }
      }

    } catch (error) {
      console.error('❌ خطأ:', error.message);
    }
  });

  // ── حدث دخول عضو جديد ──────────────────────────────────────────────────
  client.onGroupParticipantChange(async (event) => {
    try {
      if (event.action === 'add') {
        const groupId = event.groupId;
        const newMember = event.participants[0];
        const groupInfo = await client.getGroupInfo(groupId);
        const groupName = groupInfo.name || 'المجموعة';

        const welcomeMessages = [
          `منور البار يقلبي 🐦 @${newMember.split('@')[0]}`,
          `شير البار يقلب اخوك 🐦 @${newMember.split('@')[0]}`,
          `اهلاً بك في ${groupName} يا @${newMember.split('@')[0]} 🐦`
        ];

        const randomWelcome = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
        await client.sendText(groupId, randomWelcome);
      }
    } catch (error) {
      console.error('❌ خطأ في الترحيب:', error.message);
    }
  });

  console.log('🤖 البوت جاهز لاستقبال الأوامر!');
                                  }
