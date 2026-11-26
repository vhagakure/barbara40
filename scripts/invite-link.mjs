import { createHmac } from 'node:crypto';

const { INVITATION_SECRET, SITE_URL } = process.env;
if (!/^[a-f0-9]{64}$/.test(INVITATION_SECRET ?? '')) {
  throw new Error('Imposta INVITATION_SECRET con lo stesso segreto configurato nel Worker.');
}
const site = new URL(SITE_URL);
if (site.protocol !== 'https:') throw new Error('Usa il link HTTPS del sito.');
const code = createHmac('sha256', Buffer.from(INVITATION_SECRET, 'hex'))
  .update('barbara:invite:v1').digest('hex');
console.log(new URL('/invito/' + code, site).href);
