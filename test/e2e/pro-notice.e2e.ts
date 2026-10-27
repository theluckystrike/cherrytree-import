import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { pluginId } from './load';

// A free user can select each Pro option of the import dialog. The select shows the shared Pro notice with the
// "Sponsor on GitHub" button, and the option stays off. A Pro user selects the same controls and the option turns on.
const xml = readFileSync('tests/fixtures/cherry-small-fixture.ctd', 'utf8');
const LEADS = {
	properties: 'Pro adds node tags and creation dates as properties.',
	indexes: 'Pro adds parent index notes.',
	subtree: 'Pro imports a selected subtree.',
};
const LABELS = { properties: 'Tags and creation dates (Pro)', indexes: 'Parent index notes (Pro)', subtree: 'Selected subtree (Pro)' };
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

interface Options { folder: string; properties: boolean; indexes: boolean; subtree: string }
interface ModalState { options: Options; summary: string; toggles: boolean[]; subtree: string }
interface P {
	openImport(xml?: string, filename?: string): { close(): void };
	pro: { opts: { http: unknown }; refreshNow(): Promise<unknown>; signOut(): void; isPro(): boolean };
}

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, id, on) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
		if (!on) { p.pro.signOut(); return p.pro.isPro(); }
		p.pro.opts.http = () => Promise.resolve({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await p.pro.refreshNow();
		return p.pro.isPro();
	}, pluginId, on);
}

async function openDialog(): Promise<void> {
	await browser.executeObsidian(({ app }, id, xml) => {
		document.querySelectorAll('.notice').forEach((n) => n.remove());
		const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
		p.openImport(xml, 'fixture.ctd');
	}, pluginId, xml);
	await browser.waitUntil(async () => (await browser.$('.cherrytree-import-modal .cherrytree-import-summary').isExisting()), { timeout: 5000, timeoutMsg: 'The import dialog shows no preview.' });
}

async function state(): Promise<ModalState> {
	return browser.executeObsidian(({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, { modal: { options: Options } | null }> } }).plugins.plugins[id]!;
		const root = document.querySelector('.cherrytree-import-modal')!;
		return {
			options: { ...p.modal!.options },
			summary: root.querySelector('.cherrytree-import-summary')?.textContent ?? '',
			toggles: [...root.querySelectorAll('.checkbox-container')].map((t) => t.classList.contains('is-enabled')),
			subtree: (root.querySelector('select') as HTMLSelectElement | null)?.value ?? '',
		};
	}, pluginId);
}

async function notices(): Promise<{ text: string; buttons: number }[]> {
	return browser.executeObsidian(() => [...document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })));
}

async function clickToggle(label: string): Promise<void> {
	// Finds the row by its name, then clicks its toggle, as a mouse click does.
	const found = await browser.executeObsidian((_obsidian, label) => {
		const row = [...document.querySelectorAll('.cherrytree-import-modal .setting-item')].find((s) => s.querySelector('.setting-item-name')?.textContent === label);
		const box = row?.querySelector<HTMLElement>('.checkbox-container');
		box?.click();
		return !!box;
	}, label);
	expect(found).toBe(true);
}

async function selectSubtree(id: string): Promise<void> {
	// The same event that a mouse select of an option fires on a select element.
	await browser.executeObsidian((_obsidian, id) => {
		const select = document.querySelector('.cherrytree-import-modal select') as HTMLSelectElement;
		select.value = id;
		select.dispatchEvent(new Event('change'));
	}, id);
}

async function closeDialog(): Promise<void> {
	await browser.executeObsidian(({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, { modal: { close(): void } | null }> } }).plugins.plugins[id]!;
		p.modal?.close();
		document.querySelectorAll('.notice').forEach((n) => n.remove());
	}, pluginId);
}

describe('Pro options of the import dialog', () => {
	it('a free user who selects a Pro option gets a Pro notice with a Sponsor button and the option stays off', async () => {
		expect(await setPro(false)).toBe(false);
		await openDialog();
		const before = await state();
		expect(before.options).toMatchObject({ properties: false, indexes: false, subtree: '' });

		for (const key of ['properties', 'indexes'] as const) {
			await clickToggle(LABELS[key]);
			await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(LEADS[key])), { timeout: 5000, timeoutMsg: `No Pro notice after the ${key} toggle.` });
			const notice = (await notices()).find((n) => n.text.includes(LEADS[key]))!;
			expect(notice.text).toContain(`${LEADS[key]} ${PITCH}`);
			expect(notice.buttons).toBe(1);
		}
		await selectSubtree('4');
		await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(LEADS.subtree)), { timeout: 5000, timeoutMsg: 'No Pro notice after the subtree select.' });
		const subtree = (await notices()).find((n) => n.text.includes(LEADS.subtree))!;
		expect(subtree.text).toContain(`${LEADS.subtree} ${PITCH}`);
		expect(subtree.buttons).toBe(1);

		// The Pro action did not run: the options, the toggles, the select and the preview are as before.
		const after = await state();
		expect(after.options).toEqual(before.options);
		expect(after.toggles).toEqual([false, false]);
		expect(after.subtree).toBe('');
		expect(after.summary).toBe(before.summary);
		await closeDialog();
	});

	it('a Pro user who selects the same controls turns the options on', async () => {
		try {
			expect(await setPro(true)).toBe(true);
			await openDialog();
			const before = await state();
			await clickToggle(LABELS.properties);
			await clickToggle(LABELS.indexes);
			await selectSubtree('4');
			await browser.waitUntil(async () => (await state()).summary !== before.summary, { timeout: 5000, timeoutMsg: 'The subtree select did not change the preview.' });
			const after = await state();
			expect(after.options).toMatchObject({ properties: true, indexes: true, subtree: '4' });
			expect(after.toggles).toEqual([true, true]);
			expect(after.subtree).toBe('4');
			expect((await notices()).filter((n) => n.buttons > 0)).toEqual([]);
			await closeDialog();
		} finally {
			await setPro(false);
		}
	});
});
