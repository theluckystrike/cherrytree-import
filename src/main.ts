import { Notice, Plugin, TFolder, normalizePath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { DEFAULT_OPTIONS, EXPORT_NOTICE, MAX_BYTES, planImport, pngBytes, type ImportOptions, type ImportPlan } from './convert';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { CherrytreeImportSettingTab, normalizeSettings } from './settings';
import { ImportModal } from './modal';
import { IMPORT_TITLE } from './labels';

export default class CherrytreeImportPlugin extends Plugin {
	settings: ImportOptions = { ...DEFAULT_OPTIONS };
	pro: SponsorsManager | null = null;
	private settingTab: CherrytreeImportSettingTab | null = null;
	private modal: ImportModal | null = null;
	private importing = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.settingTab = new CherrytreeImportSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.addCommand({ id: 'import', name: IMPORT_TITLE, callback: () => this.openImport() });
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { this.modal?.close(); resetPro(); }
	openImport(xml?: string, filename = 'import.ctd'): ImportModal {
		this.modal?.close();
		const modal = new ImportModal(this, xml, filename);
		this.modal = modal;
		modal.open();
		return modal;
	}
	preview(xml: string, filename: string, options: Partial<ImportOptions> = {}): ImportPlan {
		return planImport(xml, filename, { ...this.settings, ...options }, isPro());
	}
	async importXml(xml: string, filename: string, options: Partial<ImportOptions> = {}): Promise<ImportPlan> {
		if (this.importing) throw new Error('An import is in progress.');
		this.importing = true;
		let written = 0;
		let started = false;
		try {
			const plan = this.preview(xml, filename, options);
			const vault = this.app.vault;
			if (vault.getAbstractFileByPath(plan.folder)) throw new Error('The destination exists. Use a new folder name.');
			// Decode images before the first write. A decode failure cannot leave partial notes.
			const images = plan.attachments.map((a) => ({ path: a.path, data: pngBytes(a.base64).buffer }));
			async function folder(path: string): Promise<void> {
				let parent = '';
				for (const part of normalizePath(path).split('/')) {
					parent = normalizePath(parent ? `${parent}/${part}` : part);
					const found = vault.getAbstractFileByPath(parent);
					if (found && !(found instanceof TFolder)) throw new Error(`A file blocks the folder ${parent}.`);
					if (!found) await vault.createFolder(parent);
				}
			}
			const parentEnd = plan.folder.lastIndexOf('/');
			if (parentEnd > 0) await folder(plan.folder.slice(0, parentEnd));
			// Claim the destination with createFolder. A concurrent folder creation must fail.
			await vault.createFolder(plan.folder);
			started = true;
			for (const image of images) { await folder(image.path.slice(0, image.path.lastIndexOf('/'))); await vault.createBinary(normalizePath(image.path), image.data); }
			for (const note of plan.notes) { await folder(note.path.slice(0, note.path.lastIndexOf('/'))); await vault.create(normalizePath(note.path), note.content); written++; }
			new Notice(`Imported ${plan.tree.length} nodes, ${plan.attachments.length} PNG images. ${plan.warnings.length} warnings.`);
			return plan;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(started ? `${message} Import stopped after ${written} notes. Check the destination folder.` : message);
			throw error;
		} finally { this.importing = false; }
	}
	async readFile(file: File): Promise<{ xml: string; filename: string }> {
		if (!file.name.toLowerCase().endsWith('.ctd')) throw new Error(EXPORT_NOTICE);
		if (file.size > MAX_BYTES) throw new Error('The file is too large. Limit: 25 MB.');
		return { xml: await file.text(), filename: file.name };
	}
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as Partial<ImportOptions> | null); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}
