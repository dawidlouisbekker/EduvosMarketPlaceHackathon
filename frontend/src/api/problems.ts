/** ProblemService (proto/incubator/v1/problems.proto). */
import { orNull, protoFetch, query, seg } from './http';
import { mutate } from './store';

import {
  CreateProblemRequest,
  CreateProblemResponse,
  GetProblemResponse,
  ListProblemsResponse,
  SearchProblemsResponse,
} from '@/gen/incubator/v1/problems';
import type { FeedIdea, FeedProblem, FeedSort, Page } from '@/types/models';

export async function getProblemFeed(sort: FeedSort, cursor: string | null, limit?: number): Promise<Page<FeedProblem>> {
  const res = await protoFetch('GET', `/problems${query({ sort, cursor, limit })}`, { response: ListProblemsResponse });
  return { items: res.items, next_cursor: res.next_cursor ?? null };
}

export async function getProblem(id: string): Promise<{ problem: FeedProblem; ideas: FeedIdea[] } | null> {
  const res = await orNull(protoFetch('GET', `/problems/${seg(id)}`, { response: GetProblemResponse }));
  return res?.problem ? { problem: res.problem, ideas: res.ideas } : null;
}

/** `voted`: whether the viewer has voted now; the call flips it. */
export function toggleProblemVote(id: string, voted: boolean) {
  return mutate(() => protoFetch(voted ? 'DELETE' : 'PUT', `/problems/${seg(id)}/vote`));
}

export async function createProblem(input: CreateProblemRequest): Promise<string> {
  const res = await mutate(() =>
    protoFetch('POST', '/problems', { body: [CreateProblemRequest, input], response: CreateProblemResponse }),
  );
  return res.id;
}

/** Used by the idea composer. */
export async function searchProblems(q: string) {
  const res = await protoFetch('GET', `/problems/search${query({ q })}`, { response: SearchProblemsResponse });
  return res.problems;
}
