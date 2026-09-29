/*
 * GENERATED FILE. DO NOT EDIT.
 * Regenerate with: pnpm gen:types
 */

export type MargotGoldenContract1 = Case | Expected;
export type Provenance = "recorded" | "reconstructed" | "constructed";
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | {
      [k: string]: Json;
    };
export type StoredResponse = {
  outcome: "success" | "transient_then_success" | "persistent_failure";
  response?: string;
  failure?: Json;
  provenance: Provenance;
};
export type NullableString = string | null;

export interface Case {
  schema: "contract/1";
  id: string;
  description: string;
  branch_class: string;
  provenance: Provenance;
  source: null | {
    constructed?: true;
    repo?: string;
    repo_visibility?: "public";
    pr?: number;
    run_id?: string;
    check_run_id?: number | string;
    dotty_sha?: string;
    workflow_sha?: string;
    run_started_at?: string;
  };
  scrub: {
    ticket_ids: number;
    roster_names: number;
    vault_paths: number;
  };
  pr: {
    repo: Provenanced;
    number: Provenanced;
    head_sha: Provenanced;
    base_sha: Provenanced;
    author: Provenanced;
    title: Provenanced;
    body: Provenanced;
    changed_files: Provenanced;
    triage: Provenanced;
    self_instrument_match: Provenanced;
    floor_receipt: Provenanced;
  };
  github: {
    reads: Read[];
    write_responses: WriteResponse[];
  };
  models: {
    [k: string]: StoredResponse;
  };
  jev: {
    [k: string]: StoredResponse;
  };
  linear?: null | {
    [k: string]: Json;
  };
  ruleset?: null | Provenanced;
  fidelity?: {
    [k: string]: Json;
  };
  /**
   * @minItems 1
   */
  seams: [
    "poster" | "council-parse" | "ledger" | "risk-verdict" | "triage" | "workflow-steps",
    ...("poster" | "council-parse" | "ledger" | "risk-verdict" | "triage" | "workflow-steps")[],
  ];
}
export interface Provenanced {
  value: Json;
  provenance: Provenance;
}
export interface Read {
  method: string;
  path: string;
  params: {
    [k: string]: Json;
  };
  body?: Json;
  response?: string;
  status?: Status;
  provenance: Provenance;
}
export interface Status {
  code?: number | string;
  reason?: string;
  body?: string;
  fault?: string;
}
export interface WriteResponse {
  method: string;
  path: string;
  params: {
    [k: string]: Json;
  };
  body: Json;
  response?: string;
  status?: Status;
  provenance: Provenance;
}
export interface Expected {
  schema: "contract/1";
  id: string;
  model_requests?: ModelRequest[];
  jev_requests?: {
    model: string;
    state: string;
    questions: {
      [k: string]: Json;
    };
  }[];
  github: {
    writes: {
      method: string;
      path: string;
      body: Json;
      token: "READ" | "WRITE";
    }[];
  };
  emit?: Json;
  driver?: {
    raised: NullableString;
  };
  poster?: {
    raised: NullableString;
    exit: {
      code: number;
      uncaught: boolean;
    };
  };
  outcome?: {
    status:
      | "reviewed"
      | "skipped"
      | "skipped:superseded"
      | "refused:not-enrolled"
      | "refused:fork"
      | "refused:draft"
      | "refused:merge-conflict"
      | "refused:empty-pr"
      | "refused:read-failure"
      | "refused:step-failed";
    triage?: Json;
    facts?: Json;
  };
}
export interface ModelRequest {
  role: string;
  card: NullableString;
  prompt: string;
  model: NullableString;
  tool_permissions: {
    tools: null | string[];
    allowed: string[];
    disallowed: string[];
  };
  json_schema: Json;
  settings: Json;
}
