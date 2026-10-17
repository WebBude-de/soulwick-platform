import { notFound } from "next/navigation";

/**
 * Every unknown path ends here after `src/proxy.ts` added the language segment, so the 404
 * renders in the visitor's language with header and footer (`[locale]/not-found.tsx`).
 */
export default function UnknownPage() {
  notFound();
}
