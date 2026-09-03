// Verschickt die Fotos an alle, die am Abend ihre Adresse eingetragen haben.
//
//   node scripts/send-mails.mjs            zeigt nur an, was rausgehen wuerde
//   node scripts/send-mails.mjs --send     verschickt tatsaechlich
//
// Ohne --send passiert nichts. Das ist Absicht: Eine Mail ist raus, sobald sie
// raus ist, und eine Gaesteliste verschickt man nicht aus Versehen zweimal.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import nodemailer from 'nodemailer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || './data');
const SENT_FILE = path.join(DATA_DIR, 'sent.json');
const REALLY_SEND = process.argv.includes('--send');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function loadBoothConfig() {
  return readJson(path.join(ROOT, 'config.json'), { eventTitle: 'Fotobox' });
}

/** Empfaengerliste einlesen, Doppelnennungen entfernen. */
async function loadRecipients() {
  let raw = '';
  try {
    raw = await fs.readFile(path.join(DATA_DIR, 'recipients.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const seen = new Set();
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const key = `${entry.photoId}|${entry.email}`;
      if (!seen.has(key)) {
        seen.add(key);
        entries.push(entry);
      }
    } catch {
      console.warn('Unlesbare Zeile in recipients.jsonl - uebersprungen.');
    }
  }
  return entries;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`\n${name} fehlt. Bitte in der .env setzen (siehe .env.example).\n`);
    process.exit(1);
  }
  return value;
}

const config = await loadBoothConfig();
const eventTitle = config.eventTitle || 'Fotobox';
const entries = await loadRecipients();
const sent = await readJson(SENT_FILE, {});

// Pro Adresse eine Mail, auch wenn jemand mehrfach fotografiert hat.
const byEmail = new Map();
for (const entry of entries) {
  const key = `${entry.photoId}|${entry.email}`;
  if (sent[key]) continue;
  if (!byEmail.has(entry.email)) byEmail.set(entry.email, []);
  byEmail.get(entry.email).push(entry);
}

const alreadySent = entries.length - [...byEmail.values()].flat().length;
console.log(`\n${entries.length} Eintraege, davon ${alreadySent} bereits verschickt.`);
console.log(`${byEmail.size} Mail(s) an ${byEmail.size} Adresse(n) offen.\n`);

for (const [email, items] of byEmail) {
  console.log(`  ${email}  (${items.length} Foto${items.length === 1 ? '' : 's'})`);
}

if (byEmail.size === 0) {
  console.log('\nNichts zu tun.\n');
  process.exit(0);
}

if (!REALLY_SEND) {
  console.log('\nProbelauf - es wurde nichts verschickt.');
  console.log('Zum echten Versand: node scripts/send-mails.mjs --send\n');
  process.exit(0);
}

const transport = nodemailer.createTransport({
  host: requireEnv('SMTP_HOST'),
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: requireEnv('SMTP_USER'), pass: requireEnv('SMTP_PASS') },
});

await transport.verify();
console.log('\nVerbindung zum Mailserver steht. Versand laeuft ...\n');

let delivered = 0;
for (const [email, items] of byEmail) {
  const attachments = [];
  for (const item of items) {
    const file = path.join(DATA_DIR, item.file);
    try {
      await fs.access(file);
      attachments.push({ filename: item.file, path: file });
    } catch {
      console.warn(`  ${email}: ${item.file} fehlt - wird ausgelassen.`);
    }
  }
  if (attachments.length === 0) continue;

  try {
    await transport.sendMail({
      from: requireEnv('MAIL_FROM'),
      to: email,
      subject: process.env.MAIL_SUBJECT || `Deine Fotos: ${eventTitle}`,
      text: `Hallo!\n\nHier sind deine Fotos aus der Fotobox von ${eventTitle}.\n\nViel Freude damit!`,
      html:
        `<p>Hallo!</p><p>Hier sind deine Fotos aus der Fotobox von ` +
        `<strong>${eventTitle}</strong>.</p><p>Viel Freude damit!</p>`,
      attachments,
    });
    for (const item of items) sent[`${item.photoId}|${item.email}`] = new Date().toISOString();
    // Nach jeder Mail sichern: Bricht der Versand ab, wird nichts doppelt geschickt.
    await fs.writeFile(SENT_FILE, JSON.stringify(sent, null, 2));
    delivered += 1;
    console.log(`  ✓ ${email}`);
  } catch (err) {
    console.error(`  ✗ ${email}: ${err.message}`);
  }
}

console.log(`\n${delivered} von ${byEmail.size} Mail(s) verschickt.`);
console.log(`Vermerkt in ${path.relative(ROOT, SENT_FILE)} - ein zweiter Lauf ueberspringt sie.\n`);
