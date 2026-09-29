export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type Provenance = "recorded" | "reconstructed" | "constructed";
export type Seam =
  | "poster"
  | "council-parse"
  | "ledger"
  | "risk-verdict"
  | "triage"
  | "workflow-steps";

export interface Provenanced<T> {
  value: T;
  provenance: Provenance;
}

export interface FloorReceipt {
  name: string;
  conclusion: string | null;
  url: string | null;
  app: string | null;
}

export interface PullRequestInput {
  repo: Provenanced<string | null>;
  number: Provenanced<string | null>;
  head_sha: Provenanced<string | null>;
  base_sha: Provenanced<string | null>;
  author: Provenanced<string | null>;
  title: Provenanced<string | null>;
  body: Provenanced<string | null>;
  changed_files: Provenanced<string[] | null>;
  triage: Provenanced<string | null>;
  self_instrument_match: Provenanced<string | null>;
  floor_receipt: Provenanced<FloorReceipt[] | null>;
}

export interface FailureStatus {
  code?: number | string;
  reason?: string;
  body?: string;
  fault?: string;
}

export interface GitHubRead {
  method: string;
  path: string;
  params: Record<string, JsonValue>;
  body?: JsonValue;
  response?: string;
  status?: FailureStatus;
  provenance: Provenance;
}

export interface GitHubWriteResponse {
  method: string;
  path: string;
  params: Record<string, JsonValue>;
  body: JsonValue;
  response?: string;
  status?: FailureStatus;
  provenance: Provenance;
}

export interface StoredResponse {
  outcome: "success" | "transient_then_success" | "persistent_failure";
  response?: string;
  failure?: JsonValue;
  provenance: Provenance;
}

export interface GoldenCase {
  schema: "contract/1";
  id: string;
  description: string;
  branch_class: string;
  provenance: Provenance;
  source: Record<string, JsonValue> | null;
  scrub: { ticket_ids: number; roster_names: number; vault_paths: number };
  pr: PullRequestInput;
  github: { reads: GitHubRead[]; write_responses: GitHubWriteResponse[] };
  models: Record<string, StoredResponse>;
  jev: Record<string, StoredResponse>;
  linear?: Record<string, JsonValue> | null;
  ruleset?: Provenanced<JsonValue> | null;
  fidelity?: Record<string, JsonValue>;
  seams: Seam[];
}

export interface ModelRequest {
  role: string;
  card: string | null;
  prompt: string;
  model: string | null;
  tool_permissions: {
    tools: string[] | null;
    allowed: string[];
    disallowed: string[];
  };
  json_schema: JsonValue;
  settings: JsonValue;
}

export interface JevRequest {
  model: string;
  state: string;
  questions: Record<string, JsonValue>;
}

export interface GitHubWrite {
  method: string;
  path: string;
  body: JsonValue;
  token: "READ" | "WRITE";
}

export interface GoldenExpected {
  schema: "contract/1";
  id: string;
  github: { writes: GitHubWrite[] };
  model_requests?: ModelRequest[];
  jev_requests?: JevRequest[];
  emit?: JsonValue;
  driver?: { raised: string | null };
  poster?: { raised: string | null; exit: { code: number; uncaught: boolean } };
  outcome?: { status: string; triage?: JsonValue; facts?: JsonValue };
}

export type ContractDocument = GoldenCase | GoldenExpected;
