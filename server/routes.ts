import { Router, type Request, type Response } from "express";
import multer from "multer";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { all, get, run, now, newId, parseJson, THUMB_DIR } from "./db.ts";
import { getSettings, setSettings, publicSettings, SECRET_KEYS, defaults, type Settings } from "./settings.ts";
import { AppError, ALT, errorBody } from "./errors.ts";
import { stream, testLlm, transcribe, estimateTokens, type ChatMsg } from "./llm.ts";
import { brandBlock, liveDataBlock, CORE_RULES } from "./prompts.ts";
import { queryReels, getScoredReel, getReel, upsertReel, analyzeReel, ensureTranscript } from "./reels.ts";
import { job, startRefresh, generateReport, writeScript } from "./radar.ts";
import { startReelJob, listJobs, reelJob } from "./jobs.ts";
import {
  listBoards,
  createBoard,
  getBoard,
  addNode,
  updateNode,
  deleteNode,
  addEdge,
  touchBoard,
  buildBoardContext,
  buildRadarContext,
  type NodeType,
} from "./boards.ts";
import {
  cleanUsername,
  cleanHashtag,
  shortcodeFromUrl,
  isInstagramUrl,
  fetchReelByUrl,
  instagramAlternatives,
  metaConfigured,
  apifyConfigured,
  metaTest,
  apifyTest,
  metaExchangeToken,
  metaDiscoverAccounts,
} from "./sources/instagram.ts";
import { fetchPage } from "./sources/web.ts";
import { extractFileText, fileKind } from "./sources/files.ts";

export const api = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const numOrNull = (v: unknown) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/[,\s]/g, "").replace(/k$/i, "e3").replace(/m$/i, "e6"));
  return Number.isFinite(n) ? Math.round(n) : null;
};

/* -------------------------------------------------------------- Settings */

api.get("/settings", (_req, res) => {
  res.json(publicSettings());
});

api.put("/settings", (req, res) => {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(req.body ?? {})) {
    if (!(key in defaults)) continue;
    if (SECRET_KEYS.includes(key as keyof Settings)) {
      if (value === null) patch[key] = "";
      else if (typeof value === "string" && value.trim() && !value.includes("…")) patch[key] = value.trim();
      continue;
    }
    const def = defaults[key as keyof Settings];
    patch[key] = typeof def === "number" ? Number(value) || 0 : value;
  }
  setSettings(patch as Partial<Settings>);
  res.json(publicSettings());
});

api.get("/sources/status", (_req, res) => {
  const s = getSettings();
  res.json({
    llm: Boolean(s.llmApiKey),
    provider: s.llmBaseUrl,
    meta: metaConfigured(s),
    metaUsername: s.metaIgUsername,
    metaExpiresAt: s.metaTokenExpiresAt,
    apify: apifyConfigured(s),
    lastRefreshAt: s.lastRefreshAt,
    alternatives: [...(s.llmApiKey ? [] : [ALT.groqKey]), ...instagramAlternatives(s, { includeManual: false })],
  });
});

api.post("/sources/test/:which", async (req, res) => {
  const s = getSettings();
  if (req.params.which === "llm") {
    const models = await testLlm();
    return res.json({ ok: true, message: `Connected. ${models.length} models available.`, models });
  }
  if (req.params.which === "meta") {
    if (!metaConfigured(s)) throw new AppError("Meta isn't connected yet.", { alternatives: [ALT.meta] });
    const info = await metaTest(s);
    if (info.expiresAt) setSettings({ metaTokenExpiresAt: info.expiresAt });
    return res.json({
      ok: true,
      message: `Connected as @${info.username}.${
        info.expiresAt ? ` Token expires ${new Date(info.expiresAt).toLocaleDateString()}.` : ""
      }`,
    });
  }
  if (req.params.which === "apify") {
    if (!apifyConfigured(s)) throw new AppError("No Apify token yet.", { alternatives: [ALT.apify] });
    const info = await apifyTest(s);
    const usage =
      info.usedUsd != null ? ` Used $${Number(info.usedUsd).toFixed(2)} of $${Number(info.limitUsd ?? 5).toFixed(2)} this month.` : "";
    return res.json({ ok: true, message: `Connected as ${info.username} (${info.plan || "free"} plan).${usage}` });
  }
  throw new AppError("Unknown source.", { status: 404 });
});

/** Save a Meta token (optionally exchanging it for a 60-day one) and find the linked Instagram account. */
api.post("/sources/meta/connect", async (req, res) => {
  const s = getSettings();
  let token = str(req.body.token);
  if (!token) throw new AppError("Paste the access token from Graph API Explorer.");
  let expiresAt = now() + 60 * 60_000; // Explorer tokens last ~1 hour
  if (str(req.body.appId) && str(req.body.appSecret)) {
    const exchanged = await metaExchangeToken(s, str(req.body.appId), str(req.body.appSecret), token);
    token = exchanged.token;
    expiresAt = exchanged.expiresAt;
  }
  const accounts = await metaDiscoverAccounts(s, token);
  if (!accounts.length) {
    throw new AppError("This token can't see any Instagram professional account.", {
      hint:
        "Make sure your Instagram is a Creator/Business account linked to a Facebook Page, and that the token has instagram_basic, pages_show_list, pages_read_engagement and business_management.",
    });
  }
  const chosen = accounts.find((a) => a.igUserId === str(req.body.igUserId)) ?? accounts[0];
  setSettings({
    metaAccessToken: token,
    metaTokenExpiresAt: expiresAt,
    metaIgUserId: chosen.igUserId,
    metaIgUsername: chosen.igUsername,
  });
  res.json({ ok: true, accounts, chosen, expiresAt, settings: publicSettings() });
});

api.post("/sources/meta/disconnect", (_req, res) => {
  setSettings({ metaAccessToken: "", metaIgUserId: "", metaIgUsername: "", metaTokenExpiresAt: 0 });
  res.json(publicSettings());
});

/* ------------------------------------------------------------- Watchlist */

api.get("/creators", (_req, res) => {
  res.json(
    all(`select c.*, (select count(*) from reels r where r.owner = c.username) reel_count
         from creators c order by added_at desc`),
  );
});

api.post("/creators", (req, res) => {
  const names = String(req.body.usernames ?? req.body.username ?? "")
    .split(/[\s,]+/)
    .map(cleanUsername)
    .filter((u) => /^[a-z0-9._]{1,30}$/.test(u));
  if (!names.length) throw new AppError("Enter at least one Instagram username, like @creator.");
  for (const u of names) run("insert or ignore into creators (username, added_at) values (?, ?)", u, now());
  res.json({ added: names });
});

api.delete("/creators/:username", (req, res) => {
  run("delete from creators where username = ?", req.params.username);
  res.json({ ok: true });
});

api.get("/hashtags", (_req, res) => {
  res.json(
    all(`select h.*, (select count(*) from reels r where r.via_hashtag = h.tag) reel_count
         from hashtags h order by added_at desc`),
  );
});

api.post("/hashtags", (req, res) => {
  const tags = String(req.body.tags ?? req.body.tag ?? "")
    .split(/[\s,]+/)
    .map(cleanHashtag)
    .filter(Boolean);
  if (!tags.length) throw new AppError("Enter at least one hashtag.");
  for (const t of tags) run("insert or ignore into hashtags (tag, added_at) values (?, ?)", t, now());
  res.json({ added: tags });
});

api.delete("/hashtags/:tag", (req, res) => {
  run("delete from hashtags where tag = ?", req.params.tag);
  res.json({ ok: true });
});

/* ----------------------------------------------------------------- Radar */

api.get("/radar/reels", (req, res) => {
  res.json(
    queryReels({
      days: Number(req.query.days) || 30,
      sort: (str(req.query.sort) || "outlier") as "outlier",
      owner: str(req.query.owner) || undefined,
      hashtag: str(req.query.hashtag) || undefined,
      limit: Number(req.query.limit) || 200,
    }),
  );
});

api.post("/radar/refresh", (req, res) => {
  startRefresh({
    usernames: Array.isArray(req.body?.usernames) ? req.body.usernames.map(cleanUsername) : undefined,
    tags: Array.isArray(req.body?.tags) ? req.body.tags.map(cleanHashtag) : undefined,
    report: typeof req.body?.report === "boolean" ? req.body.report : undefined,
  });
  res.json({ started: true });
});

api.get("/radar/status", (_req, res) => {
  const s = getSettings();
  res.json({ ...job, lastRefreshAt: s.lastRefreshAt, autoRefreshHours: s.autoRefreshHours });
});

api.post("/radar/report", async (req, res) => {
  const id = await generateReport({ days: Number(req.body?.days) || undefined });
  res.json({ id });
});

/* ----------------------------------------------------------------- Reels */

api.post("/reels/by-url", async (req, res) => {
  const url = str(req.body.url);
  const reel = await fetchReelByUrl(getSettings(), url, str(req.body.owner) || undefined);
  upsertReel(reel);
  res.json(getScoredReel(reel.id));
});

api.post("/reels/manual", (req, res) => {
  const url = str(req.body.url);
  const id = shortcodeFromUrl(url) ?? `manual-${newId()}`;
  const owner = cleanUsername(str(req.body.owner));
  upsertReel({
    id,
    url,
    owner,
    caption: str(req.body.caption),
    thumbnail: null,
    videoUrl: null,
    audioUrl: null,
    postedAt: req.body.postedAt ? Date.parse(req.body.postedAt) || null : null,
    duration: numOrNull(req.body.duration),
    views: numOrNull(req.body.views),
    likes: numOrNull(req.body.likes),
    comments: numOrNull(req.body.comments),
    music: null,
    source: "manual",
  });
  if (str(req.body.transcript)) run("update reels set transcript = ? where id = ?", str(req.body.transcript), id);
  if (owner) run("insert or ignore into creators (username, added_at) values (?, ?)", owner, now());
  res.json(getScoredReel(id));
});

const reelWithJob = (id: string) => ({ ...getScoredReel(id), job: reelJob(id) });

api.get("/reels/:id", (req, res) => {
  res.json(reelWithJob(req.params.id));
});

api.get("/jobs", (_req, res) => {
  res.json(listJobs());
});

api.patch("/reels/:id", (req, res) => {
  if (typeof req.body.transcript === "string") {
    run("update reels set transcript = ? where id = ?", req.body.transcript.trim() || null, req.params.id);
  }
  res.json(getScoredReel(req.params.id));
});

// Transcribe and analyze run as background jobs: respond immediately, the UI polls /reels/:id or /jobs.
const reelLabel = (id: string) => `@${getReel(id)?.owner || "unknown"}'s Reel`;

api.post("/reels/:id/transcribe", (req, res) => {
  const id = req.params.id;
  startReelJob("transcribe", id, reelLabel(id), () => ensureTranscript(id));
  res.json(reelWithJob(id));
});

api.post("/reels/:id/upload", upload.single("file"), async (req, res) => {
  if (!req.file) throw new AppError("No file uploaded.");
  if (!getReel(String(req.params.id))) throw new AppError("Reel not found.", { status: 404 });
  const text = await transcribe(new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype }), req.file.originalname);
  run("update reels set transcript = ? where id = ?", text || "(no speech detected)", req.params.id);
  res.json(getScoredReel(String(req.params.id)));
});

api.post("/reels/:id/analyze", (req, res) => {
  const id = req.params.id;
  startReelJob("analyze", id, reelLabel(id), () => analyzeReel(id));
  res.json(reelWithJob(id));
});

/** Instagram's CDN blocks images embedded on other sites, so thumbnails are proxied and cached on disk. */
api.get("/reels/:id/thumb", async (req, res) => {
  const safeId = req.params.id.replace(/[^A-Za-z0-9_-]/g, "");
  const file = path.join(THUMB_DIR, `${safeId}.jpg`);
  res.setHeader("Cache-Control", "public, max-age=604800");
  if (existsSync(file)) return res.sendFile(file);
  const reel = getReel(req.params.id);
  if (!reel?.thumbnail) return res.status(404).end();
  const upstream = await fetch(reel.thumbnail, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!upstream?.ok) return res.status(404).end();
  const buf = Buffer.from(await upstream.arrayBuffer());
  writeFileSync(file, buf);
  res.type(upstream.headers.get("content-type") ?? "image/jpeg").send(buf);
});

/* ------------------------------------------------------- Reports & ideas */

api.get("/reports", (_req, res) => {
  res.json(
    all<Record<string, any>>("select id, created_at, title, data from reports order by created_at desc limit 100").map((r) => ({
      ...r,
      headline: parseJson<{ headline?: string }>(r.data, {}).headline ?? "",
      data: undefined,
    })),
  );
});

api.get("/reports/:id", (req, res) => {
  const report = get("select * from reports where id = ?", req.params.id);
  if (!report) throw new AppError("Report not found.", { status: 404 });
  res.json({ ...report, ideas: all("select * from ideas where report_id = ? order by rowid", req.params.id) });
});

api.delete("/reports/:id", (req, res) => {
  run("delete from ideas where report_id = ? and status = 'new'", req.params.id);
  run("delete from reports where id = ?", req.params.id);
  res.json({ ok: true });
});

api.get("/ideas", (req, res) => {
  const status = str(req.query.status);
  res.json(
    status
      ? all("select * from ideas where status = ? order by created_at desc", status)
      : all("select * from ideas where status != 'dismissed' order by created_at desc limit 300"),
  );
});

api.post("/ideas", (req, res) => {
  const id = newId();
  run(
    "insert into ideas (id, created_at, title, hook, format, angle, why, based_on, status) values (?, ?, ?, ?, ?, ?, ?, ?, 'saved')",
    id,
    now(),
    str(req.body.title) || "Untitled idea",
    str(req.body.hook),
    str(req.body.format),
    str(req.body.angle),
    str(req.body.why),
    JSON.stringify(Array.isArray(req.body.basedOn) ? req.body.basedOn : []),
  );
  res.json(get("select * from ideas where id = ?", id));
});

api.patch("/ideas/:id", (req, res) => {
  for (const field of ["title", "hook", "format", "angle", "why", "status", "script"]) {
    if (typeof req.body[field] === "string") run(`update ideas set ${field} = ? where id = ?`, req.body[field], req.params.id);
  }
  res.json(get("select * from ideas where id = ?", req.params.id));
});

api.delete("/ideas/:id", (req, res) => {
  run("delete from ideas where id = ?", req.params.id);
  res.json({ ok: true });
});

api.post("/ideas/:id/script", async (req, res) => {
  await writeScript(req.params.id, str(req.body?.notes));
  res.json(get("select * from ideas where id = ?", req.params.id));
});

/* ---------------------------------------------------------------- Boards */

api.get("/boards", (_req, res) => {
  res.json(listBoards());
});

api.post("/boards", (req, res) => {
  res.json(createBoard(str(req.body.name) || "Untitled board"));
});

api.patch("/boards/:id", (req, res) => {
  if (str(req.body.name)) run("update boards set name = ? where id = ?", str(req.body.name), req.params.id);
  touchBoard(req.params.id);
  res.json(get("select * from boards where id = ?", req.params.id));
});

api.delete("/boards/:id", (req, res) => {
  const nodeIds = all<{ id: string }>("select id from nodes where board_id = ?", req.params.id);
  for (const { id } of nodeIds) run("delete from messages where chat_id = ?", id);
  run("delete from boards where id = ?", req.params.id);
  res.json({ ok: true });
});

api.get("/boards/:id", (req, res) => {
  res.json(getBoard(req.params.id));
});

const NODE_TYPES: NodeType[] = ["note", "chat", "reel", "creator", "radar", "url", "file"];

api.post("/boards/:id/nodes", (req, res) => {
  const type = req.body.type as NodeType;
  if (!NODE_TYPES.includes(type)) throw new AppError("Unknown node type.");
  const data = (req.body.data ?? {}) as Record<string, unknown>;
  if (type === "creator") {
    const username = cleanUsername(String(data.username ?? ""));
    if (!username) throw new AppError("Enter the creator's @username.");
    data.username = username;
    run("insert or ignore into creators (username, added_at) values (?, ?)", username, now());
  }
  const node = addNode(
    req.params.id,
    type,
    Number(req.body.x) || 0,
    Number(req.body.y) || 0,
    data,
    req.body.w ?? (type === "chat" ? 420 : null),
    req.body.h ?? (type === "chat" ? 260 : null),
  );
  res.json(node);
});

/** Add anything by link: an Instagram Reel (live stats), an Instagram profile (creator), or a web page. */
api.post("/boards/:id/nodes/link", async (req, res) => {
  const url = str(req.body.url);
  const x = Number(req.body.x) || 0;
  const y = Number(req.body.y) || 0;
  if (!/^https?:\/\//i.test(url)) throw new AppError("Paste a full link starting with https://");
  if (isInstagramUrl(url)) {
    if (shortcodeFromUrl(url)) {
      const reel = await fetchReelByUrl(getSettings(), url, str(req.body.owner) || undefined);
      upsertReel(reel);
      return res.json(addNode(req.params.id, "reel", x, y, { reelId: reel.id }));
    }
    const username = cleanUsername(url);
    run("insert or ignore into creators (username, added_at) values (?, ?)", username, now());
    return res.json(addNode(req.params.id, "creator", x, y, { username }));
  }
  const page = await fetchPage(url);
  res.json(addNode(req.params.id, "url", x, y, { url, title: page.title, site: page.siteName, text: page.text }));
});

api.post("/boards/:id/nodes/file", upload.single("file"), async (req, res) => {
  if (!req.file) throw new AppError("No file uploaded.");
  const { originalname, mimetype, buffer } = req.file;
  const x = Number(req.body.x) || 0;
  const y = Number(req.body.y) || 0;
  let text = "";
  let error: string | null = null;
  let kind = fileKind(originalname, mimetype);
  try {
    ({ text, kind } = await extractFileText(buffer, originalname, mimetype));
    if (kind === "image") error = "The current AI models can't read images. Add a Note describing it instead.";
    if (kind === "other") error = "Unsupported file type. Use PDF, text, audio or video.";
  } catch (err) {
    error = errorBody(err).error + (errorBody(err).hint ? ` ${errorBody(err).hint}` : "");
  }
  res.json(addNode(String(req.params.id), "file", x, y, { filename: originalname, mime: mimetype, kind, text, error }));
});

api.patch("/nodes/:id", (req, res) => {
  const { x, y, w, h, data } = req.body ?? {};
  res.json(updateNode(req.params.id, { x, y, w, h, data }));
});

api.delete("/nodes/:id", (req, res) => {
  deleteNode(req.params.id);
  res.json({ ok: true });
});

api.post("/boards/:id/edges", (req, res) => {
  res.json(addEdge(req.params.id, str(req.body.source), str(req.body.target)));
});

api.delete("/edges/:id", (req, res) => {
  run("delete from edges where id = ?", req.params.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ Chat */

const contextFor = (chatId: string, scope: string, days?: number) =>
  scope === "radar" ? buildRadarContext(days) : buildBoardContext(chatId);

api.get("/chat/:chatId", (req, res) => {
  res.json(all("select id, role, content, meta, created_at from messages where chat_id = ? order by id", req.params.chatId));
});

api.get("/chat/:chatId/context", (req, res) => {
  res.json(contextFor(req.params.chatId, str(req.query.scope), Number(req.query.days) || undefined).sources);
});

api.delete("/chat/:chatId", (req, res) => {
  run("delete from messages where chat_id = ?", req.params.chatId);
  res.json({ ok: true });
});

api.post("/chat/:chatId", async (req: Request, res: Response) => {
  const chatId = req.params.chatId as string;
  const message = str(req.body.message);
  const webSearch = Boolean(req.body.webSearch);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const abort = new AbortController();
  res.on("close", () => abort.abort());

  try {
    if (!message) throw new AppError("Type a message first.");
    const s = getSettings();
    const context = contextFor(chatId, str(req.body.scope), Number(req.body.days) || undefined);
    send("context", context.sources);

    // Keep recent history within ~1,500 tokens.
    const history: ChatMsg[] = [];
    let historyTokens = 0;
    for (const m of all<{ role: "user" | "assistant"; content: string }>(
      "select role, content from messages where chat_id = ? order by id desc limit 10",
      chatId,
    )) {
      historyTokens += estimateTokens(m.content);
      if (historyTokens > 1500) break;
      history.unshift({ role: m.role, content: m.content });
    }

    if (webSearch) send("info", "Searching the web…");

    const system = [
      CORE_RULES,
      brandBlock(s.brand),
      liveDataBlock(s),
      webSearch ? "WEB SEARCH is ON: use browser_search for anything current, and name the sites you used." : "WEB SEARCH is OFF.",
      `CONTEXT (sources connected to this chat):\n${context.text}`,
    ].join("\n\n");

    let answer = "";
    let model = "";
    for await (const ev of stream({
      messages: [{ role: "system", content: system }, ...history, { role: "user", content: message }],
      webSearch,
      maxTokens: 2048,
      signal: abort.signal,
    })) {
      if (ev.type === "model") model = ev.model;
      else {
        answer += ev.text;
        send("delta", ev.text);
      }
    }
    // Saved only after a successful reply, so a failed attempt can simply be retried.
    run("insert into messages (chat_id, role, content, created_at) values (?, 'user', ?, ?)", chatId, message, now());
    run(
      "insert into messages (chat_id, role, content, meta, created_at) values (?, 'assistant', ?, ?, ?)",
      chatId,
      answer || "(empty reply)",
      JSON.stringify({ model, webSearch }),
      now(),
    );
    send("done", { model });
  } catch (err) {
    if (!abort.signal.aborted) send("error", errorBody(err));
  } finally {
    res.end();
  }
});
