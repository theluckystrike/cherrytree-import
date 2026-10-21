import { createHash } from 'node:crypto';
import { browser, expect } from '@wdio/globals';
import { existsSync, readFileSync } from 'node:fs';
import { pluginId } from './load';
const xml = readFileSync('tests/fixtures/cherry-small-fixture.ctd', 'utf8');

describe('CherryTree cancellation in the app', () => {
 it('keeps settled folder, image and note output without starting the next write', async () => {
  const result = await browser.executeObsidian(async ({ app, obsidian }, id, xml) => {
   return await new Function('app', 'id', 'xml', 'version', `return (async () => {
    const plugins = app.plugins;
    const assetHashes = {};
    const dir = plugins.plugins[id].manifest.dir;
    for (const name of ['main.js', 'manifest.json', 'styles.css']) {
     const digest = await crypto.subtle.digest('SHA-256', await app.vault.adapter.readBinary(dir + '/' + name));
     assetHashes[name] = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    } const records = [];
    for (const method of ['createFolder', 'createBinary', 'create']) {
     const p = plugins.plugins[id]; const folder = 'Cancelled ' + method;
     let release; const gate = new Promise(r => release = r); let entered; const started = new Promise(r => entered = r);
     const originals = {}; const events = [];
     for (const key of ['createFolder', 'createBinary', 'create']) {
      originals[key] = app.vault[key].bind(app.vault);
      app.vault[key] = async (...args) => { events.push(key); if (key === method) { entered(); await gate; } return originals[key](...args); };
     }
     try {
      const run = p.importXml(xml, 'fixture.ctd', { folder }).then(() => '', e => e.message);
      await started; const before = events.length; await plugins.disablePlugin(id); release(); const message = await run;
      records.push({ method, message, laterOperations: events.length - before,
       notes: app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + '/')).length,
       images: app.vault.getFiles().filter(f => f.path.startsWith(folder + '/') && f.extension === 'png').length,
       folderKept: !!app.vault.getAbstractFileByPath(folder) });
     } finally { release(); for (const key of Object.keys(originals)) app.vault[key] = originals[key]; await plugins.enablePlugin(id); }
    }
    return { version, records, assetHashes };
   })()`)(app, id, xml, obsidian.apiVersion);
  }, pluginId, xml);
  const expectedAssets = Object.fromEntries(['main.js', 'manifest.json', 'styles.css'].map((name) => [name, createHash('sha256').update(readFileSync(name)).digest('hex')]));
  const lockPath = existsSync('package-lock.json') ? 'package-lock.json' : '../../pnpm-lock.yaml';
  const lockSha256 = createHash('sha256').update(readFileSync(lockPath)).digest('hex');
  console.log('CANDIDATE APP CANCELLATION', JSON.stringify({ ...result, lockPath, lockSha256 }));
  expect(result.assetHashes).toEqual(expectedAssets);
  expect(result.version).toMatch(/^1\.(13\.4|14\.4)$/);
  for (const record of result.records) {
   expect(record.message).toContain('disabled'); expect(record.message).toContain('kept'); expect(record.laterOperations).toBe(0); expect(record.folderKept).toBe(true);
   expect(record.notes).toBe(record.method === 'create' ? 1 : 0); expect(record.images).toBe(record.method === 'createFolder' ? 0 : record.method === 'createBinary' ? 1 : 4);
  }
 });
});
