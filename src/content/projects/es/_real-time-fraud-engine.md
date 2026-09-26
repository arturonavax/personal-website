---
title: "Motor Antifraude en Tiempo Real"
description: "Motor de detección de fraude de alto throughput en Go que evalúa operaciones de checkout POS en menos de 50ms mediante Strategy Pattern y ventanas de velocidad."
role: "Lead Platform Architect"
company: "Leal"
featured: true
order: 1
locale: "es"
translationKey: "real-time-fraud-engine"
techStack:
  - "Golang"
  - "AWS DynamoDB"
  - "Redis"
  - "Clean Architecture"
  - "Goroutines"
metrics:
  - label: "Latencia en Checkout"
    value: "< 50ms"
  - label: "Evaluaciones Diarias"
    value: "Millones"
  - label: "Reducción de Falsos Positivos"
    value: "38%"
searchKeywords:
  - "POS"
  - "Antifraude"
  - "Strategy Pattern"
  - "Ventana Movil"
  - "Checkout"
---

## Desafío Arquitectural

El fraude en puntos de venta durante el checkout genera pérdidas directas, particularmente por colusión de cajeros y redenciones sucesivas no autorizadas. Evaluar cadenas de reglas de forma sincrónica sin exceder el estricto umbral de 100ms exigía un pipeline no bloqueante y eficiente en memoria.

## Solución de Ingeniería

- **Motor basado en Strategy Pattern:** Construí un pipeline modular de evaluación en Go donde las reglas operan concurrentemente sobre ventanas deslizantes almacenadas en Redis y DynamoDB.
- **Normalización Multizona (FlexibleTime):** Diseñé una abstracción temporal inmutable que armoniza marcas de tiempo locales del comercio con logs operacionales en UTC.
- **Tolerancia a Fallos Fail-Open:** Implementé circuit breakers con heurísticas de respaldo que aseguran que las filas de cobro en tiendas físicas nunca se detengan ante particiones de red.
