import { DebateSession } from "./debateSession.js";

export { DebateSession };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Route: /api/debate/* → Durable Object
    if (url.pathname.startsWith("/api/debate")) {
      return routeToDebateSession(request, env, url);
    }

    // Route: /api/history → KV history
    if (url.pathname === "/api/history" && request.method === "GET") {
      return getDebateHistory(request, env, url);
    }

    // Route: /api/history/save → save completed debate to KV
    if (url.pathname === "/api/history/save" && request.method === "POST") {
      return saveDebateHistory(request, env);
    }

    // Route: /api/topics → suggest debate topics via AI
    if (url.pathname === "/api/topics" && request.method === "GET") {
      return suggestTopics(env);
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
};

async function routeToDebateSession(request, env, url) {
  // Extract session ID from URL: /api/debate/{sessionId}/action
  const parts = url.pathname.split("/");
  // parts: ['', 'api', 'debate', sessionId, action]
  const sessionId = parts[3];
  const action = parts[4] || "";

  if (!sessionId) {
    return jsonResponse({ error: "Session ID required" }, 400);
  }

  // Get or create Durable Object for this session
  const id = env.DEBATE_SESSION.idFromName(sessionId);
  const stub = env.DEBATE_SESSION.get(id);

  // Forward the request to the Durable Object with the action path
  const doUrl = new URL(request.url);
  doUrl.pathname = `/${action}`;

  const doRequest = new Request(doUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  return stub.fetch(doRequest);
}

async function getDebateHistory(request, env, url) {
  const userId = url.searchParams.get("userId") || "anonymous";

  try {
    const list = await env.DEBATE_HISTORY.list({ prefix: `history:${userId}:` });
    const debates = [];

    for (const key of list.keys.slice(-10)) {
      // last 10 debates
      const val = await env.DEBATE_HISTORY.get(key.name, "json");
      if (val) debates.push(val);
    }

    return jsonResponse({ debates: debates.reverse() });
  } catch {
    return jsonResponse({ debates: [] });
  }
}

async function saveDebateHistory(request, env) {
  const { userId, topic, difficulty, verdict, duration } = await request.json();

  const record = {
    id: crypto.randomUUID(),
    userId: userId || "anonymous",
    topic,
    difficulty,
    verdict,
    duration,
    completedAt: Date.now(),
  };

  const key = `history:${record.userId}:${record.completedAt}`;
  await env.DEBATE_HISTORY.put(key, JSON.stringify(record), {
    expirationTtl: 60 * 60 * 24 * 30, // 30 days
  });

  return jsonResponse({ success: true, id: record.id });
}

async function suggestTopics(env) {
  const response = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: [
      {
        role: "system",
        content:
          "You suggest engaging, thought-provoking debate topics. Return only valid JSON.",
      },
      {
        role: "user",
        content: `Suggest 6 diverse debate topics spanning tech, society, philosophy, and current events. 
Return ONLY a JSON array of objects with "topic" and "category" fields. No other text.
Example format: [{"topic": "...", "category": "Technology"}]`,
      },
    ],
    max_tokens: 300,
  });

  const raw = response.response || "[]";
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    const topics = JSON.parse(jsonMatch[0]);
    return jsonResponse({ topics });
  } catch {
    return jsonResponse({
      topics: [
        { topic: "AI will do more harm than good to society", category: "Technology" },
        { topic: "Social media has made us less connected", category: "Society" },
        { topic: "Free will is an illusion", category: "Philosophy" },
        { topic: "Remote work is better than office work", category: "Work" },
        { topic: "College degrees are no longer worth it", category: "Education" },
        { topic: "Humans should colonize Mars", category: "Science" },
      ],
    });
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
