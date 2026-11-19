import { describe, expect, it } from 'vitest';
import { chunkFileContent } from './chunker';

describe('chunkFileContent', () => {
  it('creates line-ranged chunks with overlap for long files', () => {
    const content = Array.from({ length: 280 }, (_, index) => `line-${index + 1}`).join('\n');
    const chunks = chunkFileContent('src/example.ts', content);

    expect(chunks.length).toBe(2);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(150);
    expect(chunks[1].startLine).toBe(131);
    expect(chunks[1].text).toContain('// File: src/example.ts (lines 131-280)');
  });
});
