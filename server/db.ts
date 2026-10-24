import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// node:sqlite is built into Node 22+/24 but still prints an ExperimentalWarning; silence just that one.
const originalEmitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  if (String(warning).includes("SQLite")) return;
  return (originalEmitWarning as (...a: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export const DATA_DIR = path.resolve(process.env.POLLEN_DATA_DIR ?? "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const THUMB_DIR = path.join(DATA_DIR, "thumbs");
for (const dir of [DATA_DIR, UPLOAD_DIR, THUMB_DIR]) mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "pollen.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
create table if not exists settings (key text primary key, value text not null);

create table if not exists boards (
  id text primary key, name text not null, created_at integer not null, updated_at integer not null
);
create table if not exists nodes (
  id text primary key, board_id text not null references boards(id) on delete cascade,
  type text not null, x real not null default 0, y real not null default 0,
  w real, h real, data text not null default '{}', created_at integer not null, updated_at integer not null
);
create table if not exists edges (
  id text primary key, board_id text not null references boards(id) on delete cascade,
  source text not null, target text not null
);
create table if not exists messages (
  id integer primary key autoincrement, chat_id text not null, role text not null,
  content text not null, meta text, created_at integer not null
);
create index if not exists messages_chat on messages(chat_id, id);

create table if not exists creators (
  username text primary key, full_name text, followers integer, media_count integer, profile_pic text,
  added_at integer not null, last_fetched_at integer, last_source text, last_error text
);
create table if not exists hashtags (
  tag text primary key, added_at integer not null, last_fetched_at integer, last_source text, last_error text
);
create table if not exists reels (
  id text primary key, url text, owner text, caption text, thumbnail text, video_url text, audio_url text,
  posted_at integer, duration real, views integer, likes integer, comments integer, music text,
  source text not null, via_hashtag text, first_seen_at integer not null, updated_at integer not null,
  transcript text, analysis text, analyzed_at integer
);
create index if not exists reels_owner on reels(owner);
create table if not exists reel_snapshots (
  reel_id text not null, taken_at integer not null, views integer, likes integer, comments integer
);
create index if not exists snapshots_reel on reel_snapshots(reel_id, taken_at);

create table if not exists reports (
  id text primary key, created_at integer not null, title text not null, body text not null, data text
);
create table if not exists ideas (
  id text primary key, report_id text, created_at integer not null, title text not null, hook text,
  format text, angle text, why text, based_on text, status text not null default 'new', script text
);
create table if not exists refresh_log (
  id integer primary key autoincrement, at integer not null, ok integer not null, summary text not null
);
`);

export const newId = () => randomUUID().replace(/-/g, "").slice(0, 16);
export const now = () => Date.now();

type Row = Record<string, unknown>;
export const all = <T = Row>(sql: string, ...params: unknown[]) =>
  db.prepare(sql).all(...(params as never[])) as T[];
export const get = <T = Row>(sql: string, ...params: unknown[]) =>
  db.prepare(sql).get(...(params as never[])) as T | undefined;
export const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...(params as never[]));

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export const parseJson = <T>(text: unknown, fallback: T): T => {
  if (typeof text !== "string" || !text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};
