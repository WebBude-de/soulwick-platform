/**
 * Sanitiser for the legal HTML from eRecht24 (ported from DapItUp, P-025). This is hardening:
 * the source is our own eRecht24 project, not user input.
 *
 * The output is rebuilt from scratch, never passed through: Bun's HTMLRewriter (lol-html)
 * only serves as a tokenizer that tokenises like a browser (quoted ">", "/" separators,
 * raw-text elements). From its tokens we emit
 * - allowlisted elements with no attributes, except `a[href]` with http(s), mailto or tel,
 * - text with "<" and ">" escaped,
 * - balanced end tags (every element we open is closed again).
 * Everything else disappears: other tags (their text stays), comments, doctypes, stray end
 * tags and anything the tokenizer could not complete, e.g. a trailing `<img onerror=...`.
 * Raw-text and embedding elements (script, style, title, xmp, plaintext, ...) are dropped
 * together with their content. A leading <h1> is dropped too (the page renders its title).
 */

const ALLOWED_ELEMENTS = new Set([
  "p",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "b",
  "i",
  "br",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "a",
]);

const VOID_ELEMENTS = new Set(["br", "hr"]);

/** Opening one of these closes an open <p> (HTML implied end tag). */
const BLOCK_ELEMENTS = new Set([
  "p",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "table",
  "hr",
]);

/** Dropped together with everything inside them. */
const DROPPED_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "noscript",
  "noembed",
  "noframes",
  "template",
  "svg",
  "math",
  "title",
  "textarea",
  "select",
  "xmp",
  "plaintext",
  "head",
]);

const ALLOWED_HREF = /^(https?:\/\/|mailto:|tel:)/;
const NUMERIC_ENTITY = /&#(x[0-9a-f]+|\d+);?/gi;
const NAMED_ENTITY = /&(colon|tab|newline|nbsp|amp|sol|period);?/gi;
const NAMED_ENTITY_VALUES: Record<string, string> = {
  amp: "&",
  colon: ":",
  nbsp: " ",
  newline: "\n",
  period: ".",
  sol: "/",
  tab: "\t",
};
const HEX_RADIX = 16;
const MAX_CODE_POINT = 0x10_ff_ff;
// Browsers ignore ASCII whitespace and control characters inside a URL scheme.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what has to go.
const IGNORED_IN_SCHEME = /[\u0000- \u007f-\u009f]/g;
const LT = /</g;
const GT = />/g;
const QUOTE = /"/g;
const WHITESPACE_ONLY = /^\s*$/;

function decodeEntities(value: string): string {
  return value
    .replace(NUMERIC_ENTITY, (_m, code: string) => {
      const n =
        code[0] === "x" || code[0] === "X"
          ? Number.parseInt(code.slice(1), HEX_RADIX)
          : Number.parseInt(code, 10);
      return Number.isFinite(n) && n <= MAX_CODE_POINT
        ? String.fromCodePoint(n)
        : "";
    })
    .replace(
      NAMED_ENTITY,
      (_m, name: string) => NAMED_ENTITY_VALUES[name.toLowerCase()] ?? ""
    );
}

/**
 * Whether a raw (entity-encoded) href may be kept: only http(s), mailto and tel. An
 * allowlist on the decoded value is safe even if decoding is partial: an undecoded entity
 * in the scheme never matches.
 */
export function isAllowedHref(rawValue: string): boolean {
  const normalised = decodeEntities(rawValue)
    .replace(IGNORED_IN_SCHEME, "")
    .toLowerCase();
  return ALLOWED_HREF.test(normalised);
}

function escapeText(raw: string): string {
  return raw.replace(LT, "&lt;").replace(GT, "&gt;");
}

/** The raw value keeps its entities; only characters that could end the attribute go. */
function escapeAttribute(raw: string): string {
  return raw.replace(QUOTE, "&quot;").replace(LT, "&lt;").replace(GT, "&gt;");
}

/** First href in source order (browsers ignore duplicates), if it is allowed. */
function allowedHref(element: HTMLRewriterTypes.Element): string | null {
  for (const [name, value] of element.attributes) {
    if (name.toLowerCase() === "href") {
      return isAllowedHref(value) ? value : null;
    }
  }
  return null;
}

interface OpenElement {
  tag: string;
}

/** Allowlist-rebuild of eRecht24 HTML; see the file comment. */
export function sanitizeLegalHtml(html: string): string {
  const out: string[] = [];
  /** Emitted, not yet closed elements (identities, so a late end tag closes only its own). */
  const open: OpenElement[] = [];
  let skipping = false;
  let seenContent = false;

  /** Closes `entry` and everything opened inside it. */
  const closeEntry = (entry: OpenElement | undefined) => {
    const index = entry ? open.indexOf(entry) : -1;
    if (index === -1) {
      return;
    }
    for (const { tag } of open.splice(index).reverse()) {
      out.push(`</${tag}>`);
    }
  };

  const lastOpen = (tags: string[]) =>
    open.findLastIndex((entry) => tags.includes(entry.tag));

  /** Closes the innermost `tag` if it sits inside the nearest container (or has none). */
  const closeWithin = (tags: string[], containers: string[]) => {
    const index = lastOpen(tags);
    if (index > lastOpen(containers)) {
      closeEntry(open[index]);
    }
  };

  /** HTML's implied end tags, so `<li>a<li>b` or `<p>a<p>b` do not nest. */
  const closeImplied = (tag: string) => {
    if (BLOCK_ELEMENTS.has(tag) && open.at(-1)?.tag === "p") {
      closeEntry(open.at(-1));
    }
    if (tag === "li") {
      closeWithin(["li"], ["ul", "ol"]);
    } else if (tag === "tr") {
      closeWithin(["tr"], ["table", "thead", "tbody"]);
    } else if (tag === "td" || tag === "th") {
      closeWithin(["td", "th"], ["tr"]);
    }
  };

  const skipUntilEnd = (element: HTMLRewriterTypes.Element) => {
    if (!element.canHaveContent) {
      return;
    }
    skipping = true;
    element.onEndTag(() => {
      skipping = false;
    });
  };

  const onElement = (element: HTMLRewriterTypes.Element) => {
    if (skipping) {
      return;
    }
    const tag = element.tagName.toLowerCase();
    if ((tag === "h1" && !seenContent) || DROPPED_WITH_CONTENT.has(tag)) {
      skipUntilEnd(element);
      return;
    }
    if (!ALLOWED_ELEMENTS.has(tag)) {
      return;
    }
    seenContent = true;
    closeImplied(tag);
    const href = tag === "a" ? allowedHref(element) : null;
    out.push(
      href === null ? `<${tag}>` : `<a href="${escapeAttribute(href)}">`
    );
    if (VOID_ELEMENTS.has(tag) || !element.canHaveContent) {
      return;
    }
    const entry: OpenElement = { tag };
    open.push(entry);
    element.onEndTag(() => closeEntry(entry));
  };

  // biome-ignore lint/correctness/noUndeclaredVariables: HTMLRewriter is a Bun global (bun-types declares it, but not on globalThis, so the type checker needs the bare name).
  new HTMLRewriter()
    .on("*", { element: onElement })
    .onDocument({
      text(chunk) {
        if (skipping || !chunk.text) {
          return;
        }
        if (!WHITESPACE_ONLY.test(chunk.text)) {
          seenContent = true;
        }
        out.push(escapeText(chunk.text));
      },
    })
    .transform(html);

  closeEntry(open[0]);
  return out.join("").trim();
}
