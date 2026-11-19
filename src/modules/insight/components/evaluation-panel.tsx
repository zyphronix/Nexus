'use client';

import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getEvaluationHistory } from '../evaluation-actions';
import type { AiEvaluation } from '@/core/db/schema';

export function EvaluationPanel({ projectId }: { projectId: string }) {
  const [evaluations, setEvaluations] = useState<AiEvaluation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getEvaluationHistory(projectId).then((result) => {
      if (!mounted) return;
      if (result.success && result.data) setEvaluations(result.data);
      setIsLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [projectId]);

  if (isLoading) {
    return <Skeleton className="h-36 w-full" />;
  }

  const scored = evaluations.filter(
    (evaluation) => evaluation.groundingScore !== null || evaluation.relevanceScore !== null,
  );
  const average = (values: Array<number | null>) => {
    const present = values.filter((value): value is number => value !== null);
    return present.length === 0
      ? '—'
      : `${(present.reduce((sum, value) => sum + value, 0) / present.length).toFixed(1)}%`;
  };
  const accepted = evaluations.filter((evaluation) => evaluation.accepted === true).length;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-5 w-5 text-primary" />
        <div>
          <h2 className="font-semibold">AI Evaluation</h2>
          <p className="text-xs text-muted-foreground">
            Human-labelled quality signals for chat, planning, and matching.
          </p>
        </div>
      </div>
      {evaluations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No evaluation samples recorded yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">Samples</p><p className="font-semibold">{evaluations.length}</p></div>
          <div><p className="text-xs text-muted-foreground">Grounding</p><p className="font-semibold">{average(scored.map((evaluation) => evaluation.groundingScore))}</p></div>
          <div><p className="text-xs text-muted-foreground">Relevance</p><p className="font-semibold">{average(scored.map((evaluation) => evaluation.relevanceScore))}</p></div>
          <div><p className="text-xs text-muted-foreground">Accepted</p><p className="font-semibold">{accepted}/{evaluations.filter((evaluation) => evaluation.accepted !== null).length || 0}</p></div>
        </div>
      )}
    </Card>
  );
}
