/** IdeaService (proto/incubator/v1/ideas.proto): ideas, sharing and comments. */
import { orNull, protoFetch, query, seg } from './http';
import { mutate } from './store';

import {
  CreateCommentRequest,
  CreateIdeaRequest,
  CreateIdeaResponse,
  GetIdeaResponse,
  ListCommentsResponse,
  ListCommentTypesResponse,
  ListIdeasResponse,
  SetIdeaSharesRequest,
  VoteCommentRequest,
} from '@/gen/incubator/v1/ideas';
import type { CommentType, FeedIdea, FeedSort, IdeaComment, IdeaDetail, Page } from '@/types/models';

export async function getIdeaFeed(sort: FeedSort, cursor: string | null, limit?: number): Promise<Page<FeedIdea>> {
  const res = await protoFetch('GET', `/ideas${query({ sort, cursor, limit })}`, { response: ListIdeasResponse });
  return { items: res.items, next_cursor: res.next_cursor ?? null };
}

export async function getIdea(id: string): Promise<IdeaDetail | null> {
  const res = await orNull(protoFetch('GET', `/ideas/${seg(id)}`, { response: GetIdeaResponse }));
  return res?.idea ? { ...res.idea, is_owner: res.is_owner, shared_with: res.shared_with } : null;
}

/** `voted`: whether the viewer has voted now; the call flips it. */
export function toggleIdeaVote(id: string, voted: boolean) {
  return mutate(() => protoFetch(voted ? 'DELETE' : 'PUT', `/ideas/${seg(id)}/vote`));
}

export async function createIdea(input: CreateIdeaRequest): Promise<string> {
  const res = await mutate(() =>
    protoFetch('POST', '/ideas', { body: [CreateIdeaRequest, input], response: CreateIdeaResponse }),
  );
  return res.id;
}

/** Owner only. Replaces the list of prospects the private idea is shared with. */
export function setIdeaShares(id: string, userIds: string[]) {
  return mutate(() =>
    protoFetch('PUT', `/ideas/${seg(id)}/shares`, { body: [SetIdeaSharesRequest, { id, user_ids: userIds }] }),
  );
}

export async function getCommentTypes(): Promise<CommentType[]> {
  const res = await protoFetch('GET', '/comment-types', { response: ListCommentTypesResponse });
  return res.comment_types;
}

/** Flat list; the client builds the tree from parent_id. */
export async function getComments(ideaId: string): Promise<IdeaComment[]> {
  const res = await protoFetch('GET', `/ideas/${seg(ideaId)}/comments`, { response: ListCommentsResponse });
  return res.comments;
}

export function addComment(ideaId: string, parentId: string | null, commentType: string, content: string) {
  const body: CreateCommentRequest = { idea_id: ideaId, parent_id: parentId ?? undefined, comment_type: commentType, content };
  return mutate(() => protoFetch('POST', `/ideas/${seg(ideaId)}/comments`, { body: [CreateCommentRequest, body] }));
}

export function voteComment(commentId: string, value: -1 | 0 | 1) {
  return mutate(() =>
    protoFetch('PUT', `/comments/${seg(commentId)}/vote`, {
      body: [VoteCommentRequest, { comment_id: commentId, value }],
    }),
  );
}

/** Soft delete (author only). */
export function deleteComment(commentId: string) {
  return mutate(() => protoFetch('DELETE', `/comments/${seg(commentId)}`));
}
