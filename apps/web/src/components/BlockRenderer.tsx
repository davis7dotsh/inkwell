// Web port of the mobile BlockRenderer: article blocks as semantic HTML
// with the same ink-wash styling (see styles.css for the visual rules).
import type { Block, Span } from "@inkwell/content";
import React, { Fragment, memo, type ReactNode } from "react";

import { useTheme } from "../lib/theme";

import { BrushStroke } from "./BrushStroke";

function SpanText({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((span, i) => {
        let node: ReactNode = span.text;
        if (span.code) node = <code className="inline-code">{node}</code>;
        if (span.bold) node = <strong>{node}</strong>;
        if (span.italic) node = <em>{node}</em>;
        if (span.href) {
          node = (
            <a href={span.href} target="_blank" rel="noopener noreferrer">
              {node}
            </a>
          );
        }
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

const headingTags = ["h1", "h2", "h3", "h4"] as const;

function RuleDivider() {
  const { c } = useTheme();
  return (
    <div className="rule-divider" role="separator">
      <BrushStroke width={150} height={7} color={c.wash} opacity={0.6} />
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "heading": {
      // Mobile caps heading styles at the h4 size; mirror that here.
      const Tag = headingTags[Math.min(block.level, 4) - 1];
      return (
        <Tag className="article-heading">
          <SpanText spans={block.spans} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p>
          <SpanText spans={block.spans} />
        </p>
      );
    case "quote":
      return (
        <blockquote>
          <p>
            <SpanText spans={block.spans} />
          </p>
        </blockquote>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag>
          {block.items.map((item, i) => (
            <li key={i}>
              <SpanText spans={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case "image":
      return (
        <figure>
          {/* Extraction-time width renders the image at its natural size;
              max-width in CSS caps it at the column. */}
          <img
            src={block.src}
            alt={block.alt ?? ""}
            loading="lazy"
            style={block.width ? { width: block.width } : undefined}
          />
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      );
    case "code":
      return (
        <pre className="code-block">
          <code>{block.text}</code>
        </pre>
      );
    case "rule":
      return <RuleDivider />;
  }
}

export const BlockRenderer = memo(function BlockRenderer({
  blocks,
}: {
  blocks: Block[];
}) {
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </>
  );
});
