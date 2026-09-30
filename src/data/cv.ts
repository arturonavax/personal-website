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
  rawMarkdown: string;
  json: string;
  toml: string;
  xml: string;
}

interface CVStructuredItem {
  title: string;
  meta?: string;
  points?: string[];
  description?: string;
}

interface CVStructuredSection {
  title: string;
  items: CVStructuredItem[];
  text?: string[];
}

interface CVStructured {
  name: string;
  headline: string;
  contact: string[];
  sections: CVStructuredSection[];
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

function cleanText(text: string): string {
  return text
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/(?:^|[^\w])_([^_]+)_(?=[^\w]|$)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&bull;/g, "•")
    .trim();
}

function inlineFormat(text: string): string {
  let s = text;
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?:^|[^\w])_([^_]+)_(?=[^\w]|$)/g, (m, p1) =>
    m.replace("_" + p1 + "_", "<em>" + p1 + "</em>"),
  );
  s = s.replace(/(?:^|[^\w])\*([^*]+)\*(?=[^\w]|$)/g, (m, p1) =>
    m.replace("*" + p1 + "*", "<em>" + p1 + "</em>"),
  );
  return s;
}

function parseCVStructured(md: string): CVStructured {
  const lines = md.split(/\r?\n/);
  let name = "";
  let headline = "";
  const contact: string[] = [];
  const sections: CVStructuredSection[] = [];
  let currentSection: CVStructuredSection | null = null;
  let currentItem: CVStructuredItem | null = null;
  let pastHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "---") continue;

    if (trimmed.startsWith("# ")) {
      name = cleanText(trimmed.slice(2));
      continue;
    }

    if (!pastHeader && !trimmed.startsWith("## ")) {
      const parts = trimmed
        .split("|")
        .map((p) => cleanText(p))
        .filter(Boolean);
      if (parts.length > 0) {
        if (!headline) {
          headline = parts[0] ?? "";
          contact.push(...parts.slice(1));
        } else {
          contact.push(...parts);
        }
      }
      continue;
    }

    if (trimmed.startsWith("## ")) {
      pastHeader = true;
      currentSection = {
        title: cleanText(trimmed.slice(3)),
        items: [],
        text: [],
      };
      sections.push(currentSection);
      currentItem = null;
      continue;
    }

    if (trimmed.startsWith("### ") || trimmed.startsWith("#### ")) {
      const level = trimmed.startsWith("### ") ? 4 : 5;
      const title = cleanText(trimmed.slice(level));
      currentItem = {
        title,
        points: [],
      };
      if (currentSection) {
        currentSection.items.push(currentItem);
      }
      continue;
    }

    if (trimmed.startsWith("- ")) {
      const point = cleanText(trimmed.slice(2));
      if (currentItem) {
        if (!currentItem.points) currentItem.points = [];
        currentItem.points.push(point);
      } else if (currentSection) {
        if (!currentSection.text) currentSection.text = [];
        currentSection.text.push(point);
      }
      continue;
    }

    // Párrafos regulares o metadatos de rol (fechas, empresa, ubicación)
    const cleaned = cleanText(trimmed);
    if (currentItem) {
      if (
        !currentItem.meta &&
        (trimmed.includes("**") ||
          trimmed.includes("*") ||
          trimmed.includes("·") ||
          trimmed.includes("—"))
      ) {
        currentItem.meta = cleaned;
      } else {
        currentItem.description = currentItem.description
          ? `${currentItem.description} ${cleaned}`
          : cleaned;
      }
    } else if (currentSection) {
      if (!currentSection.text) currentSection.text = [];
      currentSection.text.push(cleaned);
    }
  }

  return { name, headline, contact, sections };
}

function escapeToml(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

function cvToToml(s: CVStructured): string {
  const out: string[] = [];
  out.push(`name = "${escapeToml(s.name)}"`);
  out.push(`headline = "${escapeToml(s.headline)}"`);
  if (s.contact.length > 0) {
    out.push("contact = [");
    for (const c of s.contact) {
      out.push(`  "${escapeToml(c)}",`);
    }
    out.push("]");
  }
  out.push("");

  for (const sec of s.sections) {
    out.push("[[sections]]");
    out.push(`title = "${escapeToml(sec.title)}"`);
    if (sec.text && sec.text.length > 0) {
      out.push("text = [");
      for (const t of sec.text) out.push(`  "${escapeToml(t)}",`);
      out.push("]");
    }
    out.push("");

    for (const item of sec.items) {
      out.push("  [[sections.items]]");
      out.push(`  title = "${escapeToml(item.title)}"`);
      if (item.meta) out.push(`  meta = "${escapeToml(item.meta)}"`);
      if (item.description)
        out.push(`  description = "${escapeToml(item.description)}"`);
      if (item.points && item.points.length > 0) {
        out.push("  points = [");
        for (const p of item.points) out.push(`    "${escapeToml(p)}",`);
        out.push("  ]");
      }
      out.push("");
    }
  }
  return out.join("\n").trim() + "\n";
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cvToXml(s: CVStructured): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push("<resume>");
  out.push(`  <name>${escapeXml(s.name)}</name>`);
  out.push(`  <headline>${escapeXml(s.headline)}</headline>`);
  if (s.contact.length > 0) {
    out.push("  <contact>");
    for (const c of s.contact) out.push(`    <entry>${escapeXml(c)}</entry>`);
    out.push("  </contact>");
  }
  out.push("  <sections>");
  for (const sec of s.sections) {
    out.push(`    <section title="${escapeXml(sec.title)}">`);
    if (sec.text && sec.text.length > 0) {
      for (const t of sec.text) out.push(`      <text>${escapeXml(t)}</text>`);
    }
    if (sec.items.length > 0) {
      out.push("      <items>");
      for (const item of sec.items) {
        out.push("        <item>");
        out.push(`          <title>${escapeXml(item.title)}</title>`);
        if (item.meta)
          out.push(`          <meta>${escapeXml(item.meta)}</meta>`);
        if (item.description)
          out.push(
            `          <description>${escapeXml(item.description)}</description>`,
          );
        if (item.points && item.points.length > 0) {
          out.push("          <points>");
          for (const p of item.points)
            out.push(`            <point>${escapeXml(p)}</point>`);
          out.push("          </points>");
        }
        out.push("        </item>");
      }
      out.push("      </items>");
    }
    out.push("    </section>");
  }
  out.push("  </sections>");
  out.push("</resume>");
  return out.join("\n");
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

    if (trimmed.startsWith("# ")) {
      const title = inlineFormat(trimmed.slice(2));
      htmlParts.push("<h1>" + title + "</h1>");
      continue;
    }

    if (trimmed.startsWith("## ")) {
      const heading = trimmed.slice(3).trim();
      const rawText = cleanText(heading);
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

    if (trimmed.startsWith("### ")) {
      const heading = trimmed.slice(4).trim();
      const rawText = cleanText(heading);

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

    if (trimmed.startsWith("#### ")) {
      const heading = trimmed.slice(5).trim();
      const rawText = cleanText(heading);
      const id = slugify(rawText);
      htmlParts.push('<h4 id="' + id + '">' + inlineFormat(heading) + "</h4>");
      continue;
    }

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

    if (j === i) {
      pLines.push(lines[i] ?? "");
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
  const structured = parseCVStructured(md);

  return {
    html: fullHtml,
    items,
    pages: splitCVPages(fullHtml),
    rawMarkdown: md,
    json: JSON.stringify(structured, null, 2),
    toml: cvToToml(structured),
    xml: cvToXml(structured),
  };
}

function parseHtmlCV(rawHtml: string): CVData {
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyMatch ? (bodyMatch[1] ?? rawHtml) : rawHtml;

  const items: IndexItem[] = [];
  let currentParent: IndexItem | null = null;

  body = (body || "").replace(
    /<(h[234])([^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag, attrs, inner) => {
      const rawText = cleanText(inner);
      const tagName = tag.toLowerCase();

      const idMatch = attrs.match(/id=["']([^"']+)["']/i);
      const id = idMatch ? (idMatch[1] ?? slugify(rawText)) : slugify(rawText);

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
          items.push({ id, label: shortLabel, labelEs: shortLabel });
        }
      }

      if (idMatch) return match;
      return `<${tag} id="${id}"${attrs}>${inner}</${tag}>`;
    },
  );

  return {
    html: body,
    items,
    pages: splitCVPages(body),
    rawMarkdown: cleanText(body),
    json: JSON.stringify({ raw: cleanText(body) }, null, 2),
    toml: `raw = "${escapeToml(cleanText(body))}"\n`,
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n<resume><raw>${escapeXml(cleanText(body))}</raw></resume>`,
  };
}

export function getCVData(locale: "en" | "es"): CVData {
  const filePath = resolveCVPath(locale);

  if (!filePath) {
    return {
      html: "<p>CV not found.</p>",
      items: [],
      pages: ["<p>CV not found.</p>", "", ""],
      rawMarkdown: "",
      json: "{}",
      toml: "",
      xml: "",
    };
  }

  const fileContent = fs.readFileSync(filePath, "utf-8");

  if (filePath.endsWith(".md")) {
    return parseMarkdownCV(fileContent);
  }

  return parseHtmlCV(fileContent);
}
