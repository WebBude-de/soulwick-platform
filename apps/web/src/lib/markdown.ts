/**
 * A deliberately small Markdown subset for the news posts (`content/news/**`), parsed into plain
 * data and rendered by `components/news/markdown.tsx` as React elements (no HTML strings, so
 * nothing in a post can inject markup). Supported:
 *
 * - `## Heading` and `### Heading`
 * - paragraphs (lines separated by a blank line are joined)
 * - lists with `- item`
 * - quotes with `> text`
 * - inline `**bold**`, `*italic*` and `[text](https://… | /path | mailto:…)`
 *
 * Anything else is kept as text.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string }
  | { type: "link"; text: string; href: string };

export type Block =
  | { type: "h2" | "h3"; content: Inline[] }
  | { type: "p"; content: Inline[] }
  | { type: "quote"; content: Inline[] }
  | { type: "ul"; items: Inline[][] };

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;
const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?!\/))/i;
const HEADING = /^(#{2,3})\s+(.*)$/;
const LIST_ITEM = /^[-*]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const LINE_BREAK = /\r?\n/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  for (const part of text.split(INLINE)) {
    if (part === "") {
      continue;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      out.push({ type: "strong", text: part.slice(2, -2) });
      continue;
    }
    const link: RegExpExecArray | null = LINK.exec(part);
    if (link) {
      const [, label = "", href = ""] = link;
      out.push(
        SAFE_HREF.test(href)
          ? { type: "link", text: label, href }
          : { type: "text", text: label }
      );
      continue;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      out.push({ type: "em", text: part.slice(1, -1) });
      continue;
    }
    out.push({ type: "text", text: part });
  }
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Inline[][] | null = null;
  let quote: string[] | null = null;

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "p", content: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
    if (list) {
      blocks.push({ type: "ul", items: list });
      list = null;
    }
    if (quote) {
      blocks.push({ type: "quote", content: parseInline(quote.join(" ")) });
      quote = null;
    }
  };

  for (const raw of source.split(LINE_BREAK)) {
    const line = raw.trim();
    if (line === "") {
      flush();
      continue;
    }
    const heading: RegExpExecArray | null = HEADING.exec(line);
    if (heading) {
      flush();
      const [, hashes = "##", text = ""] = heading;
      blocks.push({
        type: hashes.length === 2 ? "h2" : "h3",
        content: parseInline(text),
      });
      continue;
    }
    const item: RegExpExecArray | null = LIST_ITEM.exec(line);
    if (item) {
      if (!list) {
        flush();
        list = [];
      }
      list.push(parseInline(item[1] ?? ""));
      continue;
    }
    const quoted: RegExpExecArray | null = QUOTE.exec(line);
    if (quoted) {
      if (!quote) {
        flush();
        quote = [];
      }
      quote.push(quoted[1] ?? "");
      continue;
    }
    if (list || quote) {
      flush();
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}
