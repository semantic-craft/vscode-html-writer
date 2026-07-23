const key = process.env.TOKEN_PLAN_API_KEY
  || process.env.BAILIAN_TOKEN_PLAN_API_KEY
  || process.env.QWEN_TOKEN_PLAN_API_KEY
  || process.env.QWEN_API_KEY;
const model = process.env.QWEN_MODEL || "qwen3.6-flash";

if (!key) {
  console.log("No Qwen key found. Set TOKEN_PLAN_API_KEY, BAILIAN_TOKEN_PLAN_API_KEY, QWEN_TOKEN_PLAN_API_KEY, or QWEN_API_KEY.");
  console.log("Set QWEN_MODEL=qwen3.7-max to probe Qwen 3.7 Max.");
  process.exit(0);
}

console.log(`model=${model}`);

const probes = [
  {
    name: "qwen-token-plan-openai",
    url: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: {
      model,
      messages: [{ role: "user", content: '只输出 JSON：{"ok":true}' }],
      max_tokens: 32,
      temperature: 0,
      response_format: { type: "json_object" },
    },
  },
  {
    name: "qwen-token-plan-anthropic",
    url: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic/v1/messages",
    headers: {
      Authorization: `Bearer ${key}`,
      "x-api-key": key,
      "api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: {
      model,
      system: "Return only valid JSON.",
      messages: [{ role: "user", content: '只输出 JSON：{"ok":true}' }],
      max_tokens: 32,
      temperature: 0,
    },
  },
];

const results = [];
for (const probe of probes) {
  const start = Date.now();
  try {
    const response = await fetch(probe.url, {
      method: "POST",
      headers: probe.headers,
      body: JSON.stringify(probe.body),
    });
    const latencyMs = Date.now() - start;
    const text = await response.text();
    results.push({ ...summarize(probe.name, response.status, latencyMs, text), ok: response.ok });
  } catch (error) {
    results.push({
      name: probe.name,
      ok: false,
      status: "network-error",
      latencyMs: null,
      summary: error instanceof Error ? error.message : String(error),
    });
  }
}

for (const result of results) {
  console.log(`${result.name}: status=${result.status} latency_ms=${result.latencyMs ?? "n/a"} summary=${result.summary}`);
}

const winner = results.filter((result) => result.ok).sort((a, b) => Number(a.latencyMs) - Number(b.latencyMs))[0];
if (winner) {
  console.log(`recommended=${winner.name}`);
} else {
  console.log("recommended=none");
}

function summarize(name, status, latencyMs, text) {
  let summary = text.slice(0, 240).replaceAll(key, "[redacted]");
  try {
    const json = JSON.parse(text);
    summary = json.error?.message || json.message || json.code || JSON.stringify(json).slice(0, 240).replaceAll(key, "[redacted]");
  } catch {
    // Keep text summary.
  }
  return { name, status, latencyMs, summary };
}
