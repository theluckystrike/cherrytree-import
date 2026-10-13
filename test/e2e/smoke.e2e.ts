import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lastNotice, pluginId, reloadPlugin } from './load';

const small = readFileSync('tests/fixtures/cherry-small-fixture.ctd', 'utf8');
const unicode = readFileSync('tests/fixtures/cherry-fixture.ctd', 'utf8');
interface Plan { nodeCount: number; noteCount: number; imageCount: number; notes: { path: string; content: string }[] }
interface P {
	preview(xml: string, filename: string, options: Record<string, unknown>): Plan;
	importXml(xml: string, filename: string, options: Record<string, unknown>): Promise<Plan>;
	openImport(xml?: string, filename?: string): { close(): void };
	pro: { opts: { http: unknown }; refreshNow(): Promise<void>; signOut(): void };
}
async function setPro(on: boolean) {
	await browser.executeObsidian(async ({ app }, id, on) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
		if (!on) { p.pro.signOut(); return; }
		p.pro.opts.http = () => Promise.resolve({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await p.pro.refreshNow();
	}, pluginId, on);
}
async function importDoc(xml: string, folder: string, options: Record<string, unknown> = {}): Promise<Plan> {
	return browser.executeObsidian(async ({ app }, id, xml, folder, options) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
		return p.importXml(xml, 'sample.ctd', { folder, ...options });
	}, pluginId, xml, folder, options);
}

describe('CherryTree import in the real app', function () {
	before(async () => { await setPro(false); });
	it('loads and reloads without console errors', async () => {
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
	});
	it('opens the command and previews an actual selected .ctd file', async () => {
		await browser.executeObsidianCommand(`${pluginId}:import`);
		await browser.$('.cherrytree-import-modal input[type="file"]').waitForExist();
		await browser.$('.cherrytree-import-modal input[type="file"]').setValue(resolve('tests/fixtures/cherry-small-fixture.ctd'));
		await browser.waitUntil(async () => (await browser.$('.cherrytree-import-summary').getText()).includes('7 nodes · 7 notes · 4 PNG images'), { timeout: 10000, timeoutMsg: 'File preview did not show 7 nodes and 4 PNGs' });
		expect(await browser.$$('.cherrytree-import-tree li').length).toBe(7);
		await browser.$('.cherrytree-import-modal input[type="file"]').setValue(resolve('tests/fixtures/sqlite.ctb'));
		await browser.waitUntil(async () => (await browser.$('.cherrytree-import-error').getText()) === 'Export to .ctd (XML, no password) first', { timeout: 10000 });
		expect(await browser.$$('.cherrytree-import-tree li').length).toBe(0);
		await browser.waitUntil(async () => (await lastNotice()) === 'Export to .ctd (XML, no password) first', { timeout: 5000 });
		await browser.$('.cherrytree-import-modal input[type="file"]').setValue(resolve('tests/fixtures/cherry-small-fixture.ctd'));
		await browser.waitUntil(async () => (await browser.$('.cherrytree-import-summary').getText()).includes('7 nodes · 7 notes · 4 PNG images'), { timeout: 10000 });
		const disabled = await browser.execute(() => ({ toggles: [...document.querySelectorAll('.cherrytree-import-modal .checkbox-container')].map((x) => x.classList.contains('is-disabled')), subtree: (document.querySelector('.cherrytree-import-modal select') as HTMLSelectElement).disabled }));
		expect(disabled).toEqual({ toggles: [true, true], subtree: true });
	});
	it('imports through the dialog and saves nested notes, links, tables and PNG bytes', async () => {
		await browser.$('.cherrytree-import-modal input[type="text"]').setValue('E2E free');
		await browser.$('.cherrytree-import-modal button.mod-cta').click();
		await browser.$('.cherrytree-import-complete').waitForExist({ timeout: 15000 });
		const state = await browser.executeObsidian(async ({ app }) => {
			const files = app.vault.getFiles().filter((f) => f.path.startsWith('E2E free/'));
			const image = app.vault.getFileByPath('E2E free/attachments/node-5-1.png')!;
			return { notes: files.filter((f) => f.extension === 'md').length, images: files.filter((f) => f.extension === 'png').length,
				child: await app.vault.read(app.vault.getFileByPath('E2E free/aaa/bbb.md')!),
				parent: await app.vault.read(app.vault.getFileByPath('E2E free/aaa.md')!),
				formatting: await app.vault.read(app.vault.getFileByPath('E2E free/aaa/Formatting.md')!),
				png: Array.from(new Uint8Array(await app.vault.readBinary(image)).slice(0, 8)) };
		});
		expect(state.notes).toBe(7); expect(state.images).toBe(4);
		expect(state.child).toContain('| Tool | Format | Location |');
		expect(state.parent).toContain('[[E2E free/aaa/bbb|the comparison table]]');
		expect(state.formatting).toContain('```sh\necho "Export complete"');
		expect(state.formatting).toContain('**bold** and *italic*');
		expect(state.formatting).toContain('<u>underlined</u>');
		expect(state.png).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
		await browser.execute(() => (document.querySelector('.cherrytree-import-modal .modal-close-button') as HTMLElement)?.click());
		await browser.executeObsidian(async ({ app }) => {
			const leaf = app.workspace.getLeaf(false);
			await leaf.setViewState({ type: 'markdown', state: { file: 'E2E free/Project links/Images.md', mode: 'preview' } });
			app.workspace.setActiveLeaf(leaf, { focus: true });
		});
		let imageState: { mode: string; widths: number[] } = { mode: '', widths: [] };
		await browser.waitUntil(async () => {
			imageState = await browser.executeObsidian(({ app, obsidian }) => {
				for (const leaf of app.workspace.getLeavesOfType('markdown')) {
					const view = leaf.view;
					if (view instanceof obsidian.MarkdownView && view.file?.path === 'E2E free/Project links/Images.md') {
						return { mode: view.getMode(), widths: [...view.containerEl.querySelectorAll<HTMLImageElement>('.markdown-preview-view img')].map((img) => img.naturalWidth) };
					}
				}
				return { mode: '', widths: [] };
			});
			return imageState.mode === 'preview' && imageState.widths.length === 4 && imageState.widths.every((w) => w > 0);
		}, { timeout: 15000, timeoutMsg: 'Imported PNG images did not load in the reading view' });
		expect(imageState.widths).toEqual([200, 200, 200, 200]);
	});
	it('imports the ten-node Unicode source and resolves its shared node', async () => {
		const plan = await importDoc(unicode, 'E2E Unicode');
		expect(plan.nodeCount).toBe(10); expect(plan.noteCount).toBe(10);
		expect(plan.notes[0]!.path).toBe('E2E Unicode/йцукенгшщз.md');
		expect(new Set(plan.notes.map((n) => n.path)).size).toBe(10);
	});
	it('refuses SQLite and malformed XML before a vault write', async () => {
		const state = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
			const errors: string[] = [];
			for (const [xml, filename, folder] of [['SQLite format 3', 'input.ctb', 'E2E rejected SQLite'], ['<cherrytree><node unique_id="1"></cherrytree>', 'input.ctd', 'E2E rejected XML']]) {
				try { await p.importXml(xml!, filename!, { folder }); } catch (e) { errors.push((e as Error).message); }
			}
			return { errors, sqlite: !!app.vault.getAbstractFileByPath('E2E rejected SQLite'), invalid: !!app.vault.getAbstractFileByPath('E2E rejected XML') };
		}, pluginId);
		expect(state.errors).toEqual(['Export to .ctd (XML, no password) first', 'The file is not valid CherryTree XML.']);
		expect(state.sqlite).toBe(false); expect(state.invalid).toBe(false);
	});
	it('refuses a second import into the same folder and keeps existing notes', async () => {
		const state = await browser.executeObsidian(async ({ app }, id, xml) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
			let message = '';
			try { await p.importXml(xml, 'sample.ctd', { folder: 'E2E free' }); } catch (e) { message = (e as Error).message; }
			return { message, notes: app.vault.getFiles().filter((f) => f.path.startsWith('E2E free/') && f.extension === 'md').length };
		}, pluginId, small);
		expect(state.message).toContain('The destination exists'); expect(state.notes).toBe(7);
	});
	it('free ignores Pro options at the import boundary', async () => {
		await setPro(false);
		const plan = await importDoc(small, 'E2E guarded', { properties: true, indexes: true, subtree: '2' });
		expect(plan.nodeCount).toBe(7); expect(plan.noteCount).toBe(7);
		expect(plan.notes[0]!.content.startsWith('---')).toBe(false);
	});
	it('Pro uses a stubbed Sponsors check for properties, parent indexes and subtree selection', async () => {
		await setPro(true);
		const whole = await importDoc(small, 'E2E Pro', { properties: true, indexes: true });
		expect(whole.nodeCount).toBe(7); expect(whole.noteCount).toBe(10);
		expect(whole.notes.find((n) => n.path === 'E2E Pro/aaa.md')!.content).toContain('2023-05-10T07:19:30.000Z');
		expect(whole.notes.find((n) => n.path === 'E2E Pro/aaa/_index.md')!.content).toContain('[[E2E Pro/aaa/bbb|bbb]]');
		const selected = await importDoc(small, 'E2E subtree', { subtree: '2' });
		expect(selected.noteCount).toBe(1); expect(selected.notes[0]!.path).toBe('E2E subtree/aaa/bbb.md');
		await setPro(false);
	});
	it('rejects a script address and keeps source HTML as text', async () => {
		const xml = '<cherrytree><node unique_id="1" name="Safe"><rich_text link="webs javascript:alert(1)">&lt;script&gt;alert(1)&lt;/script&gt;</rich_text></node></cherrytree>';
		const plan = await importDoc(xml, 'E2E safety');
		expect(plan.notes[0]!.content).toContain('\\<script\\>');
		expect(plan.notes[0]!.content).not.toContain('javascript:');
	});
});
