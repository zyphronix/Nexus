import { describe, expect, it } from 'vitest';
import { shouldIndexFile } from './file-filter';

describe('shouldIndexFile', () => {
  it('accepts supported source files', () => {
    expect(shouldIndexFile('src/app.ts', 1024).include).toBe(true);
  });

  it('rejects generated directories, lockfiles, unsupported files, and oversized data', () => {
    expect(shouldIndexFile('node_modules/pkg/index.js', 1024).include).toBe(false);
    expect(shouldIndexFile('package-lock.json', 1024).include).toBe(false);
    expect(shouldIndexFile('image.png', 1024).include).toBe(false);
    expect(shouldIndexFile('data.json', 60 * 1024).include).toBe(false);
  });
});
