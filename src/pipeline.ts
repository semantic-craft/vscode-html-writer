import { createSessionDir, writeJsonArtifact } from "./artifacts";
import { parseJsonArray, parseJsonObject } from "./providers";
import type {
  AIProvider,
  AuditResult,
  DraftResult,
  FactsResult,
  PipelineArtifacts,
  RewriteTarget,
  StructureSection,
  TitleResult,
  PipelineStep,
} from "./types";

export interface PipelineOptions {
  workspaceDir: string;
  timeoutMs: number;
  maxOutputTokens: number;
  providerForStep?: (step: PipelineStep) => AIProvider;
  onStepStart?: (step: PipelineStep) => void | Promise<void>;
  onStepComplete?: (step: PipelineStep) => void | Promise<void>;
}

const SYSTEM = "你是中文法学论文写作助手。一步只做一件事，严格遵守任务边界，只输出要求的 JSON。";

export async function runRewritePipeline(
  provider: AIProvider,
  target: RewriteTarget,
  options: PipelineOptions,
): Promise<PipelineArtifacts> {
  const sessionDir = await createSessionDir(options.workspaceDir);
  await options.onStepStart?.("facts");
  const facts = await runFacts(stepProvider(provider, options, "facts"), target, options);
  assertFacts(facts);
  await writeJsonArtifact(sessionDir, "01-facts.json", facts);
  await options.onStepComplete?.("facts");

  await options.onStepStart?.("structure");
  const structure = await runStructure(stepProvider(provider, options, "structure"), target, facts, options);
  assertStructure(structure);
  await writeJsonArtifact(sessionDir, "02-structure.json", structure);
  await options.onStepComplete?.("structure");

  await options.onStepStart?.("draft");
  const draft = await runDraft(stepProvider(provider, options, "draft"), target, facts, structure, options);
  assertDraft(draft);
  await writeJsonArtifact(sessionDir, "03-drafts.json", draft);
  await options.onStepComplete?.("draft");

  await options.onStepStart?.("audit");
  const audit = await runAudit(stepProvider(provider, options, "audit"), target, facts, draft, options);
  assertAudit(audit);
  await writeJsonArtifact(sessionDir, "04-audit.json", audit);
  await options.onStepComplete?.("audit");

  await options.onStepStart?.("title");
  const title = await runTitle(stepProvider(provider, options, "title"), target, audit, options);
  assertTitle(title);
  await writeJsonArtifact(sessionDir, "05-titles.json", title);
  await options.onStepComplete?.("title");

  const final = { sessionDir, facts, structure, draft, audit, title };
  await writeJsonArtifact(sessionDir, "final-candidates.json", final);
  return final;
}

function stepProvider(provider: AIProvider, options: PipelineOptions, step: PipelineStep): AIProvider {
  return options.providerForStep?.(step) ?? provider;
}

async function runFacts(provider: AIProvider, target: RewriteTarget, options: PipelineOptions): Promise<FactsResult> {
  const user = `你是事实与主张抽取编辑。不写文章，只提取信息。

任务：
1. 从选中原文中穷尽提取 hard_facts。每个独立信息点都是一条。宁多勿少。
2. 提取 claims，其中 type 可以是 fact、normative、concept、citation。
3. 每条 hard_fact/claim 标注原文摘录 quote。
4. 提取 reader_implications：基于事实/主张、与读者理解论证相关的解释。
5. 标出 open_questions：材料没有回答的重要问题。
6. 标出 forbidden_claims：最容易被编造的内容，包括原文未提及的案例/场景、数字、因果关系、域外经验、作者观点。

重要：
- 宁可多提，不可漏掉未来计划、竞争上下文、具体用例、人事变动、引述和表态。
- forbidden_claims 必须包括“原文未提及的举例和场景”。

选中原文：
${target.selectedText}

只输出 JSON。`;
  return parseJsonObject<FactsResult>(
    await provider.generate({
      system: SYSTEM,
      user,
      timeoutMs: options.timeoutMs,
      maxOutputTokens: options.maxOutputTokens,
      options: { responseMimeType: "application/json", responseJsonSchema: FACTS_SCHEMA },
    }),
  );
}

async function runStructure(
  provider: AIProvider,
  target: RewriteTarget,
  facts: FactsResult,
  options: PipelineOptions,
): Promise<StructureSection[]> {
  const user = `你是论文结构编辑。基于 facts/claims 与读者关系设计结构，不写全文。

输出 JSON 数组，每个元素：
{
  "paragraph_no": 1,
  "paragraph_goal": "这一段要完成什么论证任务",
  "reader_question": "读者读到这里会问什么",
  "key_claim_ids": ["C1", "C2"],
  "argument_move": "定义|铺垫|转折|举证|限定|反驳|制度展开|小结",
  "rhythm": "short|medium|long",
  "forbidden_moves": ["不要在这里总结"]
}

要求：
- 相关 claims 必须相邻，不要打散因果链。
- 至少一次把抽象规范判断落到具体制度语境。
- 结尾应停在新的判断、边界或待证明问题上，不做空泛升华。
- 3-5 个段落即可。

选中原文：
${target.selectedText}

facts/claims JSON：
${JSON.stringify(facts)}

只输出 JSON 数组。`;
  return parseJsonArray<StructureSection[]>(
    await provider.generate({
      system: SYSTEM,
      user,
      timeoutMs: options.timeoutMs,
      maxOutputTokens: options.maxOutputTokens,
      options: { responseMimeType: "application/json", responseJsonSchema: STRUCTURE_SCHEMA },
    }),
  );
}

async function runDraft(
  provider: AIProvider,
  target: RewriteTarget,
  facts: FactsResult,
  structure: StructureSection[],
  options: PipelineOptions,
): Promise<DraftResult> {
  const user = `你是论文改写编辑。根据 facts/claims 与 structure 生成 3 个候选版本，不要覆盖原文。

候选类型：
A 保守小改：尽量保留原句和判断。
B 收紧压缩：提高信息密度，删除空泛句。
C 结构重写：重排句序，使论证推进更清楚。

写作目标：
- 用事实和规范判断推动理解，不靠口号推动情绪。
- 保留自然的长短句变化。
- 写到没有新信息时就停。
- facts/claims 中的重要信息应尽量用到。

硬规则：
- 不添加 facts/claims 中没有的事实、案例、数字、作者观点、因果关系。
- 可以做基于 facts/claims 的合理归纳，但依据必须在前文出现。
- 不使用“材料显示”“据材料”“据称”等元语言。
- 避免连续“可组织、可授权、可监督、可退出”式清单句。
- 不总结、不升华、不把可能写成确定。

风格参考：
${target.styleGuide || "克制、准确、有问题意识，像清醒的法学作者在推进判断。"}

选中原文：
${target.selectedText}

facts/claims JSON：
${JSON.stringify(facts)}

structure JSON：
${JSON.stringify(structure)}

只输出 JSON。`;
  return parseJsonObject<DraftResult>(
    await provider.generate({
      system: SYSTEM,
      user,
      timeoutMs: options.timeoutMs,
      maxOutputTokens: options.maxOutputTokens,
      options: { responseMimeType: "application/json", responseJsonSchema: DRAFT_SCHEMA },
    }),
  );
}

async function runAudit(
  provider: AIProvider,
  target: RewriteTarget,
  facts: FactsResult,
  draft: DraftResult,
  options: PipelineOptions,
): Promise<AuditResult> {
  const user = `你有两个任务，必须按顺序完成。

## 任务一：事实审计
逐句审查候选改写，优先审计你认为最可采用的候选。每句必须标注对应的 claim_id 或 fact_id：
1. 能在 facts/claims 中找到对应依据的句子 -> supported。
2. 属于合理推断且依据在前文出现过的句子 -> reasonable_inference。
3. 找不到任何依据的句子 -> unsupported。
4. 使用了 facts/claims 中不存在的具体案例、场景、数字、因果关系 -> fabricated。

关键规则：
- 审计必须逐条对照传入的 facts/claims。
- reader_implications/human_implications 中的推理也算有支撑，只要依据存在。
- claim_id/fact_id 只用于 audit JSON。result.body 中绝对不能出现任何 C1、F1 等标注。

## 任务二：润色
基于审计结果修改文章。终稿是给读者看的，不得包含 fact_id、claim_id、审计标记或内部注释。

润色目标：
- 像一位清醒的法学作者在解释和推进判断，不像新闻稿或政策宣传稿。
- 保持克制，不端着，不油滑。
- 删除 fabricated；unsupported 只能删除或改成明确的未证成问题。

选中原文：
${target.selectedText}

facts/claims JSON：
${JSON.stringify(facts)}

draft candidates JSON：
${JSON.stringify(draft)}

只输出 JSON。`;
  return parseJsonObject<AuditResult>(
    await provider.generate({
      system: SYSTEM,
      user,
      timeoutMs: options.timeoutMs,
      maxOutputTokens: options.maxOutputTokens,
      options: { responseMimeType: "application/json", responseJsonSchema: AUDIT_SCHEMA },
    }),
  );
}

async function runTitle(
  provider: AIProvider,
  target: RewriteTarget,
  audit: AuditResult,
  options: PipelineOptions,
): Promise<TitleResult> {
  const user = `你是论文标题编辑。基于改写后的段落/小节生成 3-5 个标题或小标题。

规则：
- 标题必须揭示本节的论证任务或核心张力。
- 不用“重塑、赋能、突破、范式”等大词。
- 不用读者看不懂的内部代号做主语。
- 可以有判断，但不得超过正文已经证明的范围。
- 中文法学论文风格，克制、准确、有问题意识。

原文：
${target.selectedText}

审计后正文：
${audit.result.body}

只输出 JSON。`;
  return parseJsonObject<TitleResult>(
    await provider.generate({
      system: SYSTEM,
      user,
      timeoutMs: options.timeoutMs,
      maxOutputTokens: options.maxOutputTokens,
      options: { responseMimeType: "application/json", responseJsonSchema: TITLE_SCHEMA },
    }),
  );
}

function assertFacts(value: FactsResult): void {
  if (!value || !Array.isArray(value.open_questions) || !Array.isArray(value.forbidden_claims)) {
    throw new Error("facts step returned invalid shape.");
  }
  if (!Array.isArray(value.hard_facts) && !Array.isArray(value.claims)) {
    throw new Error("facts step must include hard_facts or claims.");
  }
}

function assertStructure(value: StructureSection[]): void {
  if (!Array.isArray(value) || value.length === 0) throw new Error("structure step returned no sections.");
}

function assertDraft(value: DraftResult): void {
  if (!value || !Array.isArray(value.candidates) || value.candidates.length === 0) {
    throw new Error("draft step returned no candidates.");
  }
}

function assertAudit(value: AuditResult): void {
  if (!value?.result?.body || !Array.isArray(value.audit)) throw new Error("audit step returned invalid result.");
}

function assertTitle(value: TitleResult): void {
  if (!value || !Array.isArray(value.titles)) throw new Error("title step returned invalid result.");
}

const FACTS_SCHEMA = {
  type: "object",
  properties: {
    hard_facts: { type: "array" },
    claims: { type: "array" },
    human_implications: { type: "array" },
    reader_implications: { type: "array" },
    open_questions: { type: "array", items: { type: "string" } },
    forbidden_claims: { type: "array", items: { type: "string" } },
  },
  required: ["open_questions", "forbidden_claims"],
};

const STRUCTURE_SCHEMA = { type: "array", items: { type: "object" } };

const DRAFT_SCHEMA = {
  type: "object",
  properties: { candidates: { type: "array", items: { type: "object" } } },
  required: ["candidates"],
};

const AUDIT_SCHEMA = {
  type: "object",
  properties: {
    audit: { type: "array", items: { type: "object" } },
    result: { type: "object" },
  },
  required: ["audit", "result"],
};

const TITLE_SCHEMA = {
  type: "object",
  properties: { titles: { type: "array", items: { type: "object" } } },
  required: ["titles"],
};
