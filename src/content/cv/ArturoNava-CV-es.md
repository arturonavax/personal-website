# Arturo Nava

**Senior Software Engineer | Sistemas Distribuidos, Alta Concurrencia & Seguridad**  
Bogotá, D.C., Colombia • [arturonavax@gmail.com](mailto:arturonavax@gmail.com) • [+57 324 200 9803](tel:+573242009803) • [linkedin.com/in/arturonavax](https://www.linkedin.com/in/arturonavax) • [github.com/arturonavax](https://github.com/arturonavax) • [arturonavax.dev](https://arturonavax.dev)

---

## Perfil Profesional / Resumen Ejecutivo

Ingeniero de Software Senior con más de 8 años de experiencia en el diseño y escalamiento de arquitecturas distribuidas de misión crítica, servicios backend de alto rendimiento y plataformas de seguridad empresarial en sectores fintech, lealtad y verificación criptográfica. Especializado en el desarrollo de microservicios concurrentes y de baja latencia en **Golang** y **Rust**, arquitectura de motores dinámicos de prevención de fraude en tiempo real, autenticación criptográfica (TOTP/HMAC) y desacoplamiento de bases de datos transaccionales (OLTP) hacia analítica masiva en **Snowflake** (OLAP). Trayectoria comprobada impulsando resiliencia de sistemas, despliegues con cero tiempo de inactividad (_zero-downtime_), gobernanza automatizada de accesos y rigurosos estándares de DevSecOps.

---

## Competencias Técnicas Clave

- **Lenguajes:** Golang (Goroutines, Canales, Concurrencia a bajo nivel), Rust, Node.js / TypeScript, Python, Bash, SQL, C / Assembly (SIMD).
- **Sistemas Distribuidos y Arquitectura:** Arquitectura Limpia / Hexagonal, Sistemas Event-Driven, Patrones de Concurrencia (Worker Pools, Mutexes, WaitGroups), APIs REST y gRPC de Alto Rendimiento, Caché Distribuida (Redis), Connection Pooling, Motores de Reglas Dinámicas.
- **Datos y Almacenamiento:** PostgreSQL, AWS DynamoDB, Snowflake (Analítica OLAP), Redis, MySQL / MariaDB, SQLite, LevelDB, Aerospike, Optimización de Consultas.
- **Ciberseguridad e Identidad:** Seguridad de Aplicaciones, DevSecOps, Seguridad Shift-Left, Hardening Vanta / SOC 2, Remediación de CVEs, Autenticación TOTP / MFA, Firmas Criptográficas (HMAC, Webhooks), OAuth2, Arquitectura Zero-Trust, Minimización de Datos PII, Hardening de Contenedores.
- **Cloud, Infraestructura y DevOps:** AWS (DynamoDB, SQS, Secrets Manager, Lambda, S3, IAM), Google Cloud (GCP, BigQuery), Docker, Kubernetes, CI/CD (Jenkins DinD, Hooks pre-commit), Feature Flags (Unleash, Firebase Remote Config), Git, Internals del Kernel de Linux (`inotify`).
- **Prácticas de Ingeniería:** Diseño de Sistemas Distribuidos, RFCs y Documentos de Diseño Técnico, TDD, Domain-Driven Design (DDD), Automatización CI/CD, Modelado de Amenazas.

---

## Experiencia Profesional

### **Leal** — Bogotá, Colombia

**Senior Software Engineer – Plataforma Core & Seguridad**  
_Septiembre 2025 – Junio 2026_

- Diseñé y desplegué microservicios de misión crítica en Golang bajo Arquitectura Limpia/Hexagonal, implementando primitivas de concurrencia (`goroutines`, canales, worker pools) sobre DynamoDB y Redis para procesamiento no bloqueante de eventos transaccionales.
- Desarrollé desde cero un motor empresarial de prevención de fraude aplicando el Patrón Estrategia para evaluar en tiempo real colusión cajero-cliente y anomalías de velocidad, garantizando endpoints sincrónicos sub-50ms en checkout de POS con consistencia de husos horarios (`FlexibleTime`).
- Centralicé la plataforma de autenticación en un microservicio unificado de OTP/TOTP, implementando rate limiting estricto, failover transaccional a almacenamiento relacional, facturación multicanal (SMS, WhatsApp, Email) y adjuntos seguros de documentación legal.
- Desacoplé cargas de trabajo analíticas de bases de datos operacionales (OLTP) integrando drivers nativos `gosnowflake` en microservicios Go, procesando millones de interacciones de marketing hacia tableros de ROI para comercios en tiempo real.
- Lideré la remediación de vulnerabilidades y cumplimiento Vanta / SOC 2 en más de 10 repositorios core, ejecutando hardening de contenedores Alpine con `dumb-init`, migración a AWS SDK v3 modular y pipelines de contactabilidad en Rust con Feature Flags zero-downtime (Unleash).

_Tecnologías:_ `Golang`, `Rust`, `AWS (DynamoDB, SQS, Secrets Manager)`, `Snowflake`, `PostgreSQL`, `Redis`, `Docker`, `Kubernetes`, `Jenkins`, `Unleash`.

---

### **Mercado Libre** — Bogotá, Colombia

**Senior Backend Security Engineer**  
_Agosto 2024 – Septiembre 2025_

- Diseñé e implementé un motor interno de evaluación de riesgo y gobernanza de accesos en Golang y Python, correlacionando telemetría de BigQuery, APIs internas y almacenamiento cloud para auditar permisos y ejecutar protocolos preventivos de mitigación en toda la organización.
- Arquitecté pipelines de detección continua de fugas de información y minimización de datos PII mediante escaneos distribuidos sobre repositorios, commits y entornos de almacenamiento en Google Cloud, previniendo la exposición de credenciales y datos sensibles.
- Implementé controles de seguridad preventiva _Shift-Left_ mediante integraciones en hooks de pre-commit y pipelines de CI/CD, bloqueando proactivamente la fuga de secretos y garantizando la adherencia a políticas de seguridad antes del despliegue en producción.
- Automaticé la orquestación y respuesta a incidentes de seguridad integrando flujos de trabajo en n8n con microservicios en Go y scripts en Bash, optimizando la gestión de tickets y reduciendo significativamente la latencia operativa en la resolución de alertas críticas.

_Tecnologías:_ `Golang`, `Python`, `Bash`, `Google Cloud (GCP)`, `BigQuery`, `n8n`, `Docker`, `CI/CD (Hooks pre-commit)`, `Minimización PII`, `Zero-Trust`.

---

### **Imagemaker** — Remoto / Chile

**Software Engineer – Plataformas de Identidad & Confianza**  
_Diciembre 2023 – Agosto 2024_

- Diseñé microservicios de identificación y autorización digital en Golang y PostgreSQL para plataformas de confianza empresarial (SOVOS Trust-Services), mitigando riesgos de suplantación y fraude de identidad y garantizando cumplimiento normativo.
- Construí pipelines de autenticación y verificación biométrica multimodal, integrando reconocimiento facial, validaciones en tiempo real contra bases de datos gubernamentales y flujos dinámicos de preguntas de seguridad (Q&A).
- Implementé estándares de autenticación empresarial incluyendo protocolo OAuth2 y microservicios dinámicos de verificación OTP multicanal, garantizando alta disponibilidad y tolerancia a fallos durante procesos masivos de onboarding.

_Tecnologías:_ `Golang`, `PostgreSQL`, `OAuth2`, `OTP`, `Biometría`, `Microservicios`, `Cloud Computing`, `REST APIs`.

---

### **FYLD, Inc.** — Estados Unidos (Remoto)

**Co-Founder & Principal Engineer**  
_Mayo 2019 – Septiembre 2023_

- Diseñé y escalé una plataforma empresarial de atestiguamiento de datos (Data Witnessing) en Golang, gRPC, PostgreSQL y almacenamiento embebido (LevelDB, SQLite), generando pistas de auditoría inmutables para clientes corporativos.
- Implementé protocolos criptográficos de anclaje de estado basados en modelos UTXO de Bitcoin y árboles de Merkle, registrando compromisos matemáticamente verificables en redes distribuidas.
- Optimicé el rendimiento de cómputo criptográfico mediante instrucciones vectoriales SIMD de bajo nivel (Ensamblador/Go), acelerando operaciones de hashing SHA-256 sobre flujos de datos a gran escala.
- Desarrollé observabilidad de mutaciones de archivos a nivel de kernel interceptando inodos del sistema operativo (`inotify`), disparando notarizaciones criptográficas automáticas sin sobrecarga de sondeo en espacio de usuario.
- Lideré la dirección técnica, estándares de arquitectura, automatización de pipelines CI/CD y gestión segura del ciclo de vida de claves criptográficas en entornos zero-trust.

_Tecnologías:_ `Golang`, `gRPC`, `Bitcoin Script / UTXO`, `SIMD / Assembly`, `LevelDB`, `SQLite`, `PostgreSQL`, `Kernel de Linux (Inodos)`, `CI/CD`.

---

### **Cobuild Lab** — Miami, FL, Estados Unidos (Remoto)

**Backend Software Engineer**  
_Noviembre 2018 – Junio 2019_

- Diseñé un coordinador de colas de trabajo concurrentes en Golang con algoritmos de reloj de ventana rodante para regular la tasa de lectura/escritura en base de datos y eliminar contención de bloqueos bajo alto tráfico.
- Construí una herramienta CLI de alto rendimiento (`pex-cmd`) en Go (Cobra, Testify, Docker) para descompresión de streams GZIP/Deflate, procesamiento masivo y concurrente de archivos XML e ingesta hacia IBM Cloudant.
- Arquitecté y desplegué microservicios REST (`pex-retail-api`, `pex-awardwallet`) en Golang (Gin), Docker y Auth0 para búsqueda filtrada de productos, analítica de uso e integración de APIs de recompensas de terceros.

_Tecnologías:_ `Golang (Cobra, Gin)`, `IBM Cloudant`, `Docker`, `Auth0`, `Testify`, `DigitalOcean`, `IBM Cloud Foundry`.

---

### **Experiencia Previa**

- **Backend Engineer | PlazaETC** _(Oct 2018 – Dic 2018)_: Implementó plataformas de comercio electrónico multitienda en AWS, optimizando esquemas relacionales e índices en MySQL para rendimiento de consultas en catálogo.
- **Backend Software Engineer | 4Geeks Developers Community** _(Abr 2018 – Jul 2018)_: Construyó APIs REST de alto rendimiento para sistemas de referidos de productos utilizando Golang (Echo) y almacenamiento en caché de baja latencia con Aerospike NoSQL.
- **Desarrollador de Software | E.T.C.R Rómulo Gallegos** _(Dic 2017 – Mar 2018)_: Desarrolló "iRG App", plataforma web institucional de preinscripciones con backend en Golang, PostgreSQL, GraphQL y autenticación JWT desplegada en Heroku, además del portal web oficial responsivo de la institución.

---

## Educación & Certificaciones

- **Técnico Medio en Informática / Sistemas** | E.T.C.R Rómulo Gallegos (2012 – 2018)
