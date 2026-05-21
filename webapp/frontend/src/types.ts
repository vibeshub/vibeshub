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
  repo_full_name: string;
  pr_number: number;
  pr_url: string;
  pr_title: string | null;
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
