---
title: "Motor de Gobernanza y Acceso Zero-Trust"
description: "Plataforma interna de evaluación de riesgos de seguridad que correlaciona telemetría en BigQuery para aplicar políticas de mínimo privilegio y detección de secretos."
role: "Senior Backend Security Engineer"
company: "Mercado Libre"
featured: true
order: 3
locale: "es"
translationKey: "zero-trust-governance-engine"
techStack:
  - "Golang"
  - "Python"
  - "Google BigQuery"
  - "GCP IAM"
  - "n8n"
  - "Docker"
metrics:
  - label: "Repositorios Monitoreados"
    value: "+10,000"
  - label: "Reducción de Tiempo de Triaje"
    value: "75%"
  - label: "Tasa de Mitigación Automática"
    value: "99.4%"
searchKeywords:
  - "Meli"
  - "Mercado Pago"
  - "IAM"
  - "Zero-Trust"
  - "Shift-Left"
  - "Secret Scanning"
---

## Desafío Arquitectural

Mantener la gobernanza de accesos de mínimo privilegio y prevenir filtraciones de credenciales en miles de microservicios e infraestructuras multi-cloud exige auditorías continuas sin ralentizar el flujo de trabajo de los equipos de desarrollo.

## Solución de Ingeniería

- **Correlación de Telemetría:** Construí un servicio en Go que transforma el inventario de recursos de GCP y logs de BigQuery en grafos de permisos y niveles de riesgo.
- **Detección Continua de Secretos:** Implementé escáneres distribuidos que analizan commits y buckets de almacenamiento para identificar credenciales expuestas y patrones de datos PII.
- **Orquestación de Incidentes:** Integré flujos en n8n con microservicios en Go para revocar tokens comprometidos y gestionar tickets de remediación de forma automatizada.
