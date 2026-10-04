---
title: "Diseño de Motores Antifraude Sub-50ms en Go"
description: "Cómo construir pipelines de evaluación en Go con cero alocaciones dinámicas mediante Strategy Pattern y ventanas deslizantes en Redis para terminales POS."
pubDate: 2026-02-15
draft: false
locale: "es"
translationKey: "sub-50ms-fraud-engine-go"
category: "systems"
tags:
  - "Golang"
  - "Sistemas Distribuidos"
  - "Baja Latencia"
  - "Clean Architecture"
searchKeywords:
  - "POS"
  - "Antifraude"
  - "Redis"
  - "Concurrencia"
  - "Zero-Allocation"
---

Al diseñar pipelines de detección de fraude para puntos de venta minoristas (POS), el techo absoluto de latencia es de 100 milisegundos. Cada milisegundo extra consumido por la evaluación del motor incrementa el tiempo de espera en las cajas de cobro.

En este artículo analizamos las decisiones de arquitectura detrás de nuestro motor en Go, que alcanzó tiempos de respuesta inferiores a 50ms sobre millones de operaciones diarias.

## 1. Patrón Strategy para Composición de Reglas

En microservicios de alta concurrencia, los motores de reglas suelen degradarse debido al uso excesivo de reflexión o árboles sintácticos dinámicos (ASTs) que saturan el recolector de basura (GC).

Adoptamos el Strategy Pattern con structs de contexto prealocados:

```go
type EvaluationContext struct {
    MerchantID string
    CashierID  string
    Amount     int64
    Timestamp  time.Time
}

type FraudRule interface {
    Evaluate(ctx *EvaluationContext, state *WindowState) (Score, error)
}
```

Al pasar referencias a buffers de contexto reutilizables, las pausas del GC se reducen al rango sub-milisegundo.

## 2. Detección de Velocidad con Ventanas en Redis

Las anomalías de velocidad (como un cajero redimiendo múltiples cupones de alto valor en 60 segundos) exigen contadores temporales estrictos.

En lugar de pesadas consultas `COUNT(*)` en bases relacionales, empleamos conjuntos ordenados de Redis (`ZADD` y `ZREMRANGEBYSCORE`) ejecutados dentro de un pipeline atómico.

## 3. Arquitectura Fail-Open

Un principio innegociable en infraestructuras de pago es que el motor antifraude jamás debe bloquear la capacidad de cobrar del comercio. Ante una partición de red, el sistema adopta una política determinista fail-open mientras registra banderas de auditoría asíncronas.
