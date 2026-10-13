import { describe, expect, it } from 'vitest';
import { planImport, safeName } from '../src/convert';

const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><cherrytree>${body}</cherrytree>`;
describe('review regressions', () => {
	it('does not plan a folder at the path of a sibling note', () => {
		const plan = planImport(doc('<node unique_id="1" name="Foo"><rich_text>a</rich_text></node><node unique_id="2" name="Foo.md"><rich_text>b</rich_text><node unique_id="3" name="Kid"><rich_text>c</rich_text></node></node>'));
		const files = new Set(plan.notes.map((n) => n.path.toLowerCase()));
		const folders = plan.notes.map((n) => n.path.slice(0, n.path.lastIndexOf('/')).toLowerCase());
		for (const f of folders) expect(files.has(f)).toBe(false);
	});
	it('does not plan a folder at the path of a sibling note in the reverse order', () => {
		const plan = planImport(doc('<node unique_id="2" name="Foo.md"><rich_text>b</rich_text><node unique_id="3" name="Kid"><rich_text>c</rich_text></node></node><node unique_id="1" name="Foo"><rich_text>a</rich_text></node>'));
		const files = new Set(plan.notes.map((n) => n.path.toLowerCase()));
		for (const n of plan.notes) expect(files.has(n.path.slice(0, n.path.lastIndexOf('/')).toLowerCase())).toBe(false);
	});
	it('does not cut a surrogate pair or leave a trailing dot when it shortens a name', () => {
		const name = safeName('a'.repeat(99) + '😀tail');
		expect(name.isWellFormed()).toBe(true);
		expect(safeName('b'.repeat(99) + '. x')).not.toMatch(/[. ]$/);
	});
	it('keeps the line breaks of a monospace run', () => {
		const plan = planImport(doc('<node unique_id="1" name="N"><rich_text family="monospace">line one\nline two</rich_text></node>'));
		expect(plan.notes[0]!.content).toContain('line one');
		expect(plan.notes[0]!.content).toMatch(/line one[^\n]*\n[^\n]*line two/);
	});
});

describe('README claims', () => {
	it('makes headings for scales h1 to h6', () => {
		for (let n = 1; n <= 6; n++) {
			const plan = planImport(doc(`<node unique_id="1" name="N"><rich_text scale="h${n}">Title</rich_text></node>`));
			expect(plan.notes[0]!.content).toContain(`\n${'#'.repeat(n)} Title\n`);
		}
	});
	it('refuses more than 10000 nodes and accepts 10000', () => {
		const nodes = (count: number) => Array.from({ length: count }, (_, i) => `<node unique_id="${i + 1}" name="n${i}"/>`).join('');
		expect(planImport(doc(nodes(10000))).notes).toHaveLength(10000);
		expect(() => planImport(doc(nodes(10001)))).toThrow('Limit: 10000');
	});
	it('refuses more than 100 tree levels', () => {
		const nest = (levels: number) => Array.from({ length: levels }, (_, i) => `<node unique_id="${i + 1}" name="n">`).join('') + '</node>'.repeat(levels);
		expect(planImport(doc(nest(100))).notes).toHaveLength(100);
		expect(() => planImport(doc(nest(101)))).toThrow('Limit: 100 levels');
	});
	it('refuses duplicate ids and an empty node tree', () => {
		expect(() => planImport(doc('<node unique_id="1" name="a"/><node unique_id="1" name="b"/>'))).toThrow('unique');
		expect(() => planImport(doc(''))).toThrow('no nodes');
	});
	it('writes no empty property block for a node without tags or a date', () => {
		const plan = planImport(doc('<node unique_id="1" name="N"><rich_text>x</rich_text></node>'), 'a.ctd', { properties: true }, true);
		expect(plan.notes[0]!.content.startsWith('# N')).toBe(true);
	});
});
