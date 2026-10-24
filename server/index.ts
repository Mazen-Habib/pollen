import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { get } from "./db.ts";
import { api } from "./routes.ts";
import { errorBody, AppError } from "./errors.ts";
import { createBoard } from "./boards.ts";
import { startScheduler } from "./radar.ts";

const PORT = Number(process.env.PORT ?? 4317);
const app = express();

app.use(express.json({ limit: "2mb" }));
app.use("/api", api);

app.use("/api", (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json(errorBody(err));
});

const dist = path.resolve("dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

if (!get("select id from boards limit 1")) createBoard("My first board");
startScheduler();

app.listen(PORT, "127.0.0.1", () => {
  const url = existsSync(dist) ? `http://127.0.0.1:${PORT}` : "http://127.0.0.1:5173";
  console.log(`\n  🌼 Pollen is running → ${url}\n`);
});
