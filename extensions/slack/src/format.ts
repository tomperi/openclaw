// Slack helper module supports format behavior.
import type { MarkdownTableMode } from "openclaw/plugin-sdk/config-contracts";
import {
  markdownToIR,
  type MarkdownLinkSpan,
  renderMarkdownIRChunksWithinLimit,
} from "openclaw/plugin-sdk/text-chunking";
import { renderMarkdownWithMarkers } from "openclaw/plugin-sdk/text-chunking";

// Escape special characters for Slack mrkdwn format.
// Preserve Slack's angle-bracket tokens so mentions and links stay intact.
function escapeSlackMrkdwnSegment(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SLACK_ANGLE_TOKEN_RE = /<[^>\n]+>/g;

function isAllowedSlackAngleToken(token: string): boolean {
  if (!token.startsWith("<") || !token.endsWith(">")) {
    return false;
  }
  const inner = token.slice(1, -1);
  return (
    inner.startsWith("@") ||
    inner.startsWith("#") ||
    inner.startsWith("!") ||
    inner.startsWith("mailto:") ||
    inner.startsWith("tel:") ||
    inner.startsWith("http://") ||
    inner.startsWith("https://") ||
    inner.startsWith("slack://")
  );
}

function escapeSlackMrkdwnContent(text: string): string {
  if (!text) {
    return "";
  }
  if (!text.includes("&") && !text.includes("<") && !text.includes(">")) {
    return text;
  }

  SLACK_ANGLE_TOKEN_RE.lastIndex = 0;
  const out: string[] = [];
  let lastIndex = 0;

  for (
    let match = SLACK_ANGLE_TOKEN_RE.exec(text);
    match;
    match = SLACK_ANGLE_TOKEN_RE.exec(text)
  ) {
    const matchIndex = match.index ?? 0;
    out.push(escapeSlackMrkdwnSegment(text.slice(lastIndex, matchIndex)));
    const token = match[0] ?? "";
    out.push(isAllowedSlackAngleToken(token) ? token : escapeSlackMrkdwnSegment(token));
    lastIndex = matchIndex + token.length;
  }

  out.push(escapeSlackMrkdwnSegment(text.slice(lastIndex)));
  return out.join("");
}

function escapeSlackMrkdwnText(text: string): string {
  if (!text) {
    return "";
  }
  if (!text.includes("&") && !text.includes("<") && !text.includes(">")) {
    return text;
  }

  return text
    .split("\n")
    .map((line) => {
      if (line.startsWith("> ")) {
        return `> ${escapeSlackMrkdwnContent(line.slice(2))}`;
      }
      return escapeSlackMrkdwnContent(line);
    })
    .join("\n");
}

function buildSlackLink(link: MarkdownLinkSpan, text: string) {
  const href = link.href.trim();
  if (!href) {
    return null;
  }
  const label = text.slice(link.start, link.end);
  const trimmedLabel = label.trim();
  const comparableHref = href.startsWith("mailto:") ? href.slice("mailto:".length) : href;
  const useMarkup =
    trimmedLabel.length > 0 && trimmedLabel !== href && trimmedLabel !== comparableHref;
  if (!useMarkup) {
    return null;
  }
  const safeHref = escapeSlackMrkdwnSegment(href);
  return {
    start: link.start,
    end: link.end,
    open: `<${safeHref}|`,
    close: ">",
  };
}

type SlackMarkdownOptions = {
  tableMode?: MarkdownTableMode;
};

function buildSlackRenderOptions() {
  return {
    styleMarkers: {
      bold: { open: "*", close: "*" },
      italic: { open: "_", close: "_" },
      strikethrough: { open: "~", close: "~" },
      code: { open: "`", close: "`" },
      code_block: { open: "```\n", close: "```" },
    },
    escapeText: escapeSlackMrkdwnText,
    buildLink: buildSlackLink,
  };
}

/** Slack's Block Kit `markdown` block caps text at 12k — stay under with margin. */
const SLACK_MARKDOWN_BLOCK_TEXT_MAX = 11_500;
const MARKDOWN_LIST_LINE_RE = /^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+\S/m;
const MARKDOWN_TABLE_ROW_RE = /^[ \t]*\|.*\|[ \t]*$/m;

/**
 * Should this outbound markdown be sent as a Block Kit `markdown` block instead of mrkdwn text?
 * Slack mrkdwn has NO list rendering — indented bullet text reads flat — while the `markdown`
 * block renders true nested lists (Slack converts it to rich_text server-side) and accepts the
 * mrkdwn-specific tokens we emit (<@mentions>, <url|label>, :emoji:) unchanged (verified against
 * the live API 2026-07-28). Opt out for: no list content (legacy path is battle-tested), tables
 * (the markdown block doesn't render them; tableMode conversion does), and texts beyond the
 * block's 12k cap (must chunk through the text path).
 */
export function shouldUseSlackMarkdownBlock(markdown: string): boolean {
  if (!markdown || markdown.length > SLACK_MARKDOWN_BLOCK_TEXT_MAX) {
    return false;
  }
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  if (MARKDOWN_TABLE_ROW_RE.test(withoutCode)) {
    return false;
  }
  return MARKDOWN_LIST_LINE_RE.test(withoutCode);
}

export function markdownToSlackMrkdwn(
  markdown: string,
  options: SlackMarkdownOptions = {},
): string {
  const ir = markdownToIR(markdown ?? "", {
    linkify: false,
    autolink: false,
    headingStyle: "bold",
    blockquotePrefix: "> ",
    tableMode: options.tableMode,
  });
  return renderMarkdownWithMarkers(ir, buildSlackRenderOptions());
}

export function normalizeSlackOutboundText(markdown: string): string {
  return markdownToSlackMrkdwn(markdown ?? "");
}

export function markdownToSlackMrkdwnChunks(
  markdown: string,
  limit: number,
  options: SlackMarkdownOptions = {},
): string[] {
  const ir = markdownToIR(markdown ?? "", {
    linkify: false,
    autolink: false,
    headingStyle: "bold",
    blockquotePrefix: "> ",
    tableMode: options.tableMode,
  });
  const renderOptions = buildSlackRenderOptions();
  return renderMarkdownIRChunksWithinLimit({
    ir,
    limit,
    renderChunk: (chunk) => renderMarkdownWithMarkers(chunk, renderOptions),
    measureRendered: (rendered) => rendered.length,
  }).map(({ rendered }) => rendered);
}
