'use server';

import { db } from '@/core/db/client';
import { githubConnections, githubTaskMatches, tasks } from '@/core/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { getAuthUser, requireRole } from '@/core/auth';
import { createOctokit } from './lib/octokit';
import { indexRepo } from './lib/indexer';
import { matchCommitToTasks } from './lib/commit-matcher';
import { deleteAllCodeChunks } from '@/modules/rag/code-sync';
import { updateTask } from '@/core/db/queries/tasks';
import {
  createIndexingJob,
  getIndexingJobById,
  getIndexingJobs as dbGetIndexingJobs,
  updateIndexingJob,
} from '@/core/db/queries';
import type { ApiResponse } from '@/types';

export type ConnectionStatus = {
  connected: boolean;
  hasRepo: boolean;
  githubUserLogin?: string;
  repoFullName?: string;
  defaultBranch?: string;
  lastIndexedAt?: Date | null;
};

export async function getConnectionStatus(
  projectId: string
): Promise<ApiResponse<ConnectionStatus>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, projectId, 'member');
    const [conn] = await db
      .select()
      .from(githubConnections)
      .where(eq(githubConnections.projectId, projectId));

    if (!conn) {
      return { success: true, data: { connected: false, hasRepo: false } };
    }

    return {
      success: true,
      data: {
        connected: true,
        hasRepo: !!conn.repoFullName,
        githubUserLogin: conn.githubUserLogin,
        repoFullName: conn.repoFullName ?? undefined,
        defaultBranch: conn.defaultBranch ?? undefined,
        lastIndexedAt: conn.lastIndexedAt,
      },
    };
  } catch (error) {
    console.error('Failed to get GitHub connection status:', error);
    return { success: false, error: 'Failed to load connection status' };
  }
}

export type RepoSummary = {
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string | null;
};

export async function listUserRepos(
  projectId: string
): Promise<ApiResponse<RepoSummary[]>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, projectId, 'member');
    const [conn] = await db
      .select()
      .from(githubConnections)
      .where(eq(githubConnections.projectId, projectId));
    if (!conn) return { success: false, error: 'GitHub not connected' };

    const octokit = createOctokit(conn.accessToken);
    const res = await octokit.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 100,
    });

    const repos: RepoSummary[] = res.data.map((r) => ({
      owner: r.owner.login,
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      private: r.private,
      defaultBranch: r.default_branch,
      updatedAt: r.updated_at ?? null,
    }));

    return { success: true, data: repos };
  } catch (error) {
    console.error('Failed to list repos:', error);
    return { success: false, error: 'Failed to list repositories' };
  }
}

export async function selectRepo(
  projectId: string,
  owner: string,
  name: string
): Promise<ApiResponse<{ filesIndexed: number; chunksIndexed: number; tasksAutoClosed: number }>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, projectId, 'admin');
    const [conn] = await db
      .select()
      .from(githubConnections)
      .where(eq(githubConnections.projectId, projectId));
    if (!conn) return { success: false, error: 'GitHub not connected' };

    const octokit = createOctokit(conn.accessToken);
    const repoRes = await octokit.repos.get({ owner, repo: name });
    const repo = repoRes.data;

    // Register webhook (best effort)
    let webhookId: number | null = null;
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || '';
    const appBaseUrl = process.env.APP_BASE_URL || '';
    if (webhookSecret && appBaseUrl) {
      try {
        const hookRes = await octokit.repos.createWebhook({
          owner,
          repo: name,
          config: {
            url: `${appBaseUrl}/api/webhooks/github`,
            content_type: 'json',
            secret: webhookSecret,
            insecure_ssl: '0',
          },
          events: ['push'],
          active: true,
        });
        webhookId = hookRes.data.id;
      } catch (err) {
        console.warn('[github] Failed to create webhook (continuing without):', err);
      }
    } else {
      console.warn(
        '[github] APP_BASE_URL or GITHUB_WEBHOOK_SECRET not set — skipping webhook registration'
      );
    }

    await db
      .update(githubConnections)
      .set({
        repoOwner: owner,
        repoName: name,
        repoFullName: repo.full_name,
        defaultBranch: repo.default_branch,
        webhookId,
        updatedAt: new Date(),
      })
      .where(eq(githubConnections.projectId, projectId));

    // Initial index
    const indexResult = await indexRepo(projectId);

    // Backfill: scan recent commits and AI-match
    let tasksAutoClosed = 0;
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const commits = await octokit.repos.listCommits({
        owner,
        repo: name,
        since,
        per_page: 100,
      });

      const closedSet = new Set<string>();

      for (const c of commits.data) {
        try {
          const detail = await octokit.repos.getCommit({
            owner,
            repo: name,
            ref: c.sha,
          });
          const filesChanged = (detail.data.files || []).map((f) => f.filename);
          const matched = await matchCommitToTasks({
            projectId,
            commitMessage: c.commit.message,
            filesChanged,
          });
          for (const match of matched) {
            if (match.confidence >= 0.9) {
              if (closedSet.has(match.taskId)) continue;
              await updateTask(match.taskId, { status: 'done' }, user.id);
              closedSet.add(match.taskId);
              await db.insert(githubTaskMatches).values({
                id: crypto.randomUUID(),
                projectId,
                commitSha: c.sha,
                taskId: match.taskId,
                confidence: Math.round(match.confidence * 100),
                reason: match.reason,
                status: 'auto_closed',
                reviewedAt: new Date(),
              });
            } else {
              await db.insert(githubTaskMatches).values({
                id: crypto.randomUUID(),
                projectId,
                commitSha: c.sha,
                taskId: match.taskId,
                confidence: Math.round(match.confidence * 100),
                reason: match.reason,
                status: 'pending',
              });
            }
          }
        } catch (err) {
          console.warn('[github] Backfill commit failed:', err);
        }
      }
      tasksAutoClosed = closedSet.size;
    } catch (err) {
      console.warn('[github] Commit backfill failed:', err);
    }

    return {
      success: true,
      data: {
        filesIndexed: indexResult.filesIndexed,
        chunksIndexed: indexResult.chunksIndexed,
        tasksAutoClosed,
      },
    };
  } catch (error) {
    console.error('Failed to select repo:', error);
    const message = error instanceof Error ? error.message : 'Failed to connect repository';
    return { success: false, error: message };
  }
}

export async function disconnectGithub(
  projectId: string
): Promise<ApiResponse<void>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, projectId, 'admin');
    const [conn] = await db
      .select()
      .from(githubConnections)
      .where(eq(githubConnections.projectId, projectId));
    if (!conn) return { success: true };

    if (conn.webhookId && conn.repoOwner && conn.repoName) {
      try {
        const octokit = createOctokit(conn.accessToken);
        await octokit.repos.deleteWebhook({
          owner: conn.repoOwner,
          repo: conn.repoName,
          hook_id: conn.webhookId,
        });
      } catch (err) {
        console.warn('[github] Failed to delete webhook:', err);
      }
    }

    await deleteAllCodeChunks(projectId);
    await db.delete(githubConnections).where(eq(githubConnections.projectId, projectId));

    return { success: true };
  } catch (error) {
    console.error('Failed to disconnect GitHub:', error);
    return { success: false, error: 'Failed to disconnect' };
  }
}

export async function triggerReindex(
  projectId: string
): Promise<ApiResponse<{ filesIndexed: number; chunksIndexed: number }>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, projectId, 'admin');
    const job = await createIndexingJob({ projectId, jobType: 'manual_full' });
    await updateIndexingJob(job.id, { status: 'running', startedAt: new Date() });
    let result;
    try {
      result = await indexRepo(projectId);
      await updateIndexingJob(job.id, {
        status: 'completed',
        totalFiles: result.filesIndexed + result.filesSkipped,
        processedFiles: result.filesIndexed,
        failedFiles: result.filesSkipped,
        completedAt: new Date(),
      });
    } catch (error) {
      await updateIndexingJob(job.id, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Reindex failed',
        completedAt: new Date(),
      });
      throw error;
    }
    return {
      success: true,
      data: { filesIndexed: result.filesIndexed, chunksIndexed: result.chunksIndexed },
    };
  } catch (error) {
    console.error('Failed to reindex:', error);
    const message = error instanceof Error ? error.message : 'Reindex failed';
    return { success: false, error: message };
  }
}

export async function getIndexingJobHistory(
  projectId: string,
): Promise<ApiResponse<Awaited<ReturnType<typeof dbGetIndexingJobs>>>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, projectId, 'member');
    return { success: true, data: await dbGetIndexingJobs(projectId) };
  } catch (error) {
    console.error('Failed to fetch indexing jobs:', error);
    return { success: false, error: 'Failed to fetch indexing jobs' };
  }
}

export async function retryIndexingJob(
  jobId: string,
): Promise<ApiResponse<{ filesIndexed: number; chunksIndexed: number }>> {
  try {
    const user = await getAuthUser();
    const job = await getIndexingJobById(jobId);
    if (!job) return { success: false, error: 'Indexing job not found' };
    await requireRole(user.id, job.projectId, 'admin');

    await updateIndexingJob(job.id, {
      status: 'running',
      errorMessage: null,
      startedAt: new Date(),
      completedAt: null,
    });
    try {
      const result = await indexRepo(job.projectId);
      await updateIndexingJob(job.id, {
        status: 'completed',
        totalFiles: result.filesIndexed + result.filesSkipped,
        processedFiles: result.filesIndexed,
        failedFiles: result.filesSkipped,
        completedAt: new Date(),
      });
      return { success: true, data: { filesIndexed: result.filesIndexed, chunksIndexed: result.chunksIndexed } };
    } catch (error) {
      await updateIndexingJob(job.id, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Retry failed',
        completedAt: new Date(),
      });
      throw error;
    }
  } catch (error) {
    console.error('Failed to retry indexing job:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to retry indexing job' };
  }
}

export async function getPendingTaskMatches(
  projectId: string,
): Promise<ApiResponse<Array<typeof githubTaskMatches.$inferSelect & { taskTitle: string }>>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, projectId, 'member');
    const matches = await db
      .select({ match: githubTaskMatches, taskTitle: tasks.title })
      .from(githubTaskMatches)
      .innerJoin(tasks, eq(githubTaskMatches.taskId, tasks.id))
      .where(and(eq(githubTaskMatches.projectId, projectId), eq(githubTaskMatches.status, 'pending')))
      .orderBy(desc(githubTaskMatches.createdAt));
    return { success: true, data: matches.map(({ match, taskTitle }) => ({ ...match, taskTitle })) };
  } catch (error) {
    console.error('Failed to fetch pending task matches:', error);
    return { success: false, error: 'Failed to fetch pending task matches' };
  }
}

export async function reviewTaskMatch(input: {
  projectId: string;
  matchId: string;
  decision: 'approve' | 'reject';
}): Promise<ApiResponse<void>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, input.projectId, 'admin');
    const [match] = await db
      .select()
      .from(githubTaskMatches)
      .where(
        and(
          eq(githubTaskMatches.id, input.matchId),
          eq(githubTaskMatches.projectId, input.projectId),
          eq(githubTaskMatches.status, 'pending'),
        ),
      );
    if (!match) return { success: false, error: 'Pending match not found' };

    if (input.decision === 'approve') {
      await updateTask(match.taskId, { status: 'done' }, user.id);
    }
    await db
      .update(githubTaskMatches)
      .set({
        status: input.decision === 'approve' ? 'approved' : 'rejected',
        reviewedAt: new Date(),
      })
      .where(eq(githubTaskMatches.id, input.matchId));
    return { success: true };
  } catch (error) {
    console.error('Failed to review task match:', error);
    return { success: false, error: 'Failed to review task match' };
  }
}

export type FileTreeNode = {
  path: string;
  type: 'tree' | 'blob';
  size?: number;
};

export async function getFileTree(
  projectId: string
): Promise<ApiResponse<FileTreeNode[]>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, projectId, 'member');
    const [conn] = await db
      .select()
      .from(githubConnections)
      .where(eq(githubConnections.projectId, projectId));
    if (!conn || !conn.repoOwner || !conn.repoName) {
      return { success: false, error: 'No repository connected' };
    }

    const octokit = createOctokit(conn.accessToken);
    const branch = conn.defaultBranch || 'main';
    const branchInfo = await octokit.repos.getBranch({
      owner: conn.repoOwner,
      repo: conn.repoName,
      branch,
    });
    const tree = await octokit.git.getTree({
      owner: conn.repoOwner,
      repo: conn.repoName,
      tree_sha: branchInfo.data.commit.commit.tree.sha,
      recursive: 'true',
    });

    const nodes: FileTreeNode[] = tree.data.tree
      .filter((t) => t.path && (t.type === 'tree' || t.type === 'blob'))
      .map((t) => ({
        path: t.path!,
        type: t.type as 'tree' | 'blob',
        size: t.size,
      }));

    return { success: true, data: nodes };
  } catch (error) {
    console.error('Failed to get file tree:', error);
    return { success: false, error: 'Failed to load file tree' };
  }
}

export async function getFileContent(
  projectId: string,
  filepath: string
): Promise<ApiResponse<{ content: string; language: string }>> {
  try {
    const user = await getAuthUser();
    await requireRole(user.id, projectId, 'member');
    const [conn] = await db
      .select()
      .from(githubConnections)
      .where(eq(githubConnections.projectId, projectId));
    if (!conn || !conn.repoOwner || !conn.repoName) {
      return { success: false, error: 'No repository connected' };
    }

    const octokit = createOctokit(conn.accessToken);
    const res = await octokit.repos.getContent({
      owner: conn.repoOwner,
      repo: conn.repoName,
      path: filepath,
      ref: conn.defaultBranch || undefined,
    });
    if (Array.isArray(res.data) || res.data.type !== 'file') {
      return { success: false, error: 'Not a file' };
    }
    const content = Buffer.from(res.data.content, 'base64').toString('utf-8');
    const { detectLanguage } = await import('./lib/file-filter');
    return { success: true, data: { content, language: detectLanguage(filepath) } };
  } catch (error) {
    console.error('Failed to get file content:', error);
    return { success: false, error: 'Failed to load file' };
  }
}
