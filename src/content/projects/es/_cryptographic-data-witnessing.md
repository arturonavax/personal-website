---
title: "Plataforma de Notarización Criptográfica"
description: "Sistema distribuido de data witnessing en Go combinando modelos Bitcoin UTXO, árboles de Merkle y aceleración SIMD de SHA-256 para auditorías corporativas inmutables."
role: "Co-Founder & Principal Engineer"
company: "FYLD, Inc."
featured: true
order: 4
locale: "es"
translationKey: "cryptographic-data-witnessing"
techStack:
  - "Golang"
  - "Assembly (SIMD)"
  - "gRPC"
  - "Bitcoin / UTXO"
  - "Merkle Trees"
  - "Linux Inodes"
  - "LevelDB"
metrics:
  - label: "Aceleración de Throughput"
    value: "4.8x SIMD"
  - label: "Verificación de Estado"
    value: "O(log N)"
  - label: "Latencia de Consulta"
    value: "< 1ms"
searchKeywords:
  - "Blockchain"
  - "Bitcoin"
  - "SHA-256"
  - "SIMD"
  - "AVX2"
  - "Notarizacion"
---

## Desafío Arquitectural

Empresas de alta regulación requerían pruebas matemáticas inmutables de que sus documentos y estados de base de datos no sufrieron modificaciones a lo largo de ciclos de auditoría plurianuales, sin exponer el contenido sensible ni incurrir en costes prohibitivos de red.

## Solución de Ingeniería

- **Agregación mediante Árboles de Merkle:** Diseñé estructuras jerárquicas en Go que consolidan millones de eventos en un único hash raíz periódico anclado matemáticamente en la red Bitcoin.
- **Aceleración Vectorial SIMD:** Desarrollé rutinas en Assembly aprovechando registros AVX2/AVX-512 para paralelizar rondas criptográficas de SHA-256, logrando 4.8x mayor rendimiento frente a crypto/sha256 estándar.
- **Intercepción de Inodos en Linux:** Capturé mutaciones en el sistema de archivos mediante inotify a nivel de kernel, disparando notarizaciones automáticas sin sobrecarga de sondeo.
