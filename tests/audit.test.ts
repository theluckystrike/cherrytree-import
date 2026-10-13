import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planImport, safeName } from '../src/convert';

const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><cherrytree>${body}</cherrytree>`;
// Obsidian normalizePath changes these two spaces to a normal space. The test mock does not.
const vaultPath = (path: string) => path.replace(/[\u00A0\u202F]/g, ' ');
describe('audit regressions', () => {
	it('does not show an anchor as a failed attachment', () => {
		const plan = planImport(doc('<node unique_id="1" name="N"><rich_text>ab</rich_text><encoded_png char_offset="1" anchor="here"/></node>'));
		expect(plan.notes[0]!.content).toBe('# N\n\nab\n');
		expect(plan.warnings.join(' ')).not.toContain('not a PNG');
	});
	it('does not show the anchor of the upstream fixture as a failed attachment', () => {
		const plan = planImport(readFileSync('tests/fixtures/cherry-fixture.ctd', 'utf8'));
		expect(plan.notes.map((n) => n.content).join('\n')).not.toContain('invalid PNG');
	});
	it('gives distinct vault paths to names that differ only by a no-break space', () => {
		expect(safeName('a\u00A0b')).toBe('a b');
		const plan = planImport(doc('<node unique_id="1" name="a b"/><node unique_id="2" name="a&#160;b"/><node unique_id="3" name="a&#8239;b"/>'));
		expect(new Set(plan.notes.map((n) => vaultPath(n.path).toLowerCase())).size).toBe(3);
	});
	it('keeps the drive letter of a Windows file link', () => {
		const encoded = btoa('C:\\Users\\a b.txt');
		const plan = planImport(doc(`<node unique_id="1" name="N"><rich_text link="file ${encoded}">doc</rich_text></node>`));
		expect(plan.notes[0]!.content).toContain('[doc](file:///C:/Users/a%20b.txt)');
	});
});
