# 🌼 Pollen

A local, Poppy-AI-style content studio built for an **Instagram Reels** creator. It watches the creators and hashtags in your niche, spots Reels that are beating their creator's normal performance ("outliers"), works out why, and turns that into ideas and scripts in your voice.

## Start it

Double-click **`Start Pollen.bat`**. It installs on first run, builds, and opens http://127.0.0.1:4317. Keep that window open; it's the server, and it runs the auto-refresh.

For development with hot reload: `npm run dev` → http://127.0.0.1:5173

## First-time setup (about 10 minutes)

1. **Settings → AI provider:** paste your free Groq key from https://console.groq.com/keys, then press *Test connection*.
2. **Settings → Instagram live data:** connect at least one source:
   | Source | Cost | Sees | Notes |
   |---|---|---|---|
   | **Apify** | Free $5/mo (~1,900 Reels), then ~$2.30/1K | Every public account and hashtag, with views, video files and audio | Easiest. Settings shows your estimated monthly cost |
   | **Meta Business Discovery** | Free | Public Business/Creator accounts: views, likes, comments | Needs your IG as a Professional account linked to a FB Page. Step-by-step guide in Settings |
   | **Manual** | Free | Anything | Paste numbers and caption, upload the video, and it's transcribed free |
3. **Brand Memory:** describe your niche, audience, voice and offers. Every AI output uses it.
4. **Trend Radar:** add 5–20 creators (`@a, @b, @c`) and a few hashtags, then press **Refresh now**.

## What's inside

- **Trend Radar:** latest Reels from your watchlist, scored as *views ÷ that creator's median views*. A 3×+ score means the idea worked, not just the creator's audience size. Also tracks velocity (views/hour since posting, and views gained between refreshes). Auto-refreshes on a schedule.
- **Ideas:** after each refresh, the AI transcribes the top outliers (Groq Whisper, free) and writes an ideas report: what's working, plus ideas with hooks, formats and angles for *your* brand. Move ideas through new → scripting → filmed → posted, and generate full timestamped scripts.
- **Boards:** a Poppy-style canvas. Add Reels (by link), creators, the live Radar, web pages, PDFs, audio/video (transcribed), and notes. Connect them to an **AI chat**, which reads everything wired into it. Toggle 🌐 **Web search** for live web results (Groq browser search).
- **When live data isn't available**, Pollen says why and shows the exact alternative to set up (Apify, Meta, manual entry, upload, or web search). The AI is told what data it has, so it says when it doesn't know instead of guessing numbers.

## Good to know

- Everything (keys, Reels, chats) is stored only on this PC in `data/pollen.db`. Delete the `data` folder to reset.
- **Groq free-tier limits** (~8K tokens/minute on gpt-oss-120b): Pollen trims sources to fit the "Context budget" setting and falls back to `llama-3.3-70b-versatile` when rate-limited. If you hit limits often, lower the budget, connect fewer sources per chat, or switch to Groq's pay-as-you-go tier.
- Any OpenAI-compatible provider works (OpenRouter, Gemini, OpenAI, local Ollama). Web search needs Groq.
- Instagram media links expire after a few hours. If a transcription fails, refresh the Radar or upload the video.
- Meta tokens last 60 days. Settings warns you when it's time to reconnect.

## Project layout

```
server/            Express API (Node 22+, built-in SQLite)
  sources/         instagram.ts (Meta + Apify), web.ts, files.ts
  radar.ts         refresh job, ideas reports, scripts, scheduler
  reels.ts         Reel storage, outlier scoring, transcription, analysis
  boards.ts        canvas data + chat context builder
  llm.ts           Groq/OpenAI-compatible client, rate-limit handling, Whisper
src/               React UI (Vite, Tailwind, React Flow)
```
