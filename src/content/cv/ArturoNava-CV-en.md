# Arturo Nava

**Senior Software Engineer | Distributed Systems, High-Concurrency & Security**  
Bogota, D.C., Colombia • [arturonavax@gmail.com](mailto:arturonavax@gmail.com) • [+57 324 200 9803](tel:+573242009803) • [linkedin.com/in/arturonavax](https://www.linkedin.com/in/arturonavax) • [github.com/arturonavax](https://github.com/arturonavax) • [arturonavax.dev](https://arturonavax.dev)

---

## Summary / Executive Profile

Senior Software Engineer with 8+ years of experience designing and scaling mission-critical distributed architectures, high-throughput backend services, and enterprise security platforms across fintech, loyalty, and cryptographic verification domains. Specialized in engineering low-latency, concurrent microservices in **Golang** and **Rust**, architecting real-time dynamic fraud evaluation engines, implementing cryptographic authentication (TOTP/HMAC), and decoupling high-volume transactional OLTP databases from **Snowflake** OLAP analytics. Proven track record of driving system resilience, zero-downtime rollouts, automated access governance, and enterprise-grade DevSecOps standards.

---

## Core Technical Competencies

- **Languages:** Golang (Goroutines, Channels, Low-Level Concurrency), Rust, Node.js / TypeScript, Python, Bash, SQL, C / Assembly (SIMD).
- **Distributed Systems & Architecture:** Clean / Hexagonal Architecture, Event-Driven Systems, Concurrency Patterns (Worker Pools, Mutexes, WaitGroups), High-Throughput REST & gRPC APIs, Distributed Caching (Redis), Connection Pooling, Dynamic Rule Engines.
- **Data & Storage:** PostgreSQL, AWS DynamoDB, Snowflake (OLAP Analytics), Redis, MySQL / MariaDB, SQLite, LevelDB, Aerospike, Query Optimization.
- **Cybersecurity & Identity:** Application Security, DevSecOps, Shift-Left Security, Vanta / SOC 2 Hardening, CVE Remediation, TOTP / MFA Authentication, Cryptographic Signatures (HMAC, Webhooks), OAuth2, Zero-Trust Architecture, PII Data Minimization, Container Hardening.
- **Cloud, Infrastructure & DevOps:** AWS (DynamoDB, SQS, Secrets Manager, Lambda, S3, IAM), Google Cloud (GCP, BigQuery), Docker, Kubernetes, CI/CD (Jenkins DinD, Pre-commit hooks), Feature Toggles (Unleash, Firebase Remote Config), Git, Linux Kernel Internals (`inotify`).
- **Engineering Practices:** Distributed System Design, RFC & Technical Design Docs, TDD, Domain-Driven Design (DDD), CI/CD Automation, Threat Modeling.

---

## Professional Experience

### **Leal** — Bogota, Colombia

**Senior Software Engineer – Core Platform & Security**  
_September 2025 – June 2026_

- Architected and deployed mission-critical microservices in Golang adopting Clean/Hexagonal Architecture and Go concurrency primitives (`goroutines`, channels, worker pools) across DynamoDB and Redis, enabling non-blocking execution across high-volume transactional flows.
- Engineered an enterprise real-time anti-fraud engine from scratch using the Strategy Pattern to detect cashier collusion and rolling-window velocity anomalies, delivering sub-50ms synchronous endpoints into POS checkout with cross-timezone normalization (`FlexibleTime`).
- Centralized the core authentication platform into a unified OTP/TOTP microservice, enforcing strict rate limiting, transactional failover to relational storage, multi-channel billing calculation (SMS, WhatsApp, Email), and secure legal document attachments.
- Decoupled analytical workloads from operational OLTP databases by integrating native `gosnowflake` drivers into Go microservices, aggregating millions of marketing interactions (sends, opens, clicks, ROI) into real-time merchant dashboards.
- Spearheaded DevSecOps compliance and CVE remediation across 10+ core repositories under Vanta / SOC 2 standards, hardening Alpine production containers with `dumb-init`, migrating to modular AWS SDK v3, and engineering Rust contactability pipelines with zero-downtime Unleash feature flags.

_Technologies:_ `Golang`, `Rust`, `AWS (DynamoDB, SQS, Secrets Manager)`, `Snowflake`, `PostgreSQL`, `Redis`, `Docker`, `Kubernetes`, `Jenkins`, `Unleash`.

---

### **Mercado Libre** — Bogota, Colombia

**Senior Backend Security Engineer**  
_August 2024 – September 2025_

- Architected and deployed an internal risk evaluation and access governance engine in Golang and Python, correlating BigQuery telemetry, internal REST APIs, and cloud storage to continuously audit permissions and trigger automated policy mitigation across the enterprise.
- Engineered distributed scanning pipelines for continuous secret detection and PII data minimization across code repositories, commit histories, and Google Cloud storage buckets, proactively preventing credential exposure and sensitive customer data leaks.
- Instituted shift-left preventive security controls by embedding automated compliance checks into pre-commit hooks and CI/CD pipelines, proactively blocking hardcoded secrets and guaranteeing strict adherence to corporate security policies prior to production deployment.
- Automated security incident triage and response workflows by integrating n8n orchestration with Go microservices and Bash scripts, streamlining ticketing operations and significantly reducing operational response latency for critical alerts.

_Technologies:_ `Golang`, `Python`, `Bash`, `Google Cloud (GCP)`, `BigQuery`, `n8n`, `Docker`, `CI/CD (Pre-commit hooks)`, `PII Minimization`, `Zero-Trust`.

---

### **Imagemaker** — Remote / Chile

**Software Engineer – Identity & Trust Platforms**  
_December 2023 – August 2024_

- Architected digital identity verification and authorization microservices in Golang and PostgreSQL for enterprise trust platforms (SOVOS Trust-Services), preventing fraudulent onboarding and ensuring strict regulatory compliance.
- Engineered multi-modal biometric and authentication pipelines, integrating facial recognition, automated challenge-response Q&A flows, and real-time validation against government databases.
- Implemented enterprise-grade OAuth2 authentication protocols and resilient, multi-channel dynamic OTP verification microservices, ensuring high availability and fault tolerance during peak verification traffic.

_Technologies:_ `Golang`, `PostgreSQL`, `OAuth2`, `OTP`, `Biometrics`, `Microservices`, `Cloud Computing`, `REST APIs`.

---

### **FYLD, Inc.** — United States (Remote)

**Co-Founder & Principal Engineer**  
_May 2019 – September 2023_

- Architected and scaled an enterprise Data Witnessing platform in Golang, gRPC, and LevelDB/PostgreSQL, providing provable, tamper-evident cryptographic audit trails for corporate clients.
- Engineered cryptographic state-anchoring protocols utilizing Bitcoin/UTXO architectures and Merkle trees to establish immutable mathematical proofs of state on distributed networks.
- Optimized cryptographic hashing throughput by implementing low-level SIMD vector instructions (Assembly/Go), accelerating SHA-256 computation across high-volume data streams.
- Pioneered kernel-level file mutation observability by intercepting Linux kernel inodes (`inotify`), triggering real-time cryptographic notarizations with zero user-space polling overhead.
- Directed engineering best practices, CI/CD automation, and zero-trust cryptographic key management lifecycles across distributed microservices.

_Technologies:_ `Golang`, `gRPC`, `Bitcoin Script / UTXO`, `SIMD / Assembly`, `LevelDB`, `SQLite`, `PostgreSQL`, `Linux Kernel (Inodes)`, `CI/CD`.

---

### **Cobuild Lab** — Miami, FL, United States (Remote)

**Backend Software Engineer**  
_November 2018 – June 2019_

- Engineered a concurrent work queue coordinator in Golang utilizing rolling-window clock algorithms to regulate database read/write throughput and eliminate lock contention under peak load.
- Built a high-performance automation CLI tool (`pex-cmd`) in Go (Cobra, Testify, Docker) executing streaming GZIP/Deflate file decompression and concurrent batch XML parsing for bulk database ingestion into IBM Cloudant.
- Architected and deployed scalable REST microservices (`pex-retail-api`, `pex-awardwallet`) using Golang (Gin), Docker, and Auth0, managing complex product search filtering, usage analytics, and third-party rewards API integrations.

_Technologies:_ `Golang (Cobra, Gin)`, `IBM Cloudant`, `Docker`, `Auth0`, `Testify`, `DigitalOcean`, `IBM Cloud Foundry`.

---

### **Earlier Career Experience**

- **Backend Engineer | PlazaETC** _(Oct 2018 – Dec 2018)_: Engineered multi-vendor e-commerce platforms on AWS, optimizing MySQL database schemas and indexing for catalog search performance.
- **Backend Software Engineer | 4Geeks Developers Community** _(Apr 2018 – Jul 2018)_: Built high-throughput product referral and affiliate REST APIs in Golang (Echo) with low-latency Aerospike NoSQL caching.
- **Software Engineer | E.T.C.R Rómulo Gallegos** _(Dec 2017 – Mar 2018)_: Engineered "iRG App", an institutional web pre-enrollment platform with a Golang backend, PostgreSQL, GraphQL, and JWT authentication deployed on Heroku, and developed the institution's official responsive web portal.

---

## Education & Certifications

- **Associate Degree in Computer Systems & Informatics** | E.T.C.R Rómulo Gallegos (2012 – 2018)
