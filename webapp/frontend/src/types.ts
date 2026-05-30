export interface AgentSummary {
  agent_id: string;
  tool_use_id: string | null;
  agent_type: string;
  description: string;
  message_count: number;
}

export interface TraceSummary {
  trace_id: string;
  short_id: string;
  owner_login: string;
  repo_full_name: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_title: string | null;
  title: string | null;
  platform: string;
  byte_size: number;
  message_count: number;
  created_at: string;
  is_private: boolean;
  agent_count: number;
  agents: AgentSummary[];
}

export interface TraceListResponse {
  traces: TraceSummary[];
}

export interface UserOverviewStats {
  trace_count: number;
  repo_count: number;
  message_count: number;
  byte_size: number;
  last_trace_at: string | null;
}

export interface UserRepoEntry {
  repo_full_name: string;
  repo_name: string;
  trace_count: number;
}

export interface UserOverview {
  login: string;
  stats: UserOverviewStats;
  repos: UserRepoEntry[];
  traces: TraceSummary[];
}

export interface RepoOverviewStats {
  trace_count: number;
  pr_count: number;
  contributor_count: number;
  message_count: number;
  byte_size: number;
  last_trace_at: string | null;
}

export interface RepoContributorEntry {
  login: string;
  trace_count: number;
}

export interface RepoOverview {
  owner: string;
  repo: string;
  repo_full_name: string;
  stats: RepoOverviewStats;
  contributors: RepoContributorEntry[];
  traces: TraceSummary[];
}

export interface MeResponse {
  id: string;
  login: string;
  name: string | null;
  avatar_url: string | null;
  has_private_access: boolean;
}

export interface GithubUser {
  login: string;
  name: string | null;
  bio: string | null;
  avatar_url: string | null;
  html_url: string;
  followers: number;
  following: number;
  public_repos: number;
  total_public_stars: number;
  top_languages: string[];
  created_at: string;
  stars_truncated: boolean;
}

export interface GithubRepo {
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  default_branch: string | null;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  primary_language: string | null;
  license_spdx: string | null;
  topics: string[];
  created_at: string | null;
  updated_at: string | null;
}

export interface GithubRepoListItem {
  name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  pushed_at: string | null;
}

export interface GithubRepoListPage {
  repos: GithubRepoListItem[];
  has_next: boolean;
}

export interface GithubContributionDay {
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  count: number;
  /** Intensity bucket 0-4, as computed by GitHub's per-user quartiles. */
  level: number;
}

export interface GithubContributions {
  login: string;
  total: number;
  days: GithubContributionDay[];
}

/** A repo entry from GET /api/github/my-repos. */
export interface GithubPickerRepo {
  full_name: string;
  name: string;
  private: boolean;
}

/** A PR entry from GET /api/github/repo-prs. */
export interface GithubPickerPr {
  number: number;
  title: string;
  html_url: string;
}

/** The JSON body returned by POST /api/uploads. */
export interface UploadResult {
  trace_id: string;
  short_id: string;
  trace_url: string;
  created: boolean;
}

/**
 * The body of PATCH /api/traces/{short_id}. Every field is optional;
 * omitting a field leaves it unchanged, while sending `null` clears the
 * association (matching the backend's model_fields_set semantics).
 */
export interface TracePatch {
  is_private?: boolean;
  pr_url?: string | null;
  repo_full_name?: string | null;
  title?: string | null;
}
