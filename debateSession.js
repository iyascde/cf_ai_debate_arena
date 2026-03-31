export class DebateSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return corsResponse(null, 204);
    }

    if (path === "/init" && request.method === "POST") {
      return this.initDebate(request);
    }
    if (path === "/message" && request.method === "POST") {
      return this.handleMessage(request);
    }
    if (path === "/state" && request.method === "GET") {
      return this.getState();
    }
    if (path === "/reset" && request.method === "POST") {
      return this.resetDebate();
    }

    return corsResponse({ error: "Not found" }, 404);
  }

  async initDebate(request) {
    const { topic, difficulty, userId } = await request.json();

    const session = {
      topic,
      difficulty,
      userId,
      round: "opening", // opening | rebuttal1 | rebuttal2 | closing | verdict
      roundNumber: 1,
      messages: [],
      scores: { user: 0, ai: 0 },
      startedAt: Date.now(),
      status: "active",
    };

    await this.storage.put("session", session);

    const systemPrompt = buildSystemPrompt(topic, difficulty, "opening");
    const aiOpening = await this.callAI(systemPrompt, [
      {
        role: "user",
        content: `The debate topic is: "${topic}". Please give your opening statement arguing the OPPOSING side to whatever position the human takes. Be ${difficultyDescription(difficulty)}. Keep it to 3-4 sentences.`,
      },
    ]);

    session.messages.push({
      role: "assistant",
      content: aiOpening,
      round: "opening",
      type: "ai_opening",
    });
    await this.storage.put("session", session);

    return corsResponse({ session, aiMessage: aiOpening });
  }

  async handleMessage(request) {
    const { message } = await request.json();
    const session = await this.storage.get("session");

    if (!session || session.status !== "active") {
      return corsResponse({ error: "No active session" }, 400);
    }

    session.messages.push({
      role: "user",
      content: message,
      round: session.round,
    });

    const nextRound = getNextRound(session.round);
    let aiResponse = "";
    let scoreUpdate = null;
    let verdict = null;

    if (session.round === "closing") {
      // Generate final verdict after closing statements
      const judgePrompt = buildJudgePrompt(session.topic, session.messages);
      const judgeMessages = buildConversationHistory(session.messages);
      judgeMessages.push({
        role: "user",
        content: `Now as an impartial judge, evaluate the entire debate on the topic "${session.topic}". Score both sides 0-100 on: Logic, Evidence, Persuasion, Style. Give a brief verdict (3-4 sentences). Format your response as JSON: {"userScore": {"logic": N, "evidence": N, "persuasion": N, "style": N, "total": N}, "aiScore": {"logic": N, "evidence": N, "persuasion": N, "style": N, "total": N}, "verdict": "...", "winner": "user"|"ai"|"tie"}`,
      });

      const judgeRaw = await this.callAI(judgePrompt, judgeMessages);

      try {
        const jsonMatch = judgeRaw.match(/\{[\s\S]*\}/);
        verdict = JSON.parse(jsonMatch[0]);
        scoreUpdate = verdict;
      } catch {
        verdict = {
          userScore: { logic: 70, evidence: 65, persuasion: 68, style: 72, total: 69 },
          aiScore: { logic: 75, evidence: 70, persuasion: 73, style: 71, total: 72 },
          verdict: judgeRaw,
          winner: "ai",
        };
      }

      session.status = "completed";
      session.verdict = verdict;
      aiResponse = verdict.verdict;
    } else {
      // Regular debate round response
      const systemPrompt = buildSystemPrompt(session.topic, session.difficulty, nextRound);
      const history = buildConversationHistory(session.messages);
      const roundInstruction = getRoundInstruction(nextRound, session.difficulty);
      history.push({ role: "user", content: roundInstruction });

      aiResponse = await this.callAI(systemPrompt, history);

      // Quick scoring for intermediate rounds
      scoreUpdate = scoreRound(message, aiResponse);
      session.scores.user += scoreUpdate.userPoints;
      session.scores.ai += scoreUpdate.aiPoints;
    }

    session.messages.push({
      role: "assistant",
      content: aiResponse,
      round: nextRound,
      type: session.status === "completed" ? "verdict" : "response",
    });

    if (nextRound) session.round = nextRound;

    await this.storage.put("session", session);

    return corsResponse({
      session,
      aiMessage: aiResponse,
      scoreUpdate,
      verdict: session.status === "completed" ? verdict : null,
      nextRound,
    });
  }

  async getState() {
    const session = await this.storage.get("session");
    return corsResponse({ session });
  }

  async resetDebate() {
    await this.storage.delete("session");
    return corsResponse({ success: true });
  }

  async callAI(systemPrompt, messages) {
    const response = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: 512,
    });
    return response.response || response.result?.response || "I acknowledge your point.";
  }
}

function buildSystemPrompt(topic, difficulty, round) {
  return `You are an AI debate opponent in a structured debate about: "${topic}".
You ALWAYS argue the OPPOSITE position from the human.
Difficulty: ${difficultyDescription(difficulty)}
Current round: ${round}
Rules:
- Stay in character as a fierce, intelligent debater
- Never agree with the human's core position
- Use logic, examples, and rhetorical techniques
- Keep responses focused and under 150 words unless asked for more
- Match the formality to the difficulty level`;
}

function buildJudgePrompt(topic, messages) {
  return `You are an impartial, expert debate judge evaluating a debate about: "${topic}".
You will analyze the full debate transcript and score both participants objectively.
Be fair, precise, and provide constructive feedback in your verdict.`;
}

function buildConversationHistory(messages) {
  return messages
    .filter((m) => m.type !== "verdict")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));
}

function difficultyDescription(difficulty) {
  const map = {
    casual: "conversational and friendly, using simple examples",
    devils_advocate: "challenging but fair, pushing back on weak points",
    socratic: "using probing questions to expose logical flaws",
    debate_club: "highly formal, using advanced rhetoric and strong evidence",
  };
  return map[difficulty] || map["devils_advocate"];
}

function getNextRound(currentRound) {
  const flow = {
    opening: "rebuttal1",
    rebuttal1: "rebuttal2",
    rebuttal2: "closing",
    closing: "verdict",
    verdict: null,
  };
  return flow[currentRound];
}

function getRoundInstruction(round, difficulty) {
  const map = {
    rebuttal1: "Respond directly to the human's opening statement. Challenge their key claims.",
    rebuttal2: "This is your second rebuttal. Reinforce your strongest points and dismantle their argument.",
    closing: "Give your closing statement. Summarize why your position is stronger. Be decisive.",
  };
  return map[round] || "Continue the debate.";
}

function scoreRound(userMessage, aiMessage) {
  // Simple heuristic scoring based on message quality indicators
  const userScore = Math.min(
    25,
    Math.floor(
      (userMessage.length / 50) * 5 +
        (userMessage.includes("because") || userMessage.includes("therefore") ? 3 : 0) +
        (userMessage.includes("evidence") || userMessage.includes("example") ? 3 : 0) +
        Math.random() * 8
    )
  );
  const aiScore = Math.min(
    25,
    Math.floor(
      (aiMessage.length / 50) * 5 +
        (aiMessage.includes("however") || aiMessage.includes("contrary") ? 3 : 0) +
        Math.random() * 8
    )
  );
  return { userPoints: userScore, aiPoints: aiScore };
}

function corsResponse(data, status = 200) {
  return new Response(data !== null ? JSON.stringify(data) : null, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
