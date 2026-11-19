"use strict";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const MAX_BODY_BYTES = 16 * 1024;
const rateLimits = new Map();

function sendJson(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

function validOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isRateLimited(req, now = Date.now()) {
  const address = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress;
  if (!address) return true;
  for (const [key, entry] of rateLimits) {
    if (now - entry.start >= WINDOW_MS) rateLimits.delete(key);
  }
  const entry = rateLimits.get(address);
  if (!entry || now - entry.start >= WINDOW_MS) {
    rateLimits.set(address, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Use POST for chat requests." });
  }
  if (!validOrigin(req)) return sendJson(res, 403, { error: "Request origin is not allowed." });
  if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) {
    return sendJson(res, 413, { error: "Request is too large." });
  }
  if (isRateLimited(req)) return sendJson(res, 429, { error: "Too many requests. Try again in a minute." });
  if (!process.env.GROQ_API_KEY) {
    return sendJson(res, 503, { error: "The server is missing its GROQ_API_KEY environment variable." });
  }

  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return sendJson(res, 400, { error: "Request body must be a JSON object." });
  }
  const { system, user } = body;
  if (typeof system !== "string" || typeof user !== "string" || !user.trim()) {
    return sendJson(res, 400, { error: "System and user prompts must be strings; the user prompt cannot be empty." });
  }
  if (system.length > 4_000 || user.length > 10_000) {
    return sendJson(res, 413, { error: "The system prompt is limited to 4,000 characters and the user prompt to 10,000." });
  }

  const temperature = Number(body.temperature);
  const topP = Number(body.topP);
  const maxTokens = Number(body.maxTokens);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2
      || !Number.isFinite(topP) || topP < 0 || topP > 1
      || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096) {
    return sendJson(res, 400, { error: "Generation settings are outside the allowed range." });
  }

  let upstream;
  try {
    upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature,
        top_p: topP,
        max_completion_tokens: maxTokens
      })
    });
  } catch {
    return sendJson(res, 502, { error: "Could not reach the Groq API. Try again shortly." });
  }

  if (!upstream.ok) {
    return sendJson(res, 502, { error: `Groq API request failed (HTTP ${upstream.status}). Check the server key and model configuration.` });
  }

  let result;
  try {
    result = await upstream.json();
  } catch {
    return sendJson(res, 502, { error: "Groq returned an invalid response." });
  }
  const output = result.choices?.[0]?.message?.content;
  if (typeof output !== "string" || !output.trim()) {
    return sendJson(res, 502, { error: "Groq returned no text for this request." });
  }
  return sendJson(res, 200, { output });
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "16kb"
    }
  }
};
