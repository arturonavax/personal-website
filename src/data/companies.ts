export interface CompanyInfo {
  name: string;
  url: string;
  domain: string;
  industry: string;
  industryEs: string;
  description: string;
  descriptionEs: string;
}

export type CompanyOverrides = {
  [K in keyof CompanyInfo]?: CompanyInfo[K] | undefined;
};

export const companiesData: Record<string, CompanyInfo> = {
  imagemaker: {
    name: "Imagemaker",
    url: "https://imagemaker.com",
    domain: "imagemaker.com",
    industry: "Enterprise Software & Identity Platforms",
    industryEs: "Software Empresarial & Plataformas de Identidad",
    description:
      "Global IT consulting and digital transformation firm engineering mission-critical identity, electronic signature, and trust platforms (SOVOS Trust-Services).",
    descriptionEs:
      "Consultora global de ingeniería y transformación digital especializada en plataformas de identidad, firma electrónica y confianza para SOVOS Trust-Services.",
  },
  "mercado libre": {
    name: "Mercado Libre",
    url: "https://www.mercadolibre.com",
    domain: "mercadolibre.com",
    industry: "E-commerce & Fintech Ecosystem",
    industryEs: "Ecosistema de Comercio Electrónico y Fintech",
    description:
      "The largest e-commerce and payments ecosystem in Latin America, serving over 100M active users with sub-second transactional processing.",
    descriptionEs:
      "El mayor ecosistema de comercio electrónico y pagos de América Latina, con más de 100M de usuarios activos y procesamiento transaccional sub-segundo.",
  },
  fyld: {
    name: "FYLD, Inc.",
    url: "https://fyld.com",
    domain: "fyld.com",
    industry: "Cryptographic Data Integrity & Distributed Systems",
    industryEs: "Integridad Criptográfica de Datos y Sistemas Distribuidos",
    description:
      "Enterprise data witnessing and tamper-evident cryptographic audit trail platform using distributed state-anchoring protocols and Merkle trees.",
    descriptionEs:
      "Plataforma empresarial de testimonio de datos (data witnessing) y pistas de auditoría criptográfica a prueba de manipulaciones mediante protocolos de anclaje de estado y árboles de Merkle.",
  },
  leal: {
    name: "Leal",
    url: "https://leal.co",
    domain: "leal.co",
    industry: "Loyalty & Retail Transactions",
    industryEs: "Fidelización y Transacciones Retail",
    description:
      "High-throughput customer engagement, cashback, and rewards platform processing millions of daily retail and merchant interactions.",
    descriptionEs:
      "Plataforma transaccional de fidelización, recompensas y cashback que procesa millones de eventos diarios en el sector retail.",
  },
  "cobuild lab": {
    name: "Cobuild Lab",
    url: "https://cobuildlab.com",
    domain: "cobuildlab.com",
    industry: "Product Engineering Studio",
    industryEs: "Estudio de Ingeniería de Producto",
    description:
      "Software development studio crafting enterprise distributed systems, web architectures, and cloud services for international tech ventures.",
    descriptionEs:
      "Estudio de desarrollo de software especializado en arquitecturas cloud y sistemas distribuidos empresariales para ventures internacionales.",
  },
  "4geeks academy": {
    name: "4Geeks Academy",
    url: "https://4geeksacademy.com",
    domain: "4geeksacademy.com",
    industry: "Technical Education & Mentorship",
    industryEs: "Educación Técnica y Mentoría",
    description:
      "Global coding academy providing intensive full-stack, software engineering, and software architecture mentorship.",
    descriptionEs:
      "Academia global de programación que imparte mentoría avanzada en desarrollo de software y arquitecturas tecnológicas.",
  },
  "plaza etc": {
    name: "Plaza Etc",
    url: "https://plazaetc.com",
    domain: "plazaetc.com",
    industry: "Retail & Commercial Operations",
    industryEs: "Retail y Operaciones Comerciales",
    description:
      "Commercial retail network and digital logistics platform optimizing store management, point-of-sale systems, and inventory operations.",
    descriptionEs:
      "Red comercial y plataforma de logística digital para optimización de sistemas punto de venta, inventario y gestión operativa.",
  },
  "etcr rómulo gallegos": {
    name: "E.T.C.R Rómulo Gallegos",
    url: "",
    domain: "",
    industry: "Technical & Vocational Secondary Education",
    industryEs: "Educación Técnica Media y Comercial",
    description:
      "Technical high school in Maracaibo, Venezuela, providing vocational education specialized in computer systems, informatics, and accounting.",
    descriptionEs:
      "Institución de educación media técnica en Maracaibo, Venezuela, especializada en la formación técnica en informática y contabilidad mercantil.",
  },
};

export function getCompanyInfo(
  companyName: string,
  overrides?: CompanyOverrides,
): CompanyInfo {
  const key = companyName.toLowerCase().trim();
  let base: CompanyInfo = {
    name: companyName,
    url: `https://www.google.com/search?q=${encodeURIComponent(companyName)}`,
    domain: companyName.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com",
    industry: "Technology & Engineering",
    industryEs: "Tecnología e Ingeniería",
    description: `${companyName} is an engineering enterprise organization.`,
    descriptionEs: `${companyName} es una organización de ingeniería y desarrollo tecnológico.`,
  };

  if (companiesData[key]) {
    base = { ...companiesData[key] };
  } else {
    // Try partial match
    for (const [k, v] of Object.entries(companiesData)) {
      if (key.includes(k) || k.includes(key)) {
        base = { ...v };
        break;
      }
    }
  }

  if (overrides) {
    if (overrides.name !== undefined) base.name = overrides.name;
    if (overrides.url !== undefined) base.url = overrides.url;
    if (overrides.domain !== undefined) base.domain = overrides.domain;
    if (overrides.industry !== undefined) base.industry = overrides.industry;
    if (overrides.industryEs !== undefined)
      base.industryEs = overrides.industryEs;
    if (overrides.description !== undefined)
      base.description = overrides.description;
    if (overrides.descriptionEs !== undefined)
      base.descriptionEs = overrides.descriptionEs;
  }

  return base;
}
