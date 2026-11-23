import { getQdrantClient, ensureCodeCollection, CODE_COLLECTION_NAME } from './qdrant';
import { generateEmbedding } from '@/core/ai/embedding';

export type RetrievedCodeChunk = {
  filepath: string;
  text: string;
  language: string;
  score: number;
};

export async function retrieveRelevantCodeChunks(
  query: string,
  filter: { projectId: string },
  topK = 6
): Promise<RetrievedCodeChunk[]> {
  await ensureCodeCollection();
  const client = getQdrantClient();
  const queryVector = await generateEmbedding(query);

  const response = await client.query(CODE_COLLECTION_NAME, {
    query: queryVector,
    limit: topK,
    filter: {
      must: [{ key: 'project_id', match: { value: filter.projectId } }],
    },
    with_payload: true,
    score_threshold: 0.3,
  });

  return response.points.map((r) => ({
    filepath: (r.payload?.filepath as string) ?? '',
    text: (r.payload?.text as string) ?? '',
    language: (r.payload?.language as string) ?? '',
    score: r.score,
  }));
}
