import { Modal, Notice, Setting } from 'obsidian';
import { DEFAULT_OPTIONS, type ImportOptions, type ImportPlan } from './convert';
import { PRO_LEADS, isPro, onProChange, proNotice } from './pro';
import type CherrytreeImportPlugin from './main';
import { DOCUMENT_LABEL, IMPORT_TITLE, PRO_LABELS } from './labels';

export class ImportModal extends Modal {
	private xml = '';
	private filename = '';
	private selectedFiles: FileList | null = null;
	private readGeneration = 0;
	private options: ImportOptions;
	private plan: ImportPlan | null = null;
	private previewEl!: HTMLElement;
	private errorEl!: HTMLElement;
	private unsubscribe: (() => void) | null = null;
	private busy = false;
	constructor(private plugin: CherrytreeImportPlugin, xml?: string, filename = 'import.ctd') {
		super(plugin.app);
		this.options = { ...DEFAULT_OPTIONS, ...plugin.settings, subtree: '' };
		this.xml = xml ?? ''; this.filename = filename;
	}
	onOpen(): void {
		this.setTitle(IMPORT_TITLE);
		this.modalEl.addClass('cherrytree-import-modal');
		this.draw();
		this.unsubscribe = onProChange(() => { if (!this.busy) this.draw(); });
	}
	onClose(): void { this.unsubscribe?.(); this.unsubscribe = null; this.contentEl.empty(); }
	private draw(): void {
		const el = this.contentEl; el.empty();
		el.createEl('p', { text: 'Select an unencrypted .ctd export. Check the tree, then import into a new folder.' });
		const picker = el.createEl('input', { attr: { type: 'file', accept: '.ctd,.ctb', 'aria-label': DOCUMENT_LABEL } });
		if (this.selectedFiles) picker.files = this.selectedFiles;
		picker.addEventListener('change', () => { void (async () => {
			const file = picker.files?.[0]; if (!file) return;
			const generation = ++this.readGeneration;
			this.xml = ''; this.plan = null; this.selectedFiles = null;
			this.previewEl.empty(); this.errorEl.empty();
			try {
				const input = await this.plugin.readFile(file);
				if (generation !== this.readGeneration) return;
				this.xml = input.xml; this.filename = input.filename; this.selectedFiles = picker.files;
				this.options.subtree = ''; this.draw();
			} catch (error) { if (generation === this.readGeneration) this.showError(error); }
		})(); });
		new Setting(el).setName('Destination folder').setDesc('Use a new folder. The import does not merge into an existing folder.').addText((t) => t.setValue(this.options.folder).onChange((value) => { this.options.folder = value; this.renderPreview(); }));
		// Free users can select the Pro options: a select shows what Pro adds and how to get it. The option stays off.
		new Setting(el).setName(PRO_LABELS.properties).addToggle((t) => t.setValue(this.options.properties && isPro()).onChange((v) => {
			if (!isPro()) { if (v) { proNotice(PRO_LEADS.properties); t.setValue(false); } return; }
			this.options.properties = v; this.renderPreview();
		}));
		new Setting(el).setName(PRO_LABELS.indexes).addToggle((t) => t.setValue(this.options.indexes && isPro()).onChange((v) => {
			if (!isPro()) { if (v) { proNotice(PRO_LEADS.indexes); t.setValue(false); } return; }
			this.options.indexes = v; this.renderPreview();
		}));
		new Setting(el).setName(PRO_LABELS.subtree).addDropdown((d) => {
			d.addOption('', 'Whole document');
			if (this.xml) {
				try { for (const n of this.plugin.preview(this.xml, this.filename, { ...this.options, subtree: '' }).tree) d.addOption(n.id, `${'— '.repeat(n.depth)}${n.name}`); }
				catch { /* The preview shows the error below. */ }
			}
			d.setValue(isPro() ? this.options.subtree : '').onChange((v) => {
				if (!isPro()) { if (v) { proNotice(PRO_LEADS.subtree); d.setValue(''); } return; }
				this.options.subtree = v; this.renderPreview();
			});
		});
		this.errorEl = el.createDiv({ cls: 'cherrytree-import-error', attr: { role: 'alert' } });
		this.previewEl = el.createDiv({ cls: 'cherrytree-import-preview' });
		new Setting(el).addButton((b) => b.setButtonText('Import notes').setCta().onClick(() => { void this.run(); }));
		this.renderPreview();
	}
	private showError(error: unknown): void { const message = error instanceof Error ? error.message : String(error); this.errorEl.setText(message); new Notice(message); }
	private renderPreview(): void {
		this.plan = null; this.errorEl.empty(); this.previewEl.empty();
		if (!this.xml) { this.previewEl.createEl('p', { text: 'No document selected.' }); return; }
		try {
			const plan = this.plugin.preview(this.xml, this.filename, this.options); this.plan = plan;
			this.previewEl.createEl('p', { cls: 'cherrytree-import-summary', text: `${this.filename}: ${plan.tree.length} nodes · ${plan.notes.length} notes · ${plan.attachments.length} PNG images` });
			const tree = this.previewEl.createEl('ul', { cls: 'cherrytree-import-tree' });
			for (const n of plan.tree) tree.createEl('li', { text: `${'— '.repeat(n.depth)}${n.name}`, attr: { title: n.path } });
			for (const w of plan.warnings) this.previewEl.createEl('p', { cls: 'cherrytree-import-warning', text: w });
		} catch (error) { this.errorEl.setText(error instanceof Error ? error.message : String(error)); }
	}
	private async run(): Promise<void> {
		if (this.busy) return;
		if (!this.plan) { new Notice('Select a valid document and destination first.'); return; }
		this.busy = true;
		this.contentEl.addClass('is-importing');
		try {
			await this.plugin.importXml(this.xml, this.filename, this.options);
			this.previewEl.empty(); this.previewEl.createEl('p', { cls: 'cherrytree-import-complete', text: `Import complete. Open the notes in ${this.options.folder}.` });
			this.plan = null;
		} catch (error) { this.showError(error); }
		finally { this.busy = false; this.contentEl.removeClass('is-importing'); }
	}
}
