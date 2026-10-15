/**
 * eRecht24 delivers `warnings` as an HTML fragment. The contract exposes them as plain text
 * lines, so the fragment is reduced here: block ends become line breaks, tags are dropped,
 * entities (the German texts use `&auml;`, `&szlig;`, `&sect;` ...) are decoded.
 */

const BLOCK_BREAK =
  /<\s*(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/ul|\/ol)\b[^>]*>/gi;
const TAG = /<[^>]*>/g;
const NUMERIC_ENTITY = /&#(x[0-9a-f]+|\d+);/gi;
const NAMED_ENTITY = /&([A-Za-z][A-Za-z0-9]*);/g;
const INLINE_WHITESPACE = /\s+/g;
const LINE_BREAKS = /\r?\n/;
const HEX_PREFIX_LENGTH = 1;
const HEX_RADIX = 16;
const MAX_CODE_POINT = 0x10_ff_ff;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  sect: "§",
  euro: "€",
  copy: "©",
  reg: "®",
  trade: "™",
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
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  middot: "·",
  bull: "•",
  deg: "°",
  para: "¶",
  times: "×",
};

function decodeNumericEntity(raw: string): string | null {
  const isHex = raw[0]?.toLowerCase() === "x";
  const codePoint = isHex
    ? Number.parseInt(raw.slice(HEX_PREFIX_LENGTH), HEX_RADIX)
    : Number.parseInt(raw, 10);
  if (
    !Number.isInteger(codePoint) ||
    codePoint <= 0 ||
    codePoint > MAX_CODE_POINT
  ) {
    return null;
  }
  return String.fromCodePoint(codePoint);
}

/** Decodes numeric and the common named HTML entities; unknown names are left untouched. */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(
      NUMERIC_ENTITY,
      (whole, raw: string) => decodeNumericEntity(raw) ?? whole
    )
    .replace(
      NAMED_ENTITY,
      (whole, name: string) => NAMED_ENTITIES[name] ?? whole
    );
}

/** HTML fragment -> trimmed, non-empty plain text lines. Empty/null input -> []. */
export function htmlToLines(html: string | null | undefined): string[] {
  if (!html) {
    return [];
  }
  const text = decodeHtmlEntities(
    html.replace(BLOCK_BREAK, "\n").replace(TAG, "")
  );
  return text
    .split(LINE_BREAKS)
    .map((line) => line.replace(INLINE_WHITESPACE, " ").trim())
    .filter((line) => line.length > 0);
}

/** eRecht24 sends "" for a language that has not been written yet; the response carries null. */
export function emptyToNull(value: string | null | undefined): string | null {
  return value && value.trim().length > 0 ? value : null;
}
