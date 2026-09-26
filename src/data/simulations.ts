export interface SimulationMetric {
  name: string;
  nameEs: string;
  beforeValue: string;
  nowValue: string;
  improvement?: string;
  improvementEs?: string;
}

export interface SimulationStep {
  stepNumber: string;
  title: string;
  titleEs: string;
  detail: string;
  detailEs: string;
  log: string;
  durationMs: number;
}

export interface ArchitectureSimulation {
  id: string;
  name: string;
  scriptName: string;
  company: string;
  jobSlug: string;
  title: string;
  titleEs: string;
  description: string;
  descriptionEs: string;
  steps: SimulationStep[];
  metrics: SimulationMetric[];
}

export const simulationsData: ArchitectureSimulation[] = [];

/* TODO: reactivate
export const simulationsData: ArchitectureSimulation[] = [
  {
    id: "fraud-engine",
    name: "real-time-fraud-evaluation",
    scriptName: "fraud_strategy_runner.go",
    company: "Mercado Libre",
    jobSlug: "mercado-libre",
    title: "Sub-50ms Synchronous POS Fraud & Velocity Strategy Engine",
    titleEs: "Motor Antifraude POS y Evaluación de Velocidad en Sub-50ms",
    description:
      "Eliminated relational database row-locking timeouts by decoupling point-of-sale voucher validation into high-concurrency Redis rolling windows evaluated via Go worker pools.",
    descriptionEs:
      "Eliminación de cuellos de botella y bloqueos transaccionales desacoplando la validación de velocidad POS a ventanas deslizantes en Redis evaluadas por worker pools en Go.",
    steps: [
      {
        stepNumber: "01",
        title: "POS Ingestion",
        titleEs: "Ingesta POS",
        detail: "mTLS handshake & gateway verification",
        detailEs: "Handshake mTLS y verificación de gateway",
        log: "[INGEST] mTLS verified for POS terminal #7492-MX. Payload parsed in 1.1ms.",
        durationMs: 12,
      },
      {
        stepNumber: "02",
        title: "Redis Velocity Window",
        titleEs: "Ventana Redis",
        detail: "60s rolling transaction window check",
        detailEs: "Chequeo de ventana deslizante de 60s",
        log: "[REDIS] ZREVRANGEBYSCORE key:merchant:99482:velocity count=3. Returned in 3.4ms.",
        durationMs: 14,
      },
      {
        stepNumber: "03",
        title: "Strategy Evaluator",
        titleEs: "Evaluador Go",
        detail: "Zero-allocation sync.Pool rule pipeline",
        detailEs: "Pipeline de reglas sin alocaciones (sync.Pool)",
        log: "[STRATEGY] Evaluated 18 risk heuristics. RiskScore=0.038. Decision=ALLOW.",
        durationMs: 8,
      },
      {
        stepNumber: "04",
        title: "Async Audit Stream",
        titleEs: "Stream Auditoría",
        detail: "Non-blocking WAL stream commit",
        detailEs: "Commit de auditoría no bloqueante",
        log: "[AUDIT] Emitted transactional witness event. Response dispatched at 34ms.",
        durationMs: 5,
      },
    ],
    metrics: [
      {
        name: "POS Checkout Latency",
        nameEs: "Latencia Checkout POS",
        beforeValue: "1,840ms (P99 timeout risk)",
        nowValue: "34ms (Synchronous SLA)",
        improvement: "98.1% faster execution",
        improvementEs: "98.1% más rápido",
      },
      {
        name: "Operational DB Locking",
        nameEs: "Bloqueos en Base de Datos",
        beforeValue: "High contention (Row locks)",
        nowValue: "0% (100% Non-blocking)",
        improvement: "Eliminated DB contention",
        improvementEs: "Bloqueos eliminados",
      },
      {
        name: "Memory Allocation / Tx",
        nameEs: "Alocación de Memoria / Tx",
        beforeValue: "4.2 MB / transaction",
        nowValue: "0 B / op (sync.Pool)",
        improvement: "Zero-alloc execution",
        improvementEs: "Zero-allocación",
      },
      {
        name: "Sustained Throughput",
        nameEs: "Throughput Sostenido",
        beforeValue: "180 tx / sec",
        nowValue: "14,200 tx / sec",
        improvement: "78x capacity increase",
        improvementEs: "78x aumento de capacidad",
      },
    ],
  },
  {
    id: "biometric-trust",
    name: "biometric-identity-pipeline",
    scriptName: "biometric_identity_verifier.go",
    company: "Imagemaker",
    jobSlug: "imagemaker",
    title: "High-Concurrency Multi-Modal Biometric & Trust Pipeline",
    titleEs: "Pipeline Concurrente de Verificación Biométrica & Confianza",
    description:
      "Engineered mission-critical digital identity verification for SOVOS Trust-Services, unifying facial biometric challenge-response matching with government civil registries.",
    descriptionEs:
      "Ingeniería de plataforma de identidad digital de misión crítica para SOVOS Trust-Services, unificando biometría facial desafío-respuesta y validación de registros civiles.",
    steps: [
      {
        stepNumber: "01",
        title: "Facial Descriptors",
        titleEs: "Descriptores Faciales",
        detail: "Biometric vector quantization",
        detailEs: "Cuantización de vectores biométricos",
        log: "[BIOMETRIC] Extracted 512-dim facial embedding. Quality score: 0.994.",
        durationMs: 16,
      },
      {
        stepNumber: "02",
        title: "Registry Verification",
        titleEs: "Validación Registro",
        detail: "Secure government database lookup",
        detailEs: "Consulta segura a bases gubernamentales",
        log: "[GOV-SYNC] Certified government authority match verified in 45.2ms.",
        durationMs: 45,
      },
      {
        stepNumber: "03",
        title: "Dynamic OTP Challenge",
        titleEs: "Desafío OTP Dinámico",
        detail: "Multi-channel timed cryptographic token",
        detailEs: "Token criptográfico multicanal con expiración",
        log: "[OTP] Issued dynamic HMAC-SHA256 OTP challenge. Validation confirmed.",
        durationMs: 12,
      },
      {
        stepNumber: "04",
        title: "SOVOS Trust Witness",
        titleEs: "Firma de Confianza SOVOS",
        detail: "Electronic signature certificate seal",
        detailEs: "Sello y certificado de firma electrónica",
        log: "[SEAL] Issued cryptographic compliance receipt #SOVOS-99214.",
        durationMs: 14,
      },
    ],
    metrics: [
      {
        name: "Onboarding Pipeline Latency",
        nameEs: "Latencia Onboarding Total",
        beforeValue: "12.8s (Manual verification)",
        nowValue: "650ms (Automated stream)",
        improvement: "19.6x speedup",
        improvementEs: "19.6x más rápido",
      },
      {
        name: "Verification Throughput",
        nameEs: "Throughput de Verificación",
        beforeValue: "150 req / min (Queue drops)",
        nowValue: "8,500 req / min (Elastic)",
        improvement: "56x capacity boost",
        improvementEs: "56x mayor capacidad",
      },
      {
        name: "Identity Fraud Leakage",
        nameEs: "Tasa de Falsos Aceptados",
        beforeValue: "2.4% bypass vulnerability",
        nowValue: "0.001% (Zero false accepts)",
        improvement: "Regulatory grade trust",
        improvementEs: "Cumplimiento normativo",
      },
      {
        name: "DB Query Amplification",
        nameEs: "Amplificación de Consultas DB",
        beforeValue: "48 queries / session",
        nowValue: "2 queries (Redis L2 cache)",
        improvement: "95.8% DB offload",
        improvementEs: "95.8% alivio a la BD",
      },
    ],
  },
  {
    id: "snowflake-streaming",
    name: "snowflake-olap-sync",
    scriptName: "snowflake_event_streaming_sink.go",
    company: "Leal",
    jobSlug: "leal",
    title: "OLTP-to-OLAP Decoupling Stream with gosnowflake",
    titleEs: "Streaming Desacoplado de OLTP a OLAP vía gosnowflake",
    description:
      "Architected non-blocking asynchronous event ingestion pipeline pumping millions of retail loyalty interactions directly into Snowflake analytical warehouses.",
    descriptionEs:
      "Arquitectura de pipeline asíncrono no bloqueante que transmite millones de transacciones retail directamente al warehouse analítico de Snowflake.",
    steps: [
      {
        stepNumber: "01",
        title: "Kafka Partition Read",
        titleEs: "Lectura de Partición",
        detail: "High-throughput consumer group batch",
        detailEs: "Consumo por lotes de consumer group",
        log: "[KAFKA] Pulled 5,000 retail events from partition #4 in 0.8ms.",
        durationMs: 8,
      },
      {
        stepNumber: "02",
        title: "Parquet Compaction",
        titleEs: "Compactación Parquet",
        detail: "Snappy columnar ring-buffer encoding",
        detailEs: "Codificación columnar Snappy en memoria",
        log: "[ENCODE] Compressed 5,000 events into 142 KB Snappy Parquet block.",
        durationMs: 14,
      },
      {
        stepNumber: "03",
        title: "gosnowflake Micro-Batch",
        titleEs: "Micro-Batch gosnowflake",
        detail: "Direct PUT stream into Snowflake stage",
        detailEs: "Carga PUT directa a stage de Snowflake",
        log: "[SNOWFLAKE] Stage PUT successful. Copy status: LOADED 5,000 rows.",
        durationMs: 18,
      },
      {
        stepNumber: "04",
        title: "WAL Offset Commit",
        titleEs: "Commit de Offset",
        detail: "Zero data loss checkpointing",
        detailEs: "Confirmación de checkpoint sin pérdidas",
        log: "[CHECKPOINT] Offset committed. Zero impact on transactional Postgres DB.",
        durationMs: 4,
      },
    ],
    metrics: [
      {
        name: "Analytical Sync Lag",
        nameEs: "Retraso de Sincronización",
        beforeValue: "4.5 hours (Nightly batch ETL)",
        nowValue: "12 seconds (Near real-time)",
        improvement: "Instant BI visibility",
        improvementEs: "Visibilidad BI inmediata",
      },
      {
        name: "PostgreSQL CPU Utilization",
        nameEs: "Uso de CPU en PostgreSQL",
        beforeValue: "94% spikes (ETL lockup)",
        nowValue: "12% steady (100% offloaded)",
        improvement: "Zero operational locks",
        improvementEs: "Cero bloqueos operacionales",
      },
      {
        name: "Analytical Ingest Speed",
        nameEs: "Velocidad de Ingesta Analítica",
        beforeValue: "450 events / sec",
        nowValue: "85,400 events / sec",
        improvement: "189x throughput gain",
        improvementEs: "189x mayor throughput",
      },
      {
        name: "Storage Footprint",
        nameEs: "Consumo de Almacenamiento",
        beforeValue: "1.8 TB (Uncompressed JSON)",
        nowValue: "210 GB (Columnar Snappy)",
        improvement: "88.3% storage reduction",
        improvementEs: "88.3% ahorro de espacio",
      },
    ],
  },
  {
    id: "edge-safety-inference",
    name: "edge-predictive-safety",
    scriptName: "field_safety_inference_stream.py",
    company: "FYLD",
    jobSlug: "fyld",
    title: "Edge Predictive Safety & Computer Vision Risk Inference",
    titleEs: "Inferencia Predictiva de Riesgos de Campo y Visión Computacional",
    description:
      "Engineered real-time hazard detection pipeline evaluating high-resolution field video streams to detect safety violations across utility and power worksites.",
    descriptionEs:
      "Pipeline de detección de peligros en tiempo real que evalúa video de campo de alta resolución para detectar riesgos en infraestructuras críticas.",
    steps: [
      {
        stepNumber: "01",
        title: "Frame Quantization",
        titleEs: "Cuantización de Cuadros",
        detail: "Edge stream downsampling & normalization",
        detailEs: "Normalización y reducción de frames en edge",
        log: "[INGEST] Normalized 60fps feed to 15fps quantized tensor in 3.1ms.",
        durationMs: 10,
      },
      {
        stepNumber: "02",
        title: "Object & PPE Detection",
        titleEs: "Detección EPP & Objetos",
        detail: "YOLO/MobileNet bounding box inference",
        detailEs: "Inferencia de cajas delimitadoras en tiempo real",
        log: "[VISION] Identified 4 workers, 1 trench excavator, missing hardhat.",
        durationMs: 22,
      },
      {
        stepNumber: "03",
        title: "Hazard Risk Scoring",
        titleEs: "Calificación de Riesgo",
        detail: "Spatial proximity risk heuristic engine",
        detailEs: "Motor heurístico de proximidad espacial",
        log: "[RISK] Proximity violation detected (Worker < 1.5m to active machinery).",
        durationMs: 8,
      },
      {
        stepNumber: "04",
        title: "Real-time Alert Broadcast",
        titleEs: "Emisión de Alerta",
        detail: "Sub-second notification to site manager",
        detailEs: "Notificación sub-segundo al supervisor de obra",
        log: "[ALERT] Critical audio & haptic alert dispatched to on-site handhelds.",
        durationMs: 6,
      },
    ],
    metrics: [
      {
        name: "Video Inference Latency",
        nameEs: "Latencia Inferencia de Video",
        beforeValue: "3,400ms (Cloud roundtrip)",
        nowValue: "26ms (Edge inference)",
        improvement: "Real-time prevention",
        improvementEs: "Prevención en tiempo real",
      },
      {
        name: "Hazard Detection SLA",
        nameEs: "SLA Detección de Peligros",
        beforeValue: "Manual audits (Hours)",
        nowValue: "< 2 seconds alert SLA",
        improvement: "Instant site safety",
        improvementEs: "Seguridad instantánea",
      },
      {
        name: "Bandwidth Consumption",
        nameEs: "Consumo de Ancho de Banda",
        beforeValue: "24 MB / min (Raw streams)",
        nowValue: "80 KB / min (Vector metadata)",
        improvement: "99.6% bandwidth saving",
        improvementEs: "99.6% ahorro de ancho de banda",
      },
      {
        name: "Offline Field Reliability",
        nameEs: "Confiabilidad Fuera de Línea",
        beforeValue: "0% (Fails without cellular)",
        nowValue: "100% (Local queue daemon)",
        improvement: "Zero loss in dead zones",
        improvementEs: "Cero pérdidas sin señal",
      },
    ],
  },
];
*/

export function getSimulationsForJob(
  jobSlug: string,
): ArchitectureSimulation[] {
  const cleanSlug = jobSlug.toLowerCase().trim();
  return simulationsData.filter(
    (sim) => sim.jobSlug.toLowerCase().trim() === cleanSlug,
  );
}

export function getSimulationCountForJob(jobSlug: string): number {
  return getSimulationsForJob(jobSlug).length;
}

export function getRandomSimulation(
  excludeId?: string,
): ArchitectureSimulation {
  const available = excludeId
    ? simulationsData.filter((s) => s.id !== excludeId)
    : simulationsData;
  const pool = available.length > 0 ? available : simulationsData;
  const index = Math.floor(Math.random() * pool.length);
  const sim = pool[index] ?? simulationsData[0];
  if (!sim) {
    throw new Error("No architecture simulations available");
  }
  return sim;
}
