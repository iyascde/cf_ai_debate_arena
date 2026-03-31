# cf_ai_debate_arena 🎤⚔️

> An AI-powered structured debate app built on Cloudflare's edge stack. Argue any topic against an AI opponent through formal rounds — with real-time scoring and a judge's verdict.

**Live Demo:** _[Deploy your own — instructions below]_

---

## What It Does

Pick any debate topic (or choose from AI-generated suggestions), select a difficulty, and go head-to-head with an AI opponent through **4 structured rounds**:

1. **Opening Statement** — Stake your position; AI responds with the opposing view  
2. **First Rebuttal** — Challenge the AI's arguments  
3. **Second Rebuttal** — Reinforce your strongest points  
4. **Closing Argument** — Final pitch to the judge  

After closing, an **AI judge** evaluates both sides across Logic, Evidence, Persuasion, and Style — and declares a winner.

Past debates are saved to your profile via **Cloudflare KV**, so you can track your win rate over time.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Pages                         │
│              React frontend (Vite)                          │
│   Home → Setup → Debate → Verdict → History                 │
└────────────────────┬────────────────────────────────────────┘
                     │ fetch /api/*
┌────────────────────▼────────────────────────────────────────┐
│                 Cloudflare Worker                           │
│              (src/index.js — router)                        │
│                                                             │
│  /api/topics          → Workers AI (topic suggestions)      │
│  /api/debate/:id/*    → Durable Object (stateful session)   │
│  /api/history         → KV (read past debates)              │
│  /api/history/save    → KV (write completed debate)         │
└────┬───────────────────────────┬────────────────────────────┘
     │                           │
┌────▼──────────────┐   ┌────────▼────────────────────────────┐
│  Workers AI       │   │  Durable Object: DebateSession      │
│  Llama 3.3 70B    │   │  (src/debateSession.js)             │
│                   │   │                                     │
│  • AI opponent    │   │  Per-session state:                 │
│  • AI judge       │   │  • current round                   │
│  • Topic gen      │   │  • full message history            │
│                   │   │  • running scores                  │
│                   │   │  • topic + difficulty              │
└───────────────────┘   └─────────────────────────────────────┘
                                 │
                        ┌────────▼────────────┐
                        │  Cloudflare KV      │
                        │  Debate history     │
                        │  (30-day TTL)       │
                        └─────────────────────┘
```

### Cloudflare Components Used

| Component | Role |
|---|---|
| **Workers AI** (Llama 3.3 70B) | AI opponent responses, judge scoring, topic generation |
| **Durable Objects** | Stateful debate sessions — persists round, history, scores |
| **KV** | Stores completed debate history per user (30-day TTL) |
| **Workers** | API routing layer |
| **Pages** | Hosts the React frontend |

---

## Getting Started

### Prerequisites

- [Node.js 18+](https://nodejs.org)
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- Wrangler CLI: `npm install -g wrangler`

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/cf_ai_debate_arena.git
cd cf_ai_debate_arena
```

### 2. Authenticate with Cloudflare

```bash
wrangler login
```

### 3. Create your KV namespace

```bash
wrangler kv:namespace create DEBATE_HISTORY
wrangler kv:namespace create DEBATE_HISTORY --preview
```

Copy the IDs printed and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "DEBATE_HISTORY"
id = "YOUR_KV_ID_HERE"
preview_id = "YOUR_PREVIEW_KV_ID_HERE"
```

### 4. Install Worker dependencies

```bash
npm install
```

### 5. Run the Worker locally

```bash
npm run dev
# Worker runs at http://localhost:8787
```

### 6. Run the frontend

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
# Frontend runs at http://localhost:5173
```

The frontend Vite config proxies `/api` → `http://localhost:8787`, so everything works together locally.

Open **http://localhost:5173** and start debating!

---

## Deploy to Production

### Deploy the Worker

```bash
# From root directory
npm run deploy
# Note the Worker URL (e.g. https://cf-ai-debate-arena.YOUR_SUBDOMAIN.workers.dev)
```

### Deploy the Frontend

```bash
cd frontend
npm run build
wrangler pages deploy dist --project-name cf-ai-debate-arena
```

Or connect the `frontend/` folder to Cloudflare Pages via the dashboard for automatic GitHub deployments.

### Set the API URL env var

In your Pages project settings, add:
```
VITE_API_URL=https://cf-ai-debate-arena.YOUR_SUBDOMAIN.workers.dev/api
```

Then redeploy.

---

## Project Structure

```
cf_ai_debate_arena/
├── src/
│   ├── index.js            # Worker entry point & API router
│   └── debateSession.js    # Durable Object — debate state machine
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # All screens: Home, Setup, Debate, Verdict, History
│   │   ├── App.module.css  # Scoped styles — dark editorial aesthetic
│   │   ├── api.js          # Frontend → Worker API calls
│   │   ├── index.css       # Global styles + CSS variables
│   │   └── main.jsx        # React entry point
│   ├── index.html
│   └── vite.config.js
├── wrangler.toml           # Cloudflare config (Worker + DO + KV)
├── package.json
└── README.md
```

---

## Difficulty Modes

| Mode | Description |
|---|---|
| **Casual** | Friendly banter, simple examples — good for practice |
| **Devil's Advocate** | Challenges weak logic and unsupported claims |
| **Socratic** | Uses probing questions to expose flaws in reasoning |
| **Debate Club** | Formal, ruthless, and precise — full rhetorical toolkit |

---

## Scoring

Each round is scored heuristically on argument quality (length, use of reasoning words, evidence cues). The final **judge verdict** uses Llama 3.3 to score both sides on:

- **Logic** — Soundness of reasoning
- **Evidence** — Use of examples and facts  
- **Persuasion** — Rhetorical effectiveness
- **Style** — Clarity and delivery

Total scores determine the winner. All results are saved to KV.

---

## Built With

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare KV](https://developers.cloudflare.com/kv/)
- [Workers AI — Llama 3.3 70B](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare Pages](https://developers.cloudflare.com/pages/)
- [React 18](https://react.dev/) + [Vite](https://vitejs.dev/)

---

## Author

**Iyas Abdel Rahman**  
First-year CS @ University of Washington  
Built for Cloudflare Software Engineering Internship Application
