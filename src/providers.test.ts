import { describe, expect, it } from "vitest";
import { modelIdsForProvider } from "./modelCatalog";
import { ConfiguredProvider, FallbackProvider, parseJsonObject, type Fetcher } from "./providers";
import type { ProviderConfig } from "./types";

describe("providers", () => {
  it("builds Qwen OpenAI-compatible JSON requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 });
    };
    const provider = new ConfiguredProvider(config("qwen"), fetcher);
    const result = await provider.generate({
      system: "sys",
      user: "user",
      timeoutMs: 1000,
      maxOutputTokens: 100,
      options: { responseMimeType: "application/json" },
    });
    expect(result).toBe("{\"ok\":true}");
    expect(calls[0].url).toBe("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.enable_thinking).toBe(false);
  });

  it("builds Qwen Token Plan Anthropic-compatible requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "{\"ok\":true}" }] }), { status: 200 });
    };
    const provider = new ConfiguredProvider({ ...config("qwen"), protocol: "anthropic", baseURL: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic" }, fetcher);
    await provider.generate({
      system: "sys",
      user: "user",
      timeoutMs: 1000,
      maxOutputTokens: 100,
      options: { responseMimeType: "application/json" },
    });
    expect(calls[0].url).toBe("https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic/v1/messages");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.system).toContain("Return only valid JSON");
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    expect((calls[0].init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-key");
  });

  it("builds native Anthropic provider requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "{\"ok\":true}" }] }), { status: 200 });
    };
    const provider = new ConfiguredProvider(config("anthropic"), fetcher);
    await provider.generate({
      system: "sys",
      user: "user",
      timeoutMs: 1000,
      maxOutputTokens: 100,
      options: { responseMimeType: "application/json" },
    });
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("builds DeepSeek Anthropic-compatible requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "{\"ok\":true}" }] }), { status: 200 });
    };
    const provider = new ConfiguredProvider(config("deepseek"), fetcher);
    await provider.generate({ system: "sys", user: "user", timeoutMs: 1000, maxOutputTokens: 100 });
    expect(calls[0].url).toBe("https://api.deepseek.com/anthropic/v1/messages");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("builds Gemini native JSON requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] } }] }), { status: 200 });
    };
    const provider = new ConfiguredProvider(config("gemini"), fetcher);
    await provider.generate({
      system: "sys",
      user: "user",
      timeoutMs: 1000,
      maxOutputTokens: 100,
      options: { responseMimeType: "application/json" },
    });
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("normalizes Gemini 3.1 Pro to the official preview model ID", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] } }] }), { status: 200 });
    };
    const provider = new ConfiguredProvider({ ...config("gemini"), model: "gemini-3.1-pro" }, fetcher);
    await provider.generate({
      system: "sys",
      user: "user",
      timeoutMs: 1000,
      maxOutputTokens: 100,
      options: { responseMimeType: "application/json" },
    });
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent");
  });

  it("builds MiMo Token Plan Anthropic-compatible requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "{\"ok\":true}" }] }), { status: 200 });
    };
    const provider = new ConfiguredProvider({ ...config("mimo"), protocol: "anthropic", baseURL: "https://token-plan-cn.xiaomimimo.com/anthropic" }, fetcher);
    await provider.generate({ system: "sys", user: "user", timeoutMs: 1000, maxOutputTokens: 100 });
    expect(calls[0].url).toBe("https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("test-key");
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("routes every cataloged MiMo model through the MiMo Anthropic-compatible endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "{\"ok\":true}" }] }), { status: 200 });
    };
    for (const model of modelIdsForProvider("mimo")) {
      const provider = new ConfiguredProvider({ ...config("mimo"), model, protocol: "anthropic", baseURL: "https://token-plan-cn.xiaomimimo.com/anthropic" }, fetcher);
      await provider.generate({ system: "sys", user: "user", timeoutMs: 1000, maxOutputTokens: 100 });
    }
    expect(calls.map((call) => call.url)).toEqual(
      modelIdsForProvider("mimo").map(() => "https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages"),
    );
  });

  it("repairs fenced JSON", () => {
    expect(parseJsonObject<{ ok: boolean }>("```json\n{\"ok\":true}\n```").ok).toBe(true);
  });

  it("falls through provider order when an earlier provider fails", async () => {
    const failingFetcher: Fetcher = async () => new Response(JSON.stringify({ error: { message: "missing key" } }), { status: 401, statusText: "Unauthorized" });
    const okFetcher: Fetcher = async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 });
    const provider = new FallbackProvider([
      new ConfiguredProvider(config("qwen"), failingFetcher),
      new ConfiguredProvider(config("mimo"), okFetcher),
    ]);

    await expect(
      provider.generate({
        system: "sys",
        user: "user",
        timeoutMs: 1000,
        maxOutputTokens: 100,
        options: { responseMimeType: "application/json" },
      }),
    ).resolves.toBe("{\"ok\":true}");
  });
});

function config(id: ProviderConfig["id"]): ProviderConfig {
  return {
    id,
    title: id,
    apiKey: "test-key",
    baseURL: {
      qwen: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      deepseek: "https://api.deepseek.com/anthropic",
      gemini: "https://generativelanguage.googleapis.com/v1beta",
      anthropic: "https://api.anthropic.com",
      mimo: "https://token-plan-cn.xiaomimimo.com/v1",
    }[id],
    model: {
      qwen: "qwen3.6-flash",
      deepseek: "deepseek-v4-flash",
      gemini: "gemini-3.5-flash",
      anthropic: "claude-sonnet-4-6",
      mimo: "mimo-v2.5",
    }[id],
    reasoningMode: "off",
    protocol: {
      qwen: "openai",
      deepseek: "anthropic",
      gemini: "gemini",
      anthropic: "anthropic",
      mimo: "openai",
    }[id] as ProviderConfig["protocol"],
  };
}
