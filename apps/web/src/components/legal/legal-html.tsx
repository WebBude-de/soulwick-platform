import type { LegalLocale } from "@soulwick/contracts";
import { htmlToReact } from "./html-to-react";
import styles from "./legal-html.module.css";

/** Styled container for legal HTML from the API. The page renders its own `<h1>`. */
export function LegalHtml({
  html,
  lang,
}: {
  html: string;
  /** Language of the HTML; set when it differs from the page language. */
  lang?: LegalLocale;
}) {
  return (
    <div className={styles.prose} lang={lang}>
      {htmlToReact(html)}
    </div>
  );
}
