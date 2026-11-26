import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const portFlag = process.argv.indexOf('--port');
const port = portFlag >= 0 ? Number(process.argv[portFlag + 1]) : 4173;
const origin = 'http://127.0.0.1:' + port;
execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], {
  env: { ...process.env, SITE_URL: origin + '/' }, stdio: 'inherit'
});
const { default: worker } = await import('../dist/server/index.js');

const data = join(root, '.local-v5');
await mkdir(data, { recursive: true });
try {
  loadEnvFile(join(data, 'bonifico.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const db = new DatabaseSync(join(data, 'risposte.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
const migrations = join(root, 'drizzle');
for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
  if (db.prepare('SELECT name FROM local_migrations WHERE name = ?').get(name)) continue;
  const sql = await readFile(join(migrations, name), 'utf8');
  db.exec('BEGIN');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO local_migrations(name) VALUES (?)').run(name);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function prepare(sql, values = []) {
  return {
    bind: (...parameters) => prepare(sql, parameters),
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    run: async () => db.prepare(sql).run(...values)
  };
}

const uploads = join(data, 'uploads');
await mkdir(uploads, { recursive: true });
function uploadPath(key) {
  if (!/^video\/[a-f0-9]{64}\/[a-f0-9-]{36}\.[a-z0-9]+$/.test(key)) {
    throw new Error('Chiave video locale non valida.');
  }
  return join(uploads, key);
}
const albumFolder = join(root, 'foto-evento');
const albumVideoTypes = JSON.parse(await readFile(join(root, 'worker/album-video-types.json'), 'utf8'));
const photoTypes = JSON.parse(await readFile(join(root, 'worker/photo-types.json'), 'utf8'));
async function albumFiles() {
  const files = await readdir(albumFolder, { withFileTypes: true });
  return files.filter(file => file.isFile() && !file.name.startsWith('.') &&
    (Object.hasOwn(photoTypes, extname(file.name).toLowerCase()) || Object.hasOwn(albumVideoTypes, file.name))).map(file => file.name);
}

const bucket = {
  async put(key, body, options) {
    const path = uploadPath(key);
    const temp = path + '.' + randomUUID() + '.tmp';
    await mkdir(dirname(path), { recursive: true });
    try {
      await pipeline(Readable.fromWeb(body), createWriteStream(temp));
      await rename(temp, path);
      await writeFile(path + '.json', JSON.stringify({
        key, uploaded: new Date(), customMetadata: options.customMetadata
      }));
    } finally {
      await rm(temp, { force: true });
    }
  },
  async head(key) {
    const filename = key.slice('foto-evento/'.length);
    if (!key.startsWith('foto-evento/') || !(await albumFiles()).includes(filename)) return null;
    return stat(join(albumFolder, filename)).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  },
  async get(key, { range } = {}) {
    if (key.startsWith('foto-evento/')) {
      const filename = key.slice('foto-evento/'.length);
      if (!(await albumFiles()).includes(filename)) return null;
      try {
        const photo = await open(join(albumFolder, filename), 'r');
        const size = (await photo.stat()).size;
        const stream = photo.createReadStream(range ? { start: range.offset, end: range.offset + range.length - 1 } : {});
        return { size, body: Readable.toWeb(stream) };
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    }
    const path = uploadPath(key);
    try {
      const info = JSON.parse(await readFile(path + '.json', 'utf8'));
      return { ...info, body: Readable.toWeb(createReadStream(path)) };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  },
  async list({ prefix, limit }) {
    if (prefix === 'foto-evento/') {
      const objects = (await albumFiles()).slice(0, limit).map(name => ({ key: prefix + name }));
      return { objects, truncated: false };
    }
    const files = await readdir(uploads, { recursive: true });
    const paths = files.filter(path => path.startsWith(prefix) && path.endsWith('.json')).slice(0, limit);
    const objects = await Promise.all(paths.map(async path => {
      const entry = JSON.parse(await readFile(join(uploads, path), 'utf8'));
      return { ...entry, uploaded: new Date(entry.uploaded) };
    }));
    return { objects, truncated: false };
  }
};

const organizerEmail = 'organizzazione@barbara.test';
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    const cookies = new Map((req.headers.cookie ?? '').split(';').map(cookie => cookie.trim().split('=')));
    const previousGuest = cookies.get('barbara-v5');
    const guest = /^[a-f0-9-]{36}$/.test(previousGuest) ? previousGuest : randomUUID();
    const mode = url.searchParams.get('modalita');
    if (mode === 'ospite' || mode === 'organizzazione') {
      url.searchParams.delete('modalita');
      res.writeHead(302, {
        Location: url.pathname + url.search,
        'Set-Cookie': 'barbara-v5-mode=' + mode + '; Path=/; HttpOnly; SameSite=Strict'
      }).end();
      return;
    }

    const organizer = cookies.get('barbara-v5-mode') === 'organizzazione';
    const headers = new Headers(req.headers);
    headers.set('oai-authenticated-user-id', organizer ? 'organizzazione-locale' : guest);
    headers.set('oai-authenticated-user-email', organizer ? organizerEmail : 'ospite@barbara.test');
    const method = req.method;
    const body = method === 'GET' || method === 'HEAD' ? undefined : Readable.toWeb(req);
    const response = await worker.fetch(new Request(url, { method, headers, body, duplex: 'half' }), {
      DB: { prepare }, BUCKET: bucket, ORGANIZER_EMAIL: organizerEmail,
      GIFT_RECIPIENT: process.env.GIFT_RECIPIENT, GIFT_IBAN: process.env.GIFT_IBAN,
      GIFT_REFERENCE: process.env.GIFT_REFERENCE
    });
    const outgoing = Object.fromEntries(response.headers);
    if (!previousGuest) outgoing['Set-Cookie'] = 'barbara-v5=' + guest + '; Path=/; HttpOnly; SameSite=Strict';
    res.writeHead(response.status, outgoing);
    if (response.body) await pipeline(Readable.fromWeb(response.body), res);
    else res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
server.once('error', error => {
  console.error('Impossibile avviare il server locale: ' + error.code);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log('Invito V5 disponibile su ' + origin + '/'));
