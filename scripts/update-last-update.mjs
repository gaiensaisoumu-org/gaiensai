/* eslint-disable no-console */
// 更新日時を public/config.yaml に書き込むスクリプト
import fs from 'fs';
import path from 'path';

const cfgPath = path.resolve('public/config.yaml');
let text = fs.readFileSync(cfgPath, 'utf8');

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
// 既存のlast_updateを書き換え、無ければ末尾に追加
if (/^last_update:\s*\d{4}-\d{2}-\d{2}/m.test(text)) {
  text = text.replace(
    /^last_update:\s*\d{4}-\d{2}-\d{2}/m,
    `last_update: ${today}`
  );
} else {
  // YAMLの最後に改行がなくても問題ないように
  if (!text.endsWith("\n")) {
    text += "\n";
  }
  text += `last_update: ${today}\n`;
}

fs.writeFileSync(cfgPath, text, 'utf8');
console.log(`updated last_update → ${today}`);
