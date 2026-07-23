import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderMarkdownPaper } from "./markdown";
import { runRewritePipeline } from "./pipeline";
import { rangeTextMatches, replaceRange } from "./selection";
import type { AIProvider, GenerateRequest, SourceRange } from "./types";

describe("human UX smoke", () => {
  it("supports read -> select -> pipeline -> preview -> apply without touching unrelated text", async () => {
    const source = [
      "# 战略科技任务的法律定位",
      "",
      "第一段说明研究问题，并保留全文阅读的连续性。",
      "",
      "## 一、问题的提出",
      "",
      "第二段存在可组织、可授权、可监督的表达，需要改成更自然的规范判断。",
      "",
      "第三段保留脚注引用，用来检查全文预览不会破坏注释[^1]。",
      "",
      "[^1]: 这里是脚注内容。",
    ].join("\n");
    const initial = renderMarkdownPaper(source);
    expect(initial.html).toContain("战略科技任务的法律定位");
    expect(initial.paragraphs).toHaveLength(3);
    expect(initial.footnoteHealth.total).toBe(1);

    const selected = initial.paragraphs[1];
    const selectedSourceText = source.slice(selected.range.start, selected.range.end);
    expect(selectedSourceText).toContain("可组织、可授权、可监督");

    const workspaceDir = await mkdtemp(join(tmpdir(), "html-writer-ux-"));
    const pipeline = await runRewritePipeline(
      new QueueProvider([
        {
          hard_facts: [{ fact_id: "F1", claim: "原段落讨论规范判断表达", quote: selectedSourceText, confidence: "high" }],
          claims: [{ claim_id: "C1", type: "normative", claim: "表达应改为自然判断句", quote: "需要改成更自然的规范判断", confidence: "high" }],
          reader_implications: [{ related_claim_ids: ["C1"], implication: "读者需要看到明确判断，而不是机械清单", why_it_matters: "降低 AI 腔" }],
          open_questions: [],
          forbidden_claims: ["原文未提及的举例和场景"],
        },
        [
          {
            paragraph_no: 1,
            paragraph_goal: "保留原判断并消除机械清单",
            reader_question: "这里到底要证明什么",
            key_claim_ids: ["C1"],
            argument_move: "限定",
            rhythm: "medium",
            forbidden_moves: ["不要扩写新案例"],
          },
        ],
        {
          candidates: [
            { candidate_id: "A", label: "保守小改", body: "第二段讨论制度安排的规范判断，需要把能力清单改成更自然的判断句。", revision_note: "保留原意" },
            { candidate_id: "B", label: "收紧压缩", body: "第二段要说明制度安排的规范判断，而不是堆叠能力清单。", revision_note: "压缩" },
            { candidate_id: "C", label: "结构重写", body: "这段真正要处理的是制度安排如何被法律判断，而不是把它拆成一串能力标签。", revision_note: "重排论点" },
          ],
        },
        {
          audit: [{ sentence: "第二段要说明制度安排的规范判断，而不是堆叠能力清单。", status: "supported", claim_ids: ["C1"] }],
          result: {
            body: "第二段要说明制度安排的规范判断，而不是堆叠能力清单。",
            risk_level: "low",
            removed_or_softened: [],
          },
        },
        {
          titles: [{ title: "制度安排不是能力清单", logic: "突出本段问题", risk: "低" }],
        },
      ]),
      {
        documentText: source,
        selectedText: selectedSourceText,
        range: selected.range,
        paragraphId: selected.id,
      },
      { workspaceDir, timeoutMs: 1000, maxOutputTokens: 1000 },
    );

    expect(pipeline.draft.candidates).toHaveLength(3);
    expect(pipeline.audit.result.body).toContain("不是堆叠能力清单");
    expect(pipeline.title.titles[0].title).toBe("制度安排不是能力清单");

    const preview = renderMarkdownPaper(source, {
      previewRange: { ...selected.range, body: pipeline.audit.result.body },
    });
    expect(source).toContain("可组织、可授权、可监督");
    expect(preview.html).toContain("不是堆叠能力清单");

    expect(rangeTextMatches(source, selected.range, selectedSourceText)).toBe(true);
    const applied = replaceRange(source, selected.range, pipeline.audit.result.body);
    expect(applied).toContain("第一段说明研究问题");
    expect(applied).toContain("第三段保留脚注引用");
    expect(applied).not.toContain("可组织、可授权、可监督");
    expect(applied.slice(0, selected.range.start)).toBe(source.slice(0, selected.range.start));
    expect(applied.slice(selected.range.start + pipeline.audit.result.body.length)).toBe(source.slice(selected.range.end));

    const externallyEdited = replaceRange(source, selected.range, "第二段已经被作者手动改过。");
    expect(rangeTextMatches(externallyEdited, selected.range, selectedSourceText)).toBe(false);
  });
});

class QueueProvider implements AIProvider {
  readonly id = "mock" as const;
  private index = 0;

  constructor(private readonly values: unknown[]) {}

  async generate(_request: GenerateRequest): Promise<string> {
    return JSON.stringify(this.values[this.index++]);
  }
}
