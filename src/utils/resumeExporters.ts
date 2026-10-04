export interface ResumeDataset {
  name: string;
  role: string;
  location: string;
  summary: string;
  skills: Record<string, string[]>;
  contact: {
    email: string;
    github: string;
    linkedin: string;
    website: string;
  };
}

export function injectUtmParams(url: string, utmContent: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("utm_source", "resume");
    parsed.searchParams.set("utm_medium", "document");
    if (utmContent) {
      parsed.searchParams.set("utm_content", utmContent);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function serializeResumeToJSON(
  data: ResumeDataset,
  utmTag: string = "",
): string {
  const enriched = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": "https://arturonavax.dev/#person",
    name: data.name,
    jobTitle: data.role,
    address: data.location,
    description: data.summary,
    url: injectUtmParams(data.contact.website, utmTag),
    sameAs: [
      injectUtmParams(data.contact.github, utmTag),
      injectUtmParams(data.contact.linkedin, utmTag),
    ],
    skills: data.skills,
  };
  return JSON.stringify(enriched, null, 2);
}

export function serializeResumeToTOML(
  data: ResumeDataset,
  utmTag: string = "",
): string {
  let toml = `name = "${data.name}"\nrole = "${data.role}"\nlocation = "${data.location}"\nsummary = "${data.summary.replace(/"/g, '\\"')}"\n\n`;
  toml += `[contact]\nemail = "${data.contact.email}"\nwebsite = "${injectUtmParams(data.contact.website, utmTag)}"\n\n`;
  toml += `[skills]\n`;
  for (const [category, skillsList] of Object.entries(data.skills)) {
    toml += `${category} = [${skillsList.map((s) => `"${s}"`).join(", ")}]\n`;
  }
  return toml;
}

export function serializeResumeToXML(
  data: ResumeDataset,
  utmTag: string = "",
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<resume>
  <profile>
    <name>${data.name}</name>
    <role>${data.role}</role>
    <location>${data.location}</location>
    <summary><![CDATA[${data.summary}]]></summary>
    <website>${injectUtmParams(data.contact.website, utmTag)}</website>
  </profile>
</resume>`.trim();
}

/**
 * Extracts a structured ResumeDataset from a raw markdown document,
 * parsing either frontmatter metadata or fallback top-level markdown headings.
 */
export function parseMarkdownToResumeDataset(
  rawMarkdown: string,
): ResumeDataset {
  let name = "Arturo Nava";
  let role =
    "Senior Software Engineer | Distributed Systems, High-Concurrency & Security";
  let location = "Bogota, D.C., Colombia";
  let summary = "";
  const skills: Record<string, string[]> = {};
  const contact = {
    email: "arturo@arturonavax.dev",
    github: "https://github.com/arturonavax",
    linkedin: "https://www.linkedin.com/in/arturonavax",
    website: "https://arturonavax.dev",
  };

  // Try parsing frontmatter
  const fmMatch = rawMarkdown.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
  if (fmMatch && fmMatch[1]) {
    const fm = fmMatch[1];
    const nameMatch = fm.match(/name:\s*["']?([^"'\r\n]+)["']?/);
    if (nameMatch && nameMatch[1]) name = nameMatch[1].trim();

    const roleMatch = fm.match(/role:\s*["']?([^"'\r\n]+)["']?/);
    if (roleMatch && roleMatch[1]) role = roleMatch[1].trim();

    const locMatch = fm.match(/location:\s*["']?([^"'\r\n]+)["']?/);
    if (locMatch && locMatch[1]) location = locMatch[1].trim();

    const sumMatch = fm.match(/summary:\s*["']?([^"'\r\n]+)["']?/);
    if (sumMatch && sumMatch[1]) summary = sumMatch[1].trim();

    const emailMatch = fm.match(/email:\s*["']?([^"'\r\n]+)["']?/);
    if (emailMatch && emailMatch[1]) contact.email = emailMatch[1].trim();

    const ghMatch = fm.match(/github:\s*["']?([^"'\r\n]+)["']?/);
    if (ghMatch && ghMatch[1]) contact.github = ghMatch[1].trim();

    const liMatch = fm.match(/linkedin:\s*["']?([^"'\r\n]+)["']?/);
    if (liMatch && liMatch[1]) contact.linkedin = liMatch[1].trim();

    const webMatch = fm.match(/website:\s*["']?([^"'\r\n]+)["']?/);
    if (webMatch && webMatch[1]) contact.website = webMatch[1].trim();
  }

  // Parse markdown body
  const body = rawMarkdown.replace(/^---\s*[\r\n]+[\s\S]*?[\r\n]+---\s*/, "");
  const lines = body.split(/\r?\n/);
  let currentSection = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("# ") && !name) {
      name = line.slice(2).trim();
    } else if (line.startsWith("## ")) {
      currentSection = line.slice(3).trim();
    } else if (
      currentSection.toLowerCase().includes("summary") ||
      currentSection.toLowerCase().includes("perfil") ||
      currentSection.toLowerCase().includes("executive")
    ) {
      if (
        !summary &&
        line &&
        !line.startsWith("#") &&
        !line.startsWith("---")
      ) {
        summary = line.replace(/[*_`]/g, "").trim();
      }
    } else if (
      currentSection.toLowerCase().includes("competenc") ||
      currentSection.toLowerCase().includes("skills")
    ) {
      if (line.startsWith("- ")) {
        const item = line.slice(2).trim();
        const colonIdx = item.indexOf(":");
        if (colonIdx > 0) {
          const category = item.slice(0, colonIdx).replace(/[*_`]/g, "").trim();
          const itemsStr = item.slice(colonIdx + 1).trim();
          const skillItems = itemsStr
            .split(",")
            .map((s) => s.replace(/[*_`]/g, "").trim())
            .filter(Boolean);
          skills[category] = skillItems;
        }
      }
    }
  }

  return { name, role, location, summary, skills, contact };
}
