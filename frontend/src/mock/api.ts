/**
 * In-memory stand-in for the backend. Each function is shaped like the REST call that will
 * replace it (see the comment above each one), and applies the same visibility rules as the schema.
 * Mutations call bump() so mounted queries refetch (see hooks/use-query.ts).
 */
import * as db from './seed';
import type {
  CommentType,
  FeedIdea,
  FeedProblem,
  FeedProject,
  FeedSort,
  IdeaComment,
  IdeaDetail,
  Notification,
  Page,
  Profile,
  ProjectDetail,
  ProjectSort,
  UserSummary,
  ViewerRelation,
  Visibility,
  VouchableRole,
} from '@/types/models';

const me = db.ME;
const PAGE_SIZE = 8;
const LATENCY_MS = 120;

// ---------------------------------------------------------------- change notification

let version = 0;
const listeners = new Set<() => void>();
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getVersion = () => version;
function bump() {
  version++;
  listeners.forEach((l) => l());
}

const sleep = () => new Promise((r) => setTimeout(r, LATENCY_MS));
const nowIso = () => new Date().toISOString();
let seq = 1000;
const newId = (prefix: string) => `${prefix}${seq++}`;

function paginate<T>(rows: T[], cursor: string | null, limit = PAGE_SIZE): Page<T> {
  const start = cursor ? Number(cursor) : 0;
  const items = rows.slice(start, start + limit);
  const next = start + limit < rows.length ? String(start + limit) : null;
  return { items, next_cursor: next };
}

const byNewest = <T extends { created_at: string }>(a: T, b: T) => b.created_at.localeCompare(a.created_at);

// ---------------------------------------------------------------- builders

function summary(userId: string): UserSummary {
  const u = db.users.find((x) => x.id === userId)!;
  return {
    id: u.id,
    display_name: u.display_name,
    avatar_url: u.avatar_url,
    bio: u.bio,
    is_entrepreneur: db.entrepreneurialVouches.some((v) => v.user_id === u.id),
  };
}

function canSeeIdea(idea: (typeof db.ideas)[number]) {
  return (
    idea.visibility === 'public' ||
    idea.user_id === me ||
    db.ideaShares.some((s) => s.idea_id === idea.id && s.user_id === me)
  );
}

function canSeeProject(p: (typeof db.projects)[number]) {
  return (
    p.visibility === 'public' ||
    p.owner_id === me ||
    db.projectParticipants.some((x) => x.project_id === p.id && x.user_id === me)
  );
}

function feedProblem(p: (typeof db.problems)[number]): FeedProblem {
  const votes = db.problemVotes.filter((v) => v.problem_id === p.id);
  return {
    ...p,
    updated_at: p.created_at,
    vote_count: votes.length,
    author: summary(p.user_id),
    viewer_voted: votes.some((v) => v.user_id === me),
    idea_count: db.ideaProblemLinks.filter(
      (l) => l.problem_id === p.id && canSeeIdea(db.ideas.find((i) => i.id === l.idea_id)!),
    ).length,
  };
}

function feedIdea(i: (typeof db.ideas)[number]): FeedIdea {
  const votes = db.ideaVotes.filter((v) => v.idea_id === i.id);
  return {
    ...i,
    updated_at: i.created_at,
    vote_count: votes.length,
    author: summary(i.user_id),
    viewer_voted: votes.some((v) => v.user_id === me),
    comment_count: db.ideaComments.filter((c) => c.idea_id === i.id && !c.deleted_at).length,
    problems: db.ideaProblemLinks
      .filter((l) => l.idea_id === i.id)
      .map((l) => ({
        problem_id: l.problem_id,
        problem_title: db.problems.find((p) => p.id === l.problem_id)!.title,
        description: l.description,
      })),
    project_name: i.project_id ? (db.projects.find((p) => p.id === i.project_id)?.name ?? null) : null,
  };
}

function feedProject(p: (typeof db.projects)[number]): FeedProject {
  const tasks = db.projectTasks.filter((t) => t.project_id === p.id);
  const assigned = new Set(db.projectParticipantRoles.filter((r) => r.project_id === p.id).map((r) => r.role_id));
  return {
    ...p,
    updated_at: p.created_at,
    owner: summary(p.owner_id),
    participants: db.projectParticipants
      .filter((x) => x.project_id === p.id && x.user_id !== p.owner_id)
      .map((x) => summary(x.user_id)),
    task_total: tasks.length,
    task_done: tasks.filter((t) => t.completed).length,
    open_roles: db.projectRoles.filter((r) => r.project_id === p.id && !assigned.has(r.id)).map((r) => r.name),
    media_count: p.show_media ? db.projectMedia.filter((m) => m.project_id === p.id).length : 0,
  };
}

// ---------------------------------------------------------------- feeds

/** GET /problems?sort=&cursor= */
export async function getProblemFeed(sort: FeedSort, cursor: string | null, limit?: number) {
  await sleep();
  const rows = db.problems.map(feedProblem).sort(byNewest);
  if (sort === 'top') rows.sort((a, b) => b.vote_count - a.vote_count);
  return paginate(rows, cursor, limit);
}

/** GET /ideas?sort=&cursor= (public ideas plus private ones shared with me) */
export async function getIdeaFeed(sort: FeedSort, cursor: string | null, limit?: number) {
  await sleep();
  const rows = db.ideas.filter(canSeeIdea).map(feedIdea).sort(byNewest);
  if (sort === 'top') rows.sort((a, b) => b.vote_count - a.vote_count);
  return paginate(rows, cursor, limit);
}

/** GET /projects?sort=&cursor= */
export async function getProjectFeed(sort: ProjectSort, cursor: string | null, limit?: number) {
  await sleep();
  let rows = db.projects.filter(canSeeProject).map(feedProject).sort(byNewest);
  if (sort === 'open_roles') rows = rows.filter((p) => p.open_roles.length > 0);
  return paginate(rows, cursor, limit);
}

// ---------------------------------------------------------------- problems

/** GET /problems/:id */
export async function getProblem(id: string) {
  await sleep();
  const p = db.problems.find((x) => x.id === id);
  if (!p) return null;
  const ideas = db.ideaProblemLinks
    .filter((l) => l.problem_id === id)
    .map((l) => db.ideas.find((i) => i.id === l.idea_id)!)
    .filter(canSeeIdea)
    .map(feedIdea);
  return { problem: feedProblem(p), ideas };
}

/** PUT|DELETE /problems/:id/vote */
export async function toggleProblemVote(id: string) {
  const i = db.problemVotes.findIndex((v) => v.problem_id === id && v.user_id === me);
  if (i >= 0) db.problemVotes.splice(i, 1);
  else db.problemVotes.push({ problem_id: id, user_id: me });
  bump();
}

/** POST /problems */
export async function createProblem(input: { title: string; description: string }) {
  await sleep();
  const id = newId('p');
  db.problems.push({ id, user_id: me, ...input, created_at: nowIso() });
  bump();
  return id;
}

/** GET /problems/search?q= (used by the idea composer) */
export async function searchProblems(q: string) {
  const needle = q.trim().toLowerCase();
  return db.problems
    .filter((p) => !needle || p.title.toLowerCase().includes(needle))
    .slice(0, 8)
    .map((p) => ({ id: p.id, title: p.title }));
}

// ---------------------------------------------------------------- ideas

/** GET /ideas/:id */
export async function getIdea(id: string): Promise<IdeaDetail | null> {
  await sleep();
  const i = db.ideas.find((x) => x.id === id);
  if (!i || !canSeeIdea(i)) return null;
  const isOwner = i.user_id === me;
  return {
    ...feedIdea(i),
    is_owner: isOwner,
    shared_with: isOwner ? db.ideaShares.filter((s) => s.idea_id === id).map((s) => summary(s.user_id)) : [],
  };
}

/** PUT|DELETE /ideas/:id/vote */
export async function toggleIdeaVote(id: string) {
  const i = db.ideaVotes.findIndex((v) => v.idea_id === id && v.user_id === me);
  if (i >= 0) db.ideaVotes.splice(i, 1);
  else db.ideaVotes.push({ idea_id: id, user_id: me });
  bump();
}

/** POST /ideas */
export async function createIdea(input: {
  title: string;
  description: string;
  visibility: Visibility;
  problems: { problem_id: string; description: string }[];
}) {
  await sleep();
  const id = newId('i');
  db.ideas.push({
    id,
    user_id: me,
    title: input.title,
    description: input.description,
    visibility: input.visibility,
    project_id: null,
    created_at: nowIso(),
  });
  input.problems.forEach((l) => db.ideaProblemLinks.push({ ...l, idea_id: id }));
  bump();
  return id;
}

/** GET /prospects: users I marked as prospects (the only people a private idea can be shared with) */
export async function getMyProspects() {
  return db.prospects.filter((p) => p.owner_id === me).map((p) => summary(p.prospect_id));
}

/** PUT /ideas/:id/shares */
export async function setIdeaShares(ideaId: string, userIds: string[]) {
  for (let i = db.ideaShares.length - 1; i >= 0; i--) {
    if (db.ideaShares[i].idea_id === ideaId) db.ideaShares.splice(i, 1);
  }
  userIds.forEach((user_id) => db.ideaShares.push({ idea_id: ideaId, owner_id: me, user_id }));
  bump();
}

// ---------------------------------------------------------------- comments

/** GET /comment-types */
export async function getCommentTypes(): Promise<CommentType[]> {
  return db.commentTypes;
}

/** GET /ideas/:id/comments (flat list; the client builds the tree from parent_id) */
export async function getComments(ideaId: string): Promise<IdeaComment[]> {
  await sleep();
  return db.ideaComments
    .filter((c) => c.idea_id === ideaId)
    .map((c) => {
      const votes = db.ideaCommentVotes.filter((v) => v.comment_id === c.id);
      return {
        ...c,
        author: c.user_id && !c.deleted_at ? summary(c.user_id) : null,
        content: c.deleted_at ? '[deleted]' : c.content,
        score: votes.reduce((s, v) => s + v.value, 0),
        viewer_vote: votes.find((v) => v.user_id === me)?.value ?? 0,
      };
    });
}

/** POST /ideas/:id/comments */
export async function addComment(ideaId: string, parentId: string | null, commentType: string, content: string) {
  const parent = parentId ? db.ideaComments.find((c) => c.id === parentId) : undefined;
  db.ideaComments.push({
    id: newId('c'),
    idea_id: ideaId,
    parent_id: parentId,
    user_id: me,
    comment_type: commentType,
    content,
    depth: parent ? Math.min(parent.depth + 1, 10) : 0,
    deleted_at: null,
    created_at: nowIso(),
  });
  bump();
}

/** PUT /comments/:id/vote {value: -1|0|1} */
export async function voteComment(commentId: string, value: -1 | 0 | 1) {
  const i = db.ideaCommentVotes.findIndex((v) => v.comment_id === commentId && v.user_id === me);
  if (i >= 0) db.ideaCommentVotes.splice(i, 1);
  if (value !== 0) db.ideaCommentVotes.push({ comment_id: commentId, user_id: me, value });
  bump();
}

/** DELETE /comments/:id (soft delete) */
export async function deleteComment(commentId: string) {
  const c = db.ideaComments.find((x) => x.id === commentId);
  if (c && c.user_id === me) c.deleted_at = nowIso();
  bump();
}

// ---------------------------------------------------------------- projects

function relation(projectId: string, ownerId: string): ViewerRelation {
  if (ownerId === me) return 'owner';
  if (db.projectParticipants.some((x) => x.project_id === projectId && x.user_id === me)) return 'participant';
  if (db.projectInvites.some((x) => x.project_id === projectId && x.user_id === me)) return 'invited';
  if (db.projectRequests.some((x) => x.project_id === projectId && x.user_id === me)) return 'requested';
  return 'none';
}

/** GET /projects/:id */
export async function getProject(id: string): Promise<ProjectDetail | null> {
  await sleep();
  const p = db.projects.find((x) => x.id === id);
  if (!p || !canSeeProject(p)) return null;
  const rel = relation(id, p.owner_id);
  const idea = db.ideas.find((i) => i.project_id === id);
  return {
    ...feedProject(p),
    viewer_relation: rel,
    categories: db.projectCategories.filter((c) => c.project_id === id).map(({ id, name }) => ({ id, name })),
    roles: db.projectRoles
      .filter((r) => r.project_id === id)
      .map((r) => ({
        id: r.id,
        name: r.name,
        category_ids: db.projectRoleCategories.filter((rc) => rc.role_id === r.id).map((rc) => rc.category_id),
      })),
    tasks: db.projectTasks
      .filter((t) => t.project_id === id)
      .sort((a, b) => a.position - b.position)
      .map((t) => ({
        id: t.id,
        position: t.position,
        description: t.description,
        deadline: t.deadline,
        completed: t.completed,
        category_ids: db.projectTaskCategories.filter((tc) => tc.task_id === t.id).map((tc) => tc.category_id),
      })),
    // Owner first. Owners are also participants, so they appear once, with their roles.
    team: [p.owner_id, ...db.projectParticipants.filter((x) => x.project_id === id && x.user_id !== p.owner_id).map((x) => x.user_id)].map(
      (userId) => ({
        user: summary(userId),
        role_ids: db.projectParticipantRoles.filter((r) => r.project_id === id && r.user_id === userId).map((r) => r.role_id),
      }),
    ),
    media: p.show_media ? db.projectMedia.filter((m) => m.project_id === id) : [],
    join_requests: rel === 'owner' ? db.projectRequests.filter((r) => r.project_id === id).map((r) => summary(r.user_id)) : [],
    source_idea: idea ? { id: idea.id, title: idea.title } : null,
  };
}

/** POST|DELETE /projects/:id/requests/me */
export async function toggleJoinRequest(projectId: string) {
  const i = db.projectRequests.findIndex((r) => r.project_id === projectId && r.user_id === me);
  if (i >= 0) db.projectRequests.splice(i, 1);
  else db.projectRequests.push({ project_id: projectId, user_id: me });
  bump();
}

/** POST /projects/:id/requests/:userId/{accept,decline} (owner) */
export async function respondToJoinRequest(projectId: string, userId: string, accept: boolean) {
  const i = db.projectRequests.findIndex((r) => r.project_id === projectId && r.user_id === userId);
  if (i >= 0) db.projectRequests.splice(i, 1);
  if (accept) db.projectParticipants.push({ project_id: projectId, user_id: userId });
  bump();
}

/** POST /projects/:id/invites/me/{accept,decline} */
export async function respondToInvite(projectId: string, accept: boolean) {
  const i = db.projectInvites.findIndex((r) => r.project_id === projectId && r.user_id === me);
  if (i >= 0) db.projectInvites.splice(i, 1);
  if (accept) db.projectParticipants.push({ project_id: projectId, user_id: me });
  bump();
}

/** PATCH /projects/:id/tasks/:taskId {completed} (owner or participant) */
export async function toggleTask(taskId: string) {
  const t = db.projectTasks.find((x) => x.id === taskId);
  if (t) t.completed = !t.completed;
  bump();
}

/** POST /projects (optionally from an idea, which links ideas.project_id) */
export async function createProject(input: {
  name: string;
  description: string;
  visibility: Visibility;
  deadline: string | null;
  idea_id: string | null;
}) {
  await sleep();
  const id = newId('pr');
  db.projects.push({
    id,
    owner_id: me,
    name: input.name,
    description: input.description,
    visibility: input.visibility,
    deadline: input.deadline,
    show_media: false,
    created_at: nowIso(),
  });
  db.projectParticipants.push({ project_id: id, user_id: me });
  const idea = input.idea_id ? db.ideas.find((i) => i.id === input.idea_id && i.user_id === me) : undefined;
  if (idea) idea.project_id = id;
  bump();
  return id;
}

// ---------------------------------------------------------------- users

/** GET /users/:id (or /me/profile) */
export async function getProfile(userId: string): Promise<Profile | null> {
  await sleep();
  if (!db.users.some((u) => u.id === userId)) return null;
  const visibleProjects = db.projects.filter(
    (p) =>
      canSeeProject(p) &&
      (p.owner_id === userId || db.projectParticipants.some((x) => x.project_id === p.id && x.user_id === userId)),
  );
  return {
    ...summary(userId),
    is_self: userId === me,
    is_prospect: db.prospects.some((p) => p.owner_id === me && p.prospect_id === userId),
    skills: db.userSkills
      .filter((s) => s.user_id === userId)
      .map((s) => {
        const vouches = db.skillVouches.filter((v) => v.user_id === userId && v.skill === s.skill).sort(byNewest);
        return {
          skill: s.skill,
          vouch_count: vouches.length,
          viewer_vouched: vouches.some((v) => v.voucher_id === me),
          vouches: vouches.map((v) => {
            const project = v.project_id ? db.projects.find((x) => x.id === v.project_id) : undefined;
            const role = v.role_id ? db.projectRoles.find((x) => x.id === v.role_id) : undefined;
            return {
              voucher: summary(v.voucher_id),
              project: project ? { id: project.id, name: project.name } : null,
              role: role ? { id: role.id, name: role.name } : null,
              created_at: v.created_at,
            };
          }),
        };
      })
      .sort((a, b) => b.vouch_count - a.vouch_count),
    vouchable_roles: userId === me ? [] : vouchableRoles(userId),
    entrepreneur_vouches: db.entrepreneurialVouches
      .filter((v) => v.user_id === userId)
      .map((v) => ({
        project_id: v.project_id,
        project_name: db.projects.find((p) => p.id === v.project_id)!.name,
        description: v.description,
      })),
    counts: {
      problems: db.problems.filter((p) => p.user_id === userId).length,
      ideas: db.ideas.filter((i) => i.user_id === userId && canSeeIdea(i)).length,
      projects: visibleProjects.length,
    },
  };
}

/** GET /users/:id/problems */
export async function getUserProblems(userId: string) {
  await sleep();
  return db.problems.filter((p) => p.user_id === userId).map(feedProblem).sort(byNewest);
}

/** GET /users/:id/ideas (private ones only if the viewer can see them) */
export async function getUserIdeas(userId: string) {
  await sleep();
  return db.ideas.filter((i) => i.user_id === userId && canSeeIdea(i)).map(feedIdea).sort(byNewest);
}

/** GET /users/:id/projects (owned + participating) */
export async function getUserProjects(userId: string) {
  await sleep();
  return db.projects
    .filter(
      (p) =>
        canSeeProject(p) &&
        (p.owner_id === userId || db.projectParticipants.some((x) => x.project_id === p.id && x.user_id === userId)),
    )
    .map(feedProject)
    .sort(byNewest);
}

/**
 * Roles `userId` held in projects the viewer worked on (owner or participant), or all their roles
 * for an admin viewer. A skill vouch must name one of these (checked again by the backend).
 */
function vouchableRoles(userId: string): VouchableRole[] {
  const isAdmin = db.users.find((u) => u.id === me)!.is_admin;
  const workedOn = (projectId: string) =>
    db.projects.some((p) => p.id === projectId && p.owner_id === me) ||
    db.projectParticipants.some((x) => x.project_id === projectId && x.user_id === me);
  return db.projectParticipantRoles
    .filter((r) => r.user_id === userId && (isAdmin || workedOn(r.project_id)))
    .map((r) => ({
      project_id: r.project_id,
      project_name: db.projects.find((p) => p.id === r.project_id)!.name,
      role_id: r.role_id,
      role_name: db.projectRoles.find((x) => x.id === r.role_id)!.name,
    }));
}

/** PUT /users/:id/skills/:skill/vouch {project_id, role_id} */
export async function vouchSkill(userId: string, skill: string, projectId: string, roleId: string) {
  if (userId === me) throw new Error('You cannot vouch for yourself');
  if (!vouchableRoles(userId).some((r) => r.project_id === projectId && r.role_id === roleId)) {
    throw new Error('You can only vouch based on a role in a project you worked on');
  }
  const existing = db.skillVouches.find((v) => v.user_id === userId && v.skill === skill && v.voucher_id === me);
  if (existing) Object.assign(existing, { project_id: projectId, role_id: roleId });
  else db.skillVouches.push({ user_id: userId, skill, voucher_id: me, project_id: projectId, role_id: roleId, created_at: nowIso() });
  bump();
}

/** DELETE /users/:id/skills/:skill/vouch */
export async function removeVouch(userId: string, skill: string) {
  const i = db.skillVouches.findIndex((v) => v.user_id === userId && v.skill === skill && v.voucher_id === me);
  if (i >= 0) db.skillVouches.splice(i, 1);
  bump();
}

/** PUT|DELETE /prospects/:userId (removing also revokes their idea_shares, like the FK cascade) */
export async function toggleProspect(userId: string) {
  const i = db.prospects.findIndex((p) => p.owner_id === me && p.prospect_id === userId);
  if (i >= 0) {
    db.prospects.splice(i, 1);
    for (let j = db.ideaShares.length - 1; j >= 0; j--) {
      if (db.ideaShares[j].owner_id === me && db.ideaShares[j].user_id === userId) db.ideaShares.splice(j, 1);
    }
  } else db.prospects.push({ owner_id: me, prospect_id: userId });
  bump();
}

/** PATCH /me {bio} */
export async function updateBio(bio: string) {
  db.users.find((u) => u.id === me)!.bio = bio.slice(0, 256);
  bump();
}

export const MY_ID = me;

// ---------------------------------------------------------------- notifications

/** GET /notifications */
export async function getNotifications(): Promise<Notification[]> {
  await sleep();
  return db.notifications
    .filter((n) => n.user_id === me)
    .sort(byNewest)
    .map((n) => {
      const problem = n.problem_id ? db.problems.find((p) => p.id === n.problem_id) : undefined;
      const idea = n.idea_id ? db.ideas.find((i) => i.id === n.idea_id) : undefined;
      const project = n.project_id ? db.projects.find((p) => p.id === n.project_id) : undefined;
      const comment = n.comment_id ? db.ideaComments.find((c) => c.id === n.comment_id) : undefined;
      let actionable = false;
      if (n.kind === 'project_invite')
        actionable = db.projectInvites.some((x) => x.project_id === n.project_id && x.user_id === me);
      if (n.kind === 'join_request')
        actionable = db.projectRequests.some((x) => x.project_id === n.project_id && x.user_id === n.actor_id);
      return {
        id: n.id,
        kind: n.kind,
        actor: n.actor_id ? summary(n.actor_id) : null,
        problem: problem ? { id: problem.id, title: problem.title } : null,
        idea: idea ? { id: idea.id, title: idea.title } : null,
        project: project ? { id: project.id, name: project.name } : null,
        comment: comment ? { id: comment.id, excerpt: comment.content.slice(0, 80) } : null,
        read_at: n.read_at,
        created_at: n.created_at,
        actionable,
      };
    });
}

/** GET /notifications/unread-count */
export function getUnreadCountSync() {
  return db.notifications.filter((n) => n.user_id === me && !n.read_at).length;
}

/** POST /notifications/read-all */
export async function markAllRead() {
  const t = nowIso();
  db.notifications.forEach((n) => {
    if (n.user_id === me && !n.read_at) n.read_at = t;
  });
  bump();
}
