/** UserService (proto/incubator/v1/users.proto): profiles, prospects and skill vouches. */
import { orNull, protoFetch, seg } from './http';
import { mutate } from './store';

import {
  GetProfileResponse,
  ListProspectsResponse,
  ListUserIdeasResponse,
  ListUserProblemsResponse,
  ListUserProjectsResponse,
  UpdateMeRequest,
  VouchSkillRequest,
} from '@/gen/incubator/v1/users';
import type { Profile } from '@/types/models';

export async function getProfile(userId: string): Promise<Profile | null> {
  const res = await orNull(protoFetch('GET', `/users/${seg(userId)}`, { response: GetProfileResponse }));
  if (!res?.user) return null;
  const { user, counts, ...rest } = res;
  return { ...user, ...rest, counts: counts ?? { problems: 0, ideas: 0, projects: 0 } };
}

export async function getUserProblems(userId: string) {
  const res = await protoFetch('GET', `/users/${seg(userId)}/problems`, { response: ListUserProblemsResponse });
  return res.problems;
}

/** Private ones only if the viewer may see them. */
export async function getUserIdeas(userId: string) {
  const res = await protoFetch('GET', `/users/${seg(userId)}/ideas`, { response: ListUserIdeasResponse });
  return res.ideas;
}

/** Owned and participating. */
export async function getUserProjects(userId: string) {
  const res = await protoFetch('GET', `/users/${seg(userId)}/projects`, { response: ListUserProjectsResponse });
  return res.projects;
}

/** The role must be one of the profile's vouchable_roles. */
export function vouchSkill(userId: string, skill: string, projectId: string, roleId: string) {
  return mutate(() =>
    protoFetch('PUT', `/users/${seg(userId)}/skills/${seg(skill)}/vouch`, {
      body: [VouchSkillRequest, { user_id: userId, skill, project_id: projectId, role_id: roleId }],
    }),
  );
}

export function removeVouch(userId: string, skill: string) {
  return mutate(() => protoFetch('DELETE', `/users/${seg(userId)}/skills/${seg(skill)}/vouch`));
}

/** Users the viewer marked as prospects (the only people a private idea can be shared with). */
export async function getMyProspects() {
  const res = await protoFetch('GET', '/prospects', { response: ListProspectsResponse });
  return res.prospects;
}

/** `isProspect`: whether they are a prospect now. Removing one also revokes their access to the viewer's private ideas. */
export function toggleProspect(userId: string, isProspect: boolean) {
  return mutate(() => protoFetch(isProspect ? 'DELETE' : 'PUT', `/prospects/${seg(userId)}`));
}

export function updateBio(bio: string) {
  return mutate(() => protoFetch('PATCH', '/me', { body: [UpdateMeRequest, { bio: bio.slice(0, 256) }] }));
}
