import { extractText, getDocumentProxy } from "unpdf";
import { transcribe } from "../llm.ts";

export type FileKind = "pdf" | "text" | "audio" | "video" | "image" | "other";

const TEXT_EXT = /\.(txt|md|markdown|csv|json|srt|vtt|html?)$/i;

export function fileKind(filename: string, mime: string): FileKind {
  if (mime === "application/pdf" || /\.pdf$/i.test(filename)) return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/") || TEXT_EXT.test(filename)) return "text";
  return "other";
}

/** Turn an uploaded file into text the AI can read. */
export async function extractFileText(buffer: Buffer, filename: string, mime: string) {
  const kind = fileKind(filename, mime);
  switch (kind) {
    case "pdf": {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      return { kind, text: String(text).trim() };
    }
    case "text":
      return { kind, text: buffer.toString("utf8") };
    case "audio":
    case "video":
      return { kind, text: await transcribe(new Blob([new Uint8Array(buffer)], { type: mime }), filename) };
    default:
      return { kind, text: "" };
  }
}
