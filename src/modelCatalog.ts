import type { ProviderId } from "./types";

export type ModelRole = "fast" | "balanced" | "strong" | "snapshot" | "coding" | "official";

export interface ModelInfo {
  id: string;
  label: string;
  role: ModelRole;
  description: string;
  recommended?: boolean;
}

export interface ProviderCatalog {
  id: ProviderId;
  title: string;
  defaultModel: string;
  protocolNote: string;
  models: ModelInfo[];
}

export const DEFAULT_PROVIDER_ORDER: ProviderId[] = ["qwen", "deepseek", "gemini", "anthropic", "mimo"];

export const MODEL_CATALOG: Record<ProviderId, ProviderCatalog> = {
  qwen: {
    id: "qwen",
    title: "Qwen Token Plan",
    defaultModel: "qwen3.6-flash",
    protocolNote: "Anthropic Messages first; OpenAI-compatible fallback is still available.",
    models: [
      { id: "qwen3.7-max", label: "Qwen 3.7 Max", role: "strong", description: "Strongest current Qwen option for difficult rewrite and audit passes.", recommended: true },
      { id: "qwen3.7-max-2026-05-20", label: "Qwen 3.7 Max Snapshot", role: "snapshot", description: "Pinned Qwen 3.7 Max snapshot for reproducible runs." },
      { id: "qwen3.6-plus", label: "Qwen 3.6 Plus", role: "balanced", description: "Balanced reasoning model for routine draft and audit work." },
      { id: "qwen3.6-flash", label: "Qwen 3.6 Flash", role: "fast", description: "Fast default for frequent five-step pipeline runs.", recommended: true },
      { id: "qwen3-coder-next", label: "Qwen 3 Coder Next", role: "coding", description: "Coding-oriented Qwen model for extension or script-heavy tasks." },
      { id: "qwen3-coder-plus", label: "Qwen 3 Coder Plus", role: "coding", description: "Stable coding-oriented Qwen option." },
    ],
  },
  deepseek: {
    id: "deepseek",
    title: "DeepSeek",
    defaultModel: "deepseek-v4-flash",
    protocolNote: "Official Anthropic-compatible endpoint only: https://api.deepseek.com/anthropic.",
    models: [
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", role: "strong", description: "Stronger V4 option for hard reasoning, audit, and long-context work.", recommended: true },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", role: "fast", description: "Fast and economical V4 default with 1M context.", recommended: true },
    ],
  },
  gemini: {
    id: "gemini",
    title: "Gemini",
    defaultModel: "gemini-3.5-flash",
    protocolNote: "Native Gemini generateContent endpoint.",
    models: [
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", role: "fast", description: "Fast frontier model for real-time preview and frequent rewrites.", recommended: true },
      { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro", role: "strong", description: "User-facing alias; requests normalize to gemini-3.1-pro-preview.", recommended: true },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", role: "official", description: "Official Gemini API model ID for 3.1 Pro." },
      { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", role: "fast", description: "Official 3-series Flash preview option." },
      { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", role: "fast", description: "Cost-efficient high-volume Gemini 3.1 option." },
    ],
  },
  anthropic: {
    id: "anthropic",
    title: "Anthropic Claude",
    defaultModel: "claude-sonnet-4-6",
    protocolNote: "Native Anthropic Messages endpoint.",
    models: [
      { id: "claude-opus-4-8", label: "Claude Opus 4.8", role: "strong", description: "Anthropic's most capable current model for complex reasoning and agentic coding.", recommended: true },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", role: "balanced", description: "Best speed/intelligence balance for everyday writing and review.", recommended: true },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", role: "fast", description: "Fastest current Claude option with near-frontier intelligence." },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 Alias", role: "official", description: "Convenience alias for Claude Haiku 4.5." },
    ],
  },
  mimo: {
    id: "mimo",
    title: "MiMo Token Plan",
    defaultModel: "mimo-v2.5",
    protocolNote: "Anthropic-compatible endpoint by default; OpenAI-compatible endpoint remains available.",
    models: [
      { id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro", role: "strong", description: "Flagship MiMo V2.5 model for harder agentic and review work.", recommended: true },
      { id: "mimo-v2.5", label: "MiMo V2.5", role: "balanced", description: "Default MiMo model with lower credit consumption.", recommended: true },
      { id: "mimo-v2-omni", label: "MiMo V2 Omni", role: "official", description: "Earlier omni-modal MiMo option still covered by Token Plan." },
      { id: "mimo-v2-pro", label: "MiMo V2 Pro", role: "official", description: "Earlier Pro MiMo option still covered by Token Plan." },
    ],
  },
};

export function providerTitle(id: ProviderId): string {
  return MODEL_CATALOG[id].title;
}

export function defaultModelForProvider(id: ProviderId): string {
  return MODEL_CATALOG[id].defaultModel;
}

export function modelsForProvider(id: ProviderId): ModelInfo[] {
  return MODEL_CATALOG[id].models;
}

export function modelIdsForProvider(id: ProviderId): string[] {
  return modelsForProvider(id).map((model) => model.id);
}

export function isKnownProviderModel(id: ProviderId, modelId: string): boolean {
  return modelIdsForProvider(id).includes(modelId);
}
