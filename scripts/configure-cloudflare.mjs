import { writeFile } from 'node:fs/promises';

const { CF_WORKER_NAME, CF_D1_NAME, CF_D1_ID, CF_R2_BUCKET } = process.env;
const resource = /^[a-z0-9][a-z0-9-]+$/;
const databaseId = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
if (!resource.test(CF_WORKER_NAME ?? '') || !resource.test(CF_D1_NAME ?? '') ||
    !databaseId.test(CF_D1_ID ?? '') || !resource.test(CF_R2_BUCKET ?? '')) {
  throw new Error('Imposta CF_WORKER_NAME, CF_D1_NAME, CF_D1_ID e CF_R2_BUCKET nelle variabili del repository.');
}

const configuration = {
  name: CF_WORKER_NAME,
  main: 'dist/server/index.js',
  compatibility_date: '2026-11-26',
  workers_dev: true,
  preview_urls: false,
  keep_vars: true,
  d1_databases: [{
    binding: 'DB', database_name: CF_D1_NAME, database_id: CF_D1_ID, migrations_dir: 'drizzle'
  }],
  r2_buckets: [{ binding: 'BUCKET', bucket_name: CF_R2_BUCKET }]
};
await writeFile(new URL('../.wrangler.deploy.json', import.meta.url), JSON.stringify(configuration, null, 2) + '\n');
