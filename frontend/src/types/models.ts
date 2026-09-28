/**
 * The app's model types. They are the protobuf messages generated from proto/incubator/v1 (src/gen, `pnpm gen`),
 * re-exported under the names the UI uses, plus a few flattened "detail" shapes built by src/api.
 * Timestamps are ISO 8601 strings; absent optional fields are `undefined`.
 */
import type { GetProfileResponse, ProfileCounts } from '@/gen/incubator/v1/users';
import type { GetProjectResponse, Project } from '@/gen/incubator/v1/projects';
import type { Idea } from '@/gen/incubator/v1/ideas';
import type { UserSummary } from '@/gen/incubator/v1/common';

export { Visibility } from '@/gen/incubator/v1/common';
export type { CommentRef, IdeaRef, ProblemRef, ProjectRef, UserSummary } from '@/gen/incubator/v1/common';
export type { Problem as FeedProblem } from '@/gen/incubator/v1/problems';
export type { Comment as IdeaComment, CommentType, Idea as FeedIdea, IdeaProblemLink } from '@/gen/incubator/v1/ideas';
export { ViewerRelation } from '@/gen/incubator/v1/projects';
export type {
  Project as FeedProject,
  ProjectCategory,
  ProjectMedia,
  ProjectParticipant,
  ProjectRole,
  ProjectTask,
} from '@/gen/incubator/v1/projects';
export type { SkillVouch, UserSkill, VouchableRole } from '@/gen/incubator/v1/users';
export { NotificationKind } from '@/gen/incubator/v1/notifications';
export type { Notification } from '@/gen/incubator/v1/notifications';

/** Feed order, as sent in `?sort=`. */
export type FeedSort = 'new' | 'top';
export type ProjectSort = 'new' | 'open_roles';

export type Page<T> = { items: T[]; next_cursor: string | null };

/** GetIdeaResponse with the idea's fields flattened in. */
export type IdeaDetail = Idea & { is_owner: boolean; shared_with: UserSummary[] };

/** GetProjectResponse with the project's fields flattened in. */
export type ProjectDetail = Project & Omit<GetProjectResponse, 'project'>;

/** GetProfileResponse with the user's fields flattened in. */
export type Profile = UserSummary & Omit<GetProfileResponse, 'user' | 'counts'> & { counts: ProfileCounts };
