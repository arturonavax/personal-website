---
title: "FYLD: Plataforma Empresarial de Notarización y Atestiguamiento Criptográfico"
description: "Plataforma de atestiguamiento de datos en Go combinando modelos UTXO/Bitcoin, hashing SHA-256 acelerado con SIMD y observabilidad de inodos a nivel de kernel para auditorías inmutables."
role: "Co-Founder & Principal Engineer"
company: "FYLD, Inc."
featured: true
order: 2
locale: "es"
translationKey: "fyld"
techStack:
  - "Golang"
  - "gRPC"
  - "Bitcoin / UTXO"
  - "Assembly (SIMD)"
  - "Inodos Linux"
  - "PostgreSQL"
  - "LevelDB / SQLite"
metrics:
  - label: "Aceleración de Hashing"
    value: "SIMD Vectorizado"
  - label: "Detección de Archivos"
    value: "Cero Polling (Inodos)"
  - label: "Arquitectura de Persistencia"
    value: "Híbrida Embebida + SQL"
searchKeywords:
  [
    "Blockchain",
    "Bitcoin UTXO",
    "SHA-256",
    "SIMD",
    "Assembly",
    "Inodos de Kernel",
    "Notarización Criptográfica",
    "Go gRPC",
  ]
---

## Problema Arquitectónico

Los entornos corporativos requerían pruebas matemáticas e inmutables que demostraran que sus documentos operativos, bitácoras de auditoría y estados transaccionales no habían sido alterados a lo largo del tiempo. Las soluciones convencionales dependían de sellos de tiempo centralizados vulnerables a manipulación o resultaban inviables por los altos costos y latencias de interactuar individualmente contra redes distribuidas.

## Solución de Ingeniería

- **Persistencia Híbrida y Microservicios de Alto Rendimiento:** Diseño e implementación de microservicios en Go (Gin y gRPC) desacoplados con una arquitectura de almacenamiento dual: PostgreSQL para metadatos relacionales y motores embebidos de baja latencia (LevelDB y SQLite) para flujos de alta frecuencia de I/O.
- **Anclaje UTXO y Aceleración por Hardware:** Anclaje de compromisos de estado (state commitments) sobre redes basadas en el modelo UTXO y Bitcoin Script. Eliminación de cuellos de botella de procesamiento mediante el desarrollo de rutinas en Assembly con instrucciones vectoriales SIMD para el cálculo paralelo de SHA-256.
- **Observabilidad de Ficheros a Nivel de Kernel:** Detección de mutaciones de archivos en tiempo real interceptando eventos de inodos a nivel de kernel de Linux, eliminando el consumo innecesario de cómputo derivado del sondeo continuo (polling) en espacio de usuario.
- **Gobernanza Criptográfica y Entrega Continua:** Implementación de esquemas seguros de custodia y ciclo de vida de claves criptográficas, validación bajo arquitectura Zero-Trust y automatización de pipelines de CI/CD para despliegues empresariales.
