/**
 * Types mirroring backend/migrations/0001_init.sql, plus the "view" shapes the API returns
 * (rows joined with their author, counts and the viewer's own state).
 * Timestamps are ISO 8601 strings.
 */

export type Visibility = 'public' | 'private';

export type FeedSort = 'new' | 'top';
export type ProjectSort = 'new' | 'open_roles';

export type Page<T> = { items: T[]; next_cursor: string | null };

// ---------------------------------------------------------------- users

/** What is shown next to anything a user posted. */
export type UserSummary = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  /** Has at least one user_entrepreneurial_vouches row. */
  is_entrepreneur: boolean;
};

/** A skill_vouches row: who vouched, and the project role they saw the skill in. */
export type SkillVouch = {
  voucher: UserSummary;
  /** null when the role assignment or project was removed after vouching. */
  project: { id: string; name: string } | null;
  role: { id: string; name: string } | null;
  created_at: string;
};

export type UserSkill = {
  skill: string;
  vouch_count: number;
  viewer_vouched: boolean;
  vouches: SkillVouch[]; // newest first
};

/** A role the profile's user held in a project, which the viewer may vouch based on. */
export type VouchableRole = {
  project_id: string;
  project_name: string;
  role_id: string;
  role_name: string;
};

export type Profile = UserSummary & {
  is_self: boolean;
  /** Viewer has this user in user_prospects. */
  is_prospect: boolean;
  skills: UserSkill[];
  /** Roles the user held in projects the viewer worked on (all their roles for an admin viewer). Empty on your own profile. */
  vouchable_roles: VouchableRole[];
  entrepreneur_vouches: { project_id: string; project_name: string; description: string }[];
  counts: { problems: number; ideas: number; projects: number };
};

// ---------------------------------------------------------------- problems

export type Problem = {
  id: string;
  user_id: string;
  title: string; // max 128
  description: string; // max 1024
  vote_count: number;
  created_at: string;
  updated_at: string;
};

export type FeedProblem = Problem & {
  author: UserSummary;
  viewer_voted: boolean;
  idea_count: number;
};

// ---------------------------------------------------------------- ideas

export type Idea = {
  id: string;
  user_id: string;
  title: string; // max 128
  description: string; // max 2048
  visibility: Visibility;
  project_id: string | null;
  vote_count: number;
  created_at: string;
  updated_at: string;
};

/** An idea_problem_links row with the problem's title. */
export type IdeaProblemLink = {
  problem_id: string;
  problem_title: string;
  description: string; // max 128, how the idea solves the problem
};

export type FeedIdea = Idea & {
  author: UserSummary;
  viewer_voted: boolean;
  comment_count: number;
  problems: IdeaProblemLink[];
  project_name: string | null;
};

export type IdeaDetail = FeedIdea & {
  is_owner: boolean;
  /** Owner only: prospects the private idea is shared with. */
  shared_with: UserSummary[];
};

export type CommentType = {
  id: string;
  label: string; // max 32
  color: string; // #RRGGBB
};

export type IdeaComment = {
  id: string;
  idea_id: string;
  parent_id: string | null;
  author: UserSummary | null; // null = account deleted
  comment_type: string; // CommentType.id
  content: string; // max 512, "[deleted]" when deleted_at is set
  depth: number; // 0..10
  score: number;
  viewer_vote: -1 | 0 | 1;
  deleted_at: string | null;
  created_at: string;
};

// ---------------------------------------------------------------- projects

export type Project = {
  id: string;
  owner_id: string;
  name: string; // max 128
  description: string; // max 2048
  visibility: Visibility;
  deadline: string | null;
  show_media: boolean;
  created_at: string;
  updated_at: string;
};

export type ProjectCategory = { id: string; name: string };
export type ProjectRole = { id: string; name: string; category_ids: string[] };
export type ProjectTask = {
  id: string;
  position: number;
  description: string;
  deadline: string;
  completed: boolean;
  category_ids: string[];
};
export type ProjectParticipant = { user: UserSummary; role_ids: string[] };
export type ProjectMedia = { id: string; url: string };

export type ViewerRelation = 'owner' | 'participant' | 'invited' | 'requested' | 'none';

export type FeedProject = Project & {
  owner: UserSummary;
  participants: UserSummary[];
  task_total: number;
  task_done: number;
  /** Names of roles nobody has been assigned to yet. */
  open_roles: string[];
  media_count: number;
};

export type ProjectDetail = FeedProject & {
  viewer_relation: ViewerRelation;
  categories: ProjectCategory[];
  roles: ProjectRole[];
  tasks: ProjectTask[];
  team: ProjectParticipant[];
  media: ProjectMedia[];
  /** Owner only: pending project_participant_requests. */
  join_requests: UserSummary[];
  source_idea: { id: string; title: string } | null;
};

// ---------------------------------------------------------------- notifications

export type NotificationKind =
  | 'project_invite'
  | 'join_request'
  | 'request_accepted'
  | 'idea_comment'
  | 'comment_reply'
  | 'skill_vouch'
  | 'idea_shared'
  | 'entrepreneur_vouch';

export type Notification = {
  id: string;
  kind: NotificationKind;
  actor: UserSummary | null;
  problem: { id: string; title: string } | null;
  idea: { id: string; title: string } | null;
  project: { id: string; name: string } | null;
  comment: { id: string; excerpt: string } | null;
  read_at: string | null;
  created_at: string;
  /** For project_invite / join_request: whether it is still pending. */
  actionable: boolean;
};
