import Link from "next/link";
import { type Block, type Inline, parseMarkdown } from "@/lib/markdown";

function InlineContent({ parts }: { parts: Inline[] }) {
  return parts.map((part, i) => {
    const key = `${i}-${part.type}`;
    switch (part.type) {
      case "strong":
        return <strong key={key}>{part.text}</strong>;
      case "em":
        return <em key={key}>{part.text}</em>;
      case "link":
        return part.href.startsWith("/") ? (
          <Link href={part.href} key={key}>
            {part.text}
          </Link>
        ) : (
          <a href={part.href} key={key} rel="noopener" target="_blank">
            {part.text}
          </a>
        );
      default:
        return part.text;
    }
  });
}

function BlockContent({ block }: { block: Block }) {
  switch (block.type) {
    case "h2":
      return (
        <h2>
          <InlineContent parts={block.content} />
        </h2>
      );
    case "h3":
      return (
        <h3>
          <InlineContent parts={block.content} />
        </h3>
      );
    case "quote":
      return (
        <blockquote>
          <InlineContent parts={block.content} />
        </blockquote>
      );
    case "ul":
      return (
        <ul>
          {block.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list from a file, never reordered.
            <li key={i}>
              <InlineContent parts={item} />
            </li>
          ))}
        </ul>
      );
    default:
      return (
        <p>
          <InlineContent parts={block.content} />
        </p>
      );
  }
}

/** Renders a news post body (Markdown subset, see `lib/markdown.ts`) in the reading style. */
export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="news-prose">
      {blocks.map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks of a static file, never reordered.
        <BlockContent block={block} key={i} />
      ))}
    </div>
  );
}
