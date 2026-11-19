'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Github, RefreshCw, Unlink, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  getConnectionStatus,
  disconnectGithub,
  triggerReindex,
  getIndexingJobHistory,
  getPendingTaskMatches,
  reviewTaskMatch,
  retryIndexingJob,
  type ConnectionStatus,
} from '../actions';
import type { GithubTaskMatch, IndexingJob } from '@/core/db/schema';
import { RepoPicker } from './repo-picker';

interface Props {
  projectId: string;
}

export function GithubSettingsSection({ projectId }: Props) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [jobs, setJobs] = useState<IndexingJob[]>([]);
  const [pendingMatches, setPendingMatches] = useState<Array<GithubTaskMatch & { taskTitle: string }>>([]);

  const refresh = useCallback(async () => {
    const [res, jobsResult, matchesResult] = await Promise.all([
      getConnectionStatus(projectId),
      getIndexingJobHistory(projectId),
      getPendingTaskMatches(projectId),
    ]);
    if (res.success && res.data) setStatus(res.data);
    if (jobsResult.success && jobsResult.data) setJobs(jobsResult.data);
    if (matchesResult.success && matchesResult.data) setPendingMatches(matchesResult.data);
    setIsLoading(false);
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleConnect() {
    window.location.href = `/api/auth/github/start?projectId=${projectId}`;
  }

  function handleDisconnect() {
    if (!confirm('Disconnect GitHub? This will remove all indexed code chunks for this project.')) return;
    startTransition(async () => {
      const res = await disconnectGithub(projectId);
      if (res.success) {
        toast.success('GitHub disconnected');
        refresh();
      } else {
        toast.error(res.error || 'Failed to disconnect');
      }
    });
  }

  function handleReindex() {
    startTransition(async () => {
      toast.info('Reindexing repository...');
      const res = await triggerReindex(projectId);
      if (res.success && res.data) {
        toast.success(`Reindexed ${res.data.filesIndexed} files (${res.data.chunksIndexed} chunks)`);
        refresh();
      } else {
        toast.error(res.error || 'Reindex failed');
      }
    });
  }

  function handleReview(matchId: string, decision: 'approve' | 'reject') {
    startTransition(async () => {
      const result = await reviewTaskMatch({ projectId, matchId, decision });
      if (result.success) {
        toast.success(decision === 'approve' ? 'Task match approved' : 'Task match rejected');
        refresh();
      } else {
        toast.error(result.error || 'Failed to review task match');
      }
    });
  }

  function handleRetry(jobId: string) {
    startTransition(async () => {
      const result = await retryIndexingJob(jobId);
      if (result.success) {
        toast.success('Indexing retry completed');
        refresh();
      } else {
        toast.error(result.error || 'Indexing retry failed');
      }
    });
  }

  if (isLoading) {
    return (
      <Card className="p-6">
        <Skeleton className="h-6 w-48 mb-4" />
        <Skeleton className="h-4 w-full" />
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/12 p-2 text-primary">
          <Github className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">GitHub Integration</h2>
          <p className="text-sm text-muted-foreground">
            Connect a repository so the chat and agent can use your code as context, and commits can auto-close tasks.
          </p>
        </div>
      </div>

      {!status?.connected && (
        <div>
          <Button onClick={handleConnect} className="gap-2">
            <Github className="h-4 w-4" />
            Connect GitHub
          </Button>
        </div>
      )}

      {status?.connected && !status.hasRepo && (
        <div className="space-y-4">
          <div className="text-sm">
            Connected as <span className="font-medium">@{status.githubUserLogin}</span>. Pick a repository to index:
          </div>
          <RepoPicker projectId={projectId} onSelected={refresh} />
          <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={isPending}>
            Disconnect
          </Button>
        </div>
      )}

      {status?.connected && status.hasRepo && (
        <div className="space-y-3">
          <div className="text-sm space-y-1">
            <div>
              Repository: <span className="font-mono">{status.repoFullName}</span>
            </div>
            <div className="text-muted-foreground">
              Branch: {status.defaultBranch} · Connected as @{status.githubUserLogin}
            </div>
            {status.lastIndexedAt && (
              <div className="text-muted-foreground">
                Last indexed: {new Date(status.lastIndexedAt).toLocaleString()}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleReindex} disabled={isPending} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
              Reindex
            </Button>
            <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={isPending} className="gap-2">
              <Unlink className="h-4 w-4" />
              Disconnect
            </Button>
          </div>

          {pendingMatches.length > 0 && (
            <div className="space-y-3 border-t pt-4">
              <div>
                <h3 className="font-medium">Pending task matches</h3>
                <p className="text-xs text-muted-foreground">
                  Medium-confidence matches require an admin decision before closing a task.
                </p>
              </div>
              {pendingMatches.map((match) => (
                <div key={match.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs">Commit {match.commitSha.slice(0, 8)}</p>
                      <p className="mt-1">Task: {match.taskTitle}</p>
                      <p className="mt-1 text-muted-foreground">{match.reason || 'No explanation provided.'}</p>
                    </div>
                    <span className="shrink-0 text-xs font-medium">{match.confidence}%</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => handleReview(match.id, 'approve')} disabled={isPending}>
                      <Check className="mr-1 h-4 w-4" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleReview(match.id, 'reject')} disabled={isPending}>
                      <X className="mr-1 h-4 w-4" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {jobs.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <h3 className="font-medium">Indexing history</h3>
              {jobs.slice(0, 5).map((job) => (
                <div key={job.id} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{job.jobType.replace('_', ' ')}</span>
                  <span>
                    {job.status} · {job.processedFiles}/{job.totalFiles || 0} files
                    {job.status === 'failed' && (
                      <Button variant="link" size="sm" className="h-auto p-0 pl-2 text-xs" onClick={() => handleRetry(job.id)}>
                        Retry
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
