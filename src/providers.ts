import type { GenerateRequest, GenerationOptions, ProviderConfig, ProviderId } from "./types";

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
  base_resp?: { status_msg?: string };
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string; status?: string };
}

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export class ProviderHTTPError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderHTTPError";
  }
}

export class ConfiguredProvider {
  readonly id: ProviderId;

  constructor(
    private readonly config: ProviderConfig,
    private readonly fetcher: Fetcher = fetch,
  ) {
    this.id = config.id;
  }

  async generate(request: GenerateRequest): Promise<string> {
    if (!this.config.apiKey.trim()) {
      throw new ProviderHTTPError(`${this.config.title} API key is not configured.`);
    }
    switch (this.config.protocol) {
      case "gemini":
        return this.generateGemini(request);
      case "anthropic":
        return this.generateAnthropic(request);
      case "openai":
        return this.generateOpenAI(request);
    }
  }

  private async generateOpenAI(request: GenerateRequest): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      stream: false,
      temperature: 0.2,
      max_tokens: request.maxOutputTokens,
    };
    applyOpenAIResponseFormat(body, request.options ?? {}, this.config.id);
    applyOpenAIProviderQuirks(body, this.config);
    if (needsPromptEmbeddedSchema(this.config.id, request.options ?? {})) {
      const prompted = applyStructuredPromptOptions({ system: request.system, user: request.user }, request.options ?? {});
      body.messages = [
        { role: "system", content: prompted.system },
        { role: "user", content: prompted.user },
      ];
    }

    const json = await postJson<OpenAIResponse>(
      this.fetcher,
      chatCompletionsUrl(this.config.baseURL),
      request.timeoutMs,
      openAIHeaders(this.config),
      body,
    );
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new ProviderHTTPError(extractError(json) ?? `${this.config.title} returned an empty response.`);
    return cleanModelOutput(content);
  }

  private async generateAnthropic(request: GenerateRequest): Promise<string> {
    const prompted = applyStructuredPromptOptions({ system: request.system, user: request.user }, request.options ?? {});
    const body: Record<string, unknown> = {
      model: this.config.model,
      system: prompted.system,
      messages: [{ role: "user", content: prompted.user }],
      max_tokens: request.maxOutputTokens,
      temperature: 0.2,
      stream: false,
    };
    if (this.config.reasoningMode === "off") {
      body.thinking = { type: "disabled" };
    }

    const json = await postJson<AnthropicResponse>(
      this.fetcher,
      anthropicMessagesUrl(this.config.baseURL),
      request.timeoutMs,
      anthropicHeaders(this.config),
      body,
    );
    const content = json.content?.map((part) => part.text ?? "").join("").trim();
    if (!content) throw new ProviderHTTPError(json.error?.message ?? `${this.config.title} returned an empty response.`);
    return cleanModelOutput(content);
  }

  private async generateGemini(request: GenerateRequest): Promise<string> {
    const generationConfig: Record<string, unknown> = {
      temperature: 0.2,
      maxOutputTokens: request.maxOutputTokens,
    };
    if (request.options?.responseMimeType === "application/json" || request.options?.responseJsonSchema) {
      generationConfig.responseMimeType = "application/json";
    }
    const prompted = applyStructuredPromptOptions({ system: request.system, user: request.user }, request.options ?? {});
    const json = await postJson<GeminiResponse>(
      this.fetcher,
      geminiGenerateContentUrl(this.config.baseURL, this.config.model),
      request.timeoutMs,
      {
        "x-goog-api-key": this.config.apiKey,
        "Content-Type": "application/json",
      },
      {
        system_instruction: { parts: [{ text: prompted.system }] },
        contents: [{ role: "user", parts: [{ text: prompted.user }] }],
        generationConfig,
      },
    );
    const content = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!content) throw new ProviderHTTPError(json.error?.message ?? `${this.config.title} returned an empty response.`);
    return cleanModelOutput(content);
  }
}

export class FallbackProvider {
  readonly id = "fallback" as const;

  constructor(private readonly providers: ConfiguredProvider[]) {}

  async generate(request: GenerateRequest): Promise<string> {
    const errors: string[] = [];
    for (const provider of this.providers) {
      try {
        return await provider.generate(request);
      } catch (error) {
        errors.push(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new ProviderHTTPError(`All providers failed. ${errors.join(" | ")}`);
  }
}

export function cleanModelOutput(content: string): string {
  let text = content.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) text = fence[1].trim();
  return text;
}

export function parseJsonObject<T>(content: string): T {
  const cleaned = cleanModelOutput(content);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new Error(`Provider returned invalid JSON: ${cleaned.slice(0, 180)}`);
  }
}

export function parseJsonArray<T>(content: string): T {
  const cleaned = cleanModelOutput(content);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new Error(`Provider returned invalid JSON array: ${cleaned.slice(0, 180)}`);
  }
}

async function postJson<T>(
  fetcher: Fetcher,
  url: string,
  timeoutMs: number,
  headers: Record<string, string>,
  body: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new ProviderHTTPError(`${response.status} ${response.statusText}: ${text.slice(0, 240)}`);
    }
    if (!response.ok) {
      throw new ProviderHTTPError(`${response.status} ${response.statusText}: ${extractError(parsed) ?? text.slice(0, 240)}`);
    }
    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

function applyOpenAIResponseFormat(body: Record<string, unknown>, options: GenerationOptions, providerId: ProviderId): void {
  if (options.responseJsonSchema) {
    if (providerId === "mimo" || providerId === "qwen") {
      body.response_format = { type: "json_object" };
      return;
    }
    body.response_format = { type: "json_schema", json_schema: { name: "structured_response", strict: true, schema: options.responseJsonSchema } };
    return;
  }
  if (options.responseMimeType === "application/json") {
    body.response_format = { type: "json_object" };
  }
}

function applyOpenAIProviderQuirks(body: Record<string, unknown>, config: ProviderConfig): void {
  if (config.id === "mimo") {
    body.thinking = { type: config.reasoningMode === "on" ? "enabled" : "disabled" };
  }
  if (config.id === "qwen" && config.reasoningMode !== "auto") {
    body.enable_thinking = config.reasoningMode === "on";
  }
}

function needsPromptEmbeddedSchema(providerId: ProviderId, options: GenerationOptions): boolean {
  return (providerId === "mimo" || providerId === "qwen") && Boolean(options.responseJsonSchema || options.responseMimeType);
}

function applyStructuredPromptOptions(
  prompt: { system: string; user: string },
  options: GenerationOptions,
): { system: string; user: string } {
  if (!options.responseJsonSchema && options.responseMimeType !== "application/json") return prompt;
  const constraints = [
    "Return only valid JSON. Do not wrap it in Markdown or add commentary.",
    "Return the requested data object/array, not the schema.",
  ];
  if (options.responseJsonSchema) constraints.push(`JSON schema: ${JSON.stringify(options.responseJsonSchema)}`);
  return { system: `${prompt.system}\n\nStructured output requirements:\n${constraints.join("\n")}`, user: prompt.user };
}

function chatCompletionsUrl(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, "");
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

function anthropicMessagesUrl(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, "");
  if (/\/messages$/.test(base)) return base;
  if (/\/v1$/.test(base)) return `${base}/messages`;
  return `${base}/v1/messages`;
}

function geminiGenerateContentUrl(baseURL: string, model: string): string {
  const base = baseURL.replace(/\/+$/, "");
  return `${base}/models/${encodeURIComponent(normalizeGeminiModel(model))}:generateContent`;
}

function normalizeGeminiModel(model: string): string {
  if (model === "gemini-3.1-pro") return "gemini-3.1-pro-preview";
  return model;
}

function openAIHeaders(config: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };
  if (config.id === "mimo") headers["api-key"] = config.apiKey;
  return headers;
}

function anthropicHeaders(config: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
  if (config.id === "mimo") {
    headers["api-key"] = config.apiKey;
    return headers;
  }
  headers["x-api-key"] = config.apiKey;
  if (config.id === "qwen") {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  return headers;
}

function extractError(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
    return String((error as Record<string, unknown>).message);
  }
  const baseResp = record.base_resp;
  if (baseResp && typeof baseResp === "object" && typeof (baseResp as Record<string, unknown>).status_msg === "string") {
    return String((baseResp as Record<string, unknown>).status_msg);
  }
  return undefined;
}
