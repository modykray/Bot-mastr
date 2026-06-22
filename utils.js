'use strict';

const fs   = require('fs');
const path = require('path');

const EMOJIS = [
  '😂', '🔥', '💀', '😎', '🤣', '😅', '👊', '💪', '🫡', '😏',
  '🤙', '😜', '🙈', '🤯', '😤', '🥹', '💅', '🫣', '🤡', '😬',
  '🫠', '🤌', '👀', '🫶', '🥲', '😇', '🤭', '😈', '🦋', '✨',
];

function randomEmoji() {
  return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const EREN_DIR = path.join(__dirname, 'assets', 'eren');

function randomErenImage() {
  try {
    const files = fs.readdirSync(EREN_DIR).filter(f => f.endsWith('.jpg') || f.endsWith('.png'));
    if (!files.length) return null;
    const pick = files[Math.floor(Math.random() * files.length)];
    return fs.readFileSync(path.join(EREN_DIR, pick));
  } catch { return null; }
}

module.exports = { randomEmoji, randomInt, randomErenImage };
