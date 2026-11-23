import { describe, expect, it } from 'vitest';

import { createQueueJobId } from './redis';

describe('BullMQ custom job IDs', () => {
  it('does not contain colon separators', () => {
    const id = createQueueJobId('architect', 'project-id', 'user-id', 'generation-id');
    expect(id).not.toContain(':');
  });

  it('creates distinct chat and Architect IDs', () => {
    expect(createQueueJobId('chat', 'project', 'user', '1')).toMatch(/^chat-/);
    expect(createQueueJobId('architect', 'project', 'user', '2')).toMatch(/^architect-/);
  });

  it('does not add a prefix twice when an AI job ID is already namespaced', () => {
    const namespaced = createQueueJobId('architect-project-user-generation-id');
    expect(namespaced).toBe('architect-project-user-generation-id');
  });
});
