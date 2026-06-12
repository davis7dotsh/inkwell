// Plain Block[] → Markdown, the inverse of markdownToBlocks. Unlike
// buildExportMarkdown (which interleaves annotations and needs reader-measured
// layouts), this is a pure content serialization — used by the agent API to
// hand article text to LLMs.
import type { Block, Span } from "./types";

/** Longest run of consecutive backticks in the text (0 when none). */
const longestBacktickRun = (text: string): number =>
  (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);

function spanToMarkdown(span: Span): string {
  let text = span.text;
  if (!text) return "";
  if (span.code) {
    // CommonMark code spans: the delimiter must outrun any interior backtick
    // run, and content that starts/ends with a backtick needs space padding
    // (one leading+trailing space is stripped when both are present).
    const fence = "`".repeat(longestBacktickRun(text) + 1);
    const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
    text = `${fence}${pad}${text}${pad}${fence}`;
  }
  if (span.bold) text = `**${text}**`;
  if (span.italic) text = `*${text}*`;
  if (span.href) text = `[${text}](${span.href})`;
  return text;
}

const spansToMarkdown = (spans: Span[]): string =>
  spans.map(spanToMarkdown).join("");

function blockToMarkdown(block: Block): string {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.level)} ${spansToMarkdown(block.spans)}`;
    case "paragraph":
      return spansToMarkdown(block.spans);
    case "quote":
      return spansToMarkdown(block.spans)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "list":
      return block.items
        .map(
          (item, i) =>
            `${block.ordered ? `${i + 1}.` : "-"} ${spansToMarkdown(item)}`
        )
        .join("\n");
    case "code": {
      // The fence must outrun any backtick run inside the code, or an
      // embedded ``` line would close it early (CommonMark).
      const fence = "`".repeat(Math.max(3, longestBacktickRun(block.text) + 1));
      return `${fence}\n${block.text}\n${fence}`;
    }
    case "image": {
      const image = `![${block.alt ?? ""}](${block.src})`;
      return block.caption ? `${image}\n*${block.caption}*` : image;
    }
    case "rule":
      return "---";
  }
}

/** Serializes parsed article blocks back to Markdown (blank line between blocks). */
export function blocksToMarkdown(blocks: Block[]): string {
  return blocks
    .map(blockToMarkdown)
    .filter((text) => text.length > 0)
    .join("\n\n");
}
