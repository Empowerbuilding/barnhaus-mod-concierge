// gemini.js — shared Gemini client (Google's OpenAI-compatible endpoint).
// Replaces the Anthropic SDK calls — Anthropic credits exhausted 11/23/26.
// reasoning_effort "none" keeps behavior equivalent to the previous
// non-thinking Claude models: predictable latency, no hidden token burn,
// and no truncation risk on the structured JSON completions.
//
// Content normalization: accepts messages in plain-string, OpenAI-parts, OR
// legacy Anthropic-blocks format, so existing call sites keep working:
//   {type:"text", text}                          -> passthrough
//   {type:"image_url", image_url:{url}}          -> passthrough (https URLs are fetched by Google)
//   {type:"image", source:{type:"url", url}}     -> image_url
//   {type:"image", source:{type:"base64", ...}}  -> image_url (data URL)
//
// Env:
//   GEMINI_API_KEY (or GOOGLE_API_KEY) — required, set in Coolify env
//   GEMINI_MODEL — optional override, default gemini-3.5-flash

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export function geminiConfigured() {
  return Boolean(GEMINI_API_KEY);
}

function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && part.text) {
      parts.push({ type: "text", text: part.text });
    } else if (part.type === "image_url" && part.image_url?.url) {
      parts.push(part);
    } else if (part.type === "image" && part.source) {
      const s = part.source;
      if (s.type === "url" && s.url) {
        parts.push({ type: "image_url", image_url: { url: s.url } });
      } else if (s.type === "base64" && s.data) {
        parts.push({ type: "image_url", image_url: { url: `data:${s.media_type || "image/png"};base64,${s.data}` } });
      }
    }
  }
  return parts;
}

export async function geminiChat({ system, messages, maxTokens = 1024 }) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY env var not set on concierge server");

  const oaiMessages = [];
  if (system) oaiMessages.push({ role: "system", content: system });
  for (const m of messages || []) {
    oaiMessages.push({ role: m.role, content: normalizeContent(m.content) });
  }

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GEMINI_API_KEY}`,
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      max_tokens: maxTokens,
      reasoning_effort: "none",
      messages: oaiMessages,
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`Gemini empty response (finish_reason=${data?.choices?.[0]?.finish_reason})`);
  }
  return content;
}

export async function geminiVision({ prompt, imageBase64, mimetype, maxTokens = 400 }) {
  return geminiChat({
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${mimetype};base64,${imageBase64}` } },
      ],
    }],
    maxTokens,
  });
}
