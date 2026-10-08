export function getHomepageJsonLd(locale: "en" | "es" = "en") {
  const isEs = locale === "es";

  return {
    "@context": "https://schema.org",
    "@id": "https://arturonavax.dev/#person",
    inLanguage: isEs ? "es" : "en",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": "https://arturonavax.dev/#website",
        url: isEs ? "https://arturonavax.dev/es/" : "https://arturonavax.dev/",
        name: "Arturo Nava",
        alternateName: "arturonavax.dev",
        publisher: { "@id": "https://arturonavax.dev/#person" },
        inLanguage: isEs ? "es" : "en",
      },
      {
        "@type": "ProfilePage",
        "@id": "https://arturonavax.dev/#profilepage",
        url: isEs ? "https://arturonavax.dev/es/" : "https://arturonavax.dev/",
        name: isEs
          ? "Arturo Nava - Ingeniero de Software Senior / IA"
          : "Arturo Nava - Senior Software / AI Engineer",
        isPartOf: { "@id": "https://arturonavax.dev/#website" },
        inLanguage: isEs ? "es" : "en",
        dateCreated: "2025-09-01T00:00:00Z",
        dateModified: "2026-09-27T23:46:15Z",
        mainEntity: { "@id": "https://arturonavax.dev/#person" },
        about: { "@id": "https://arturonavax.dev/#person" },
      },
      {
        "@type": "Person",
        "@id": "https://arturonavax.dev/#person",
        name: "Arturo Nava",
        alternateName: ["arturonavax", "Arturo Enrique Nava Matheus"],
        jobTitle: isEs
          ? "Ingeniero de Software Senior / IA"
          : "Senior Software / AI Engineer",
        description: isEs
          ? "Ingeniero de Software Senior / IA con más de 8 años diseñando arquitecturas distribuidas de alto rendimiento, motores antifraude en tiempo real, verificación criptográfica Web3 y flujos agénticos en Go, Rust y Python. Disponible para roles remotos Senior/Staff y consultoría a nivel global vía Contractor B2B (W-8BEN) o EOR (alineado con la zona horaria UTC-5 / EE. UU., sin patrocinio de visa)."
          : "Senior Software & AI Engineer with 8+ years architecting high-throughput distributed backends, real-time fraud engines, Web3 cryptographic verification, and production AI workflows in Go, Rust, and Python. Open to remote full-time Senior/Staff roles and advisory globally via B2B contractor (W-8BEN) or EOR (aligned with UTC-5 / US time zones, no visa sponsorship needed).",
        url: "https://arturonavax.dev/",
        mainEntityOfPage: { "@id": "https://arturonavax.dev/#profilepage" },
        image: [
          "https://arturonavax.dev/arturonava.webp",
          "https://arturonavax.dev/og-default.png",
        ],
        email: "mailto:arturo@arturonavax.dev",
        contactPoint: {
          "@type": "ContactPoint",
          contactType: isEs
            ? "Reclutamiento y Consultas Profesionales"
            : "Recruitment & Professional Inquiries",
          availableLanguage: ["Spanish", "English"],
        },
        address: {
          "@type": "PostalAddress",
          addressLocality: "Bogotá",
          addressRegion: "D.C.",
          addressCountry: "CO",
        },
        sameAs: [
          "https://github.com/arturonavax",
          "https://www.linkedin.com/in/arturonavax",
          "https://x.com/arturonavax",
        ],
        knowsLanguage: [
          {
            "@type": "Language",
            name: isEs ? "Inglés" : "English",
            alternateName: "en",
          },
          {
            "@type": "Language",
            name: isEs ? "Español" : "Spanish",
            alternateName: "es",
          },
        ],
        alumniOf: [
          {
            "@type": "EducationalOrganization",
            "@id": "https://arturonavax.dev/#etcr-romulo-gallegos",
            name: "E.T.C.R Rómulo Gallegos",
            address: {
              "@type": "PostalAddress",
              addressCountry: "VE",
            },
          },
        ],
        hasCredential: [
          {
            "@type": "EducationalOccupationalCredential",
            credentialCategory: "degree",
            name: isEs
              ? "Técnico Medio en Comercio y Servicios Administrativos, Mención Informática"
              : "Middle Technical Degree in Commerce & Administrative Services, Major in Computer Science",
            recognizedBy: {
              "@type": "EducationalOrganization",
              "@id": "https://arturonavax.dev/#etcr-romulo-gallegos",
              name: "E.T.C.R Rómulo Gallegos",
            },
            about: [
              {
                "@type": "DefinedTerm",
                name: isEs ? "Ciencias de la Computación" : "Computer Science",
              },
              {
                "@type": "DefinedTerm",
                name: isEs ? "Ingeniería de Software" : "Software Engineering",
              },
              {
                "@type": "DefinedTerm",
                name: isEs ? "Desarrollo Web" : "Web Development",
              },
              {
                "@type": "DefinedTerm",
                name: isEs ? "Algoritmos" : "Algorithms",
              },
              {
                "@type": "DefinedTerm",
                name: isEs ? "Estructuras de Datos" : "Data Structures",
              },
              {
                "@type": "DefinedTerm",
                name: isEs
                  ? "Bases de Datos Relacionales"
                  : "Relational Databases",
              },
            ],
          },
        ],
        hasOccupation: [
          {
            "@type": "Role",
            roleName: isEs
              ? "Senior Software Engineer - Plataforma Core & Seguridad"
              : "Senior Software Engineer - Core Platform & Security",
            startDate: "2023-08-01",
            endDate: "2026-02-01",
            worksFor: {
              "@type": "Organization",
              name: "Leal",
              url: "https://puntosleal.com",
            },
          },
          {
            "@type": "Role",
            roleName: isEs
              ? "Senior Backend Security Engineer"
              : "Senior Backend Security Engineer",
            startDate: "2021-12-01",
            endDate: "2023-04-01",
            worksFor: {
              "@type": "Organization",
              name: "Mercado Libre",
              url: "https://mercadolibre.com",
            },
          },
          {
            "@type": "Role",
            roleName: isEs
              ? "Software Engineer - Plataformas de Identidad & Confianza"
              : "Software Engineer - Identity & Trust Platforms",
            startDate: "2021-02-01",
            endDate: "2021-12-01",
            worksFor: {
              "@type": "Organization",
              name: "Imagemaker",
              url: "https://imagemaker.com",
            },
          },
          {
            "@type": "Role",
            roleName: isEs
              ? "Co-Founder & Principal Engineer"
              : "Co-Founder & Principal Engineer",
            startDate: "2019-07-01",
            endDate: "2021-02-01",
            worksFor: {
              "@type": "Organization",
              name: "FYLD, Inc.",
            },
          },
          {
            "@type": "Role",
            roleName: isEs
              ? "Backend Software Engineer"
              : "Backend Software Engineer",
            startDate: "2019-01-01",
            endDate: "2019-07-01",
            worksFor: {
              "@type": "Organization",
              name: "Cobuild Lab",
              url: "https://cobuildlab.com",
            },
          },
          {
            "@type": "Role",
            roleName: isEs ? "Backend Engineer" : "Backend Engineer",
            startDate: "2018-10-01",
            endDate: "2018-12-01",
            worksFor: {
              "@type": "Organization",
              name: "PlazaETC",
            },
          },
          {
            "@type": "Role",
            roleName: isEs
              ? "Backend Software Engineer"
              : "Backend Software Engineer",
            startDate: "2018-04-01",
            endDate: "2018-07-01",
            worksFor: {
              "@type": "Organization",
              "@id": "https://arturonavax.dev/#4geeks-organization",
              name: "4Geeks Developers Community",
              url: "https://4geeks.co",
            },
          },
          {
            "@type": "Role",
            roleName: isEs ? "Desarrollador de Software" : "Software Engineer",
            startDate: "2017-12-01",
            endDate: "2018-03-01",
            worksFor: {
              "@type": "EducationalOrganization",
              "@id": "https://arturonavax.dev/#etcr-romulo-gallegos",
              name: "E.T.C.R Rómulo Gallegos",
            },
          },
        ],
        workLocation: {
          "@type": "Country",
          name: "Colombia",
          identifier: "CO",
        },
        jobLocationType: "TELECOMMUTE",
        applicantLocationRequirements: [
          {
            "@type": "Country",
            name: isEs ? "Estados Unidos" : "United States",
            identifier: "US",
          },
          {
            "@type": "Country",
            name: isEs ? "Canadá" : "Canada",
            identifier: "CA",
          },
          {
            "@type": "Country",
            name: isEs ? "Reino Unido" : "United Kingdom",
            identifier: "GB",
          },
          {
            "@type": "AdministrativeArea",
            name: isEs ? "Unión Europea" : "European Union",
          },
        ],
        knowsAbout: [
          {
            "@type": "DefinedTerm",
            name: "Go",
            alternateName: "Golang",
            sameAs: [
              isEs
                ? "https://es.wikipedia.org/wiki/Go_(lenguaje_de_programaci%C3%B3n)"
                : "https://en.wikipedia.org/wiki/Go_(programming_language)",
              "https://www.wikidata.org/wiki/Q37227",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: "Rust",
            sameAs: [
              isEs
                ? "https://es.wikipedia.org/wiki/Rust_(lenguaje_de_programaci%C3%B3n)"
                : "https://en.wikipedia.org/wiki/Rust_(programming_language)",
              "https://www.wikidata.org/wiki/Q575650",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: "Python",
            sameAs: [
              isEs
                ? "https://es.wikipedia.org/wiki/Python"
                : "https://en.wikipedia.org/wiki/Python_(programming_language)",
              "https://www.wikidata.org/wiki/Q28865",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: isEs ? "Computación distribuida" : "Distributed computing",
            sameAs: [
              isEs
                ? "https://es.wikipedia.org/wiki/Computaci%C3%B3n_distribuida"
                : "https://en.wikipedia.org/wiki/Distributed_computing",
              "https://www.wikidata.org/wiki/Q180634",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: "Apache Kafka",
            sameAs: [
              "https://es.wikipedia.org/wiki/Apache_Kafka",
              "https://www.wikidata.org/wiki/Q16235208",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: isEs ? "Microservicios" : "Microservices",
            sameAs: [
              isEs
                ? "https://es.wikipedia.org/wiki/Arquitectura_de_microservicios"
                : "https://en.wikipedia.org/wiki/Microservices",
              "https://www.wikidata.org/wiki/Q18344624",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: isEs
              ? "Arquitectura dirigida por eventos"
              : "Event-driven architecture",
            sameAs: [
              isEs
                ? "https://es.wikipedia.org/wiki/Arquitectura_dirigida_por_eventos"
                : "https://en.wikipedia.org/wiki/Event-driven_architecture",
              "https://www.wikidata.org/wiki/Q991296",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: isEs
              ? "Modelo de seguridad Zero Trust"
              : "Zero trust security model",
            sameAs: [
              isEs
                ? "https://es.wikipedia.org/wiki/Redes_de_confianza_cero"
                : "https://en.wikipedia.org/wiki/Zero_trust_security_model",
              "https://www.wikidata.org/wiki/Q104852562",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: "PostgreSQL",
            sameAs: [
              "https://es.wikipedia.org/wiki/PostgreSQL",
              "http://wikidata.org/wiki/Q192490",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: "Redis",
            sameAs: [
              "https://es.wikipedia.org/wiki/Redis",
              "https://www.wikidata.org/wiki/Q2136322",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: "Snowflake",
            sameAs: [
              "https://es.wikipedia.org/wiki/Snowflake_Inc.",
              "https://www.wikidata.org/wiki/Q114880973",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: "Amazon Web Services",
            alternateName: "AWS",
            sameAs: [
              "https://es.wikipedia.org/wiki/Amazon_Web_Services",
              "https://www.wikidata.org/wiki/Q456157",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: "Amazon DynamoDB",
            alternateName: "DynamoDB",
            sameAs: [
              "https://es.wikipedia.org/wiki/Amazon_DynamoDB",
              "https://www.wikidata.org/wiki/Q15731832",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: "Kubernetes",
            sameAs: [
              "https://es.wikipedia.org/wiki/Kubernetes",
              "https://www.wikidata.org/wiki/Q22661306",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: "Docker",
            sameAs: [
              "https://es.wikipedia.org/wiki/Docker_(software)",
              "https://www.wikidata.org/wiki/Q15206305",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: "gRPC",
            sameAs: [
              "https://es.wikipedia.org/wiki/GRPC",
              "https://www.wikidata.org/wiki/Q26356541",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: "Linux",
            sameAs: [
              "https://es.wikipedia.org/wiki/Linux",
              "https://www.wikidata.org/wiki/Q388",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: isEs
              ? "Extensiones Vectoriales Avanzadas"
              : "Advanced Vector Extensions",
            alternateName: "AVX2 SIMD",
            sameAs: [
              "https://es.wikipedia.org/wiki/Advanced_Vector_Extensions",
              "https://www.wikidata.org/wiki/Q17600",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: "Inotify",
            alternateName: isEs
              ? "Inodos del Kernel de Linux"
              : "Linux Kernel Inodes",
            sameAs: [
              isEs
                ? "https://es.wikipedia.org/wiki/Inodo"
                : "https://en.wikipedia.org/wiki/Inode",
              "https://www.wikidata.org/wiki/Q307101",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: isEs ? "Concurrencia" : "Concurrency",
            sameAs: [
              isEs
                ? "https://es.wikipedia.org/wiki/Concurrencia_(inform%C3%A1tica)"
                : "https://en.wikipedia.org/wiki/Concurrency_(computer_science)",
              "https://www.wikidata.org/wiki/Q1414548",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: isEs ? "Arquitectura Hexagonal" : "Hexagonal Architecture",
            sameAs: [
              isEs
                ? "https://es.wikipedia.org/wiki/Arquitectura_hexagonal_(software)"
                : "https://en.wikipedia.org/wiki/Hexagonal_architecture_(software)",
              "https://www.wikidata.org/wiki/Q66403655",
            ],
          },
          {
            "@type": "DefinedTerm",
            name: isEs ? "Árbol de Merkle" : "Merkle Tree",
            sameAs: [
              isEs
                ? "https://es.wikipedia.org/wiki/%C3%81rbol_de_Merkle"
                : "https://en.wikipedia.org/wiki/Merkle_tree",
              "https://www.wikidata.org/wiki/Q14746",
            ],
          },
        ],
      },
    ],
  };
}
