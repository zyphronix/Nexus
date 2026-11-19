'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, GitBranch, RefreshCw } from 'lucide-react';
import type { Task } from '@/core/db/schema';
import {
  getDependencies,
  getProjectCriticalPath,
} from '../dependency-actions';
import type { TaskDependencyWithTasks } from '@/core/db/queries/dependencies';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface DependencyGraphProps {
  projectId: string;
  tasks: Task[];
}

type GraphNode = Pick<Task, 'id' | 'title' | 'status' | 'storyPoints'>;

function statusLabel(status: Task['status']): string {
  return status.replace('_', ' ');
}

export function DependencyGraph({ projectId, tasks }: DependencyGraphProps) {
  const [dependencies, setDependencies] = useState<TaskDependencyWithTasks[]>([]);
  const [criticalPath, setCriticalPath] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(true);

  const loadGraph = useCallback(async () => {
    setIsLoading(true);
    const [dependencyResult, criticalPathResult] = await Promise.all([
      getDependencies(projectId),
      getProjectCriticalPath(projectId),
    ]);
    if (dependencyResult.success && dependencyResult.data) {
      setDependencies(dependencyResult.data);
    }
    if (criticalPathResult.success && criticalPathResult.data) {
      setCriticalPath(criticalPathResult.data.taskIds);
    }
    setIsLoading(false);
  }, [projectId]);

  useEffect(() => {
    void loadGraph();
    const handleDependenciesChanged = () => void loadGraph();
    window.addEventListener('task-dependencies-changed', handleDependenciesChanged);

    return () => {
      window.removeEventListener('task-dependencies-changed', handleDependenciesChanged);
    };
  }, [loadGraph]);

  const nodesByLevel = useMemo(() => {
    const nodes = new Map<string, GraphNode>();
    for (const dependency of dependencies) {
      nodes.set(dependency.task.id, dependency.task);
      nodes.set(dependency.dependsOnTask.id, dependency.dependsOnTask);
    }

    const levels = new Map<string, number>();
    const orderedDependencies = [...dependencies].sort((a, b) =>
      a.task.id.localeCompare(b.task.id),
    );
    for (const dependency of orderedDependencies) {
      const blockerLevel = levels.get(dependency.dependsOnTask.id) ?? 0;
      levels.set(
        dependency.task.id,
        Math.max(levels.get(dependency.task.id) ?? 0, blockerLevel + 1),
      );
    }

    for (const task of tasks) {
      if (nodes.has(task.id) && !levels.has(task.id)) levels.set(task.id, 0);
    }

    const grouped = new Map<number, GraphNode[]>();
    for (const [id, task] of nodes) {
      const level = levels.get(id) ?? 0;
      grouped.set(level, [...(grouped.get(level) ?? []), task]);
    }
    return [...grouped.entries()].sort(([left], [right]) => left - right);
  }, [dependencies, tasks]);

  if (dependencies.length === 0 && !isLoading) return null;

  return (
    <section className="mx-4 mt-4 rounded-2xl border border-primary/15 bg-background/55 p-4 shadow-sm md:mx-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold">Task Dependency Graph</h2>
            <p className="text-xs text-muted-foreground">
              Follow blockers from left to right to prioritize delivery.
            </p>
          </div>
          {criticalPath.length > 0 && (
            <Badge variant="secondary">Critical path: {criticalPath.length} tasks</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => void loadGraph()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="sr-only">Refresh dependency graph</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsOpen((open) => !open)}>
            {isOpen ? 'Hide graph' : 'Show graph'}
          </Button>
        </div>
      </div>

      {isOpen && (
        <div className="mt-4 overflow-x-auto pb-2">
          <div className="flex min-w-max items-stretch gap-3">
            {nodesByLevel.map(([level, nodes], levelIndex) => (
              <div key={level} className="flex items-center gap-3">
                <div className="w-56 space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {level === 0 ? 'Starting work' : `After level ${level}`}
                  </p>
                  {nodes.map((node) => {
                    const isCritical = criticalPath.includes(node.id);
                    return (
                      <div
                        key={node.id}
                        className={`rounded-xl border p-3 ${
                          isCritical
                            ? 'border-amber-400 bg-amber-50/80 dark:bg-amber-950/30'
                            : 'border-border/70 bg-background/80'
                        }`}
                      >
                        <p className="line-clamp-2 text-sm font-medium">{node.title}</p>
                        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{statusLabel(node.status)}</span>
                          <span>{node.storyPoints ?? 1} pts</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {levelIndex < nodesByLevel.length - 1 && (
                  <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
