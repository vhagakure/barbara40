import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const bucket = process.argv[2];
if (!bucket || !/^[a-z0-9][a-z0-9-]+$/.test(bucket)) {
  console.error('Uso: npm run foto:pubblica -- nome-del-bucket-privato');
  process.exit(1);
}
const folder = new URL('../foto-evento/', import.meta.url);
const videoTypes = JSON.parse(await readFile(new URL('../worker/album-video-types.json', import.meta.url), 'utf8'));
const types = JSON.parse(await readFile(new URL('../worker/photo-types.json', import.meta.url), 'utf8'));
const files = (await readdir(folder, { withFileTypes: true })).filter(file =>
  file.isFile() && !file.name.startsWith('.') && file.name !== 'README.md');
const unsupported = files.filter(({ name }) =>
  !Object.hasOwn(types, extname(name).toLowerCase()) && !Object.hasOwn(videoTypes, name));
if (unsupported.length) {
  console.error('File da convertire o rinominare: ' + unsupported.map(({ name }) => name).join(', '));
  process.exit(1);
}
for (const { name } of files) {
  const command = spawnSync('wrangler', [
    'r2', 'object', 'put', bucket + '/foto-evento/' + name,
    '--file', fileURLToPath(new URL(encodeURIComponent(name), folder)),
    '--content-type', videoTypes[name] ?? types[extname(name).toLowerCase()],
    '--remote'
  ], { stdio: 'inherit' });
  if (command.error) throw command.error;
  if (command.status !== 0) process.exit(command.status ?? 1);
}
console.log(files.length + ' file dell’album caricati.');
