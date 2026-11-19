import { desc, eq } from 'drizzle-orm';
import { db } from '../client';
import { indexingJobs } from '../schema';
import type { IndexingJob } from '../schema';

function generateId(): string {
  return crypto.randomUUID();
}

export type IndexingJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export async function createIndexingJob(input: {
  projectId: string;
  jobType: string;
  commitSha?: string | null;
  totalFiles?: number;
}): Promise<IndexingJob> {
  const [job] = await db
    .insert(indexingJobs)
    .values({
      id: generateId(),
      projectId: input.projectId,
      jobType: input.jobType,
      commitSha: input.commitSha ?? null,
      totalFiles: input.totalFiles ?? 0,
      status: 'queued',
    })
    .returning();

  return job;
}

export async function updateIndexingJob(
  id: string,
  update: Partial<{
    status: IndexingJobStatus;
    totalFiles: number;
    processedFiles: number;
    failedFiles: number;
    errorMessage: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }>,
): Promise<IndexingJob | null> {
  const [job] = await db
    .update(indexingJobs)
    .set(update)
    .where(eq(indexingJobs.id, id))
    .returning();
  return job ?? null;
}

export async function getIndexingJobs(projectId: string, limit = 20): Promise<IndexingJob[]> {
  return db
    .select()
    .from(indexingJobs)
    .where(eq(indexingJobs.projectId, projectId))
    .orderBy(desc(indexingJobs.createdAt))
    .limit(limit);
}

export async function getIndexingJobById(id: string): Promise<IndexingJob | null> {
  const [job] = await db.select().from(indexingJobs).where(eq(indexingJobs.id, id)).limit(1);
  return job ?? null;
}
