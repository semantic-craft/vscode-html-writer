import * as vscode from "vscode";
import { dirname } from "node:path";
import { ensureProjectArtifacts } from "./artifacts";
import { countCjk, escapeHtml, paragraphTextSet, renderMarkdownPaper } from "./markdown";
import { DEFAULT_PROVIDER_ORDER, MODEL_CATALOG, defaultModelForProvider, isKnownProviderModel, providerTitle } from "./modelCatalog";
import { ConfiguredProvider, FallbackProvider } from "./providers";
import { runRewritePipeline } from "./pipeline";
import { rangeTextMatches } from "./selection";
import type { AIProvider, DraftCandidate, FootnoteHealth, ParagraphBlock, PipelineArtifacts, PipelineStep, ProviderConfig, ProviderId, ProviderProtocol, ReasoningMode, RewriteTarget, SourceRange } from "./types";

type WebviewMessage =
  | { type: "selectParagraph"; paragraphId: string }
  | { type: "runPipeline" }
  | { type: "previewCandidate"; index: number }
  | { type: "applyCandidate"; index: number }
  | { type: "clearPreview" };

interface CandidateView extends DraftCandidate {
  source: "draft" | "audit";
}

export class ReaderPanel {
  static current: ReaderPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private previousParagraphTexts: Set<string> | undefined;
  private paragraphs = new Map<string, ParagraphBlock>();
  private selectedParagraphId: string | undefined;
  private pipeline: PipelineArtifacts | undefined;
  private activeTarget: RewriteTarget | undefined;
  private candidates: CandidateView[] = [];
  private preview: { candidate: CandidateView; range: SourceRange } | undefined;
  private status = "Ready";
  private running = false;

  static open(context: vscode.ExtensionContext, document: vscode.TextDocument): ReaderPanel {
    if (ReaderPanel.current) {
      ReaderPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      ReaderPanel.current.setDocument(document);
      return ReaderPanel.current;
    }
    ReaderPanel.current = new ReaderPanel(context, document);
    return ReaderPanel.current;
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private document: vscode.TextDocument,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "vscodeHtmlWriter.reader",
      `Paper Reader: ${document.fileName.split(/[\\/]/).pop() ?? "Markdown"}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.onDidDispose(() => {
      if (ReaderPanel.current === this) ReaderPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message));
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === this.document.uri.toString()) {
          this.render();
        }
      }),
    );
    this.render();
  }

  setDocument(document: vscode.TextDocument): void {
    this.document = document;
    this.clearPipelineState();
    this.selectedParagraphId = undefined;
    this.status = "Ready";
    this.render();
  }

  async runPipelineFromCommand(): Promise<void> {
    await this.runPipeline();
  }

  async previewCandidateFromCommand(): Promise<void> {
    const picked = await this.pickCandidate("Preview which candidate?");
    if (picked) this.previewCandidate(picked.index);
  }

  async applyCandidateFromCommand(): Promise<void> {
    const picked = await this.pickCandidate("Apply which candidate?");
    if (picked) await this.applyCandidate(picked.index);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "selectParagraph":
        if (this.selectedParagraphId !== message.paragraphId) {
          this.clearPipelineState();
          this.selectedParagraphId = message.paragraphId;
        }
        this.render();
        break;
      case "runPipeline":
        await this.runPipeline();
        break;
      case "previewCandidate":
        this.previewCandidate(message.index);
        break;
      case "applyCandidate":
        await this.applyCandidate(message.index);
        break;
      case "clearPreview":
        this.preview = undefined;
        this.render();
        break;
    }
  }

  private async runPipeline(): Promise<void> {
    if (this.running) {
      vscode.window.showInformationMessage("HTML Writer pipeline is already running.");
      return;
    }
    try {
      const target = this.resolveRewriteTarget();
      if (!target) throw new Error("Select text in the editor or click a paragraph in the reader first.");
      this.running = true;
      this.activeTarget = target;
      this.candidates = [];
      this.pipeline = undefined;
      this.preview = undefined;
      const workspaceDir = dirname(this.document.uri.fsPath);
      await ensureProjectArtifacts(workspaceDir);
      this.status = "Running five-step pipeline...";
      this.render();
      const provider = await createConfiguredProvider(this.context);
      const stepProviders = await createConfiguredStepProviders(this.context);
      const cfg = vscode.workspace.getConfiguration("vscodeHtmlWriter");
      this.pipeline = await runRewritePipeline(provider, target, {
        workspaceDir,
        timeoutMs: Math.max(1, cfg.get<number>("requestTimeoutSeconds", 60)) * 1000,
        maxOutputTokens: Math.max(512, cfg.get<number>("maxOutputTokens", 4096)),
        providerForStep: (step) => stepProviders.get(step) ?? provider,
        onStepStart: (step) => {
          this.status = `Pipeline ${stepLabel(step)}...`;
          this.render();
        },
        onStepComplete: (step) => {
          this.status = `Pipeline ${stepLabel(step)} complete`;
          this.render();
        },
      });
      this.candidates = buildCandidateViews(this.pipeline);
      this.status = `Pipeline complete: ${this.pipeline.sessionDir}`;
      this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = `Pipeline failed: ${message}`;
      vscode.window.showErrorMessage(this.status);
      this.render();
    } finally {
      this.running = false;
      this.render();
    }
  }

  private previewCandidate(index: number): void {
    const candidate = this.candidates[index];
    const target = this.activeTarget;
    if (!candidate || !target) return;
    if (!this.isActiveTargetCurrent()) {
      this.status = "Source changed after candidates were generated. Rerun the pipeline before preview/apply.";
      vscode.window.showWarningMessage(this.status);
      this.render();
      return;
    }
    this.preview = { candidate, range: target.range };
    this.status = `Previewing ${candidate.label}`;
    this.render();
  }

  private async applyCandidate(index: number): Promise<void> {
    const candidate = this.candidates[index];
    const target = this.activeTarget;
    if (!candidate || !target || !candidate.body.trim()) return;
    if (!this.isActiveTargetCurrent()) {
      this.status = "Source changed after candidates were generated. Rerun the pipeline before applying.";
      vscode.window.showWarningMessage(this.status);
      this.render();
      return;
    }
    const beforeParagraphTexts = paragraphTextSet(this.document.getText());
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, new vscode.Range(this.document.positionAt(target.range.start), this.document.positionAt(target.range.end)), candidate.body);
    const ok = await vscode.workspace.applyEdit(edit);
    if (ok) {
      await this.document.save();
      this.clearPipelineState();
      this.status = `Applied ${candidate.label}`;
      this.previousParagraphTexts = beforeParagraphTexts;
      this.render();
    } else {
      vscode.window.showErrorMessage("HTML Writer could not apply the selected candidate.");
    }
  }

  private resolveRewriteTarget(throwOnMissing = true): RewriteTarget | undefined {
    const editor = vscode.window.activeTextEditor;
    const cfg = vscode.workspace.getConfiguration("vscodeHtmlWriter");
    if (editor?.document.uri.toString() === this.document.uri.toString() && !editor.selection.isEmpty) {
      const start = this.document.offsetAt(editor.selection.start);
      const end = this.document.offsetAt(editor.selection.end);
      return {
        documentText: this.document.getText(),
        selectedText: this.document.getText(editor.selection),
        range: { start, end },
        styleGuide: cfg.get<string>("styleGuide", ""),
      };
    }
    if (this.selectedParagraphId) {
      const block = this.paragraphs.get(this.selectedParagraphId);
      if (block) {
        return {
          documentText: this.document.getText(),
          selectedText: this.document.getText().slice(block.range.start, block.range.end),
          range: block.range,
          paragraphId: block.id,
          styleGuide: cfg.get<string>("styleGuide", ""),
        };
      }
    }
    if (throwOnMissing) throw new Error("Select text in the editor or click a paragraph in the reader first.");
    return undefined;
  }

  private async pickCandidate(placeHolder: string): Promise<{ index: number } | undefined> {
    if (!this.candidates.length) {
      vscode.window.showWarningMessage("Run the rewrite pipeline first.");
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      this.candidates.map((candidate, index) => ({
        label: `${candidate.candidate_id} · ${candidate.label}`,
        description: candidate.source,
        detail: candidate.revision_note ?? candidate.body.slice(0, 120),
        index,
      })),
      { placeHolder },
    );
    return picked ? { index: picked.index } : undefined;
  }

  private render(): void {
    const source = this.document.getText();
    const rendered = renderMarkdownPaper(source, {
      previousParagraphTexts: this.previousParagraphTexts,
      previewRange: this.preview ? { ...this.preview.range, body: this.preview.candidate.body } : undefined,
    });
    this.previousParagraphTexts = paragraphTextSet(source);
    this.paragraphs = new Map(rendered.paragraphs.map((p) => [p.id, p]));
    this.panel.webview.html = this.html(rendered.html, rendered.bodyText, rendered.footnoteHealth, rendered.paragraphs);
  }

  private html(paperHtml: string, bodyText: string, footnoteHealth: FootnoteHealth, paragraphs: ParagraphBlock[]): string {
    const selected = this.selectedParagraphId ? this.paragraphs.get(this.selectedParagraphId) : undefined;
    const wordCount = countCjk(bodyText);
    const cockpit = selected ? diagnoseParagraph(selected.text) : undefined;
    const candidatesJson = JSON.stringify(this.candidates);
    const titlesHtml = this.pipeline ? renderTitleCandidates(this.pipeline) : "";
    const selectedJson = JSON.stringify(this.selectedParagraphId ?? "");
    const previewId = this.preview?.candidate.candidate_id ?? "";
    const canUseCandidates = Boolean(this.candidates.length && this.activeTarget && this.isActiveTargetCurrent() && !this.running);
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${READER_CSS}</style>
</head>
<body>
  <div id="wc">正文 <b>${wordCount}</b> 字 · ${renderFootnoteHealth(footnoteHealth)}</div>
  <main id="paper">${paperHtml}</main>
  <aside id="cockpit">
    <h2>Review Cockpit</h2>
    <div class="status">${escapeHtml(this.status)}</div>
    ${this.preview ? `<div class="previewing">Previewing: ${escapeHtml(this.preview.candidate.label)} <button id="clearPreview">Clear</button></div>` : ""}
    ${selected ? renderCockpit(selected, cockpit) : `<p class="muted">点击正文段落，或在编辑器中选择文本后运行 Pipeline。</p>`}
    <button id="runPipeline" ${this.running ? "disabled" : ""}>Run Five-Step Pipeline</button>
    ${titlesHtml}
    <h3>Candidates</h3>
    <div id="candidates"></div>
  </aside>
<script>
const vscode = acquireVsCodeApi();
const candidates = ${candidatesJson};
const selectedId = ${selectedJson};
const previewId = ${JSON.stringify(previewId)};
const canUseCandidates = ${JSON.stringify(canUseCandidates)};
function post(type, extra = {}) { vscode.postMessage({ type, ...extra }); }
function wireParagraphs() {
  document.querySelectorAll("[data-paragraph-id]").forEach((p) => {
    if (p.dataset.paragraphId === selectedId) p.classList.add("selected");
    p.addEventListener("click", () => post("selectParagraph", { paragraphId: p.dataset.paragraphId }));
  });
}
function buildTOC() {
  const heads = Array.from(document.querySelectorAll("#paper h1,#paper h2,#paper h3"));
  if (!heads.length) return;
  const nav = document.createElement("nav");
  nav.id = "toc";
  heads.forEach((h, i) => {
    if (!h.id) h.id = "sec-" + i;
    const a = document.createElement("a");
    a.textContent = h.textContent || "";
    a.href = "#" + h.id;
    if (h.tagName === "H3") a.className = "lv3";
    nav.appendChild(a);
  });
  document.body.appendChild(nav);
}
function wireFootnotes() {
  const tip = document.createElement("div");
  tip.id = "fntip";
  document.body.appendChild(tip);
  document.querySelectorAll("a.footnote-ref").forEach((ref) => {
    ref.addEventListener("mouseenter", () => {
      const li = document.getElementById((ref.getAttribute("href") || "").slice(1));
      if (!li) return;
      tip.innerHTML = li.innerHTML;
      tip.style.display = "block";
      const r = ref.getBoundingClientRect();
      tip.style.top = (window.scrollY + r.bottom + 6) + "px";
      tip.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - tip.offsetWidth - 16)) + "px";
    });
    ref.addEventListener("mouseleave", () => { tip.style.display = "none"; });
  });
}
function renderCandidates() {
  const root = document.getElementById("candidates");
  if (!root) return;
  root.innerHTML = "";
  if (!candidates.length) {
    root.innerHTML = '<p class="muted">Pipeline 尚未生成候选。</p>';
    return;
  }
  candidates.forEach((c, index) => {
    const card = document.createElement("section");
    card.className = "candidate" + (c.candidate_id === previewId ? " active" : "");
    card.innerHTML = '<h4>' + c.candidate_id + ' · ' + c.label + '</h4><p>' + escapeHtml(c.revision_note || "") + '</p>';
    const body = document.createElement("pre");
    body.className = "candidate-body";
    body.textContent = c.body || "";
    card.appendChild(body);
    const preview = document.createElement("button");
    preview.textContent = "Preview";
    preview.disabled = !canUseCandidates;
    preview.addEventListener("click", () => post("previewCandidate", { index }));
    const apply = document.createElement("button");
    apply.textContent = "Apply";
    apply.disabled = !canUseCandidates;
    apply.addEventListener("click", () => post("applyCandidate", { index }));
    card.appendChild(preview);
    card.appendChild(apply);
    root.appendChild(card);
  });
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}
document.getElementById("runPipeline")?.addEventListener("click", () => post("runPipeline"));
document.getElementById("clearPreview")?.addEventListener("click", () => post("clearPreview"));
window.addEventListener("scroll", () => vscode.setState({ y: window.scrollY }), { passive: true });
const oldState = vscode.getState();
wireParagraphs(); buildTOC(); wireFootnotes(); renderCandidates();
if (oldState && typeof oldState.y === "number") window.scrollTo(0, oldState.y);
</script>
</body>
</html>`;
  }

  private isActiveTargetCurrent(): boolean {
    return Boolean(this.activeTarget && rangeTextMatches(this.document.getText(), this.activeTarget.range, this.activeTarget.selectedText));
  }

  private clearPipelineState(): void {
    this.pipeline = undefined;
    this.activeTarget = undefined;
    this.candidates = [];
    this.preview = undefined;
  }
}

async function createConfiguredProvider(context: vscode.ExtensionContext): Promise<AIProvider> {
  return createProviderChain(context);
}

async function createConfiguredStepProviders(context: vscode.ExtensionContext): Promise<Map<PipelineStep, AIProvider>> {
  const cfg = vscode.workspace.getConfiguration("vscodeHtmlWriter");
  const raw = cfg.get<Record<string, unknown>>("stepProviders", {});
  const providers = new Map<PipelineStep, AIProvider>();
  for (const [step, provider] of Object.entries(raw ?? {})) {
    if (isPipelineStep(step) && isProviderId(provider)) {
      providers.set(step, await createProviderChain(context, provider));
    }
  }
  return providers;
}

async function createProviderChain(context: vscode.ExtensionContext, preferredProvider?: ProviderId): Promise<AIProvider> {
  const cfg = vscode.workspace.getConfiguration("vscodeHtmlWriter");
  const configuredDefault = cfg.get<string>("provider", "qwen");
  const firstProvider = preferredProvider ?? (isProviderId(configuredDefault) ? configuredDefault : "qwen");
  const ids = providerOrder(firstProvider, cfg.get<string>("providerOrder", DEFAULT_PROVIDER_ORDER.join(",")));
  const configs = (await Promise.all(ids.map(async (id) => providerConfigsFromSettings(context, id)))).flat();
  const providers = configs.map((config) => new ConfiguredProvider(config));
  return providers.length === 1 ? providers[0] : new FallbackProvider(providers);
}

export async function setProviderApiKey(context: vscode.ExtensionContext): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    DEFAULT_PROVIDER_ORDER.map((id) => ({ label: id, description: providerTitle(id) })),
    { placeHolder: "Provider" },
  );
  if (!picked) return;
  const providerId = picked.label as ProviderId;
  const value = await vscode.window.showInputBox({ prompt: `API key for ${providerId}`, password: true, ignoreFocusOut: true });
  if (!value) return;
  await context.secrets.store(secretKey(providerId), value.trim());
  vscode.window.showInformationMessage(`Stored ${providerId} API key.`);
}

export async function setProviderModel(providerId?: ProviderId, modelId?: string): Promise<void> {
  let selectedProvider = providerId;
  if (!selectedProvider || !isProviderId(selectedProvider)) {
    const picked = await vscode.window.showQuickPick(
      DEFAULT_PROVIDER_ORDER.map((id) => ({ label: id, description: providerTitle(id) })),
      { placeHolder: "Provider" },
    );
    if (!picked) return;
    selectedProvider = picked.label as ProviderId;
  }

  let selectedModel = modelId;
  if (!selectedModel || !isKnownProviderModel(selectedProvider, selectedModel)) {
    const picked = await vscode.window.showQuickPick(
      MODEL_CATALOG[selectedProvider].models.map((model) => ({
        label: model.id,
        description: model.label,
        detail: model.description,
      })),
      { placeHolder: `${providerTitle(selectedProvider)} model` },
    );
    if (!picked) return;
    selectedModel = picked.label;
  }

  await vscode.workspace
    .getConfiguration("vscodeHtmlWriter")
    .update(`${selectedProvider}.model`, selectedModel, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`HTML Writer ${providerTitle(selectedProvider)} model set to ${selectedModel}.`);
}

async function providerConfigsFromSettings(context: vscode.ExtensionContext, id: ProviderId): Promise<ProviderConfig[]> {
  const cfg = vscode.workspace.getConfiguration("vscodeHtmlWriter");
  const apiKey = await apiKeyForProvider(context, id);
  const common = {
    id,
    apiKey,
    model: cfg.get<string>(`${id}.model`, defaultModelForProvider(id)),
    reasoningMode: cfg.get<ReasoningMode>("reasoningMode", "off"),
  };
  if (id === "qwen") {
    const protocol = cfg.get<ProviderProtocol>("qwen.protocol", "anthropic");
    const primary = qwenConfig(common, protocol);
    const fallbackAnthropic = cfg.get<boolean>("qwen.fallbackAnthropic", true);
    if (!fallbackAnthropic) return [primary];
    const fallbackProtocol: ProviderProtocol = protocol === "anthropic" ? "openai" : "anthropic";
    return [primary, qwenConfig(common, fallbackProtocol)];
  }
  if (id === "mimo") {
    return [mimoConfig(common, cfg.get<ProviderProtocol>("mimo.protocol", "anthropic"))];
  }
  return [
    {
      ...common,
      title: providerTitle(id),
      baseURL: cfg.get<string>(`${id}.baseURL`, defaultBaseURL(id)),
      protocol: defaultProtocol(id),
    },
  ];
}

const PROVIDER_IDS = new Set<ProviderId>(DEFAULT_PROVIDER_ORDER);
const PIPELINE_STEPS = new Set<PipelineStep>(["facts", "structure", "draft", "audit", "title"]);

function providerOrder(first: ProviderId, orderSetting: string): ProviderId[] {
  const configured = orderSetting
    .split(",")
    .map((item) => item.trim())
    .filter(isProviderId);
  const ordered = configured.length ? configured : DEFAULT_PROVIDER_ORDER;
  return Array.from(new Set<ProviderId>([first, ...ordered]));
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDER_IDS.has(value as ProviderId);
}

function isPipelineStep(value: unknown): value is PipelineStep {
  return typeof value === "string" && PIPELINE_STEPS.has(value as PipelineStep);
}

function secretKey(id: ProviderId): string {
  return `vscodeHtmlWriter.${id}.apiKey`;
}

async function apiKeyForProvider(context: vscode.ExtensionContext, id: ProviderId): Promise<string> {
  if (id === "qwen") return tokenPlanApiKey(context);
  return (await context.secrets.get(secretKey(id))) || officialEnvApiKey(id) || "";
}

async function tokenPlanApiKey(context: vscode.ExtensionContext): Promise<string> {
  return (await context.secrets.get(secretKey("qwen"))) || tokenPlanEnvApiKey() || "";
}

function tokenPlanEnvApiKey(): string | undefined {
  return process.env.TOKEN_PLAN_API_KEY
    || process.env.BAILIAN_TOKEN_PLAN_API_KEY
    || process.env.QWEN_TOKEN_PLAN_API_KEY
    || process.env.QWEN_API_KEY;
}

function officialEnvApiKey(id: ProviderId): string | undefined {
  switch (id) {
    case "qwen":
      return tokenPlanEnvApiKey();
    case "deepseek":
      return process.env.DEEPSEEK_API_KEY;
    case "gemini":
      return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    case "mimo":
      return process.env.MIMO_API_KEY;
  }
}

function defaultBaseURL(id: ProviderId): string {
  return {
    qwen: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    deepseek: "https://api.deepseek.com/anthropic",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    anthropic: "https://api.anthropic.com",
    mimo: "https://token-plan-cn.xiaomimimo.com/v1",
  }[id];
}

function defaultQwenAnthropicBaseURL(): string {
  return "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic";
}

function defaultMimoAnthropicBaseURL(): string {
  return "https://token-plan-cn.xiaomimimo.com/anthropic";
}

function defaultProtocol(id: ProviderId): ProviderProtocol {
  return ({
    qwen: "anthropic",
    deepseek: "anthropic",
    gemini: "gemini",
    anthropic: "anthropic",
    mimo: "anthropic",
  } as const)[id];
}

function qwenConfig(
  common: Omit<ProviderConfig, "title" | "baseURL" | "protocol">,
  protocol: ProviderProtocol,
): ProviderConfig {
  const cfg = vscode.workspace.getConfiguration("vscodeHtmlWriter");
  if (protocol === "anthropic") {
    return {
      ...common,
      title: "Qwen Token Plan (Anthropic)",
      baseURL: cfg.get<string>("qwen.anthropicBaseURL", defaultQwenAnthropicBaseURL()),
      protocol,
    };
  }
  return {
    ...common,
    title: "Qwen Token Plan (OpenAI)",
    baseURL: cfg.get<string>("qwen.baseURL", defaultBaseURL("qwen")),
    protocol: "openai",
  };
}

function mimoConfig(
  common: Omit<ProviderConfig, "title" | "baseURL" | "protocol">,
  protocol: ProviderProtocol,
): ProviderConfig {
  const cfg = vscode.workspace.getConfiguration("vscodeHtmlWriter");
  if (protocol === "anthropic") {
    return {
      ...common,
      title: "MiMo Token Plan (Anthropic)",
      baseURL: cfg.get<string>("mimo.anthropicBaseURL", defaultMimoAnthropicBaseURL()),
      protocol,
    };
  }
  return {
    ...common,
    title: "MiMo Token Plan (OpenAI)",
    baseURL: cfg.get<string>("mimo.baseURL", defaultBaseURL("mimo")),
    protocol: "openai",
  };
}

function stepLabel(step: PipelineStep): string {
  return {
    facts: "1/5 facts",
    structure: "2/5 structure",
    draft: "3/5 draft",
    audit: "4/5 audit",
    title: "5/5 title",
  }[step];
}

function buildCandidateViews(pipeline: PipelineArtifacts): CandidateView[] {
  const draft = pipeline.draft.candidates.map((candidate) => ({ ...candidate, source: "draft" as const }));
  const audited: CandidateView = {
    candidate_id: "AUDITED",
    label: "审计润色版",
    body: pipeline.audit.result.body,
    revision_note: `risk: ${pipeline.audit.result.risk_level}`,
    source: "audit",
  };
  return [...draft, audited];
}

function renderTitleCandidates(pipeline: PipelineArtifacts): string {
  if (!pipeline.title.titles.length) return "";
  return `<section class="title-candidates">
    <h3>Titles</h3>
    <ul>${pipeline.title.titles.map((item) => `<li><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.logic)}</span></li>`).join("")}</ul>
  </section>`;
}

function diagnoseParagraph(text: string): { task: string; claim: string; issues: string[]; actions: string[] } {
  const issues: string[] = [];
  if (/[，、](可[^，。；;]{1,8}){2,}/.test(text) || /可[^，。；;]+、可[^，。；;]+、可/.test(text)) issues.push("可能存在连续“可X”式机械清单。");
  if (!/[。！？]$/.test(text.trim())) issues.push("段落结尾可能不完整。");
  if (/(应当|必须|国家|公共目的|责任|边界|退出|限制)/.test(text) && !/\[\^[^\]]+\]/.test(text)) issues.push("规范性判断可能需要脚注或来源支撑。");
  if (text.length > 450) issues.push("段落偏长，适合拆分或压缩。");
  return {
    task: inferTask(text),
    claim: firstSentence(text),
    issues: issues.length ? issues : ["未发现明显形式问题，建议从论证任务和上下文衔接判断。"],
    actions: ["保守小改", "收紧压缩", "结构重写"],
  };
}

function inferTask(text: string): string {
  if (/概念|定义|所谓|是指/.test(text)) return "概念界定";
  if (/然而|但是|问题在于|并非/.test(text)) return "转折或反驳";
  if (/因此|由此|所以|这意味着/.test(text)) return "归纳判断";
  if (/应当|必须|可以|需要/.test(text)) return "规范展开";
  return "论证推进";
}

function firstSentence(text: string): string {
  return text.split(/(?<=[。！？])/u)[0]?.trim() || text.slice(0, 80);
}

function renderCockpit(block: ParagraphBlock, cockpit: ReturnType<typeof diagnoseParagraph> | undefined): string {
  if (!cockpit) return "";
  return `<section class="selected-card">
    <h3>${escapeHtml(block.id)}</h3>
    <p class="quote">${escapeHtml(block.text)}</p>
    <dl>
      <dt>段落任务</dt><dd>${escapeHtml(cockpit.task)}</dd>
      <dt>核心判断</dt><dd>${escapeHtml(cockpit.claim)}</dd>
      <dt>主要问题</dt><dd><ul>${cockpit.issues.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></dd>
      <dt>建议动作</dt><dd>${cockpit.actions.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</dd>
    </dl>
  </section>`;
}

function renderFootnoteHealth(health: FootnoteHealth): string {
  const issues = [
    health.undefined.length ? `未定义 ${health.undefined.join(", ")}` : "",
    health.dangling.length ? `未引用 ${health.dangling.join(", ")}` : "",
    health.duplicated.length ? `重复引用 ${health.duplicated.join(", ")}` : "",
  ].filter(Boolean);
  if (!issues.length) return `<span class="fn-ok">脚注 ${health.total} · OK</span>`;
  return `<span class="fn-warn" title="${escapeHtml(issues.join("；"))}">脚注 ${health.total} · ${issues.length} 项需查</span>`;
}

const READER_CSS = `
:root {
  --song: "Times New Roman", "Songti SC", STSong, SimSun, serif;
  --kai: "Times New Roman", "Kaiti SC", STKaiti, KaiTi, serif;
  --hei: "Heiti SC", "PingFang SC", STHeiti, SimHei, sans-serif;
  --ink: #1a1a1a;
  --accent: #8a1f1f;
  --paper: #fffef9;
  --edge: #e3ddd0;
}
* { box-sizing: border-box; }
body { margin: 0; background: #e9e6df; color: var(--ink); font-family: var(--song); font-size: 17px; line-height: 1.8; }
#paper { max-width: 48em; margin: 0 auto; padding: 3.5em 3em 7em; background: var(--paper); min-height: 100vh; box-shadow: 0 0 0 1px rgba(0,0,0,.04); }
h1, h2 { text-align: center; font-weight: 700; }
h1 { font-size: 2.2em; margin: 1.1em 0 .8em; }
h2 { font-size: 1.55em; margin: 1.5em 0 .7em; }
h3 { font-size: 1.2em; margin: 1.3em 0 .5em; }
p { text-align: justify; text-indent: 2em; margin: .16em 0; border-radius: 4px; }
p[data-paragraph-id] { cursor: pointer; }
p[data-paragraph-id]:hover { background: #f5eddb; }
p.selected { outline: 2px solid var(--accent); background: #fff5d4; }
.edited { background: linear-gradient(transparent 60%, #fff1a8 60%); }
.footnote-ref { color: var(--accent); text-decoration: none; }
section.footnotes { border-top: 1px solid var(--edge); margin-top: 3em; padding-top: .5em; font-size: .86em; }
section.footnotes::before { content: "注　释"; display: block; font-weight: 700; margin-bottom: .4em; }
section.footnotes p { text-indent: 0; }
#wc { position: fixed; top: 10px; right: 360px; z-index: 5; font: 12px/1.5 var(--hei); background: rgba(26,26,26,.86); color: #f4efe6; padding: 6px 10px; border-radius: 8px; }
#wc b { color: #ffd9a0; }
.fn-ok { color: #bce6b8; }
.fn-warn { color: #ffd08a; cursor: help; }
#toc { position: fixed; top: 52px; left: 12px; width: 15em; max-height: 80vh; overflow: auto; font: 13px/1.5 var(--hei); background: rgba(255,254,249,.96); border: 1px solid var(--edge); border-radius: 8px; padding: 8px 6px; }
#toc a { display: block; color: #444; text-decoration: none; padding: 2px 6px; border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#toc a.lv3 { padding-left: 18px; color: #777; font-size: .92em; }
#toc a:hover { background: #f0e8d8; }
#fntip { position: absolute; z-index: 20; display: none; max-width: 30em; font: 13px/1.6 var(--song); background: #1a1a1a; color: #f4efe6; padding: 8px 11px; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
#cockpit { position: fixed; top: 0; right: 0; bottom: 0; width: 340px; overflow: auto; padding: 14px; background: #f8f6f1; border-left: 1px solid #d8d1c3; font-family: var(--hei); font-size: 13px; line-height: 1.55; }
#cockpit h2 { text-align: left; margin: 0 0 8px; font-size: 18px; }
#cockpit h3 { margin: 12px 0 6px; }
#cockpit button { margin: 6px 6px 6px 0; padding: 5px 9px; border: 1px solid #b9ad9a; border-radius: 6px; background: white; cursor: pointer; }
.status, .previewing { padding: 8px; border-radius: 6px; background: #eee7d8; margin-bottom: 8px; }
.muted { color: #766e62; }
.quote { max-height: 11em; overflow: auto; text-indent: 0; font-family: var(--song); background: white; padding: 8px; border: 1px solid #e1dacd; border-radius: 6px; }
dt { font-weight: 700; margin-top: 7px; }
dd { margin-left: 0; }
.chip { display: inline-block; margin: 2px 4px 2px 0; padding: 2px 6px; background: #eadfc9; border-radius: 999px; }
.title-candidates ul { margin: 4px 0 10px; padding-left: 18px; }
.title-candidates li { margin: 4px 0; }
.title-candidates span { display: block; color: #766e62; }
.candidate { border: 1px solid #ded5c6; background: white; border-radius: 8px; padding: 8px; margin: 8px 0; }
.candidate.active { border-color: var(--accent); background: #fff5d4; }
.candidate h4 { margin: 0 0 4px; }
.candidate-body { margin: 6px 0; max-height: 13em; overflow: auto; white-space: pre-wrap; font: 13px/1.7 var(--song); background: #fffdf8; border: 1px solid #eee5d4; border-radius: 6px; padding: 7px; }
button:disabled { cursor: not-allowed; opacity: .45; }
@media (max-width: 1180px) { #toc { display: none; } #wc { right: 360px; } }
@media (max-width: 900px) { #cockpit { position: static; width: auto; } #wc { right: 12px; } #paper { padding: 2em 1.4em; } }
`;
