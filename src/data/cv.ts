import fs from "node:fs";
import path from "node:path";
import type { IndexItem } from "@/components/ui/PageIndexNav.astro";

function resolveCVPath(locale: "en" | "es"): string | null {
  const baseName = locale === "es" ? "ArturoNava-CV-es" : "ArturoNava-CV-en";
  const candidates = [
    path.resolve(`./src/content/cv/${baseName}.md`),
    path.resolve(`./${baseName}.md`),
    path.resolve(`./src/content/cv/${baseName}.html`),
    path.resolve(`./${baseName}.html`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export const hasResume =
  resolveCVPath("en") !== null || resolveCVPath("es") !== null;

export interface CVData {
  html: string;
  items: IndexItem[];
  pages: [string, string, string];
}

function splitCVPages(html: string): [string, string, string] {
  const p1Match = html.search(/(?:<hr>\s*)?<h3 id=["']mercado-libre-/i);
  if (p1Match === -1) return [html, "", ""];
  const page1 = html.slice(0, p1Match).trim();
  const rest1 = html.slice(p1Match).replace(/^(?:<hr>\s*)+/i, "");

  const p2Match = rest1.search(/(?:<hr>\s*)?<h3 id=["']cobuild-lab-/i);
  if (p2Match === -1) return [page1, rest1.trim(), ""];
  const page2 = rest1.slice(0, p2Match).trim();
  const page3 = rest1
    .slice(p2Match)
    .replace(/^(?:<hr>\s*)+/i, "")
    .trim();

  return [page1, page2, page3];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function cleanText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&bull;/g, "•")
    .trim();
}

function inlineFormat(text: string): string {
  let s = text;
  // inline code: `code`
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  // links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // bold: **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italic: _text_ or *text* (word-boundary safe)
  s = s.replace(/(?:^|[^\w])_([^_]+)_(?=[^\w]|$)/g, (m, p1) =>
    m.replace("_" + p1 + "_", "<em>" + p1 + "</em>"),
  );
  s = s.replace(/(?:^|[^\w])\*([^*]+)\*(?=[^\w]|$)/g, (m, p1) =>
    m.replace("*" + p1 + "*", "<em>" + p1 + "</em>"),
  );
  return s;
}

function parseMarkdownCV(md: string): CVData {
  const lines = md.split(/\r?\n/);
  const items: IndexItem[] = [];
  let currentParent: IndexItem | null = null;
  const htmlParts: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();

    if (!trimmed) {
      if (inList) {
        htmlParts.push("</ul>");
        inList = false;
      }
      continue;
    }

    if (trimmed === "---") {
      if (inList) {
        htmlParts.push("</ul>");
        inList = false;
      }
      htmlParts.push("<hr>");
      continue;
    }

    // List item
    if (trimmed.startsWith("- ")) {
      if (!inList) {
        htmlParts.push("<ul>");
        inList = true;
      }
      const itemContent = inlineFormat(trimmed.slice(2));
      htmlParts.push("<li>" + itemContent + "</li>");
      continue;
    } else if (inList) {
      htmlParts.push("</ul>");
      inList = false;
    }

    // H1
    if (trimmed.startsWith("# ")) {
      const title = inlineFormat(trimmed.slice(2));
      htmlParts.push("<h1>" + title + "</h1>");
      continue;
    }

    // H2
    if (trimmed.startsWith("## ")) {
      const heading = trimmed.slice(3).trim();
      const rawText = cleanText(
        heading.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/_([^_]+)_/g, "$1"),
      );
      const id = slugify(rawText);
      currentParent = {
        id,
        label: rawText,
        labelEs: rawText,
        subitems: [],
      };
      items.push(currentParent);
      htmlParts.push('<h2 id="' + id + '">' + inlineFormat(heading) + "</h2>");
      continue;
    }

    // H3
    if (trimmed.startsWith("### ")) {
      const heading = trimmed.slice(4).trim();
      const rawText = cleanText(
        heading.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/_([^_]+)_/g, "$1"),
      );

      const parts = rawText.split("—");
      const firstPart = parts[0] ?? rawText;
      const subParts = firstPart.split("-");
      let shortLabel = (subParts[0] ?? rawText).trim();
      if (!shortLabel) shortLabel = rawText;

      const id = slugify(rawText);
      const subItem = {
        id,
        label: shortLabel,
        labelEs: shortLabel,
      };

      if (currentParent) {
        if (!currentParent.subitems) currentParent.subitems = [];
        currentParent.subitems.push(subItem);
      } else {
        items.push({ id, label: shortLabel, labelEs: shortLabel });
      }

      htmlParts.push('<h3 id="' + id + '">' + inlineFormat(heading) + "</h3>");
      continue;
    }

    // Paragraph (collect consecutive non-empty lines until blank line or next block element)
    const pLines: string[] = [];
    let j = i;
    while (
      j < lines.length &&
      (lines[j] ?? "").trim() &&
      !(lines[j] ?? "").trim().startsWith("#") &&
      !(lines[j] ?? "").trim().startsWith("- ") &&
      (lines[j] ?? "").trim() !== "---"
    ) {
      pLines.push(lines[j] ?? "");
      j++;
    }
    i = j - 1;

    let pContent = "";
    for (let k = 0; k < pLines.length; k++) {
      const cur = pLines[k] ?? "";
      const clean = cur.replace(/(  |\\)$/, "");
      if (k > 0) {
        const prev = pLines[k - 1] ?? "";
        pContent += prev.endsWith("  ") || prev.endsWith("\\") ? "<br>" : " ";
      }
      pContent += inlineFormat(clean);
    }
    htmlParts.push("<p>" + pContent + "</p>");
  }

  if (inList) {
    htmlParts.push("</ul>");
  }

  const fullHtml = htmlParts.join("\n");
  return { html: fullHtml, items, pages: splitCVPages(fullHtml) };
}

function parseHtmlCV(rawHtml: string): CVData {
  // Extract body contents
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyMatch ? (bodyMatch[1] ?? rawHtml) : rawHtml;

  const items: IndexItem[] = [];
  let currentParent: IndexItem | null = null;

  // Process h2 and h3 headings to ensure IDs and compile navigation items
  body = (body || "").replace(
    /<(h[23])([^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag, attrs, inner) => {
      const rawText = cleanText(inner);
      const tagName = tag.toLowerCase();

      // Check if ID already exists
      const idMatch = attrs.match(/id=["']([^"']+)["']/i);
      const id = idMatch ? (idMatch[1] ?? slugify(rawText)) : slugify(rawText);

      // Short label for company heading (e.g. "Leal — Bogota, Colombia" -> "Leal")
      const parts = rawText.split("—");
      const firstPart = parts[0] ?? rawText;
      const subParts = firstPart.split("-");
      let shortLabel = (subParts[0] ?? rawText).trim();
      if (!shortLabel) shortLabel = rawText;

      if (tagName === "h2") {
        currentParent = {
          id,
          label: rawText,
          labelEs: rawText,
          subitems: [],
        };
        items.push(currentParent);
      } else if (tagName === "h3") {
        const subItem = {
          id,
          label: shortLabel,
          labelEs: shortLabel,
        };
        if (currentParent) {
          if (!currentParent.subitems) currentParent.subitems = [];
          currentParent.subitems.push(subItem);
        } else {
          items.push({
            id,
            label: shortLabel,
            labelEs: shortLabel,
          });
        }
      }

      if (idMatch) {
        return match;
      }
      return `<${tag} id="${id}"${attrs}>${inner}</${tag}>`;
    },
  );

  return { html: body, items, pages: splitCVPages(body) };
}

export function getCVData(locale: "en" | "es"): CVData {
  const filePath = resolveCVPath(locale);

  if (!filePath) {
    return {
      html: "<p>CV not found.</p>",
      items: [],
      pages: ["<p>CV not found.</p>", "", ""],
    };
  }

  const fileContent = fs.readFileSync(filePath, "utf-8");

  if (filePath.endsWith(".md")) {
    return parseMarkdownCV(fileContent);
  }

  return parseHtmlCV(fileContent);
}
