import fs from "node:fs";
import path from "node:path";
import type { IndexItem } from "@/components/ui/PageIndexNav.astro";
import {
  parseMarkdownToResumeDataset,
  serializeResumeToJSON,
  serializeResumeToTOML,
  serializeResumeToXML,
} from "@/utils/resumeExporters";

export const resumeVisibilityConfig = {
  draft: false,
  visible: true,
};
export const cvVisibilityConfig = resumeVisibilityConfig;

export function resolveResumePath(locale: "en" | "es"): string | null {
  if (resumeVisibilityConfig.draft || !resumeVisibilityConfig.visible) {
    return null;
  }

  const resumeBase =
    locale === "es" ? "ArturoNava-Resume-es" : "ArturoNava-Resume-en";
  const cvBase = locale === "es" ? "ArturoNava-CV-es" : "ArturoNava-CV-en";
  const candidates = [
    path.resolve(`./src/content/resume/${resumeBase}.md`),
    path.resolve(`./src/content/resume/${cvBase}.md`),
    path.resolve(`./src/content/cv/${cvBase}.md`),
    path.resolve(`./${resumeBase}.md`),
    path.resolve(`./${cvBase}.md`),
    path.resolve(`./src/content/resume/${resumeBase}.html`),
    path.resolve(`./src/content/cv/${cvBase}.html`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const content = fs.readFileSync(candidate, "utf8");
        const fmMatch = content.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
        if (fmMatch && fmMatch[1]) {
          const fm = fmMatch[1];
          if (/draft:\s*true/i.test(fm) || /visible:\s*false/i.test(fm)) {
            return null;
          }
        }
      } catch (_) {}
      return candidate;
    }
  }
  return null;
}
export const resolveCVPath = resolveResumePath;

export const hasResume =
  resolveResumePath("en") !== null || resolveResumePath("es") !== null;

export interface ResumeData {
  html: string;
  items: IndexItem[];
  pages: [string, string, string];
  rawMarkdown: string;
  json: string;
  toml: string;
  xml: string;
}
export type CVData = ResumeData;

function splitResumePages(html: string): [string, string, string] {
  const parts = html.split('<hr class="cv-page-break" />');
  return [parts[0] || "", parts[1] || "", parts[2] || ""];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/--+/g, "-")
    .trim();
}

function inlineFormat(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/(?:^|[^\w])_([^_]+)_(?=[^\w]|$)/g, " <em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function cleanText(text: string): string {
  let s = text.replace(/<[^>]+>/g, "");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/(?:^|[^\w])_([^_]+)_(?=[^\w]|$)/g, " $1");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/&bull;/g, "•");
  s = s.replace(/&ndash;/g, "–");
  s = s.replace(/&mdash;/g, "—");
  s = s.replace(/&nbsp;/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function parseMarkdownResume(md: string): ResumeData {
  const contentWithoutFrontmatter = md.replace(
    /^---\s*[\r\n]+[\s\S]*?[\r\n]+---\s*/,
    "",
  );
  const lines = contentWithoutFrontmatter.split(/\r?\n/);
  const items: IndexItem[] = [];
  let currentParent: IndexItem | null = null;
  const htmlParts: string[] = [];
  let inList = false;
  // Open paragraph state: consecutive text lines merge like CommonMark (hard break on trailing 2 spaces)
  let openParaIdx = -1;
  let openParaRaw = "";
  let openParaHardBreak = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();

    if (openParaIdx !== -1 && (!trimmed || /^(#{1,4} |- |---$)/.test(trimmed))) {
      openParaIdx = -1;
    }

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
      htmlParts.push("<hr />");
      continue;
    }

    if (trimmed.startsWith("### ")) {
      if (inList) {
        htmlParts.push("</ul>");
        inList = false;
      }
      const rawTitle = trimmed.slice(4);
      const cleanTitle = cleanText(rawTitle);
      const id = slugify(cleanTitle);
      const subItem = {
        id,
        label: cleanTitle,
        labelEs: cleanTitle,
      };

      if (currentParent) {
        if (!currentParent.subitems) currentParent.subitems = [];
        currentParent.subitems.push(subItem);
      } else {
        items.push({
          id,
          label: cleanTitle,
          labelEs: cleanTitle,
        });
      }

      htmlParts.push(`<h3 id="${id}">${inlineFormat(rawTitle)}</h3>`);
      continue;
    }

    if (trimmed.startsWith("## ")) {
      if (inList) {
        htmlParts.push("</ul>");
        inList = false;
      }
      const rawTitle = trimmed.slice(3);
      const cleanTitle = cleanText(rawTitle);
      const id = slugify(cleanTitle);

      currentParent = {
        id,
        label: cleanTitle,
        labelEs: cleanTitle,
        subitems: [],
      };
      items.push(currentParent);

      htmlParts.push(`<h2 id="${id}">${inlineFormat(rawTitle)}</h2>`);
      continue;
    }

    if (trimmed.startsWith("# ")) {
      if (inList) {
        htmlParts.push("</ul>");
        inList = false;
      }
      const rawTitle = trimmed.slice(2);
      const cleanTitle = cleanText(rawTitle);
      const id = slugify(cleanTitle);
      htmlParts.push(`<h1 id="${id}">${inlineFormat(rawTitle)}</h1>`);
      continue;
    }

    if (trimmed.startsWith("#### ")) {
      if (inList) {
        htmlParts.push("</ul>");
        inList = false;
      }
      const rawTitle = trimmed.slice(5);
      const cleanTitle = cleanText(rawTitle);
      const id = slugify(cleanTitle);
      htmlParts.push(`<h4 id="${id}">${inlineFormat(rawTitle)}</h4>`);
      continue;
    }

    if (trimmed.startsWith("- ")) {
      if (!inList) {
        htmlParts.push("<ul>");
        inList = true;
      }
      const content = trimmed.slice(2);
      htmlParts.push(`<li>${inlineFormat(content)}</li>`);
      continue;
    }

    if (inList) {
      htmlParts.push("</ul>");
      inList = false;
    }

    if (openParaIdx !== -1) {
      openParaRaw += (openParaHardBreak ? "\n<br />\n" : " ") + trimmed;
      htmlParts[openParaIdx] = `<p>${inlineFormat(openParaRaw)}</p>`;
    } else {
      openParaRaw = trimmed;
      htmlParts.push(`<p>${inlineFormat(trimmed)}</p>`);
      openParaIdx = htmlParts.length - 1;
    }
    openParaHardBreak = / {2,}$/.test(rawLine);
  }

  if (inList) {
    htmlParts.push("</ul>");
  }

  const fullHtml = htmlParts.join("\n");
  const dataset = parseMarkdownToResumeDataset(md);

  return {
    html: fullHtml,
    items,
    pages: splitResumePages(fullHtml),
    rawMarkdown: md,
    json: serializeResumeToJSON(dataset),
    toml: serializeResumeToTOML(dataset),
    xml: serializeResumeToXML(dataset),
  };
}
export const parseMarkdownCV = parseMarkdownResume;

export function parseHtmlResume(rawHtml: string): ResumeData {
  let body = rawHtml;
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1]) {
    body = bodyMatch[1];
  }

  const items: IndexItem[] = [];
  let currentParent: IndexItem | null = null;

  body = body.replace(
    /<(h[1-4])([^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag, attrs, inner) => {
      const tagName = tag.toLowerCase();
      const rawText = cleanText(inner);
      const shortLabel = rawText.split("—")[0]?.trim() || rawText;

      const idMatch = attrs.match(/id=["']([^"']+)["']/i);
      const id = idMatch ? idMatch[1] : slugify(shortLabel);

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
          items.push({ id, label: shortLabel, labelEs: shortLabel });
        }
      }

      if (idMatch) return match;
      return `<${tag} id="${id}"${attrs}>${inner}</${tag}>`;
    },
  );

  const dataset = parseMarkdownToResumeDataset(cleanText(body));

  return {
    html: body,
    items,
    pages: splitResumePages(body),
    rawMarkdown: cleanText(body),
    json: serializeResumeToJSON(dataset),
    toml: serializeResumeToTOML(dataset),
    xml: serializeResumeToXML(dataset),
  };
}
export const parseHtmlCV = parseHtmlResume;

export function getResumeData(locale: "en" | "es"): ResumeData {
  const filePath = resolveResumePath(locale);

  if (!filePath) {
    return {
      html: "<p>Resume not found.</p>",
      items: [],
      pages: ["<p>Resume not found.</p>", "", ""],
      rawMarkdown: "",
      json: "{}",
      toml: "",
      xml: "",
    };
  }

  const fileContent = fs.readFileSync(filePath, "utf-8");

  if (filePath.endsWith(".md")) {
    return parseMarkdownResume(fileContent);
  }

  return parseHtmlResume(fileContent);
}
export const getCVData = getResumeData;
