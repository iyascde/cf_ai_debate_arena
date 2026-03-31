import React, { useState, useEffect, useRef, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import * as api from "./api.js";
import styles from "./App.module.css";

const ROUNDS = ["opening", "rebuttal1", "rebuttal2", "closing", "verdict"];
const ROUND_LABELS = {
  opening: "Opening Statement",
  rebuttal1: "First Rebuttal",
  rebuttal2: "Second Rebuttal",
  closing: "Closing Argument",
  verdict: "Verdict",
};

const DIFFICULTY_CONFIG = {
  casual: { label: "Casual", desc: "Friendly banter, simple points", color: "#4ade80" },
  devils_advocate: { label: "Devil's Advocate", desc: "Challenges weak logic", color: "#facc15" },
  socratic: { label: "Socratic", desc: "Probing questions, exposes flaws", color: "#fb923c" },
  debate_club: { label: "Debate Club", desc: "Formal, ruthless, precise", color: "#f87171" },
};

function getUserId() {
  let id = localStorage.getItem("debateUserId");
  if (!id) {
    id = uuidv4().slice(0, 8);
    localStorage.setItem("debateUserId", id);
  }
  return id;
}

export default function App() {
  const [screen, setScreen] = useState("home"); // home | setup | debate | verdict | history
  const [topics, setTopics] = useState([]);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  const [difficulty, setDifficulty] = useState("devils_advocate");
  const [sessionId, setSessionId] = useState(null);
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [history, setHistory] = useState([]);
  const [startTime, setStartTime] = useState(null);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const userId = getUserId();
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const loadTopics = useCallback(async () => {
    setTopicsLoading(true);
    try {
      const data = await api.fetchTopics();
      setTopics(data.topics || []);
    } catch {
      setTopics([]);
    }
    setTopicsLoading(false);
  }, []);

  const goToSetup = () => {
    setScreen("setup");
    loadTopics();
  };

  const startDebate = async () => {
    const topic = customTopic.trim() || selectedTopic;
    if (!topic) return;
    setLoading(true);
    const sid = uuidv4();
    setSessionId(sid);
    setStartTime(Date.now());
    try {
      const data = await api.initDebate(sid, topic, difficulty, userId);
      setSession(data.session);
      setMessages([
        {
          role: "ai",
          content: data.aiMessage,
          round: "opening",
          label: "AI Opening Statement",
        },
      ]);
      setScreen("debate");
    } catch (e) {
      alert("Failed to start debate. Make sure the Worker is running.");
    }
    setLoading(false);
  };

  const sendMessage = async () => {
    if (!input.trim() || loading || !sessionId) return;
    const msg = input.trim();
    setInput("");

    const roundLabel = ROUND_LABELS[session?.round] || session?.round;
    setMessages((prev) => [
      ...prev,
      { role: "user", content: msg, round: session?.round, label: `Your ${roundLabel}` },
    ]);
    setLoading(true);

    try {
      const data = await api.sendMessage(sessionId, msg);
      setSession(data.session);

      if (data.verdict) {
        setVerdict(data.verdict);
        setMessages((prev) => [
          ...prev,
          {
            role: "ai",
            content: data.aiMessage,
            round: "verdict",
            label: "Judge's Verdict",
            isVerdict: true,
          },
        ]);
        // Save to history
        await api.saveHistory({
          userId,
          topic: data.session.topic,
          difficulty: data.session.difficulty,
          verdict: data.verdict,
          duration: Math.floor((Date.now() - startTime) / 1000),
        });
        setTimeout(() => setScreen("verdict"), 1200);
      } else {
        const nextLabel = ROUND_LABELS[data.nextRound] || data.nextRound;
        setMessages((prev) => [
          ...prev,
          {
            role: "ai",
            content: data.aiMessage,
            round: data.nextRound,
            label: `AI ${nextLabel}`,
          },
        ]);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "ai", content: "Connection error. Please try again.", round: "error" },
      ]);
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const newDebate = () => {
    setSession(null);
    setMessages([]);
    setInput("");
    setVerdict(null);
    setSessionId(null);
    setSelectedTopic("");
    setCustomTopic("");
    setScreen("setup");
    loadTopics();
  };

  const loadHistory = async () => {
    setScreen("history");
    const data = await api.getHistory(userId);
    setHistory(data.debates || []);
  };

  const currentRoundIndex = session ? ROUNDS.indexOf(session.round) : 0;
  const topic = session?.topic || "";

  if (screen === "home") return <HomeScreen onStart={goToSetup} onHistory={loadHistory} />;
  if (screen === "setup")
    return (
      <SetupScreen
        topics={topics}
        topicsLoading={topicsLoading}
        selectedTopic={selectedTopic}
        setSelectedTopic={setSelectedTopic}
        customTopic={customTopic}
        setCustomTopic={setCustomTopic}
        difficulty={difficulty}
        setDifficulty={setDifficulty}
        onStart={startDebate}
        onBack={() => setScreen("home")}
        loading={loading}
      />
    );
  if (screen === "debate")
    return (
      <DebateScreen
        topic={topic}
        messages={messages}
        input={input}
        setInput={setInput}
        onSend={sendMessage}
        onKeyDown={handleKeyDown}
        loading={loading}
        session={session}
        currentRoundIndex={currentRoundIndex}
        chatEndRef={chatEndRef}
        inputRef={inputRef}
      />
    );
  if (screen === "verdict")
    return <VerdictScreen verdict={verdict} session={session} onNewDebate={newDebate} onHistory={loadHistory} />;
  if (screen === "history")
    return <HistoryScreen debates={history} onBack={() => setScreen("home")} onNewDebate={goToSetup} />;

  return null;
}

/* ─── HOME SCREEN ─── */
function HomeScreen({ onStart, onHistory }) {
  return (
    <div className={styles.homeWrap}>
      <div className={styles.homeNoise} />
      <header className={styles.homeHeader}>
        <div className={styles.headerRule} />
        <span className={styles.headerTag}>CLOUDFLARE AI · POWERED BY LLAMA 3.3</span>
        <div className={styles.headerRule} />
      </header>

      <main className={styles.homeMain}>
        <div className={styles.homeEyebrow}>ENTER THE</div>
        <h1 className={styles.homeTitle}>
          <span className={styles.titleLine1}>DEBATE</span>
          <span className={styles.titleLine2}>ARENA</span>
        </h1>
        <p className={styles.homeSubtitle}>
          Argue any position. An AI opponent will take the other side.<br />
          Structured rounds. Real scoring. No mercy.
        </p>

        <div className={styles.homeCta}>
          <button className={styles.btnPrimary} onClick={onStart}>
            <span>ENTER THE ARENA</span>
            <span className={styles.btnArrow}>→</span>
          </button>
          <button className={styles.btnGhost} onClick={onHistory}>
            VIEW PAST DEBATES
          </button>
        </div>

        <div className={styles.homeFeatures}>
          {[
            ["4", "Structured Rounds"],
            ["4", "Difficulty Modes"],
            ["AI", "Judge & Scorer"],
            ["∞", "Topics"],
          ].map(([num, label]) => (
            <div key={label} className={styles.featurePill}>
              <span className={styles.featureNum}>{num}</span>
              <span className={styles.featureLabel}>{label}</span>
            </div>
          ))}
        </div>
      </main>

      <div className={styles.ticker}>
        <div className={styles.tickerInner}>
          {Array(4).fill("OPENING STATEMENT · REBUTTAL · CROSS-EXAMINATION · CLOSING ARGUMENT · VERDICT · ").join("")}
        </div>
      </div>
    </div>
  );
}

/* ─── SETUP SCREEN ─── */
function SetupScreen({
  topics, topicsLoading, selectedTopic, setSelectedTopic,
  customTopic, setCustomTopic, difficulty, setDifficulty,
  onStart, onBack, loading,
}) {
  const activeTopic = customTopic.trim() || selectedTopic;
  return (
    <div className={styles.setupWrap}>
      <button className={styles.backBtn} onClick={onBack}>← BACK</button>
      <div className={styles.setupInner}>
        <div className={styles.setupHeader}>
          <p className={styles.setupEyebrow}>STEP 1 OF 2</p>
          <h2 className={styles.setupTitle}>Choose Your Battleground</h2>
        </div>

        {/* Topic selection */}
        <section className={styles.setupSection}>
          <h3 className={styles.sectionLabel}>SELECT A TOPIC</h3>
          {topicsLoading ? (
            <p className={styles.loadingText}>Generating topics...</p>
          ) : (
            <div className={styles.topicGrid}>
              {topics.map((t) => (
                <button
                  key={t.topic}
                  className={`${styles.topicCard} ${selectedTopic === t.topic && !customTopic ? styles.topicCardActive : ""}`}
                  onClick={() => { setSelectedTopic(t.topic); setCustomTopic(""); }}
                >
                  <span className={styles.topicCategory}>{t.category}</span>
                  <span className={styles.topicText}>{t.topic}</span>
                </button>
              ))}
            </div>
          )}

          <div className={styles.orDivider}><span>OR WRITE YOUR OWN</span></div>
          <input
            className={styles.topicInput}
            placeholder="Type any debate topic..."
            value={customTopic}
            onChange={(e) => setCustomTopic(e.target.value)}
          />
        </section>

        {/* Difficulty */}
        <section className={styles.setupSection}>
          <h3 className={styles.sectionLabel}>STEP 2 OF 2 · SELECT DIFFICULTY</h3>
          <div className={styles.difficultyGrid}>
            {Object.entries(DIFFICULTY_CONFIG).map(([key, cfg]) => (
              <button
                key={key}
                className={`${styles.diffCard} ${difficulty === key ? styles.diffCardActive : ""}`}
                style={{ "--accent": cfg.color }}
                onClick={() => setDifficulty(key)}
              >
                <span className={styles.diffLabel}>{cfg.label}</span>
                <span className={styles.diffDesc}>{cfg.desc}</span>
              </button>
            ))}
          </div>
        </section>

        <button
          className={styles.btnPrimary}
          onClick={onStart}
          disabled={!activeTopic || loading}
        >
          {loading ? "STARTING DEBATE..." : "BEGIN DEBATE →"}
        </button>
      </div>
    </div>
  );
}

/* ─── DEBATE SCREEN ─── */
function DebateScreen({ topic, messages, input, setInput, onSend, onKeyDown, loading, session, currentRoundIndex, chatEndRef, inputRef }) {
  const round = session?.round;
  const isOver = session?.status === "completed";
  const roundLabel = ROUND_LABELS[round] || round;

  return (
    <div className={styles.debateWrap}>
      {/* Header */}
      <div className={styles.debateHeader}>
        <div className={styles.debateTopicRow}>
          <span className={styles.debateTopicLabel}>TOPIC</span>
          <span className={styles.debateTopic}>{topic}</span>
        </div>
        <div className={styles.roundTrack}>
          {ROUNDS.filter(r => r !== "verdict").map((r, i) => (
            <div key={r} className={`${styles.roundDot} ${i < currentRoundIndex ? styles.roundDone : ""} ${i === currentRoundIndex ? styles.roundActive : ""}`}>
              <span className={styles.roundDotLabel}>{ROUND_LABELS[r].split(" ")[0]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Score bar */}
      <div className={styles.scoreBar}>
        <div className={styles.scoreSide}>
          <span className={styles.scoreLabel}>YOU</span>
          <span className={styles.scoreVal}>{session?.scores?.user || 0}</span>
        </div>
        <div className={styles.scoreVs}>VS</div>
        <div className={styles.scoreSide}>
          <span className={styles.scoreVal}>{session?.scores?.ai || 0}</span>
          <span className={styles.scoreLabel}>AI</span>
        </div>
      </div>

      {/* Chat */}
      <div className={styles.chatArea}>
        {messages.map((msg, i) => (
          <div key={i} className={`${styles.msgWrap} ${msg.role === "user" ? styles.msgUser : styles.msgAi} animate-fadeUp`}>
            <div className={styles.msgMeta}>
              <span className={styles.msgSpeaker}>{msg.role === "user" ? "YOU" : "AI OPPONENT"}</span>
              <span className={styles.msgRound}>{msg.label || ROUND_LABELS[msg.round]}</span>
            </div>
            <div className={`${styles.msgBubble} ${msg.isVerdict ? styles.msgVerdict : ""}`}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className={`${styles.msgWrap} ${styles.msgAi}`}>
            <div className={styles.msgMeta}>
              <span className={styles.msgSpeaker}>AI OPPONENT</span>
              <span className={styles.msgRound}>Thinking...</span>
            </div>
            <div className={styles.msgBubble}>
              <span className={styles.typingDot} />
              <span className={styles.typingDot} />
              <span className={styles.typingDot} />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      {!isOver && (
        <div className={styles.inputArea}>
          <div className={styles.inputLabel}>YOUR {roundLabel.toUpperCase()}</div>
          <div className={styles.inputRow}>
            <textarea
              ref={inputRef}
              className={styles.inputBox}
              placeholder={`Make your ${roundLabel.toLowerCase()}... (Enter to send)`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              disabled={loading}
            />
            <button className={styles.sendBtn} onClick={onSend} disabled={loading || !input.trim()}>
              {loading ? "..." : "SEND →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── VERDICT SCREEN ─── */
function VerdictScreen({ verdict, session, onNewDebate, onHistory }) {
  if (!verdict) return null;
  const winner = verdict.winner;
  const userS = verdict.userScore || {};
  const aiS = verdict.aiScore || {};

  return (
    <div className={styles.verdictWrap}>
      <div className={styles.verdictInner}>
        <div className={styles.verdictEyebrow}>DEBATE CONCLUDED</div>
        <div className={styles.verdictTopic}>{session?.topic}</div>

        <div className={`${styles.winnerBanner} ${winner === "user" ? styles.winnerUser : winner === "ai" ? styles.winnerAi : styles.winnerTie}`}>
          {winner === "user" ? "YOU WIN" : winner === "ai" ? "AI WINS" : "TIE"}
        </div>

        <p className={styles.verdictText}>{verdict.verdict}</p>

        <div className={styles.scoreTable}>
          <div className={styles.scoreTableHead}>
            <span>CATEGORY</span><span>YOU</span><span>AI</span>
          </div>
          {["logic", "evidence", "persuasion", "style"].map((cat) => (
            <div key={cat} className={styles.scoreTableRow}>
              <span className={styles.scoreCat}>{cat.toUpperCase()}</span>
              <span className={`${styles.scoreNum} ${(userS[cat] || 0) > (aiS[cat] || 0) ? styles.scoreWin : ""}`}>{userS[cat] || 0}</span>
              <span className={`${styles.scoreNum} ${(aiS[cat] || 0) > (userS[cat] || 0) ? styles.scoreWin : ""}`}>{aiS[cat] || 0}</span>
            </div>
          ))}
          <div className={`${styles.scoreTableRow} ${styles.scoreTotal}`}>
            <span>TOTAL</span>
            <span>{userS.total || 0}</span>
            <span>{aiS.total || 0}</span>
          </div>
        </div>

        <div className={styles.verdictActions}>
          <button className={styles.btnPrimary} onClick={onNewDebate}>DEBATE AGAIN →</button>
          <button className={styles.btnGhost} onClick={onHistory}>VIEW HISTORY</button>
        </div>
      </div>
    </div>
  );
}

/* ─── HISTORY SCREEN ─── */
function HistoryScreen({ debates, onBack, onNewDebate }) {
  return (
    <div className={styles.historyWrap}>
      <button className={styles.backBtn} onClick={onBack}>← BACK</button>
      <div className={styles.historyInner}>
        <h2 className={styles.setupTitle}>Debate History</h2>
        {debates.length === 0 ? (
          <p className={styles.loadingText}>No debates yet. Enter the arena!</p>
        ) : (
          <div className={styles.historyList}>
            {debates.map((d, i) => (
              <div key={i} className={styles.historyCard}>
                <div className={styles.historyCardTop}>
                  <span className={styles.historyDifficulty}>{DIFFICULTY_CONFIG[d.difficulty]?.label || d.difficulty}</span>
                  <span className={`${styles.historyWinner} ${d.verdict?.winner === "user" ? styles.winnerUser : d.verdict?.winner === "ai" ? styles.winnerAi : ""}`}>
                    {d.verdict?.winner === "user" ? "WIN" : d.verdict?.winner === "ai" ? "LOSS" : "TIE"}
                  </span>
                </div>
                <p className={styles.historyTopic}>{d.topic}</p>
                <div className={styles.historyScores}>
                  <span>You: {d.verdict?.userScore?.total || "—"}</span>
                  <span>AI: {d.verdict?.aiScore?.total || "—"}</span>
                  <span>{d.duration ? `${Math.floor(d.duration / 60)}m ${d.duration % 60}s` : ""}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <button className={styles.btnPrimary} onClick={onNewDebate} style={{ marginTop: "2rem" }}>NEW DEBATE →</button>
      </div>
    </div>
  );
}
