import { describe, expect, it } from 'vitest';
import { calculateCriticalPath, wouldCreateCycle } from './dependency-graph';

describe('dependency graph algorithms', () => {
  it('detects an edge that would create a cycle', () => {
    const edges = [
      { taskId: 'b', dependsOnTaskId: 'a' },
      { taskId: 'c', dependsOnTaskId: 'b' },
    ];

    expect(wouldCreateCycle('a', 'c', edges)).toBe(true);
    expect(wouldCreateCycle('d', 'c', edges)).toBe(false);
  });

  it('finds the highest story-point unfinished dependency chain', () => {
    const result = calculateCriticalPath(
      [
        { id: 'a', storyPoints: 3, status: 'todo' },
        { id: 'b', storyPoints: 5, status: 'todo' },
        { id: 'c', storyPoints: 8, status: 'todo' },
        { id: 'done', storyPoints: 13, status: 'done' },
      ],
      [
        { taskId: 'b', dependsOnTaskId: 'a' },
        { taskId: 'c', dependsOnTaskId: 'b' },
      ],
    );

    expect(result).toEqual({ taskIds: ['a', 'b', 'c'], totalStoryPoints: 16 });
  });
});
