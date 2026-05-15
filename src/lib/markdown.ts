/**
 * Tiny hand-rolled markdown renderer for project descriptions. Phase 1
 * doesn't pull in a markdown dep (CLAUDE.md § Constraints). Supports:
 *   - ATX headings (# / ## / ### / ####)
 *   - Paragraphs
 *   - Unordered lists (- / *)
 *   - Ordered lists (1. )
 *   - Links [text](url) — only http/https, defensive
 *   - Inline code spans `code`
 *   - Bold **text**
 *
 * Everything is HTML-escaped first; inline syntax is then expanded into
 * a safe subset. ~80 lines.
 */

interface Block {
  type: "p" | "h1" | "h2" | "h3" | "h4" | "ul" | "ol";
  lines: string[];
}

export function renderMarkdown(src: string): string {
  const blocks = parseBlocks(src);
  return blocks.map(renderBlock).join("\n");
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let current: Block | null = null;
  function flush() {
    if (current) {
      out.push(current);
      current = null;
    }
  }
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length as 1 | 2 | 3 | 4;
      out.push({ type: `h${level}` as Block["type"], lines: [h[2]] });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!current || current.type !== "ul") { flush(); current = { type: "ul", lines: [] }; }
      current.lines.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (!current || current.type !== "ol") { flush(); current = { type: "ol", lines: [] }; }
      current.lines.push(line.replace(/^\d+\.\s+/, ""));
      continue;
    }
    if (!current || current.type !== "p") { flush(); current = { type: "p", lines: [] }; }
    current.lines.push(line);
  }
  flush();
  return out;
}

function renderBlock(b: Block): string {
  if (b.type === "p") return `<p>${renderInline(b.lines.join(" "))}</p>`;
  if (b.type === "ul") return `<ul>${b.lines.map((l) => `<li>${renderInline(l)}</li>`).join("")}</ul>`;
  if (b.type === "ol") return `<ol>${b.lines.map((l) => `<li>${renderInline(l)}</li>`).join("")}</ol>`;
  // headings
  return `<${b.type}>${renderInline(b.lines.join(" "))}</${b.type}>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(s: string): string {
  let out = escapeHtml(s);
  // inline code first (so other replacements don't touch the contents)
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // links — match the already-escaped &quot;-less form. The escape above
  // turned <http://x> into nothing special; we operate on plain text.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    if (!/^https?:\/\//.test(url)) return label; // strip non-http(s)
    // url already escaped by escapeHtml — safe to embed.
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return out;
}
