import { normalizePath, stringifyYaml } from 'obsidian';

export const EXPORT_NOTICE = 'Export to .ctd (XML, no password) first';
export const MAX_BYTES = 25 * 1024 * 1024;
export interface ImportOptions { folder: string; properties: boolean; indexes: boolean; subtree: string }
export const DEFAULT_OPTIONS: ImportOptions = { folder: 'CherryTree import', properties: false, indexes: false, subtree: '' };
export interface TreeEntry { id: string; name: string; path: string; depth: number }
export interface ImportPlan {
	folder: string;
	nodeCount: number;
	noteCount: number;
	imageCount: number;
	tree: TreeEntry[];
	notes: { path: string; content: string }[];
	attachments: { path: string; base64: string }[];
	warnings: string[];
}
interface TreeNode { id: string; name: string; path: string; depth: number; element: Element; children: TreeNode[] }

/** Use one safe filename component. Keep Unicode letters. */
export function safeName(name: string): string {
	// Cut by code points, so a surrogate pair stays whole. Then remove the trailing dots and spaces again.
	// normalizePath changes no-break spaces to spaces. Change them here, so two sibling names cannot get one vault path.
	const clean = Array.from(Array.from(name.normalize('NFC').replace(/[\u00A0\u202F]/g, ' ')).map((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? '-' : ch).join('').replace(/[/\\:*?"<>|#[\]^]/g, '-').trim()).slice(0, 100).join('').replace(/[. ]+$/g, '').trim();
	const result = clean && clean !== '.' && clean !== '..' ? clean : 'Untitled';
	return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result) ? `_${result}` : result;
}
export function destination(value: string): string {
	const path = normalizePath(value.trim());
	if (!path || path.split('/').some((x) => !x || x === '.' || x === '..' || safeName(x) !== x || x.startsWith('.'))) {
		throw new Error('Use a folder path with safe names and no hidden folders or parent steps.');
	}
	return path;
}
function direct(el: Element, tag: string): Element[] { return Array.from(el.children).filter((x) => x.tagName === tag); }
function text(el: Element): string { return el.textContent ?? ''; }
function escapeText(value: string): string { return value.replace(/([\\`*_[\]<>])/g, '\\$1'); }
function label(value: string): string { return value.replace(/[[\]|\r\n]/g, ' '); }
function htmlText(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fence(value: string, language: string): string {
	const longest = Math.max(2, ...(value.match(/`+/g) ?? []).map((x) => x.length));
	const marker = '`'.repeat(longest + 1);
	return `\n\n${marker}${language.replace(/[^a-zA-Z0-9_+-]/g, '')}\n${value}\n${marker}\n\n`;
}
function decodedPath(encoded: string): string | null {
	try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(encoded), (x) => x.charCodeAt(0))); }
	catch { return null; }
}
export function pngBytes(base64: string): Uint8Array<ArrayBuffer> {
	let bytes: Uint8Array<ArrayBuffer>;
	try { bytes = Uint8Array.from(atob(base64.replace(/\s/g, '')), (x) => x.charCodeAt(0)); }
	catch { throw new Error('An image has invalid base64 data.'); }
	const magic = [137, 80, 78, 71, 13, 10, 26, 10];
	if (!magic.every((n, i) => bytes[i] === n)) throw new Error('An embedded image is not a PNG file.');
	return bytes;
}

/** Parse XML and plan local files. Pro options are checked here as well as in the UI. */
export function planImport(xml: string, filename = 'import.ctd', options: Partial<ImportOptions> = {}, pro = false): ImportPlan {
	if (!filename.toLowerCase().endsWith('.ctd') || xml.startsWith('SQLite format 3')) throw new Error(EXPORT_NOTICE);
	if (xml.length > MAX_BYTES) throw new Error('The XML file is too large. Limit: 25 MB.');
	if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML document types and entities are not supported.');
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	if (doc.querySelector('parsererror') || doc.documentElement?.tagName !== 'cherrytree') throw new Error('The file is not valid CherryTree XML.');
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const folder = destination(opts.folder);
	const warnings = new Set<string>();
	const sourceElements = Array.from(doc.getElementsByTagName('node'));
	if (!sourceElements.length) throw new Error('The document has no nodes.');
	if (sourceElements.length > 10000) throw new Error('The document has too many nodes. Limit: 10000.');
	const elements = new Map<string, Element>();
	for (const el of sourceElements) {
		const id = el.getAttribute('unique_id');
		if (!id || elements.has(id)) throw new Error('Node ids must be present and unique.');
		elements.set(id, el);
	}
	function source(el: Element, seen = new Set<string>()): Element {
		const master = el.getAttribute('master_id');
		if (!master || master === '0') return el;
		const found = elements.get(master);
		if (!found || seen.has(master)) throw new Error('A shared node has a missing or circular source.');
		seen.add(master);
		return source(found, seen);
	}
	const byId = new Map<string, TreeNode>();
	function walk(parent: Element, base: string, depth: number): TreeNode[] {
		if (depth > 100) throw new Error('The tree is too deep. Limit: 100 levels.');
		// A note uses name.md and a parent folder uses name. Reserve both, so a folder cannot land on a sibling note.
		const used = new Set(['attachments', '_index', '_index.md']);
		return direct(parent, 'node').map((el) => {
			const content = source(el);
			const name = el.getAttribute('name') ?? content.getAttribute('name') ?? 'Untitled';
			const stem = safeName(name);
			let unique = stem;
			for (let n = 2; used.has(unique.toLowerCase()) || used.has(`${unique}.md`.toLowerCase()); n++) unique = `${stem}-${n}`;
			used.add(unique.toLowerCase()); used.add(`${unique}.md`.toLowerCase());
			const path = normalizePath(`${base}/${unique}`);
			const node: TreeNode = { id: el.getAttribute('unique_id')!, name, path, depth, element: content, children: walk(el, path, depth + 1) };
			byId.set(node.id, node);
			return node;
		});
	}
	const roots = walk(doc.documentElement, folder, 0);
	const selected = pro && opts.subtree ? byId.get(opts.subtree) : null;
	if (pro && opts.subtree && !selected) throw new Error('The selected node is not in the document.');
	const nodes: TreeNode[] = [];
	function flatten(list: TreeNode[]) { for (const n of list) { nodes.push(n); flatten(n.children); } }
	flatten(selected ? [selected] : roots);
	const included = new Set(nodes.map((x) => x.id));
	const plan: ImportPlan = { folder, nodeCount: nodes.length, noteCount: 0, imageCount: 0, tree: nodes.map(({ id, name, path, depth }) => ({ id, name, path: `${path}.md`, depth })), notes: [], attachments: [], warnings: [] };
	function rich(el: Element, value: string): string {
		if (!value) return '';
		let out = escapeText(value);
		if (el.getAttribute('family') === 'monospace') {
			const ticks = '`'.repeat(Math.max(1, ...(value.match(/`+/g) ?? []).map((s) => s.length + 1)));
			// One code span for each line. A code span cannot hold a line break.
			out = value.split('\n').map((line) => line ? `${ticks} ${line} ${ticks}` : line).join('\n');
		}
		if (el.getAttribute('underline') === 'single' || el.getAttribute('underline') === 'true') out = `<u>${htmlText(value)}</u>`;
		if (el.getAttribute('weight') === 'heavy') out = out.replace(/\S(?:[^\n]*\S)?|\S/g, (s) => `**${s}**`);
		if (el.getAttribute('style') === 'italic') out = out.replace(/\S(?:[^\n]*\S)?|\S/g, (s) => `*${s}*`);
		if (el.getAttribute('strikethrough') === 'true') out = out.replace(/\S(?:[^\n]*\S)?|\S/g, (s) => `~~${s}~~`);
		const link = el.getAttribute('link') ?? '';
		if (link.startsWith('node ')) {
			const id = link.slice(5).split(/\s/)[0]!;
			const target = byId.get(id);
			if (target && included.has(id)) out = `[[${target.path}|${label(value)}]]`;
			else warnings.add(`Node link target ${id} is outside this import or missing. Its text is kept.`);
		} else if (link.startsWith('webs ')) {
			const url = link.slice(5);
			if (/^https?:\/\/\S+$/i.test(url)) out = `[${escapeText(value)}](${url.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
			else warnings.add('A web link uses an unsupported address. Its text is kept.');
		} else if (/^(file|fold) /.test(link)) {
			const path = decodedPath(link.slice(5));
			if (path && !Array.from(path).some((ch) => ch.charCodeAt(0) < 32)) {
				const absolute = path.replace(/\\/g, '/');
				const url = 'file://' + (absolute.startsWith('/') ? '' : '/') + absolute.split('/').map((s, i) => i === 0 && /^[a-zA-Z]:$/.test(s) ? s : encodeURIComponent(s)).join('/');
				out = `[${escapeText(value)}](${url})`;
			} else warnings.add('A file link could not be decoded. Its text is kept.');
		}
		const heading = /^h([1-6])$/.exec(el.getAttribute('scale') ?? '');
		return heading ? `\n\n${'#'.repeat(Number(heading[1]))} ${out.trim()}\n\n` : out;
	}
	function object(el: Element, node: TreeNode, number: number): string {
		const value = text(el);
		if (el.tagName === 'codebox') return fence(value, el.getAttribute('syntax_highlighting') ?? '');
		if (el.tagName === 'table') {
			const rows = direct(el, 'row').map((r) => direct(r, 'cell').map((c) => escapeText(text(c)).replace(/\|/g, '\\|').replace(/\n/g, '<br>')));
			const header = rows.pop();
			if (!header?.length) return '';
			const line = (row: string[]) => `| ${header.map((_, i) => row[i] ?? '').join(' | ')} |`;
			return `\n\n${line(header)}\n${line(header.map(() => '---'))}\n${rows.map(line).join('\n')}\n\n`;
		}
		if (el.tagName === 'encoded_png') {
			// CherryTree keeps an anchor as an encoded_png element with no data. A link to the anchor opens its note.
			if (el.hasAttribute('anchor')) { warnings.add('Anchors are not kept. A link to an anchor opens its note.'); return ''; }
			if (el.getAttribute('filename') === '__ct_special.tex') { warnings.add('LaTeX sources are kept as code blocks.'); return fence(value, 'latex'); }
			try {
				pngBytes(value);
				const path = normalizePath(`${folder}/attachments/node-${safeName(node.id)}-${number}.png`);
				plan.attachments.push({ path, base64: value.replace(/\s/g, '') });
				return `![[${path}]]`;
			} catch {
				warnings.add(`An object in ${node.name} is not a PNG. It was not saved.`);
				return `[Attachment not imported: ${escapeText(el.getAttribute('filename') ?? 'invalid PNG')}]`;
			}
		}
		warnings.add(`Unsupported object ${el.tagName} in ${node.name}. Its text is kept.`);
		return escapeText(value);
	}
	for (const node of nodes) {
		const runs = direct(node.element, 'rich_text');
		const objects = Array.from(node.element.children).filter((x) => !['rich_text', 'node'].includes(x.tagName));
		let body = '';
		if (!['custom-colors', 'plain-text', ''].includes(node.element.getAttribute('prog_lang') ?? '')) {
			body = fence(runs.map(text).join(''), node.element.getAttribute('prog_lang') ?? '');
		} else {
			const parts = runs.map((el) => ({ el, points: Array.from(text(el)) }));
			const length = parts.reduce((n, p) => n + p.points.length, 0);
			function slice(from: number, to: number): string {
				let start = 0;
				return parts.map((p) => { const out = rich(p.el, p.points.slice(Math.max(0, from - start), Math.max(0, to - start)).join('')); start += p.points.length; return out; }).join('');
			}
			const positions = objects.map((el, i) => ({ el, i, offset: Number(el.getAttribute('char_offset') ?? length + i) })).sort((a, b) => a.offset - b.offset || a.i - b.i);
			let cursor = 0;
			positions.forEach(({ el, offset }, i) => {
				const pos = Number.isFinite(offset) ? Math.max(cursor, Math.min(length, offset - i)) : length;
				if (!Number.isInteger(offset) || offset < i || offset > length + i) warnings.add(`An object offset in ${node.name} was outside the text. It was clamped.`);
				body += slice(cursor, pos) + object(el, node, i + 1);
				cursor = pos;
			});
			body += slice(cursor, length);
		}
		let frontmatter = '';
		if (pro && opts.properties) {
			const props: Record<string, unknown> = {};
			const tags = (node.element.getAttribute('tags') ?? '').split(/[\s,;]+/).filter(Boolean);
			if (tags.length) props.tags = tags;
			const stamp = Number(node.element.getAttribute('ts_creation'));
			if (stamp > 0 && Number.isFinite(stamp) && stamp <= 253402300799) props.created = new Date(stamp * 1000).toISOString();
			if (Object.keys(props).length) frontmatter = `---\n${stringifyYaml(props).trimEnd()}\n---\n\n`;
		}
		plan.notes.push({ path: `${node.path}.md`, content: `${frontmatter}# ${escapeText(node.name)}\n\n${body.trim()}\n` });
		if (pro && opts.indexes && node.children.length) {
			const links = node.children.filter((x) => included.has(x.id)).map((x) => `- [[${x.path}|${label(x.name)}]]`).join('\n');
			plan.notes.push({ path: normalizePath(`${node.path}/_index.md`), content: `# ${escapeText(node.name)} index\n\n${links}\n` });
		}
	}
	plan.warnings = [...warnings];
	plan.noteCount = plan.notes.length;
	plan.imageCount = plan.attachments.length;
	return plan;
}
