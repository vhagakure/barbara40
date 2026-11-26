const maxVideoSize = 64 * 1024 * 1024;
const videoTypes = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ogv: 'video/ogg'
};
const videoKeyPattern = /^video\/[a-f0-9]{64}\/[a-f0-9-]{36}\.([a-z0-9]+)$/;

const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow'
};

const inviteCookie = '__Host-barbara-invito';
const inviteLifetime = 90 * 24 * 60 * 60;
const inviteEncoder = new TextEncoder();
const hex = /^[a-f0-9]{64}$/;
const organizerAssetPrefix = '/organizzazione/risorse';
const adminAssets = standaloneHosting ? organizerAssetPrefix : '';

function standaloneOrganizer(request, password) {
  if (!request.url.startsWith('https://') || typeof password !== 'string' || !hex.test(password)) return false;
  const credentials = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!credentials || credentials.length > 120) return false;
  let decoded;
  try {
    decoded = atob(credentials);
  } catch {
    return false;
  }
  const expected = 'barbara:' + password;
  if (decoded.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= decoded.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

function organizerSignIn() {
  if (!standaloneHosting) {
    return new Response(null, { status: 302, headers: { ...privateHeaders, Location: '/signin-with-chatgpt?return_to=%2Forganizzazione' } });
  }
  return new Response('Area riservata all’organizzazione.', {
    status: 401, headers: { ...privateHeaders, 'Content-Type': 'text/plain; charset=utf-8',
      'WWW-Authenticate': 'Basic realm="Organizzazione Barbara", charset="UTF-8"' }
  });
}

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value) {
  return Uint8Array.from(value.match(/../g), pair => Number.parseInt(pair, 16));
}

function invitationKey(secret) {
  return crypto.subtle.importKey('raw', fromHex(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function verifyInvitation(key, code, contents) {
  return hex.test(code) && crypto.subtle.verify('HMAC', key, fromHex(code), inviteEncoder.encode(contents));
}

async function guestIdentity(request, key) {
  const item = (request.headers.get('Cookie') ?? '').split(';').map(value => value.trim())
    .find(value => value.startsWith(inviteCookie + '='));
  const match = /^([a-f0-9-]{36})\.(\d{1,12})\.([a-f0-9]{64})$/.exec(item?.slice(inviteCookie.length + 1));
  if (!match || Number(match[2]) <= Math.floor(Date.now() / 1000)) return null;
  const [, id, expiry, signature] = match;
  return await verifyInvitation(key, signature, 'barbara:guest:v1:' + id + ':' + expiry) ? 'invito:' + id : null;
}

function invitationRequired() {
  return new Response(`<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="robots" content="noindex,nofollow"><title>Invito riservato</title>
<body style="margin:0;padding:2rem;background:#fbf6ee;color:#50101e;font:1.06rem/1.5 system-ui">
<main style="max-width:30rem;margin:12vh auto"><h1>Un invito riservato</h1>
<p>Per aprirlo usa il link che hai ricevuto con l’invito.</p></main></body></html>`, {
    status: 403,
    headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8' }
  });
}

async function acceptInvitation(request, key, code) {
  if (!await verifyInvitation(key, code, 'barbara:invite:v1')) return invitationRequired();
  const headers = { ...privateHeaders, Location: '/', 'Referrer-Policy': 'no-referrer' };
  if (!await guestIdentity(request, key)) {
    const id = crypto.randomUUID();
    const expiry = Math.floor(Date.now() / 1000) + inviteLifetime;
    const signature = toHex(await crypto.subtle.sign('HMAC', key, inviteEncoder.encode('barbara:guest:v1:' + id + ':' + expiry)));
    headers['Set-Cookie'] = inviteCookie + '=' + id + '.' + expiry + '.' + signature +
      '; Path=/; Max-Age=' + inviteLifetime + '; HttpOnly; Secure; SameSite=Lax';
  }
  return new Response(null, { status: 303, headers });
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: privateHeaders });
}

function reject(message, status) {
  return json({ error: message }, status);
}

function staticFile(path) {
  const asset = assets[path === '/' ? '/index.html' : path];
  if (!Array.isArray(asset)) return new Response('Pagina non trovata', { status: 404 });
  const [contentType, encoded] = asset;
  return new Response(Uint8Array.from(atob(encoded), character => character.charCodeAt(0)), {
    headers: {
      'Content-Type': contentType,
      ...(contentType.startsWith('text/calendar') ? { 'Content-Disposition': `attachment; filename="${path.slice(1)}"` } : {}),
      ...privateHeaders
    }
  });
}

function textInput(value, length) {
  return typeof value === 'string' && value.trim().length <= length ? value.trim() : null;
}

function dietarySelection(value, group) {
  const options = dietaryOptions[group];
  if (!Array.isArray(value) || value.length > Object.keys(options).length ||
      value.some(key => typeof key !== 'string' || !Object.hasOwn(options, key))) return null;
  return Object.keys(options).filter(key => value.includes(key));
}

const mealPeople = { guest: 'Ospite', companion: 'Accompagnatore adulto', 'child-1': 'Bambino 1', 'child-2': 'Bambino 2' };
const allergyKinds = { allergy: 'Allergia', intolerance: 'Intolleranza', unknown: 'Da precisare' };

function parsePeople(value, companions, children) {
  if (!Array.isArray(value) || value.length > 4) return null;
  const seen = new Set();
  const people = [];
  for (const entry of value) {
    const { person, allergens } = entry ?? {};
    if (!Object.hasOwn(mealPeople, person) || seen.has(person) ||
        (person === 'companion' && !companions) ||
        (person.startsWith('child-') && Number(person.at(-1)) > children)) return null;
    seen.add(person);
    if (!Array.isArray(allergens) || allergens.some(item => !item || !Object.hasOwn(allergyKinds, item.kind))) return null;
    const keys = dietarySelection(allergens.map(item => item.key), 'allergens');
    const restrictions = dietarySelection(entry.restrictions ?? [], 'restrictions');
    const notes = textInput(entry.notes ?? '', 500);
    if (!keys || !restrictions || notes === null) return null;
    if (keys.length || restrictions.length || notes) {
      people.push({ person, allergens: keys.map(key => ({ key, kind: allergens.find(item => item.key === key).kind })), restrictions, notes });
    }
  }
  return people;
}

function parseDietary(value, companions, children) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allergens = dietarySelection(value.allergens ?? [], 'allergens');
  const restrictions = dietarySelection(value.restrictions ?? [], 'restrictions');
  const notes = textInput(value.notes ?? '', 500);
  if (!allergens || !restrictions || notes === null) return null;
  if (!Object.hasOwn(value, 'people')) return { allergens, restrictions, notes };
  const people = parsePeople(value.people, companions, children);
  return people ? { allergens, restrictions, notes, people } : null;
}

const rsvpColumns = `guest_name AS name, guest_given_name AS givenName, guest_family_name AS familyName,
  attendance, companions, companion_names AS companionNames, companion_given_name AS companionGivenName,
  companion_family_name AS companionFamilyName, children, song, dietary`;

function decodeRsvp(row) {
  if (!row) return null;
  let dietary = null;
  try {
    dietary = parseDietary(JSON.parse(row.dietary), row.companions, row.children);
  } catch {
    // Keep the response editable if older dietary data cannot be read.
  }
  return { ...row, dietary };
}

async function getRsvp(db, userId) {
  const row = await db.prepare(`SELECT ${rsvpColumns} FROM rsvps WHERE guest_id = ?`).bind(userId).first();
  return decodeRsvp(row);
}

async function saveRsvp(request, db, userId) {
  let fields;
  try {
    fields = await request.json();
  } catch {
    return reject('Controlla i dati della risposta e riprova.', 400);
  }
  return storeRsvp(fields, db, userId);
}

async function storeRsvp(fields, db, userId, current = null) {
  const splitGuest = Boolean(fields && (Object.hasOwn(fields, 'givenName') || Object.hasOwn(fields, 'familyName')));
  const givenName = splitGuest ? textInput(fields.givenName, 120) : '';
  const familyName = splitGuest ? textInput(fields.familyName, 120) : '';
  const name = textInput(splitGuest ? [givenName, familyName].join(' ') : fields?.name, 120);
  const attendance = fields?.attendance;
  const companions = attendance === 'yes' ? fields?.companions : 0;
  const children = attendance === 'yes' ? fields?.children ?? 0 : 0;
  const companionGivenName = companions > 0 ? textInput(fields?.companionGivenName ?? '', 120) : '';
  const companionFamilyName = companions > 0 ? textInput(fields?.companionFamilyName ?? '', 120) : '';
  const companionNames = companionGivenName || companionFamilyName
    ? [companionGivenName, companionFamilyName].filter(Boolean).join(' ')
    : companions > 0 ? textInput(fields?.companionNames ?? '', 400) : '';
  const song = attendance === 'yes' ? textInput(fields?.song ?? '', 180) : '';

  if (!name || (splitGuest && (!givenName || !familyName)) || !['yes', 'no'].includes(attendance) ||
      companionGivenName === null || companionFamilyName === null || companionNames === null || song === null) {
    return reject('Controlla i dati della risposta e riprova.', 400);
  }
  if (companions !== 0 && companions !== 1 && companions !== current?.companions) {
    return reject('Puoi indicare al massimo un accompagnatore adulto.', 400);
  }
  if (!current && companions === 1 && !companionGivenName) {
    return reject('Inserisci il nome del tuo accompagnatore.', 400);
  }
  if (!Number.isSafeInteger(children) || children < 0) {
    return reject('Indica il numero di bambini con un numero intero da zero in su.', 400);
  }

  if (children > 2 && children !== (await getRsvp(db, userId))?.children) {
    return reject('Puoi indicare fino a due bambini per risposta.', 400);
  }

  let dietary = attendance === 'no' ? '{}' : null;
  if (attendance === 'yes' && Object.hasOwn(fields, 'dietary')) {
    const preferences = parseDietary(fields.dietary, companions, children);
    if (!preferences) return reject('Controlla le indicazioni alimentari e riprova.', 400);
    dietary = JSON.stringify(preferences);
  }

  const row = await db.prepare(`
    INSERT INTO rsvps (guest_id, guest_name, attendance, companions, companion_names, children, song, dietary,
      guest_given_name, guest_family_name, companion_given_name, companion_family_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, '{}'), ?, ?, ?, ?)
    ON CONFLICT (guest_id) DO UPDATE SET
      guest_name = excluded.guest_name,
      attendance = excluded.attendance,
      companions = excluded.companions,
      companion_names = excluded.companion_names,
      children = excluded.children,
      song = excluded.song,
      guest_given_name = CASE WHEN excluded.guest_given_name = '' AND excluded.guest_name = rsvps.guest_name
        THEN rsvps.guest_given_name ELSE excluded.guest_given_name END,
      guest_family_name = CASE WHEN excluded.guest_given_name = '' AND excluded.guest_name = rsvps.guest_name
        THEN rsvps.guest_family_name ELSE excluded.guest_family_name END,
      companion_given_name = CASE WHEN excluded.companion_given_name = '' AND excluded.companion_family_name = ''
        AND excluded.companion_names = rsvps.companion_names THEN rsvps.companion_given_name ELSE excluded.companion_given_name END,
      companion_family_name = CASE WHEN excluded.companion_given_name = '' AND excluded.companion_family_name = ''
        AND excluded.companion_names = rsvps.companion_names THEN rsvps.companion_family_name ELSE excluded.companion_family_name END,
      dietary = CASE WHEN ? IS NULL THEN rsvps.dietary ELSE excluded.dietary END,
      updated_at = CURRENT_TIMESTAMP,
      revision = rsvps.revision + 1
    WHERE ? IS NULL OR rsvps.revision = ?
    RETURNING ${rsvpColumns}
  `).bind(userId, name, attendance, companions, companionNames, children, song, dietary,
    givenName, familyName, companionGivenName, companionFamilyName, dietary,
    current?.revision ?? null, current?.revision ?? null).first();
  if (!row) return reject('Questa risposta è cambiata. Riaprila prima di salvare.', 409);
  return json({ saved: true, rsvp: decodeRsvp(row) });
}

async function saveWish(request, db, userId) {
  const fields = await request.json().catch(() => null);
  const name = textInput(fields?.name, 120);
  const message = textInput(fields?.message, 600);
  if (!name || !message) return reject('Inserisci il tuo nome e un breve augurio.', 400);
  await db.prepare(`
    INSERT INTO guest_messages (guest_id, guest_name, message) VALUES (?, ?, ?)
    ON CONFLICT (guest_id) DO UPDATE SET guest_name = excluded.guest_name,
      message = excluded.message, updated_at = CURRENT_TIMESTAMP
  `).bind(userId, name, message).run();
  return json({ saved: true });
}

function decodeHeader(value) {
  try {
    return decodeURIComponent(value ?? '');
  } catch {
    return '';
  }
}

async function saveVideo(request, bucket, userId, uploadId) {
  const name = textInput(decodeHeader(request.headers.get('X-Video-Guest')), 120);
  const visibility = request.headers.get('X-Video-Visibility');
  const suppliedExtension = request.headers.get('X-Video-Extension')?.toLowerCase();
  const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  const extension = Object.hasOwn(videoTypes, suppliedExtension)
    ? suppliedExtension
    : Object.keys(videoTypes).find(key => videoTypes[key] === contentType);
  const size = Number(request.headers.get('Content-Length'));
  if (!name || !['memory', 'party', 'private'].includes(visibility) || !/^[a-f0-9-]{36}$/.test(uploadId)) {
    return reject('Controlla il nome e la preferenza per l’uso del video.', 400);
  }
  if (!extension) return reject('Scegli un altro video oppure registrane uno qui.', 415);
  if (!request.body || !Number.isSafeInteger(size) || size < 1) return reject('Scegli un video e riprova.', 411);
  if (size > maxVideoSize) return reject('Il video è troppo grande. Prova con una clip più breve.', 413);

  const method = new TextEncoder().encode(userId);
  const owner = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', method)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  const key = `video/${owner}/${uploadId}.${extension}`;
  const options = {
    httpMetadata: { contentType: videoTypes[extension] },
    customMetadata: { name: encodeURIComponent(name), visibility }
  };

  // FixedLengthStream preserves streaming uploads and enforces the declared length at storage.
  if (typeof FixedLengthStream === 'function') {
    const stream = new FixedLengthStream(size);
    await Promise.all([request.body.pipeTo(stream.writable), bucket.put(key, stream.readable, options)]);
  } else {
    await bucket.put(key, request.body, options);
  }
  return json({ saved: true }, 201);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function mealEntries(row) {
  const notesToReview = notes => ({
    subject: 'Persona da identificare', reference: row.guest_name, assigned: false,
    allergies: '', intolerances: '', restrictions: '', unknown: 'Persona da identificare', notes
  });
  let dietary;
  try {
    dietary = parseDietary(JSON.parse(row.dietary), row.companions, row.children);
  } catch {
    return [notesToReview('Verificare le indicazioni con l’ospite.')];
  }
  if (!dietary) return [notesToReview('Verificare le indicazioni con l’ospite.')];
  const entries = [...(dietary.people ?? [])];
  if (dietary.allergens.length || dietary.restrictions.length || dietary.notes) {
    entries.push({ person: '', allergens: dietary.allergens, restrictions: dietary.restrictions, notes: dietary.notes });
  }
  return entries.map(entry => {
    const labels = { allergy: [], intolerance: [], unknown: [] };
    for (const item of entry.allergens) {
      const { key, kind } = typeof item === 'string' ? { key: item, kind: 'unknown' } : item;
      labels[kind].push(dietaryOptions.allergens[key]);
    }
    const ambiguousCompanion = entry.person === 'companion' && row.companions > 1;
    if (!entry.person || ambiguousCompanion) labels.unknown.push('Persona da identificare');
    const role = mealPeople[entry.person];
    const subject = entry.person === 'guest' ? row.guest_name
      : entry.person === 'companion' && row.companions === 1 && row.companion_names ? row.companion_names
      : role ? role + ' di ' + row.guest_name : 'Persona da identificare';
    return {
      subject, reference: row.guest_name, assigned: Boolean(entry.person) && !ambiguousCompanion,
      allergies: labels.allergy.join(', '),
      intolerances: labels.intolerance.join(', '),
      restrictions: entry.restrictions.map(key => dietaryOptions.restrictions[key]).join(', '),
      unknown: labels.unknown.join(', '), notes: entry.notes
    };
  });
}

function csvRow(values, separator = ',') {
  return values.map(value => {
    const text = String(value ?? '');
    const safe = /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  }).join(separator);
}

const mealColumns = [
  ['subject', 'Persona'], ['reference', 'Ospite di riferimento'], ['allergies', 'Allergie'],
  ['intolerances', 'Intolleranze'], ['restrictions', 'Altre esigenze'], ['unknown', 'Da chiarire'], ['notes', 'Note']
];

async function organizerPage(env, view, saved = false) {
  const { results: rsvps } = await env.DB.prepare(
    `SELECT rowid AS id, guest_name, guest_given_name, guest_family_name, attendance, companions, companion_names,
      children, song, dietary, updated_at
      FROM rsvps ORDER BY guest_name COLLATE NOCASE`
  ).all();
  const attending = rsvps.filter(row => row.attendance === 'yes');
  const childrenTotal = attending.reduce((count, row) => count + row.children, 0);
  const adultsTotal = attending.reduce((count, row) => count + 1 + row.companions, 0);
  const mealsByReply = new Map(attending.map(row => [row, mealEntries(row)]));
  const meals = [...mealsByReply.values()].flat();
  const songs = attending.filter(row => row.song);

  if (view === 'menu' || view === 'playlist') {
    const lines = view === 'menu' ? [
      mealColumns.map(([, label]) => label),
      ...meals.map(meal => mealColumns.map(([key]) => meal[key]))
    ] : [
      ['Canzone', 'Ospite'],
      ...songs.map(row => [row.song, row.guest_name])
    ];
    const timestamp = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short'
    }).format(new Date()).replaceAll(':', '-').replace(' ', '_');
    const filename = view === 'menu' ? 'elenco-per-la-sala_' + timestamp : 'playlist';
    return new Response('\uFEFF' + lines.map(line => csvRow(line, view === 'menu' ? ';' : ',')).join('\r\n'), { headers: {
      ...privateHeaders, 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + filename + '.csv"'
    } });
  }
  const { results: wishes } = await env.DB.prepare(
    'SELECT guest_name, message FROM guest_messages ORDER BY updated_at DESC'
  ).all();
  const videos = [];
  let cursor;
  let videoUnavailable = false;
  try {
    do {
      const batch = await env.BUCKET.list({ prefix: 'video/', include: ['customMetadata'], cursor });
      videos.push(...batch.objects);
      cursor = batch.truncated ? batch.cursor : undefined;
    } while (cursor);
  } catch {
    videoUnavailable = true;
  }
  videos.sort((first, second) => second.uploaded - first.uploaded);

  const statusFilter = view === 'yes' || view === 'no' ? view : '';
  const renderVideo = audience => {
    const items = videos.filter(video => video.customMetadata?.visibility === audience)
      .map(video => `<li><a href="/organizzazione/${escapeHtml(video.key)}">Scarica il video di ${escapeHtml(decodeHeader(video.customMetadata.name))}</a></li>`);
    return items.length > 0 ? '<ul>' + items.join('') + '</ul>' : '<p>Nessun video ricevuto.</p>';
  };
  const rows = rsvps.map(row => {
    const yes = row.attendance === 'yes';
    const kinds = [row.attendance, yes && row.companions && 'companion', yes && row.children && 'children',
      mealsByReply.get(row)?.length && 'dietary'].filter(Boolean).join(' ');
    return `<li data-admin-item data-kinds="${kinds}" data-search="${escapeHtml(row.guest_name + ' ' + row.companion_names)}"
      data-given="${escapeHtml(row.guest_given_name || row.guest_name)}" data-family="${escapeHtml(row.guest_family_name)}"
      data-updated="${escapeHtml(row.updated_at)}"${statusFilter && statusFilter !== row.attendance ? ' hidden' : ''}>
      <div><strong>${escapeHtml(row.guest_name)}</strong>
      ${yes && row.companions ? `<p>${escapeHtml(row.companion_names || (row.companions === 1 ? '1 accompagnatore' : row.companions + ' accompagnatori'))}</p>` : ''}
      ${yes && row.children ? `<p>${row.children} ${row.children === 1 ? 'bambino' : 'bambini'}</p>` : ''}</div>
      <div class="org-guest-actions"><span class="org-status ${yes ? 'org-yes' : ''}">${yes ? 'Confermato' : 'Non partecipa'}</span>
      <a class="text-link calendar-link" href="/organizzazione/risposte/${row.id}" aria-label="Modifica risposta di ${escapeHtml(row.guest_name)}">Modifica risposta</a></div>
    </li>`;
  }).join('');
  const dietaryRows = meals.map(meal => {
    const kinds = mealColumns.slice(2).filter(([key]) => meal[key]);
    return `<li data-admin-item data-kinds="${kinds.map(([key]) => key).join(' ')}" data-search="${escapeHtml(mealColumns.map(([key]) => meal[key]).join(' '))}">
      <div class="org-meal-person"><strong>${escapeHtml(meal.subject)}</strong>
      ${meal.subject !== meal.reference ? `<p>Riferimento · ${escapeHtml(meal.reference)}</p>` : ''}</div>
      <dl>${kinds.map(([key, label]) => `<div class="org-meal-${key}"><dt>${label}</dt><dd>${escapeHtml(meal[key])}</dd></div>`).join('')}</dl>
    </li>`;
  });
  const lastUpdate = rsvps.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, '');
  const updatedDate = lastUpdate ? new Date(lastUpdate.replace(' ', 'T') + 'Z') : null;
  const dateLabel = updatedDate && new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short'
  }).format(updatedDate);
  const flaggedPeople = meals.filter(meal => meal.assigned).length;
  const toReview = meals.filter(meal => meal.unknown).length;
  const chips = [
    ['Persone attese', adultsTotal + childrenTotal], ['Adulti', adultsTotal], ['Bambini', childrenTotal],
    ['Risposte positive', attending.length], ['Persone con indicazioni', flaggedPeople], ['Indicazioni da chiarire', toReview]
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
  const page = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Organizzazione · Barbara fa 40</title><link rel="stylesheet" href="${adminAssets}/invito-v5.css">
<link rel="stylesheet" href="${adminAssets}/organizzazione.css"><script defer src="${adminAssets}/organizzazione.js"></script></head>
<body><header class="site-header org-header"><a class="brand" href="/"><span class="monogram" aria-hidden="true">BR</span>Torna all’invito</a></header>
<main class="page-width organizer-page">
<header class="org-overview">
  <h1>Organizzazione</h1>
  <p>${dateLabel ? `Ultima risposta aggiornata il <time datetime="${updatedDate.toISOString()}">${dateLabel}</time>` : 'In attesa delle prime risposte.'}</p>
  <dl class="organizer-stats">${chips}</dl>
</header>
<nav aria-label="Sezioni organizzazione" class="org-navigation">
  <a href="#per-la-sala">Per la sala</a><a href="#partecipazione">Partecipazione</a>
  <a href="#auguri">Auguri</a><a href="#musica">Musica</a>
</nav>
<section id="per-la-sala" class="org-panel" data-admin-list>
  <header class="org-panel-header">
    <div><h2>Per la sala</h2><p>Allergie, intolleranze e altre esigenze delle persone confermate.</p></div>
    <a class="action calendar-link" href="/organizzazione?export=menu">Scarica elenco completo (CSV)</a>
  </header>
  ${dietaryRows.length ? `
  <div class="org-tools" hidden>
    <label>Cerca persona o indicazione <input type="search" data-admin-query></label>
    <label>Tipo di indicazione <select data-admin-kind>
      <option value="">Tutte</option><option value="allergies">Allergie</option><option value="intolerances">Intolleranze</option>
      <option value="restrictions">Altre esigenze</option><option value="unknown">Da chiarire</option><option value="notes">Con note</option>
    </select></label>
  </div>
  <p class="org-results" data-admin-count aria-live="polite" hidden></p>
  <ul class="org-meals">${dietaryRows.join('')}</ul>` : '<p class="org-empty">Nessuna indicazione ricevuta.</p>'}
</section>
<section id="partecipazione" class="org-panel" data-admin-list>
  <header class="org-panel-header"><div><h2>Partecipazione</h2><p>${rsvps.length} risposte ricevute</p></div></header>
  ${saved ? '<p class="org-saved" role="status">Risposta aggiornata.</p>' : ''}
  ${rows ? `
  <div class="org-tools" hidden>
    <label>Cerca ospite o accompagnatore <input type="search" data-admin-query></label>
    <label>Stato <select data-admin-kind>
      <option value="">Tutte le risposte</option><option value="yes"${statusFilter === 'yes' ? ' selected' : ''}>Confermati</option>
      <option value="no"${statusFilter === 'no' ? ' selected' : ''}>Non partecipano</option>
    </select></label>
    <label>Gruppo o esigenze <select data-admin-kind>
      <option value="">Tutti</option><option value="companion">Con accompagnatore</option>
      <option value="children">Con bambini</option><option value="dietary">Con indicazioni alimentari</option>
    </select></label>
    <label>Ordina per <select data-admin-sort>
      <option value="given">Nome A–Z</option><option value="family">Cognome A–Z</option><option value="updated">Risposta più recente</option>
    </select></label>
  </div>
  <p class="org-results" data-admin-count aria-live="polite" hidden></p>
  <ul class="org-guests">${rows}</ul>` : '<p class="org-empty">Nessuna risposta ricevuta.</p>'}
</section>
<section id="auguri" class="org-panel">
  <header class="org-panel-header"><div><h2>Auguri</h2><p>${wishes.length} messaggi scritti${videoUnavailable ? '' : ' · ' + videos.length + ' video'}</p></div></header>
  <div class="org-media">
    <div><h3>Auguri scritti</h3>
    ${wishes.length ? '<ul class="organizer-dietary">' + wishes.map(wish => `<li><strong>${escapeHtml(wish.guest_name)}</strong><p class="organizer-note">${escapeHtml(wish.message)}</p></li>`).join('') + '</ul>' : '<p>Nessun messaggio ricevuto.</p>'}</div>
    <div><h3>Video</h3>${videoUnavailable ? '<p>L’elenco dei video è momentaneamente indisponibile.</p>' : `
      <details open><summary>Video autorizzati per il ricordo degli invitati</summary>${renderVideo('memory')}</details>
      <details><summary>Video solo per Barbara</summary>${renderVideo('private')}</details>
      ${videos.some(video => video.customMetadata?.visibility === 'party') ? '<details><summary>Video autorizzati solo per la proiezione</summary>' + renderVideo('party') + '</details>' : ''}`}</div>
  </div>
</section>
<section id="musica" class="org-panel">
  <header class="org-panel-header"><div><h2>Musica</h2><p>${songs.length} brani suggeriti</p></div>
  <a class="text-link calendar-link" href="/organizzazione?export=playlist">Scarica la playlist (CSV)</a></header>
  ${songs.length ? '<ul class="org-songs">' + songs.map(song => `<li><strong>${escapeHtml(song.song)}</strong><span>${escapeHtml(song.guest_name)}</span></li>`).join('') + '</ul>' : '<p class="org-empty">Nessun brano suggerito.</p>'}
</section>
</main></body></html>`;
  return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...privateHeaders } });
}

function replyEditor(row, message = '', status = 200) {
  const rsvp = decodeRsvp(row);
  const options = (values, selected) => values.map(([value, label]) =>
    `<option value="${value}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const countOptions = (maximum, selected) => options(
    Array.from({ length: maximum + 1 }, (_, i) => [String(i), String(i)]), String(selected));
  const dietary = new Map((rsvp.dietary?.people ?? []).map(entry => [entry.person, entry]));
  const fields = Object.entries(mealPeople).map(([person, label]) => {
    const values = dietary.get(person);
    const selected = new Map((values?.allergens ?? []).map(item => [item.key, item.kind]));
    const allergens = Object.entries(dietaryOptions.allergens).map(([key, allergen]) => `
      <label>${escapeHtml(allergen)}<select name="${person}-allergy-${key}">${options([
        ['', 'Nessuna indicazione'], ['allergy', 'Allergia'], ['intolerance', 'Intolleranza'], ['unknown', 'Da chiarire']
      ], selected.get(key) || '')}</select></label>`).join('');
    return `<details data-edit-person="${person}">
      <summary>${label}${values ? ' · Con indicazioni' : ''}</summary><div class="org-edit-diet">
        <fieldset><legend>Allergie e intolleranze</legend><div class="org-allergens">${allergens}</div></fieldset>
        <fieldset><legend>Altre esigenze</legend><div class="org-allergens">${Object.entries(dietaryOptions.restrictions).map(([key, restriction]) =>
          `<label class="choice"><input type="checkbox" name="${person}-restriction" value="${key}"${values?.restrictions.includes(key) ? ' checked' : ''}> ${escapeHtml(restriction)}</label>`
        ).join('')}</div></fieldset>
        <label>Note<textarea name="${person}-notes" rows="2" maxlength="500">${escapeHtml(values?.notes)}</textarea></label>
      </div></details>`;
  }).join('');
  const page = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Modifica risposta · Organizzazione</title><link rel="stylesheet" href="${adminAssets}/invito-v5.css">
<link rel="stylesheet" href="${adminAssets}/organizzazione.css"><script defer src="${adminAssets}/organizzazione.js"></script></head>
<body><header class="site-header org-header"><a class="brand" href="/organizzazione#partecipazione">Torna alle risposte</a></header>
<main class="page-width organizer-page">
  <header class="org-overview"><h1>Modifica risposta</h1><p>${escapeHtml(rsvp.name)}</p></header>
  <section class="org-panel org-edit">
    ${message ? `<p role="alert" class="org-edit-message">${escapeHtml(message)}</p>` : ''}
    <form class="paper-form" method="post" action="/organizzazione/risposte/${row.id}" data-admin-editor>
      <input type="hidden" name="revision" value="${row.revision}">
      <div class="org-edit-grid">
        <label>Partecipazione <select name="attendance" data-edit-attendance>${options([['yes', 'Confermato'], ['no', 'Non partecipa']], rsvp.attendance)}</select></label>
      </div>
      <div class="org-edit-grid" data-edit-group>
        <label>Accompagnatori adulti <select name="companions" data-edit-companions>${countOptions(Math.max(1, rsvp.companions), rsvp.companions)}</select></label>
        <label>Bambini <select name="children" data-edit-children>${countOptions(Math.max(2, rsvp.children), rsvp.children)}</select></label>
        <label data-edit-companion>Nome accompagnatore <input name="companionGivenName" maxlength="120" value="${escapeHtml(rsvp.companionGivenName)}"></label>
        <label data-edit-companion>Cognome accompagnatore <input name="companionFamilyName" maxlength="120" value="${escapeHtml(rsvp.companionFamilyName)}"></label>
        ${!rsvp.companionGivenName && !rsvp.companionFamilyName && rsvp.companionNames ? `<p class="input-note" data-edit-companion>Nome registrato in precedenza · ${escapeHtml(rsvp.companionNames)}</p>` : ''}
      </div>
      <div class="org-editor-meals" data-edit-group>
        <h2>Indicazioni per la cena</h2>
        ${rsvp.dietary?.allergens.length || rsvp.dietary?.restrictions.length || rsvp.dietary?.notes ? '<p class="input-note">Le indicazioni precedenti senza persona assegnata restano nell’elenco da chiarire.</p>' : ''}
        ${fields}
      </div>
      <div class="org-edit-actions"><button class="action" type="submit">Salva modifiche</button><a href="/organizzazione#partecipazione">Annulla</a></div>
    </form>
  </section>
</main></body></html>`;
  return new Response(page, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...privateHeaders } });
}

async function editReply(request, db, id) {
  const row = await db.prepare(`SELECT rowid AS id, guest_id, revision, ${rsvpColumns} FROM rsvps WHERE rowid = ?`)
    .bind(id).first();
  if (!row) return reject('Risposta non trovata.', 404);
  if (request.method === 'GET') return replyEditor(row);
  const form = await request.formData().catch(() => null);
  if (!form) return replyEditor(row, 'Controlla i campi della risposta.', 400);
  if (form.get('revision') !== String(row.revision)) {
    return replyEditor(row, 'La risposta è stata aggiornata. Controlla i dati più recenti prima di salvare.', 409);
  }
  const attendance = form.get('attendance');
  const afterSave = () => new Response(null, {
    status: 303, headers: { ...privateHeaders, Location: '/organizzazione?salvata=1#partecipazione' }
  });
  const showConflict = async message => {
    const fresh = await db.prepare(`SELECT rowid AS id, guest_id, revision, ${rsvpColumns} FROM rsvps WHERE rowid = ?`)
      .bind(id).first();
    return fresh ? replyEditor(fresh, message, 409) : reject('Risposta non trovata.', 404);
  };
  if (attendance === 'no') {
    // A manual absence excludes the group from the event without losing its previous details.
    const updated = await db.prepare(`UPDATE rsvps SET attendance = 'no', revision = revision + 1,
      updated_at = CURRENT_TIMESTAMP WHERE rowid = ? AND revision = ? RETURNING rowid AS id`)
      .bind(id, row.revision).first();
    return updated ? afterSave() : showConflict('La risposta è stata aggiornata. Controlla i dati più recenti prima di salvare.');
  }
  const companions = Number(form.get('companions') ?? 0);
  const children = Number(form.get('children') ?? 0);
  const people = Object.keys(mealPeople).filter(person => person === 'guest' ||
    (person === 'companion' && companions > 0) || (person.startsWith('child-') && Number(person.at(-1)) <= children))
    .map(person => ({
      person,
      allergens: Object.keys(dietaryOptions.allergens).flatMap(key => {
        const kind = form.get(person + '-allergy-' + key);
        return kind ? [{ key, kind }] : [];
      }),
      restrictions: form.getAll(person + '-restriction'),
      notes: form.get(person + '-notes') || ''
    }));
  const previous = decodeRsvp(row).dietary;
  const fields = {
    name: row.name, attendance, companions, children, song: row.song,
    companionGivenName: form.get('companionGivenName') || '',
    companionFamilyName: form.get('companionFamilyName') || '',
    companionNames: row.companionGivenName || row.companionFamilyName ? '' : row.companionNames,
    dietary: { allergens: previous?.allergens ?? [], restrictions: previous?.restrictions ?? [], notes: previous?.notes ?? '', people }
  };
  if (row.givenName && row.familyName) Object.assign(fields, { givenName: row.givenName, familyName: row.familyName });
  const result = await storeRsvp(fields, db, row.guest_id, row);
  if (result.ok) return afterSave();
  const { error } = await result.json();
  if (result.status === 409) return showConflict(error);
  return replyEditor(row, error, result.status);
}

async function serveDownload(bucket, key) {
  const extension = videoKeyPattern.exec(key)?.[1];
  if (!Object.hasOwn(videoTypes, extension)) return new Response('Video non trovato', { status: 404 });
  const video = await bucket.get(key);
  if (!video) return new Response('Video non trovato', { status: 404 });
  const name = decodeHeader(video.customMetadata?.name);
  const slug = name.normalize('NFD').replace(/[^a-zA-Z0-9 -]/g, '').trim().replace(/ +/g, '-');
  return new Response(video.body, {
    headers: {
      ...privateHeaders,
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="auguri-${slug || 'Barbara'}.${extension}"`
    }
  });
}

const photoPrefix = 'foto-evento/';

function photoType(filename) {
  if (!filename || filename.startsWith('.') || /[/\\]/.test(filename)) return undefined;
  const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return Object.hasOwn(photoTypes, extension) ? photoTypes[extension] : undefined;
}

async function albumContents(bucket) {
  if (Date.now() < galleryOpensAt) return { photos: [], video: null };
  const names = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: photoPrefix, cursor });
    names.push(...page.objects.map(object => object.key.slice(photoPrefix.length)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const photos = names.filter(photoType).sort((a, b) => a.localeCompare(b, 'it', { numeric: true }))
    .map(name => ({ url: '/foto-evento/' + encodeURIComponent(name) }));
  const hero = Object.keys(albumVideoTypes).find(name => names.includes(name));
  return { photos, video: hero ? '/foto-evento/' + hero : null };
}

function parseVideoRange(header, size) {
  const bounds = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!bounds || !size || (!bounds[1] && !bounds[2])) return null;
  const start = bounds[1] ? Number(bounds[1]) : Math.max(0, size - Number(bounds[2]));
  const end = bounds[1] && bounds[2] ? Math.min(Number(bounds[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
  return { offset: start, length: end - start + 1, contentRange: 'bytes ' + start + '-' + end + '/' + size };
}

async function streamAlbumMedia(request, bucket, filename, contentType) {
  const key = photoPrefix + filename;
  const headers = { ...privateHeaders, 'Content-Type': contentType };
  const isVideo = Object.hasOwn(albumVideoTypes, filename);
  if (isVideo) headers['Accept-Ranges'] = 'bytes';
  const requestedRange = isVideo ? request.headers.get('Range') : null;

  if (request.method === 'HEAD' || requestedRange) {
    const info = await bucket.head(key);
    if (!info) return reject('File non trovato.', 404);
    if (request.method === 'HEAD') {
      return new Response(null, { headers: { ...headers, 'Content-Length': String(info.size) } });
    }
    const range = parseVideoRange(requestedRange, info.size);
    if (!range) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': 'bytes */' + info.size } });
    const media = await bucket.get(key, { range: { offset: range.offset, length: range.length } });
    if (!media) return reject('File non trovato.', 404);
    return new Response(media.body, { status: 206, headers: {
      ...headers, 'Content-Range': range.contentRange, 'Content-Length': String(range.length)
    } });
  }

  const media = await bucket.get(key);
  if (!media) return reject('File non trovato.', 404);
  if (Number.isFinite(media.size)) headers['Content-Length'] = String(media.size);
  return new Response(media.body, { headers });
}

async function galleryResponse(path, bucket, request) {
  if (Date.now() < galleryOpensAt) return reject('L’album sarà disponibile dopo la festa.', 404);
  if (path === '/foto-evento/' || path === '/foto-evento') {
    const { photos, video } = await albumContents(bucket);
    if (!photos.length && !video) return reject('Le foto della serata saranno disponibili qui.', 404);
    const cards = photos.map(({ url: href }, index) => {
      const label = 'Foto ' + (index + 1);
      return `<figure><a href="${href}" target="_blank" rel="noopener" aria-label="Apri ${label.toLowerCase()}"><img src="${href}" alt="${label} della serata" loading="lazy" decoding="async"></a>
<figcaption><span>${label}</span><a href="${href}" download>Scarica</a></figcaption></figure>`;
    }).join('');
    return new Response(`<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Le foto della serata · Barbara</title>
<link rel="stylesheet" href="/invito-v5.css"></head><body>
<header class="site-header"><a class="brand" href="/"><span class="monogram" aria-hidden="true">BR</span><span>Torna all’invito</span></a></header>
<main class="section page-width gallery-page"><h1>I ricordi della serata</h1><p class="lead">Grazie di aver festeggiato con me!</p>
${video ? '<section class="memories-reel"><h2>La serata in un video</h2><video controls playsinline preload="metadata" src="' + video + '"></video></section>' : ''}
${photos.length ? '<h2>Le foto della serata</h2><div class="event-gallery">' + cards + '</div>' : ''}
</main></body></html>`,
      { headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
  }

  let filename;
  try {
    filename = decodeURIComponent(path.slice('/foto-evento/'.length));
  } catch {
    return reject('Foto non trovata.', 404);
  }
  const contentType = Object.hasOwn(albumVideoTypes, filename) ? albumVideoTypes[filename] : photoType(filename);
  if (!contentType) return reject('File non trovato.', 404);
  return streamAlbumMedia(request, bucket, filename, contentType);
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const galleryPath = path === '/foto-evento' || path.startsWith('/foto-evento/');
  const organizerPath = path === '/organizzazione' || path.startsWith('/organizzazione/');
  const siteUser = standaloneHosting ? null : request.headers.get('oai-authenticated-user-id');
  const userEmail = standaloneHosting ? null : request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  const organizer = standaloneHosting ? standaloneOrganizer(request, env.ORGANIZER_PASSWORD)
    : Boolean(siteUser && userEmail && userEmail === env.ORGANIZER_EMAIL?.trim().toLowerCase());

  if (method === 'HEAD' && path === '/api/invito') {
    const sources = await Promise.allSettled([
      env.DB?.prepare('SELECT dietary, guest_given_name, revision FROM rsvps LIMIT 1').first(),
      env.DB?.prepare('SELECT message FROM guest_messages LIMIT 1').first(),
      env.BUCKET?.list({ prefix: 'video/', limit: 1 })
    ]);
    const ready = env.DB && env.BUCKET && sources.every(source => source.status === 'fulfilled');
    return new Response(null, { status: ready ? 204 : 503, headers: privateHeaders });
  }

  let userId = standaloneHosting && organizer ? 'organizzazione' : siteUser;
  if (standaloneHosting && !env.INVITATION_SECRET) return reject('L’invito non è ancora disponibile.', 503);
  if (env.INVITATION_SECRET) {
    if (!hex.test(env.INVITATION_SECRET)) return reject('L’invito non è ancora disponibile.', 503);
    const key = await invitationKey(env.INVITATION_SECRET);
    if (method === 'GET' && path.startsWith('/invito/')) return acceptInvitation(request, key, path.slice('/invito/'.length));
    if (organizerPath && !organizer) {
      if (path === '/organizzazione' && method === 'GET' && !siteUser && !url.search) return organizerSignIn();
      return reject('Area riservata all’organizzazione.', 403);
    }
    if (!organizer) userId = await guestIdentity(request, key);
    if (!userId) return method === 'GET' && path === '/' ? invitationRequired() : reject('Apri il link dell’invito per continuare.', 401);
  }

  if (!path.startsWith('/api/') && !organizerPath && !galleryPath) {
    return method === 'GET' ? staticFile(path) : new Response(null, { status: 405, headers: { Allow: 'GET' } });
  }

  if (!userId) return reject('Accedi con ChatGPT per continuare.', 401);
  if (organizerPath && !organizer) return reject('Area riservata all’organizzazione.', 403);
  if (method === 'GET' && standaloneHosting && path.startsWith(organizerAssetPrefix + '/')) {
    const assetPath = path.slice(organizerAssetPrefix.length);
    if (/^\/(?:invito-v5\.css|organizzazione\.(?:css|js)|assets\/[^/]+\.otf)$/.test(assetPath)) return staticFile(assetPath);
    return reject('File non trovato.', 404);
  }

  const origin = request.headers.get('Origin');
  if (method !== 'GET' && method !== 'HEAD') {
    const foreignOrigin = origin && origin !== url.origin &&
      (standaloneHosting || origin !== 'https://compleanno-di-barbara.hagakuresush-0222.chatgpt.site');
    if (foreignOrigin || (standaloneHosting && organizerPath && origin !== url.origin)) {
      return reject('La richiesta deve partire dall’invito.', 403);
    }
  }

  if (galleryPath && (method === 'GET' || method === 'HEAD')) return galleryResponse(path, env.BUCKET, request);
  if (method === 'GET' && path === '/api/foto-evento') return json(await albumContents(env.BUCKET));

  if (method === 'GET' && path === '/api/invito') {
    const gift = env.GIFT_RECIPIENT && env.GIFT_IBAN ? {
      recipient: env.GIFT_RECIPIENT, iban: env.GIFT_IBAN, reference: env.GIFT_REFERENCE || 'Regalo di compleanno da parte di {NOME}'
    } : null;
    const [rsvp, wish] = await Promise.all([
      getRsvp(env.DB, userId),
      env.DB.prepare('SELECT guest_name AS name, message FROM guest_messages WHERE guest_id = ?').bind(userId).first()
    ]);
    return json({ organizer, gift, rsvp, wish });
  }
  if (method === 'POST' && path === '/api/auguri') return saveWish(request, env.DB, userId);
  if (method === 'POST' && path === '/api/rsvp') return saveRsvp(request, env.DB, userId);
  if (method === 'PUT' && path.startsWith('/api/video/')) return saveVideo(request, env.BUCKET, userId, path.split('/').at(-1));
  if (method === 'GET' && path === '/organizzazione') return organizerPage(
    env, url.searchParams.get('export') || url.searchParams.get('stato'), url.searchParams.get('salvata') === '1');
  const replyId = Number(/^\/organizzazione\/risposte\/(\d+)$/.exec(path)?.[1]);
  if (Number.isSafeInteger(replyId) && (method === 'GET' || method === 'POST')) return editReply(request, env.DB, replyId);
  if (method === 'GET' && path.startsWith('/organizzazione/video/')) return serveDownload(env.BUCKET, path.slice('/organizzazione/'.length));

  return reject('Pagina non trovata.', 404);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error('Errore nel servizio invito', error?.name, error?.message);
      return reject('Il servizio è momentaneamente indisponibile. Riprova tra poco.', 503);
    }
  }
};
