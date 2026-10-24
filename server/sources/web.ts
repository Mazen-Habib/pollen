import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { AppError, ALT } from "../errors.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const pasteAlternative = {
  id: "paste",
  title: "Paste the text into a Note",
  detail: "Copy the page's text, add a Note to the board, and connect it to the chat.",
  cost: "Free",
};

export async function fetchPage(url: string) {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new AppError(`Couldn't reach that page (${err instanceof Error ? err.message : err}).`, {
      alternatives: [ALT.webSearch, pasteAlternative],
    });
  }
  if (!res.ok) {
    throw new AppError(`The site blocked or failed the request (HTTP ${res.status}).`, {
      hint: "Many sites block automated readers.",
      alternatives: [ALT.webSearch, pasteAlternative],
    });
  }
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text();
  if (!type.includes("html")) return { title: url, text: body.slice(0, 200_000), siteName: new URL(url).hostname };

  const { document } = parseHTML(body);
  const title = document.querySelector("title")?.textContent?.trim() || url;
  const article = new Readability(document as unknown as Document).parse();
  const text = (article?.textContent ?? document.body?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 200) {
    throw new AppError("That page has almost no readable text (it probably needs JavaScript or a login).", {
      alternatives: [ALT.webSearch, pasteAlternative],
    });
  }
  return { title: article?.title || title, text, siteName: article?.siteName || new URL(url).hostname };
}
