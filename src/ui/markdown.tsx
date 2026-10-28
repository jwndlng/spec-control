// Markdown from tracked repositories, rendered as Preact VNodes (design.md D4).
//
// Artifact text is untrusted. There is deliberately no path from it to markup: `marked` is used as a tokeniser only
// (`lexer`, never `parse`), every token type below maps to a fixed element, and anything else — raw HTML included —
// becomes a text node. Do not add `dangerouslySetInnerHTML` or an `<img>` here.
import { lexer, type Token, type Tokens } from "marked";
import type { ComponentChildren, VNode } from "preact";

const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** Browsers ignore control characters and whitespace inside a scheme ("java\tscript:"), so targets are judged cleaned up. */
function cleanTarget(target: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is being removed
  return target.replace(/[\u0000- \u007f-\u009f]/g, "");
}

function schemeOf(cleaned: string): string | undefined {
  return /^([a-z][a-z0-9+.-]*):/i.exec(cleaned)?.[1];
}

/** The target when it may become an external `href`: absolute http, https or mailto. Undefined for everything else. */
export function safeHref(target: string): string | undefined {
  const cleaned = cleanTarget(target);
  const scheme = schemeOf(cleaned);
  if (scheme === undefined) return undefined;
  return ALLOWED_SCHEMES.has(`${scheme.toLowerCase()}:`) ? cleaned : undefined;
}

/** The target when it is relative (no scheme), cleaned up; only a `LinkResolver` may turn it into a link. */
export function relativeTarget(target: string): string | undefined {
  const cleaned = cleanTarget(target);
  return cleaned && schemeOf(cleaned) === undefined ? cleaned : undefined;
}

/**
 * Turns a relative link target into a URL of the dashboard's own, or refuses it (undefined). Without one, relative
 * targets are text: they would resolve against the dashboard's route, never the file they were written in.
 */
export interface LinkResolver {
  resolve(target: string): string | undefined;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** Text tokens keep the source's character references; they end up in a text node, so decoding is safe. */
function decode(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (entity) => ENTITIES[entity]);
}

// One document renders at a time, synchronously, so the resolver of the current `renderMarkdown` call is module state
// rather than a parameter threaded through every function below.
let links: LinkResolver | undefined;

function inline(tokens: Token[] | undefined): ComponentChildren {
  return (tokens ?? []).map((token) => inlineToken(token));
}

function inlineToken(token: Token): ComponentChildren {
  switch (token.type) {
    case "text":
    case "escape": {
      const t = token as Tokens.Text;
      return t.tokens?.length ? inline(t.tokens) : decode(t.text);
    }
    case "strong":
      return <strong>{inline((token as Tokens.Strong).tokens)}</strong>;
    case "em":
      return <em>{inline((token as Tokens.Em).tokens)}</em>;
    case "del":
      return <del>{inline((token as Tokens.Del).tokens)}</del>;
    case "codespan":
      return <code>{(token as Tokens.Codespan).text}</code>;
    case "br":
      return <br />;
    case "link": {
      const link = token as Tokens.Link;
      const target = safeHref(link.href);
      if (target === undefined) {
        const relative = relativeTarget(link.href);
        const inView = relative === undefined ? undefined : links?.resolve(relative);
        if (inView === undefined) return inline(link.tokens);
        // A file of the same view: followed in place, so no new tab or window.
        return (
          <a href={inView} title={link.title ?? undefined} class="md-file-link">
            {inline(link.tokens)}
          </a>
        );
      }
      return (
        <a href={target} title={link.title ?? undefined} target="_blank" rel="noopener noreferrer">
          {inline(link.tokens)}
        </a>
      );
    }
    case "image":
      // Never embedded and never fetched; the alternative text is all that is shown.
      return (token as Tokens.Image).text;
    case "checkbox":
      return <input type="checkbox" checked={(token as Tokens.Checkbox).checked} disabled />;
    default:
      // Raw HTML and anything unmapped: shown as written.
      return token.raw;
  }
}

/**
 * `- [~]`: this project's third task state — the agent finished it, a person still has to confirm it. GitHub-flavoured
 * Markdown knows only `[ ]` and `[x]`, so `marked` leaves the marker as text; it is recognised here instead.
 */
const AWAITING_MARKER = /^\[~\]\s+/;

/** The marker off the item's first text token, so the task reads as its own words. */
function withoutMarker(tokens: Token[]): Token[] {
  const [first, ...rest] = tokens;
  if (first?.type !== "text" && first?.type !== "paragraph") return tokens;
  const text = first as Tokens.Text;
  const inner = text.tokens?.length ? withoutMarker(text.tokens) : text.tokens;
  return [{ ...text, text: text.text.replace(AWAITING_MARKER, ""), tokens: inner } as Token, ...rest];
}

function listItem(item: Tokens.ListItem): VNode {
  if (!item.task && AWAITING_MARKER.test(item.text)) {
    return (
      <li class="task awaiting">
        {/* Neither ticked nor empty, announced as mixed — and as inoperable as the other two: the dashboard never writes tasks.md. */}
        <input type="checkbox" checked={false} indeterminate aria-checked="mixed" disabled />
        {blocks(withoutMarker(item.tokens))}
      </li>
    );
  }
  return <li class={item.task ? "task" : undefined}>{blocks(item.tokens)}</li>;
}

function blockToken(token: Token): ComponentChildren {
  switch (token.type) {
    case "space":
    case "def":
      return null;
    case "heading": {
      const heading = token as Tokens.Heading;
      const Tag = `h${Math.min(6, Math.max(1, heading.depth))}` as "h1";
      return <Tag>{inline(heading.tokens)}</Tag>;
    }
    case "paragraph":
      return <p>{inline((token as Tokens.Paragraph).tokens)}</p>;
    case "list": {
      const list = token as Tokens.List;
      const items = list.items.map(listItem);
      const tasks = list.items.some((item) => item.task) ? "tasks" : undefined;
      return list.ordered ? (
        <ol class={tasks} start={typeof list.start === "number" ? list.start : undefined}>
          {items}
        </ol>
      ) : (
        <ul class={tasks}>{items}</ul>
      );
    }
    case "table": {
      const table = token as Tokens.Table;
      const align = (i: number) => (table.align[i] ? { textAlign: table.align[i] as string } : undefined);
      return (
        <div class="md-table">
          <table>
            <thead>
              <tr>
                {table.header.map((cell, i) => (
                  <th style={align(i)}>{inline(cell.tokens)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr>
                  {row.map((cell, i) => (
                    <td style={align(i)}>{inline(cell.tokens)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "code": {
      const code = token as Tokens.Code;
      return (
        <pre data-lang={code.lang || undefined}>
          <code>{code.text}</code>
        </pre>
      );
    }
    case "blockquote":
      return <blockquote>{blocks((token as Tokens.Blockquote).tokens)}</blockquote>;
    case "hr":
      return <hr />;
    case "html":
      return <p class="md-literal">{token.raw.trimEnd()}</p>;
    default:
      // Inline tokens at block level (tight list items) and anything unmapped.
      return inlineToken(token);
  }
}

function blocks(tokens: Token[]): ComponentChildren {
  return tokens.map((token) => blockToken(token));
}

/**
 * The document as VNodes. Never throws on odd input: text the tokeniser cannot handle is shown as written. Relative
 * link targets become links only through `resolver`; without one they are text.
 */
export function renderMarkdown(text: string, resolver?: LinkResolver): VNode {
  let tokens: Token[];
  try {
    tokens = lexer(text, { gfm: true });
  } catch {
    return <div class="markdown"><pre>{text}</pre></div>;
  }
  links = resolver;
  try {
    return <div class="markdown">{blocks(tokens)}</div>;
  } finally {
    links = undefined;
  }
}
