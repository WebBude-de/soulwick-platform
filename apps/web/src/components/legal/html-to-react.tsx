import { createElement, Fragment, type ReactNode } from "react";

/**
 * Renders the legal HTML from the API (eRecht24 cache) as React elements through an allowlist,
 * so the page never needs `dangerouslySetInnerHTML`. Unknown tags are unwrapped (their text
 * stays), active content (scripts, frames, forms, media) is dropped, links keep only safe
 * protocols. The parser is deliberately small: eRecht24 emits plain, well-formed markup.
 */

type HtmlNode =
  | { kind: "text"; text: string }
  | {
      kind: "element";
      tag: string;
      attrs: Attrs;
      children: HtmlNode[];
    };

/** Attribute map; a missing attribute reads as `undefined`. */
type Attrs = Record<string, string | undefined>;

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link", "wbr"]);

/** Rendered as the same element. */
const ALLOWED_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "li",
  "a",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "br",
  "hr",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "blockquote",
  "span",
  "div",
  "section",
  "article",
  "small",
  "sup",
  "sub",
  "dl",
  "dt",
  "dd",
  "address",
  "code",
  "pre",
]);

/** Removed together with their content. */
const DROPPED_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "svg",
  "img",
  "video",
  "audio",
  "noscript",
  "template",
  "link",
  "meta",
  "head",
  "title",
]);

const SAFE_HREF = /^(?:https?:|mailto:|tel:|\/|#)/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  shy: "­",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  sect: "§",
  para: "¶",
  middot: "·",
  bull: "•",
  deg: "°",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
};

const ENTITY_PATTERN = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

export function decodeEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return codePoint(Number.parseInt(body.slice(2), 16), match);
    }
    if (body.startsWith("#")) {
      return codePoint(Number.parseInt(body.slice(1), 10), match);
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

function codePoint(value: number, fallback: string): string {
  return Number.isFinite(value) && value > 0 && value <= 0x10_ff_ff
    ? String.fromCodePoint(value)
    : fallback;
}

const TOKEN_PATTERN =
  /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-z][\w-]*)\s*>|<([a-z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/gi;
const ATTR_PATTERN =
  /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttrs(raw: string): Attrs {
  const attrs: Attrs = {};
  for (const m of raw.matchAll(ATTR_PATTERN)) {
    const name = m[1]?.toLowerCase();
    if (name) {
      attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
    }
  }
  return attrs;
}

/** Tolerant tag-soup parser: stray closing tags are ignored, unclosed tags close at the end. */
export function parseHtml(html: string): HtmlNode[] {
  const root: HtmlNode = {
    kind: "element",
    tag: "#root",
    attrs: {},
    children: [],
  };
  const stack: Extract<HtmlNode, { kind: "element" }>[] = [root];
  const top = () => stack.at(-1) ?? root;
  let last = 0;

  for (const m of html.matchAll(TOKEN_PATTERN)) {
    const index = m.index ?? 0;
    if (index > last) {
      top().children.push({
        kind: "text",
        text: decodeEntities(html.slice(last, index)),
      });
    }
    last = index + m[0].length;

    const closing = m[1]?.toLowerCase();
    const opening = m[2]?.toLowerCase();
    if (closing) {
      const depth = stack.findLastIndex((n) => n.tag === closing);
      if (depth > 0) {
        stack.length = depth;
      }
    } else if (opening) {
      const node: HtmlNode = {
        kind: "element",
        tag: opening,
        attrs: parseAttrs(m[3] ?? ""),
        children: [],
      };
      top().children.push(node);
      if (!(VOID_TAGS.has(opening) || m[0].endsWith("/>"))) {
        stack.push(node);
      }
    }
  }
  if (last < html.length) {
    top().children.push({
      kind: "text",
      text: decodeEntities(html.slice(last)),
    });
  }
  return root.children;
}

function isBlank(node: HtmlNode): boolean {
  return node.kind === "text" && node.text.trim().length === 0;
}

/** Drops a leading `<h1>` (the page renders its own title) and surrounding whitespace. */
export function withoutLeadingHeading(nodes: HtmlNode[]): HtmlNode[] {
  const first = nodes.findIndex((n) => !isBlank(n));
  const node = first >= 0 ? nodes[first] : undefined;
  if (node?.kind === "element" && node.tag === "h1") {
    return nodes.filter((_, i) => i !== first);
  }
  return nodes;
}

function linkProps(attrs: Attrs): Record<string, string> {
  const props: Record<string, string> = {};
  const href = attrs.href?.trim();
  if (href && SAFE_HREF.test(href)) {
    props.href = href;
  }
  if (attrs.target === "_blank") {
    props.target = "_blank";
    props.rel = "noopener noreferrer";
  }
  return props;
}

function cellProps(attrs: Attrs): Record<string, number> {
  const props: Record<string, number> = {};
  const colSpan = Number.parseInt(attrs.colspan ?? "", 10);
  const rowSpan = Number.parseInt(attrs.rowspan ?? "", 10);
  if (colSpan > 1) {
    props.colSpan = colSpan;
  }
  if (rowSpan > 1) {
    props.rowSpan = rowSpan;
  }
  return props;
}

function renderNode(node: HtmlNode, key: number): ReactNode {
  if (node.kind === "text") {
    return node.text;
  }
  if (DROPPED_TAGS.has(node.tag)) {
    return null;
  }
  const children = renderNodes(node.children);
  if (!ALLOWED_TAGS.has(node.tag)) {
    return createElement(Fragment, { key }, ...children);
  }
  if (VOID_TAGS.has(node.tag)) {
    return createElement(node.tag, { key });
  }
  let props: Record<string, unknown> = { key };
  if (node.tag === "a") {
    props = { ...props, ...linkProps(node.attrs) };
  } else if (node.tag === "td" || node.tag === "th") {
    props = { ...props, ...cellProps(node.attrs) };
  }
  return createElement(node.tag, props, ...children);
}

export function renderNodes(nodes: HtmlNode[]): ReactNode[] {
  return nodes.map((node, i) => renderNode(node, i));
}

/** Parses `html` and returns React children; `stripLeadingH1` removes a leading `<h1>`. */
export function htmlToReact(html: string, stripLeadingH1 = true): ReactNode[] {
  const nodes = parseHtml(html);
  return renderNodes(stripLeadingH1 ? withoutLeadingHeading(nodes) : nodes);
}
