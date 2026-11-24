/**
 * Per-template styles for the document track, run inside the app.
 *
 * Document templates are plain HTML with their own CSS, and their markup is
 * only known at run time, so the styles a template needs are built when the
 * template is prepared (preview or print) and injected as a `<style>` —
 * never stored, never sent to the pipeline already styled.
 * `withTemplateStyles` returns the HTML unchanged when no class attribute
 * yields a single utility rule and the template carries no embedded font, so
 * a plain-CSS template is byte for byte what it was before this file
 * existed.
 *
 * Embedded fonts (the previous app's "upload a font"): each entry the user
 * attached to the template becomes an `@font-face` data URI, so the rendered
 * document carries its own font and nothing is installed on the machine.
 *
 * The compiler is Tailwind v4's `compile()`, which works on an in-memory
 * candidate list: no Node, no filesystem. It is installed under the alias
 * `tailwind4` so the app shell can stay on Tailwind v3, the way the previous
 * app did.
 *
 * One deliberate departure from the previous app's build: its output is
 * flattened, so its unlayered utilities beat the template's own CSS. Here
 * the cascade layers are kept, so the template's own unlayered `<style>`
 * always beats a Tailwind rule — a hand-written `h1 { margin: 0 }` still
 * wins over `mt-4`. The fonts, the `dark:` ancestor variant and the default
 * border colour match the previous app's build, so its templates keep
 * rendering the way they did.
 */
import { compile } from "tailwind4";
import preflight from "tailwind4/preflight.css?raw";
import theme from "tailwind4/theme.css?raw";
import utilities from "tailwind4/utilities.css?raw";
import type { TemplateFont } from "@/scene/schema";

/** Bump when INPUT or the post-processing changes. */
const COMPILER_REV = "tw4.3-layered-r1";

const FILES: Record<string, string> = {
  "tailwindcss/theme.css": theme,
  "tailwindcss/preflight.css": preflight,
  "tailwindcss/utilities.css": utilities,
};

const INPUT = `
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/preflight.css" layer(base);
@import "tailwindcss/utilities.css" layer(utilities);

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --font-sans: "Segoe UI", Roboto, "Noto Sans", -apple-system,
    BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
  --font-mono: Consolas, "DejaVu Sans Mono", Menlo, monospace;
}

@layer base {
  *, ::after, ::before, ::backdrop, ::file-selector-button {
    border-color: var(--color-gray-200, currentcolor);
  }
}
`;

/** 32-bit FNV-1a: small, synchronous, and plenty for a change-detection key. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function classSetKey(candidates: string[]): string {
  return `${COMPILER_REV}:${fnv1a(candidates.join("\n"))}`;
}

/**
 * The candidate classes a template's markup asks for: every token of every
 * `class` attribute, deduplicated. A token carrying a `{{field}}` binding is
 * not a class, and arbitrary values (`w-[37mm]`) stay — v4 understands them.
 */
export function extractCandidates(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/class\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    for (const tok of (m[1] ?? m[2] ?? "").split(/\s+/)) {
      if (tok !== "" && !tok.includes("{{")) found.add(tok);
    }
  }
  return [...found];
}

/** Drop comments (the v4 banner links to tailwindcss.com, and printed
 * documents must not reference the network) and blank lines. */
function tidy(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

async function build(candidates: string[]): Promise<string> {
  // A fresh compiler per call: `build()` is incremental and would otherwise
  // leak classes from one template into the next.
  const compiler = await compile(INPUT, {
    base: "/",
    loadStylesheet: async (id: string) => {
      const content = FILES[id];
      if (content === undefined) {
        throw new Error(`Unexpected stylesheet import: ${id}`);
      }
      return { path: id, base: "/", content };
    },
  });
  return tidy(compiler.build(candidates));
}

/**
 * Whether the build emitted at least one utility rule, or only the theme
 * variables and preflight. That decides whether anything was matched, and
 * with it whether the HTML gets the injected stylesheet at all.
 */
function hasUtilities(css: string): boolean {
  // The build may carry a bare `@layer utilities;` statement (an empty
  // layer), so only a `@layer utilities {` block counts, and only if it
  // holds a rule of its own.
  const m = /@layer utilities[^{;]*\{/.exec(css);
  if (!m) return false;
  let depth = 1; // the layer's own opening brace
  for (let i = m.index + m[0].length; i < css.length; i++) {
    if (css[i] === "{") {
      depth++;
      if (depth === 2) return true; // a rule inside the utilities layer
    } else if (css[i] === "}") {
      depth--;
      if (depth === 0) return false; // the layer closed, rule-free
    }
  }
  return false;
}

const MEMO_LIMIT = 24;
// Settled results stay cached; in-flight compiles are shared but never
// evicted out from under their waiters.
const memo = new Map<string, { promise: Promise<string>; settled: boolean }>();

const STYLE_ID = "printninja-tw";

const FONT_MIME: Record<TemplateFont["format"], string> = {
  truetype: "font/ttf",
  opentype: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

/**
 * The `@font-face` rules for a template's embedded fonts, each as a data
 * URI, so the document is self-contained and CSP-clean. A font with an
 * unknown format is skipped with a warning — the template's own font stack
 * still applies to the rest.
 */
function fontFaceCss(fonts: TemplateFont[]): string {
  const rules: string[] = [];
  for (const f of fonts) {
    const mime = FONT_MIME[f.format as TemplateFont["format"]];
    if (!mime) {
      console.warn(`Font "${f.family}": unknown format "${f.format}"`);
      continue;
    }
    const family = `"${f.family.replace(/"/g, '\\"')}"`;
    rules.push(
      `@font-face { font-family: ${family}; src: url(data:${mime};base64,${f.data}) format("${f.format}"); }`,
    );
  }
  return rules.join("\n");
}

function inject(html: string, css: string): string {
  if (html.includes(STYLE_ID)) return html; // already styled
  const tag = `<style id="${STYLE_ID}">${css}</style>`;
  const close = html.toLowerCase().indexOf("</head>");
  if (close !== -1) return html.slice(0, close) + tag + html.slice(close);
  const open = /<head[^>]*>/i.exec(html);
  if (open) {
    return (
      html.slice(0, open.index + open[0].length) +
      tag +
      html.slice(open.index + open[0].length)
    );
  }
  return tag + html;
}

/**
 * `html` with the styles it asks for — its embedded fonts as `@font-face`
 * data URIs and the Tailwind utilities its classes use, compiled in memory —
 * injected before `</head>`. Never throws: on a compile failure the fonts
 * are still injected and the template's own CSS still applies.
 */
export async function withTemplateStyles(
  html: string,
  fonts?: TemplateFont[],
): Promise<string> {
  const fontCss = fonts && fonts.length > 0 ? fontFaceCss(fonts) : "";
  const candidates = extractCandidates(html);
  if (candidates.length === 0) {
    return fontCss ? inject(html, fontCss) : html;
  }
  const key = classSetKey(candidates);

  let entry = memo.get(key);
  if (!entry) {
    const fresh: { promise: Promise<string>; settled: boolean } = {
      promise: build(candidates),
      settled: false,
    };
    entry = fresh;
    memo.delete(key);
    memo.set(key, entry);
    fresh.promise.then(
      () => {
        fresh.settled = true;
      },
      () => {
        // Failures are not cached: a later call may succeed.
        if (memo.get(key) === fresh) memo.delete(key);
      },
    );
    if (memo.size > MEMO_LIMIT) {
      for (const [k, v] of memo) {
        if (v.settled) {
          memo.delete(k);
          break;
        }
      }
    }
  } else {
    // Refresh recency on hits too.
    memo.delete(key);
    memo.set(key, entry);
  }

  let css: string;
  try {
    css = await entry.promise;
  } catch (e) {
    console.warn(
      "Tailwind compile failed; the template's own CSS still applies:",
      e,
    );
    return fontCss ? inject(html, fontCss) : html;
  }
  if (!hasUtilities(css)) return fontCss ? inject(html, fontCss) : html;
  return inject(html, fontCss ? `${fontCss}\n${css}` : css);
}
