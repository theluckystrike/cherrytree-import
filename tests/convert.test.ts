import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import vectors from './vectors/cherrytree-import.json';
import { DEFAULT_OPTIONS, planImport, safeName, type ImportOptions } from '../src/convert';

for (const vector of vectors.cases) {
	it(vector.name, () => {
		const [xml, filename, options, pro] = vector.args as [string, string, Partial<ImportOptions>, boolean];
		if ('error' in vector.expected) expect(() => planImport(xml, filename, options, pro)).toThrow(vector.expected.error);
		else expect(planImport(xml, filename, options, pro)).toMatchObject(vector.expected);
	});
}
const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8');
describe('source fixture regressions', () => {
	it('keeps the seven-node parent path and four PNG files in the local fixture', () => {
		const plan = planImport(fixture('cherry-small-fixture.ctd'));
		expect(plan.notes).toHaveLength(7);
		expect(plan.tree.find((n) => n.name === 'bbb')?.path).toBe('CherryTree import/aaa/bbb.md');
		expect(plan.attachments).toHaveLength(4);
		expect(plan.notes.find((n) => n.path.endsWith('/Images.md'))?.content.match(/!\[\[/g)).toHaveLength(4);
	});
	it('imports ten upstream nodes and expands the shared node under a distinct filename', () => {
		const plan = planImport(fixture('cherry-fixture.ctd'));
		expect(plan.notes).toHaveLength(10);
		expect(plan.notes[0]?.path).toBe('CherryTree import/йцукенгшщз.md');
		expect(plan.tree.find((n) => n.id === '10')?.name).toBe('e');
		expect(new Set(plan.notes.map((n) => n.path)).size).toBe(10);
	});
	it('imports the unmodified seven-node upstream fixture and reports non-PNG objects', () => {
		const plan = planImport(fixture('cherry-upstream.ctd'));
		expect(plan.notes).toHaveLength(7);
		expect(plan.attachments).toHaveLength(1);
		expect(plan.warnings).toContain('LaTeX sources are kept as code blocks.');
		expect(plan.notes.find((n) => n.path.endsWith('/bbb.md'))?.content).toContain('| header |');
	});
	it('creates an index with exact links to child notes', () => {
		const plan = planImport(fixture('cherry-small-fixture.ctd'), 'sample.ctd', { ...DEFAULT_OPTIONS, indexes: true }, true);
		const index = plan.notes.find((n) => n.path.endsWith('/aaa/_index.md'));
		expect(index?.content).toBe('# aaa index\n\n- [[CherryTree import/aaa/bbb|bbb]]\n- [[CherryTree import/aaa/Formatting|Formatting]]\n');
	});
	it('handles reserved filenames and forbidden path characters', () => {
		expect(safeName('a/b:c')).toBe('a-b-c');
		expect(safeName('CON')).toBe('_CON');
		expect(safeName('..')).toBe('Untitled');
	});
});
