import { describe, expect, it, vi, afterEach } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import CherrytreeImportPlugin from '../src/main';
import { DEFAULT_OPTIONS } from '../src/convert';
import { normalizeSettings } from '../src/settings';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

const xml = '<cherrytree><node unique_id="1" name="Parent" tags="tag" ts_creation="1683703170"><rich_text>hello</rich_text><node unique_id="2" name="Child"><rich_text>child</rich_text></node></node></cherrytree>';
afterEach(() => resetPro());
function setup(files: Record<string, string> = {}) {
	const app = App.createConfigured__({ files });
	return { app, plugin: new CherrytreeImportPlugin(app as never, manifest as never) };
}
describe('vault writes and Pro guards', () => {
	it('loads default settings', async () => { const { plugin } = setup(); await plugin.loadSettings(); expect(plugin.settings).toEqual(DEFAULT_OPTIONS); });
	it('refuses a SQLite file at selection before it is read', async () => {
		const { plugin } = setup();
		const read = vi.fn();
		await expect(plugin.readFile({ name: 'source.ctb', size: 20, text: read } as unknown as File)).rejects.toThrow('Export to .ctd (XML, no password) first');
		expect(read).not.toHaveBeenCalled();
	});
	it('repairs invalid settings and does not persist subtree selection', () => {
		expect(normalizeSettings({ folder: 5 as never, properties: 'true' as never, subtree: '2' })).toEqual(DEFAULT_OPTIONS);
	});
	it('imports one note per node and makes parent folders through the Vault API', async () => {
		const { plugin, app } = setup();
		const plan = await plugin.importXml(xml, 'sample.ctd', { folder: 'Import' });
		expect(plan.notes).toHaveLength(2);
		expect(app.vault.getAbstractFileByPath('Import/Parent/Child.md')).not.toBeNull();
		const file = app.vault.getFileByPath('Import/Parent.md')!;
		expect(await app.vault.read(file)).toBe('# Parent\n\nhello\n');
	});
	it('refuses existing destination before notes are written', async () => {
		const { plugin, app } = setup({ 'Import/keep.md': 'keep' });
		await expect(plugin.importXml(xml, 'sample.ctd', { folder: 'Import' })).rejects.toThrow('The destination exists');
		expect(app.vault.getFiles().map((f) => f.path)).toEqual(['Import/keep.md']);
	});
	it('refuses a destination created between planning and the first write', async () => {
		const { plugin, app } = setup({ 'Import/keep.md': 'keep' });
		// Simulate a stale preflight result. The folder creation must still refuse the import.
		vi.spyOn(app.vault, 'getAbstractFileByPath').mockReturnValueOnce(null);
		await expect(plugin.importXml(xml, 'sample.ctd', { folder: 'Import' })).rejects.toThrow();
		expect(app.vault.getFiles().map((f) => f.path)).toEqual(['Import/keep.md']);
	});
	it('refuses SQLite without writes', async () => {
		const { plugin, app } = setup();
		await expect(plugin.importXml('SQLite format 3', 'sample.ctb')).rejects.toThrow('Export to .ctd');
		expect(app.vault.getFiles()).toHaveLength(0);
	});
	it('free ignores Pro options at the write boundary', async () => {
		const { plugin } = setup();
		const plan = await plugin.importXml(xml, 'sample.ctd', { folder: 'Import', properties: true, indexes: true, subtree: '2' });
		expect(plan.notes).toHaveLength(2);
		expect(plan.notes[0]?.content).not.toContain('tags:');
	});
	it('Pro writes properties, an index and the selected subtree', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as unknown as SponsorsManager);
		const { plugin } = setup();
		const whole = await plugin.importXml(xml, 'sample.ctd', { folder: 'Whole', properties: true, indexes: true });
		expect(whole.notes).toHaveLength(3);
		expect(whole.notes[0]?.content).toContain('tags:');
		const selected = await plugin.importXml(xml, 'sample.ctd', { folder: 'Selected', subtree: '2' });
		expect(selected.notes).toHaveLength(1);
	});
	it('reports a write error, releases the busy state and allows retry in a new folder', async () => {
		const { plugin, app } = setup();
		const write = vi.spyOn(app.vault, 'create').mockRejectedValueOnce(new Error('Disk full'));
		await expect(plugin.importXml(xml, 'sample.ctd', { folder: 'Failed' })).rejects.toThrow('Disk full');
		write.mockRestore();
		expect((await plugin.importXml(xml, 'sample.ctd', { folder: 'Retry' })).notes).toHaveLength(2);
	});
});
