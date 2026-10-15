/** Sanitiser for the eRecht24 HTML (ported from DapItUp together with the implementation, P-025). */
import { describe, expect, test } from "bun:test";
import { isAllowedHref, sanitizeLegalHtml } from "../src/lib/erecht24/index.ts";

/** Every tag in the output must be an allowlisted one; only `a` may carry an href. */
const TAG = /<\/?([a-z0-9]+)([^>]*)>/gi;
const ALLOWED =
  /^(p|h2|h3|h4|ul|ol|li|strong|em|b|i|br|hr|table|thead|tbody|tr|th|td|a)$/;
const SAFE_HREF = /^ href="(https?:\/\/|mailto:|tel:)[^"<>]*"$/;

function expectOnlyAllowlisted(html: string) {
  for (const match of html.matchAll(TAG)) {
    const [, name = "", attrs = ""] = match;
    expect(name).toMatch(ALLOWED);
    if (attrs) {
      expect(name).toBe("a");
      expect(attrs).toMatch(SAFE_HREF);
    }
  }
  // Any "<" left over is part of a well-formed allowlisted tag
  expect(html.replace(TAG, "")).not.toContain("<");
}

describe("sanitizeLegalHtml", () => {
  test("keeps the eRecht24 structure and drops the leading h1", () => {
    const html = sanitizeLegalHtml(
      '  <h1 class="x">Impressum</h1>\n<h2 id="m">Angaben gemäß § 5 TMG</h2><p>Muster &amp; Co.<br>Straße 1</p><ul><li><strong>a</strong></li></ul><table><thead><tr><th>k</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>'
    );
    expect(html).toBe(
      "<h2>Angaben gemäß § 5 TMG</h2><p>Muster &amp; Co.<br>Straße 1</p><ul><li><strong>a</strong></li></ul><table><thead><tr><th>k</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>"
    );
  });

  test("a later h1 loses its tag but keeps its text", () => {
    expect(sanitizeLegalHtml("<p>a</p><h1>b</h1>")).toBe("<p>a</p>b");
  });

  test("a trailing incomplete tag does not survive (would swallow the page markup)", () => {
    expect(sanitizeLegalHtml('<p>x</p><img src="x"onerror=alert(1)//')).toBe(
      "<p>x</p>"
    );
    expect(sanitizeLegalHtml('<p>x</p><a href="x')).toBe("<p>x</p>");
    expect(sanitizeLegalHtml("text <")).toBe("text &lt;");
  });

  test("unclosed allowlisted elements are closed, stray end tags dropped", () => {
    expect(sanitizeLegalHtml("<p><strong>a</div>b")).toBe(
      "<p><strong>ab</strong></p>"
    );
  });

  test("implied end tags do not nest paragraphs, list items or cells", () => {
    expect(sanitizeLegalHtml("<p>a<p>b<ul><li>c<li>d</ul>")).toBe(
      "<p>a</p><p>b</p><ul><li>c</li><li>d</li></ul>"
    );
    expect(sanitizeLegalHtml("<table><tr><td>1<td>2<tr><th>3</table>")).toBe(
      "<table><tr><td>1</td><td>2</td></tr><tr><th>3</th></tr></table>"
    );
  });

  test("other elements lose their tags and all attributes", () => {
    expect(
      sanitizeLegalHtml(
        '<div class="c" onclick="x()"><span style="color:red">a</span><img src="a.png" onerror="x"><p id="p" onmouseover=\'x\'>b</p></div>'
      )
    ).toBe("a<p>b</p>");
  });

  test("raw-text and embedding elements are dropped with their content", () => {
    const html = sanitizeLegalHtml(
      "<p>a</p><script>alert(1)</script><style>p{}</style><iframe src=x>i</iframe><object data=x>o</object><embed src=x><noscript>n</noscript><template><p>t</p></template><title><p onclick=x>t</title><xmp><b>x</b></xmp><noembed>e</noembed><noframes>f</noframes><textarea><p>t</p></textarea><p>b</p>"
    );
    expect(html).toBe("<p>a</p><p>b</p>");
  });

  test("plaintext swallows the rest of the document", () => {
    expect(sanitizeLegalHtml("<p>a</p><plaintext><p>b</p><a href=x>")).toBe(
      "<p>a</p>"
    );
  });

  test("tag names are matched case-insensitively", () => {
    expect(
      sanitizeLegalHtml(
        "<SCRIPT>alert(1)</SCRIPT><ScRiPt src=//evil></sCrIpT><IFRAME SRC=x></IFRAME><P>ok</P>"
      )
    ).toBe("<p>ok</p>");
  });

  test("svg with onload is removed entirely", () => {
    const html = sanitizeLegalHtml(
      '<svg onload=alert(1)><a xlink:href="javascript:alert(1)">x</a></svg><svg/onload=alert(2)><p>ok</p>'
    );
    expectOnlyAllowlisted(html);
    expect(html).not.toContain("alert");
  });

  test("a quoted '>' does not hide a later attribute", () => {
    expect(sanitizeLegalHtml('<a title=">" onclick="alert(1)">x</a>')).toBe(
      "<a>x</a>"
    );
  });

  test("hrefs: only http(s), mailto and tel; the first duplicate counts", () => {
    const html = sanitizeLegalHtml(
      [
        '<a href="javascript:alert(1)">1</a>',
        '<a href="JaVaScRiPt:alert(1)">2</a>',
        '<a href="  javascript:alert(1)">3</a>',
        '<a href="java\tscript:alert(1)">4</a>',
        '<a href="&#106;avascript:alert(1)">5</a>',
        '<a href="&#x6A;&#x61;&#x76;&#x61;script&colon;alert(1)">6</a>',
        '<a href="&#0000106avascript:alert(1)">7</a>',
        '<a href="java&Tab;script:alert(1)">8</a>',
        '<a href="vbscript:msgbox(1)">9</a>',
        '<a href="data:text/html;base64,PHNjcmlwdD4=">10</a>',
        '<a href="/relative">11</a>',
        '<a href="javascript:alert(1)" href="https://ok.de">12</a>',
      ].join("")
    );
    expectOnlyAllowlisted(html);
    for (let n = 1; n <= 12; n += 1) {
      expect(html).toContain(`<a>${n}</a>`);
    }
  });

  test("duplicate href: a harmless first one is kept, the second never emitted", () => {
    expect(
      sanitizeLegalHtml(
        '<a href="https://ok.de" href="javascript:alert(1)" onclick="x">x</a>'
      )
    ).toBe('<a href="https://ok.de">x</a>');
  });

  test("keeps allowed links with their entities, escapes quotes", () => {
    const html = sanitizeLegalHtml(
      '<a href="https://www.e-recht24.de/?a=1&amp;b=2" target="_blank">e</a><a href=\'mailto:hello@example.com?subject="x"\'>m</a><a href="tel:+49301234">t</a>'
    );
    expect(html).toBe(
      '<a href="https://www.e-recht24.de/?a=1&amp;b=2">e</a><a href="mailto:hello@example.com?subject=&quot;x&quot;">m</a><a href="tel:+49301234">t</a>'
    );
  });

  test("removes comments, including conditional comments", () => {
    expect(
      sanitizeLegalHtml(
        "<p>a</p><!--[if IE]><script>x</script><![endif]--><!-- open"
      )
    ).toBe("<p>a</p>");
  });

  test("text entities are kept, raw angle brackets escaped", () => {
    expect(sanitizeLegalHtml("<p>a &lt;b&gt; &copy; 1 > 0</p>")).toBe(
      "<p>a &lt;b&gt; &copy; 1 &gt; 0</p>"
    );
  });

  test("broken markup stays harmless", () => {
    const html = sanitizeLegalHtml(
      '<scr<script>ipt>alert(1)</script><p>ok</p><a href="javas<!-- -->cript:alert(1)">x</a><<img src=x onerror=alert(1)>>'
    );
    expectOnlyAllowlisted(html);
    expect(html).toContain("<p>ok</p>");
    expect(html).toContain("<a>x</a>");
  });
});

describe("isAllowedHref", () => {
  test("allowlist on the decoded value", () => {
    expect(isAllowedHref("https://example.com")).toBe(true);
    expect(isAllowedHref("HTTP://example.com")).toBe(true);
    expect(isAllowedHref("mailto:a@b.de")).toBe(true);
    expect(isAllowedHref("tel:+49")).toBe(true);
    expect(isAllowedHref("h&#116;tps://example.com")).toBe(true);
    expect(isAllowedHref("javascript:x")).toBe(false);
    expect(isAllowedHref("\u0001java\nscript:x")).toBe(false);
    expect(isAllowedHref("&#x4A;avascript:x")).toBe(false);
    expect(isAllowedHref("https&unknown;//x")).toBe(false);
    expect(isAllowedHref("//example.com")).toBe(false);
    expect(isAllowedHref("#anchor")).toBe(false);
  });
});
