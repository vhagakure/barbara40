import { mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const assets = {};
const event = JSON.parse(await readFile(join(root, 'worker/event-details.json'), 'utf8'));
event.url = process.env.SITE_URL || event.url;
const standaloneHosting = process.env.HOSTING_TARGET === 'cloudflare';
if (standaloneHosting && (!process.env.SITE_URL || new URL(event.url).protocol !== 'https:')) {
  throw new Error('Imposta SITE_URL con l’indirizzo HTTPS del sito Cloudflare.');
}
const start = new Date(event.startsAt);
const end = new Date(event.endsAt);
const destination = event.venue + ', ' + event.address;
const dayDirections = new URL('https://www.google.com/maps/dir/');
dayDirections.search = new URLSearchParams({ api: '1', destination });
const dayMap = new URL('https://maps.google.com/maps');
dayMap.search = new URLSearchParams({ q: destination, output: 'embed' });
const contactUrl = process.env.CONTACT_URL || event.contactUrl;
const contactLink = contactUrl ? new URL(contactUrl) : null;
if (contactLink && !['https:', 'mailto:'].includes(contactLink.protocol)) {
  throw new Error('Il contatto deve usare un indirizzo HTTPS o mailto.');
}
const contactAction = className => contactLink
  ? '<a class="' + className + '" href="' + contactLink.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '">Scrivimi su WhatsApp</a>'
  : '';
const dayFormat = new Intl.DateTimeFormat('it-IT', { timeZone: event.timeZone, day: 'numeric', month: 'long' });
const clockFormat = new Intl.DateTimeFormat('it-IT', { timeZone: event.timeZone, hour: '2-digit', minute: '2-digit' });
const calendarDate = date => date.toISOString().replace(/[-:]|[.]\d{3}/g, '');
const replyDate = new Date(event.replyBy + 'T12:00:00Z');
const calendarEscape = value => value.replace(/\\|,|;/g, character => '\\' + character).replace(/\r?\n/g, '\\n');
const reminderStart = new Date(event.replyReminderAt);
const reminderEnd = new Date(reminderStart.getTime() + 10 * 60000);
const reminderTitle = 'Rispondi all’invito di Barbara';
const reminderUrl = new URL('#rsvp', event.url).href;
const reminderDescription = 'Fammi sapere entro il ' + dayFormat.format(replyDate) + ' se ci sarai.';
const googleReminder = new URL('https://calendar.google.com/calendar/render');
googleReminder.search = new URLSearchParams({
  action: 'TEMPLATE',
  text: reminderTitle,
  dates: calendarDate(reminderStart) + '/' + calendarDate(reminderEnd),
  ctz: event.timeZone,
  details: reminderDescription + '\n' + reminderUrl
});
const albumVideoTypes = JSON.parse(await readFile(join(root, 'worker/album-video-types.json'), 'utf8'));
const photoTypes = JSON.parse(await readFile(join(root, 'worker/photo-types.json'), 'utf8'));
const dietaryOptions = JSON.parse(await readFile(join(root, 'worker/dietary-options.json'), 'utf8'));

function renderDietaryOptions(group) {
  return Object.entries(dietaryOptions[group]).map(([key, label]) => {
    const safeLabel = label.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
    const checkbox = `<label class="choice"><input type="checkbox" name="${group}" value="${key}"> ${safeLabel}</label>`;
    if (group !== 'allergens') return checkbox;
    return `<div class="meal-allergen">${checkbox}<select aria-label="Tipo di esigenza per ${safeLabel}" hidden><option value="unknown">Da precisare</option><option value="allergy">Allergia</option><option value="intolerance">Intolleranza</option></select></div>`;
  }).join('\n');
}
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png'
};

async function collect(directory, route = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = join(directory, entry.name);
    const pathname = route + '/' + entry.name;
    if (entry.isDirectory()) {
      await collect(source, pathname);
    } else {
      const type = types[extname(entry.name)];
      if (!type) throw new Error('Tipo di file non supportato: ' + pathname);
      let content = await readFile(source);
      if (pathname === '/index.html') {
        content = Buffer.from(content.toString()
          .replaceAll('{{EVENT_DAY}}', dayFormat.format(start))
          .replaceAll('{{EVENT_TIME}}', clockFormat.format(start))
          .replaceAll('{{EVENT_END_TIME}}', clockFormat.format(end))
          .replaceAll('{{EVENT_START}}', event.startsAt)
          .replaceAll('{{EVENT_END}}', event.endsAt)
          .replaceAll('{{EVENT_ADDRESS}}', event.address.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
          .replaceAll('{{DAY_DIRECTIONS}}', dayDirections.href.replaceAll('&', '&amp;'))
          .replace('{{DAY_MAP}}', dayMap.href.replaceAll('&', '&amp;'))
          .replace('{{CONTACT_ACTION}}', contactAction('action calendar-link'))
          .replace('{{CONTACT_DAY_ACTION}}', contactAction('text-link calendar-link') || 'Contatta Barbara.')
          .replace('{{CONTACT_COPY}}', contactLink ? 'Se è cambiato qualcosa, fammelo sapere su WhatsApp.' : 'Se è cambiato qualcosa, fammelo sapere.')
          .replaceAll('{{EVENT_ZONE}}', event.timeZone)
          .replaceAll('{{RSVP_DATE}}', event.replyBy)
          .replaceAll('{{RSVP_DAY}}', dayFormat.format(replyDate))
          .replaceAll('{{REMINDER_START}}', event.replyReminderAt)
          .replaceAll('{{REMINDER_DAY}}', dayFormat.format(reminderStart))
          .replaceAll('{{REMINDER_TIME}}', clockFormat.format(reminderStart))
          .replaceAll('{{REMINDER_GOOGLE}}', googleReminder.href.replaceAll('&', '&amp;'))
          .replace('<!-- dietary-allergens -->', renderDietaryOptions('allergens'))
          .replace('<!-- dietary-restrictions -->', renderDietaryOptions('restrictions')));
      }
      assets[pathname] = [type, content.toString('base64')];
    }
  }
}

await collect(join(root, 'web'));

function addCalendar(path, uid, fields) {
  const calendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Barbara//Dinner and Party//IT',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:' + uid + '@' + new URL(event.url).hostname,
    'DTSTAMP:' + calendarDate(new Date()),
    ...fields,
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n');
  assets[path] = ['text/calendar; charset=utf-8', Buffer.from(calendar).toString('base64')];
}

addCalendar('/festa-barbara.ics', 'barbara-40', [
  'SEQUENCE:2',
  'DTSTART:' + calendarDate(start),
  'DTEND:' + calendarDate(end),
  'TRANSP:OPAQUE',
  'SUMMARY:' + calendarEscape(event.title),
  'LOCATION:' + calendarEscape(event.venue + ', ' + event.address),
  'DESCRIPTION:Dinner & Party',
  'URL:' + event.url
]);
addCalendar('/promemoria-risposta.ics', 'barbara-40-risposta', [
  'DTSTART:' + calendarDate(reminderStart),
  'DTEND:' + calendarDate(reminderEnd),
  'SUMMARY:' + calendarEscape(reminderTitle),
  'DESCRIPTION:' + calendarEscape(reminderDescription),
  'URL:' + reminderUrl,
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:PT0S',
  'DESCRIPTION:' + calendarEscape(reminderTitle),
  'END:VALARM'
]);
const worker = await readFile(join(root, 'worker/index.js'), 'utf8');
const dist = join(root, 'dist');
await mkdir(join(dist, 'server'), { recursive: true });
await mkdir(join(dist, '.openai'), { recursive: true });
await mkdir(join(dist, 'server/drizzle'), { recursive: true });
try {
  await copyFile(join(root, '.openai/hosting.json'), join(dist, '.openai/hosting.json'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
for (const filename of await readdir(join(root, 'drizzle'))) {
  if (filename.endsWith('.sql')) {
    await copyFile(join(root, 'drizzle', filename), join(dist, 'server/drizzle', filename));
  }
}
await writeFile(join(dist, 'server/index.js'), 'const dietaryOptions = ' + JSON.stringify(dietaryOptions) + ';\n' +
  'const assets = ' + JSON.stringify(assets) + ';\n' +
  'const galleryOpensAt = ' + end.getTime() + ';\n' +
  'const standaloneHosting = ' + standaloneHosting + ';\n' +
  'const photoTypes = ' + JSON.stringify(photoTypes) + ';\n' +
  'const albumVideoTypes = ' + JSON.stringify(albumVideoTypes) + ';\n' + worker);
