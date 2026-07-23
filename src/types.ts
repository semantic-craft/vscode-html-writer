export type ProviderId = "qwen" | "deepseek" | "gemini" | "anthropic" | "mimo";
export type ProviderProtocol = "openai" | "anthropic" | "gemini";
export type ReasoningMode = "off" | "on" | "auto";
export type PipelineStep = "facts" | "structure" | "draft" | "audit" | "title";

export interface SourceRange {
  start: number;
  end: number;
}

export interface ParagraphBlock {
  id: string;
  text: string;
  range: SourceRange;
  edited: boolean;
}

export interface RenderedPaper {
  html: string;
  bodyText: string;
  paragraphs: ParagraphBlock[];
  footnoteHealth: FootnoteHealth;
}

export interface FootnoteHealth {
  dangling: string[];
  undefined: string[];
  duplicated: string[];
  total: number;
}

export interface ProviderConfig {
  id: ProviderId;
  title: string;
  apiKey: string;
  baseURL: string;
  model: string;
  protocol: ProviderProtocol;
  reasoningMode: ReasoningMode;
}

export interface GenerationOptions {
  responseMimeType?: string;
  responseJsonSchema?: Record<string, unknown>;
}

export interface GenerateRequest {
  system: string;
  user: string;
  timeoutMs: number;
  maxOutputTokens: number;
  options?: GenerationOptions;
}

export interface AIProvider {
  id: ProviderId | "mock" | "fallback";
  generate(request: GenerateRequest): Promise<string>;
}

export interface RewriteTarget {
  documentText: string;
  selectedText: string;
  range: SourceRange;
  paragraphId?: string;
  styleGuide?: string;
}

export interface ClaimRecord {
  claim_id: string;
  type: "fact" | "normative" | "concept" | "citation";
  claim: string;
  quote: string;
  paragraph_id?: string;
  has_citation?: boolean;
  confidence: "high" | "medium";
}

export interface FactsResult {
  hard_facts?: Array<{ fact_id: string; claim: string; quote: string; confidence: "high" | "medium" }>;
  claims?: ClaimRecord[];
  human_implications?: Array<{ related_fact_ids?: string[]; implication: string; why_it_matters: string }>;
  reader_implications?: Array<{ related_claim_ids: string[]; implication: string; why_it_matters: string }>;
  open_questions: string[];
  forbidden_claims: string[];
}

export interface StructureSection {
  section_no?: number;
  paragraph_no?: number;
  section_goal?: string;
  paragraph_goal?: string;
  reader_question: string;
  key_fact_ids?: string[];
  key_claim_ids?: string[];
  narrative_move?: string;
  argument_move?: string;
  rhythm: "short" | "medium" | "long";
  forbidden_moves: string[];
}

export interface DraftCandidate {
  candidate_id: string;
  label: string;
  body: string;
  used_claim_ids?: string[];
  used_fact_ids?: string[];
  revision_note?: string;
}

export interface DraftResult {
  candidates: DraftCandidate[];
}

export interface AuditItem {
  sentence: string;
  status: "supported" | "reasonable_inference" | "unsupported" | "fabricated";
  claim_ids?: string[];
  fact_ids?: string[];
  note?: string;
}

export interface AuditResult {
  audit: AuditItem[];
  result: {
    body: string;
    risk_level: "low" | "medium" | "high";
    removed_or_softened: string[];
  };
}

export interface TitleResult {
  titles: Array<{ title: string; logic: string; risk: string }>;
}

export interface PipelineArtifacts {
  sessionDir: string;
  facts: FactsResult;
  structure: StructureSection[];
  draft: DraftResult;
  audit: AuditResult;
  title: TitleResult;
}
