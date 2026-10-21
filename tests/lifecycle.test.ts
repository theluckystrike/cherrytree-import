import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { App } from 'obsidian-test-mocks/obsidian';
import Plugin from '../src/main';
import manifest from '../manifest.json';

const xml = readFileSync('tests/fixtures/cherry-small-fixture.ctd', 'utf8');
afterEach(() => vi.restoreAllMocks());
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
describe('disable during import', () => {
 it.each(['createFolder', 'createBinary', 'create'] as const)('keeps a pending %s output but starts no next operation after unload', async (method) => {
  const app = App.createConfigured__({ files: {} }); const p = new Plugin(app as never, manifest as never);
  const gate = deferred(); const original = app.vault[method].bind(app.vault);
  const events: string[] = [];
  for (const key of ['createFolder', 'createBinary', 'create'] as const) {
   const real = app.vault[key].bind(app.vault);
   vi.spyOn(app.vault, key).mockImplementation((...args: unknown[]) => { events.push(key); return (real as (...a: unknown[]) => Promise<never>)(...args); });
  }
  const pending = vi.spyOn(app.vault, method).mockImplementation(async (...args: unknown[]) => { events.push(method); await gate.promise; return (original as (...a: unknown[]) => Promise<never>)(...args); });
  const run = p.importXml(xml, 'fixture.ctd', { folder: 'Partial' }).then(() => '', (e: Error) => e.message);
  await vi.waitFor(() => expect(pending).toHaveBeenCalledTimes(1)); const started = events.length;
  p.onunload(); gate.resolve(); const message = await run;
  expect(message).toContain('disabled'); expect(message).toContain('kept'); expect(events).toHaveLength(started);
  expect(app.vault.getAbstractFileByPath('Partial')).not.toBeNull();
  if (method === 'createBinary') expect(app.vault.getFiles().filter((f) => f.extension === 'png')).toHaveLength(1);
  if (method === 'create') expect(app.vault.getMarkdownFiles()).toHaveLength(1);
  const before = app.vault.getFiles().map((f) => f.path);
  await expect(p.importXml(xml, 'fixture.ctd', { folder: 'Disabled' })).rejects.toThrow('disabled');
  pending.mockRestore();
  const next = new Plugin(app as never, manifest as never);
  await expect(next.importXml(xml, 'fixture.ctd', { folder: 'Partial' })).rejects.toThrow('destination exists');
  expect(app.vault.getFiles().map((f) => f.path)).toEqual(before);
  expect((await next.importXml(xml, 'fixture.ctd', { folder: 'Retry' })).notes).toHaveLength(7);
  expect(before.every((path) => app.vault.getFileByPath(path))).toBe(true);
 });
});
