import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runRewritePipeline } from "./pipeline";
import type { AIProvider, GenerateRequest } from "./types";

describe("pipeline", () => {
  it("runs five steps and writes JSON artifacts", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "html-writer-"));
    const provider = new QueueProvider([
      {
        hard_facts: [{ fact_id: "F1", claim: "事实", quote: "事实", confidence: "high" }],
        open_questions: [],
        forbidden_claims: ["原文未提及的举例和场景"],
      },
      [
        {
          paragraph_no: 1,
          paragraph_goal: "说明问题",
          reader_question: "为什么重要",
          key_claim_ids: ["C1"],
          argument_move: "铺垫",
          rhythm: "medium",
          forbidden_moves: [],
        },
      ],
      {
        candidates: [
          { candidate_id: "A", label: "保守小改", body: "改写A", used_claim_ids: [], revision_note: "保守" },
          { candidate_id: "B", label: "收紧压缩", body: "改写B", used_claim_ids: [], revision_note: "收紧" },
          { candidate_id: "C", label: "结构重写", body: "改写C", used_claim_ids: [], revision_note: "重写" },
        ],
      },
      {
        audit: [{ sentence: "改写A", status: "supported", fact_ids: ["F1"] }],
        result: { body: "审计后正文", risk_level: "low", removed_or_softened: [] },
      },
      {
        titles: [{ title: "问题与边界", logic: "突出论证任务", risk: "低" }],
      },
    ]);

    const result = await runRewritePipeline(
      provider,
      {
        documentText: "全文",
        selectedText: "事实。",
        range: { start: 0, end: 3 },
      },
      { workspaceDir, timeoutMs: 1000, maxOutputTokens: 1000 },
    );

    expect(result.draft.candidates).toHaveLength(3);
    expect(await readFile(join(result.sessionDir, "01-facts.json"), "utf8")).toContain("hard_facts");
    expect(await readFile(join(result.sessionDir, "05-titles.json"), "utf8")).toContain("问题与边界");
  });

  it("reports progress step by step", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "html-writer-progress-"));
    const provider = new QueueProvider(validPipelineValues());
    const events: string[] = [];

    await runRewritePipeline(
      provider,
      {
        documentText: "全文",
        selectedText: "事实。",
        range: { start: 0, end: 3 },
      },
      {
        workspaceDir,
        timeoutMs: 1000,
        maxOutputTokens: 1000,
        onStepStart: (step) => events.push(`start:${step}`),
        onStepComplete: (step) => events.push(`complete:${step}`),
      },
    );

    expect(events).toEqual([
      "start:facts",
      "complete:facts",
      "start:structure",
      "complete:structure",
      "start:draft",
      "complete:draft",
      "start:audit",
      "complete:audit",
      "start:title",
      "complete:title",
    ]);
  });
});

export function validPipelineValues(): unknown[] {
  return [
    {
      hard_facts: [{ fact_id: "F1", claim: "事实", quote: "事实", confidence: "high" }],
      open_questions: [],
      forbidden_claims: ["原文未提及的举例和场景"],
    },
    [
      {
        paragraph_no: 1,
        paragraph_goal: "说明问题",
        reader_question: "为什么重要",
        key_claim_ids: ["C1"],
        argument_move: "铺垫",
        rhythm: "medium",
        forbidden_moves: [],
      },
    ],
    {
      candidates: [
        { candidate_id: "A", label: "保守小改", body: "改写A", used_claim_ids: [], revision_note: "保守" },
        { candidate_id: "B", label: "收紧压缩", body: "改写B", used_claim_ids: [], revision_note: "收紧" },
        { candidate_id: "C", label: "结构重写", body: "改写C", used_claim_ids: [], revision_note: "重写" },
      ],
    },
    {
      audit: [{ sentence: "改写A", status: "supported", fact_ids: ["F1"] }],
      result: { body: "审计后正文", risk_level: "low", removed_or_softened: [] },
    },
    {
      titles: [{ title: "问题与边界", logic: "突出论证任务", risk: "低" }],
    },
  ];
}

class QueueProvider implements AIProvider {
  readonly id = "mock" as const;
  private index = 0;

  constructor(private readonly values: unknown[]) {}

  async generate(_request: GenerateRequest): Promise<string> {
    const value = this.values[this.index++];
    return JSON.stringify(value);
  }
}
