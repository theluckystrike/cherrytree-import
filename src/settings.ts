import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { DEFAULT_OPTIONS, type ImportOptions } from './convert';
import { PRO_UI } from './pro';
import type CherrytreeImportPlugin from './main';

export function normalizeSettings(saved: Partial<ImportOptions> | null | undefined): ImportOptions {
	return { folder: typeof saved?.folder === 'string' && saved.folder.trim() ? saved.folder : DEFAULT_OPTIONS.folder,
		properties: typeof saved?.properties === 'boolean' ? saved.properties : false,
		indexes: typeof saved?.indexes === 'boolean' ? saved.indexes : false, subtree: '' };
}
export class CherrytreeImportSettingTab extends PluginSettingTab {
	plugin: CherrytreeImportPlugin;
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: CherrytreeImportPlugin) { super(app, plugin); this.plugin = plugin; }
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Destination folder', desc: 'A new folder for this import. Existing destination folders are refused.', control: { type: 'text', key: 'folder', defaultValue: DEFAULT_OPTIONS.folder } },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
}
