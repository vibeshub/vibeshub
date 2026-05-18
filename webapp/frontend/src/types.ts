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
