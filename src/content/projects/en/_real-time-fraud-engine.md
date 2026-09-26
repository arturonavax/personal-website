---
title: "Real-Time Anti-Fraud Engine"
description: "High-throughput fraud detection engine in Go evaluating POS checkout operations in under 50ms using Strategy Pattern and rolling velocity windows."
role: "Lead Platform Architect"
company: "Leal"
featured: true
order: 1
locale: "en"
translationKey: "real-time-fraud-engine"
techStack:
  - "Golang"
  - "AWS DynamoDB"
  - "Redis"
  - "Clean Architecture"
  - "Goroutines"
metrics:
  - label: "Checkout Latency"
    value: "< 50ms"
  - label: "Daily Evaluation Volume"
    value: "Millions"
  - label: "False Positive Reduction"
    value: "38%"
searchKeywords:
  - "POS"
  - "Anti-Fraud"
  - "Strategy Pattern"
  - "Sliding Window"
  - "Checkout"
---

## Architectural Problem

Retail loyalty fraud during point-of-sale checkout causes direct financial leakage, especially cashier collusion and rapid consecutive voucher redemptions. Evaluating rule chains synchronously without exceeding the strict 100ms merchant POS threshold required a non-blocking, zero-allocation pipeline.

## Engineering Solution

- **Strategy Pattern Engine:** Built a modular evaluation pipeline in Go where rules execute concurrently against an in-memory sliding window state backed by Redis and DynamoDB.
- **Cross-Timezone Normalization (FlexibleTime):** Designed an immutable time abstraction normalizing merchant local transaction timestamps against UTC operational logs.
- **Fail-Open Fault Tolerance:** Implemented circuit breakers with fallback heuristics ensuring that even during downstream network partitions, retail checkout lines are never blocked.
