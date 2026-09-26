/** ProjectService (proto/incubator/v1/projects.proto). */
import { orNull, protoFetch, query, seg } from './http';
import { mutate } from './store';

import {
  AddCategoryRequest,
  AddCategoryResponse,
  AddMediaRequest,
  AddMediaResponse,
  AddRoleRequest,
  AddRoleResponse,
  AddTaskRequest,
  AddTaskResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  GetProjectResponse,
  InviteRequest,
  ListProjectsResponse,
  RenameCategoryRequest,
  ReorderTasksRequest,
  SetParticipantRolesRequest,
  UpdateProjectRequest,
  UpdateRoleRequest,
  UpdateTaskRequest,
} from '@/gen/incubator/v1/projects';
import type { FeedProject, Page, ProjectDetail, ProjectSort } from '@/types/models';

export async function getProjectFeed(sort: ProjectSort, cursor: string | null, limit?: number): Promise<Page<FeedProject>> {
  const res = await protoFetch('GET', `/projects${query({ sort, cursor, limit })}`, { response: ListProjectsResponse });
  return { items: res.items, next_cursor: res.next_cursor ?? null };
}

export async function getProject(id: string): Promise<ProjectDetail | null> {
  const res = await orNull(protoFetch('GET', `/projects/${seg(id)}`, { response: GetProjectResponse }));
  if (!res?.project) return null;
  const { project, ...detail } = res;
  return { ...project, ...detail };
}

/** `requested`: whether the viewer has a pending request now; the call sends or withdraws it. */
export function toggleJoinRequest(projectId: string, requested: boolean) {
  return mutate(() => protoFetch(requested ? 'DELETE' : 'POST', `/projects/${seg(projectId)}/requests/me`));
}

/** Owner only. */
export function respondToJoinRequest(projectId: string, userId: string, accept: boolean) {
  const decision = accept ? 'accept' : 'decline';
  return mutate(() => protoFetch('POST', `/projects/${seg(projectId)}/requests/${seg(userId)}/${decision}`));
}

export function respondToInvite(projectId: string, accept: boolean) {
  const decision = accept ? 'accept' : 'decline';
  return mutate(() => protoFetch('POST', `/projects/${seg(projectId)}/invites/me/${decision}`));
}

/** Owner or participant. */
export function setTaskCompleted(projectId: string, taskId: string, completed: boolean) {
  return mutate(() =>
    protoFetch('PATCH', `/projects/${seg(projectId)}/tasks/${seg(taskId)}`, {
      body: [UpdateTaskRequest, UpdateTaskRequest.fromPartial({ id: projectId, task_id: taskId, completed })],
    }),
  );
}

/** With idea_id, the (own) idea is linked to the new project. */
export async function createProject(input: CreateProjectRequest): Promise<string> {
  const res = await mutate(() =>
    protoFetch('POST', '/projects', { body: [CreateProjectRequest, input], response: CreateProjectResponse }),
  );
  return res.id;
}

// ---------------------------------------------------------------- owner only (the edit screen)

/** Only the fields that are set change. */
export function updateProject(id: string, changes: Omit<Partial<UpdateProjectRequest>, 'id'>) {
  const body = UpdateProjectRequest.fromPartial({ ...changes, id });
  return mutate(() => protoFetch('PATCH', `/projects/${seg(id)}`, { body: [UpdateProjectRequest, body] }));
}

/** Ideas created from it are kept and unlinked. */
export function deleteProject(id: string) {
  return mutate(() => protoFetch('DELETE', `/projects/${seg(id)}`));
}

/** YouTube links only. */
export function addMedia(id: string, url: string) {
  return mutate(() =>
    protoFetch('POST', `/projects/${seg(id)}/media`, { body: [AddMediaRequest, { id, url }], response: AddMediaResponse }),
  );
}

export function removeMedia(id: string, mediaId: string) {
  return mutate(() => protoFetch('DELETE', `/projects/${seg(id)}/media/${seg(mediaId)}`));
}

export function addCategory(id: string, name: string) {
  return mutate(() =>
    protoFetch('POST', `/projects/${seg(id)}/categories`, {
      body: [AddCategoryRequest, { id, name }],
      response: AddCategoryResponse,
    }),
  );
}

export function renameCategory(id: string, categoryId: string, name: string) {
  return mutate(() =>
    protoFetch('PATCH', `/projects/${seg(id)}/categories/${seg(categoryId)}`, {
      body: [RenameCategoryRequest, { id, category_id: categoryId, name }],
    }),
  );
}

/** Refused (409) while it is the only category of a task. */
export function removeCategory(id: string, categoryId: string) {
  return mutate(() => protoFetch('DELETE', `/projects/${seg(id)}/categories/${seg(categoryId)}`));
}

export function addRole(id: string, name: string, categoryIds: string[]) {
  return mutate(() =>
    protoFetch('POST', `/projects/${seg(id)}/roles`, {
      body: [AddRoleRequest, { id, name, category_ids: categoryIds }],
      response: AddRoleResponse,
    }),
  );
}

/** `categoryIds`, when given, replaces the categories the role covers. */
export function updateRole(id: string, roleId: string, changes: { name?: string; categoryIds?: string[] }) {
  const body: UpdateRoleRequest = {
    id,
    role_id: roleId,
    name: changes.name,
    category_ids: changes.categoryIds ?? [],
    set_categories: changes.categoryIds !== undefined,
  };
  return mutate(() => protoFetch('PATCH', `/projects/${seg(id)}/roles/${seg(roleId)}`, { body: [UpdateRoleRequest, body] }));
}

export function removeRole(id: string, roleId: string) {
  return mutate(() => protoFetch('DELETE', `/projects/${seg(id)}/roles/${seg(roleId)}`));
}

/** Appended after the last task. `deadline` is ISO 8601. */
export function addTask(id: string, task: { description: string; deadline: string; categoryIds: string[] }) {
  const body: AddTaskRequest = { id, description: task.description, deadline: task.deadline, category_ids: task.categoryIds };
  return mutate(() =>
    protoFetch('POST', `/projects/${seg(id)}/tasks`, { body: [AddTaskRequest, body], response: AddTaskResponse }),
  );
}

/** Owner only. `categoryIds`, when given, replaces the task's categories (at least one). */
export function editTask(
  id: string,
  taskId: string,
  changes: { description?: string; deadline?: string; categoryIds?: string[] },
) {
  const body: UpdateTaskRequest = {
    id,
    task_id: taskId,
    description: changes.description,
    deadline: changes.deadline,
    category_ids: changes.categoryIds ?? [],
    set_categories: changes.categoryIds !== undefined,
  };
  return mutate(() => protoFetch('PATCH', `/projects/${seg(id)}/tasks/${seg(taskId)}`, { body: [UpdateTaskRequest, body] }));
}

export function removeTask(id: string, taskId: string) {
  return mutate(() => protoFetch('DELETE', `/projects/${seg(id)}/tasks/${seg(taskId)}`));
}

/** `taskIds`: every task of the project, in the new order. */
export function reorderTasks(id: string, taskIds: string[]) {
  return mutate(() =>
    protoFetch('PUT', `/projects/${seg(id)}/tasks/order`, { body: [ReorderTasksRequest, { id, task_ids: taskIds }] }),
  );
}

/** Replaces the participant's roles. */
export function setParticipantRoles(id: string, userId: string, roleIds: string[]) {
  return mutate(() =>
    protoFetch('PUT', `/projects/${seg(id)}/participants/${seg(userId)}/roles`, {
      body: [SetParticipantRolesRequest, { id, user_id: userId, role_ids: roleIds }],
    }),
  );
}

export function removeParticipant(id: string, userId: string) {
  return mutate(() => protoFetch('DELETE', `/projects/${seg(id)}/participants/${seg(userId)}`));
}

/** Only the owner's prospects. */
export function inviteToProject(id: string, userId: string) {
  return mutate(() => protoFetch('POST', `/projects/${seg(id)}/invites`, { body: [InviteRequest, { id, user_id: userId }] }));
}

export function cancelInvite(id: string, userId: string) {
  return mutate(() => protoFetch('DELETE', `/projects/${seg(id)}/invites/${seg(userId)}`));
}
