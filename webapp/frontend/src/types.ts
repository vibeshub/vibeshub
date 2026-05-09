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

export interface RenderError {
  error: "render_failed";
  fallback: "raw";
  message?: string;
}
