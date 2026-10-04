---
title: "Designing Sub-50ms Fraud Detection in Go"
description: "How to engineer zero-allocation rule evaluation pipelines in Go using the Strategy Pattern and Redis sliding windows during point-of-sale checkout."
pubDate: 2026-02-15
draft: false
locale: "en"
translationKey: "sub-50ms-fraud-engine-go"
category: "systems"
tags:
  - "Golang"
  - "Distributed Systems"
  - "Low Latency"
  - "Clean Architecture"
searchKeywords:
  - "POS"
  - "Anti-Fraud"
  - "Redis"
  - "Concurrency"
  - "Zero-Allocation"
---

When engineering fraud detection pipelines for retail point-of-sale (POS) checkouts, the absolute latency ceiling is 100 milliseconds. Every millisecond consumed by fraud evaluation directly increases checkout line queues.

In this deep dive, we walk through the engineering decisions behind our Go-based anti-fraud engine, which achieved sub-50ms evaluation latencies across millions of daily operations.

## 1. The Strategy Pattern for Rule Composition

In high-concurrency microservices, rule engines often suffer from excessive reflection or complex abstract syntax trees (ASTs) that trigger dynamic allocations.

We adopted the Strategy Pattern with pre-allocated context structs:

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

By passing pointers to reusable context buffers, garbage collection pauses are minimized to sub-millisecond ranges.

## 2. Sliding Window Velocity Checks in Redis

Velocity anomalies (such as a cashier issuing 5 high-value loyalty redemptions within 60 seconds) require precise temporal counting.

Instead of heavy SQL count queries, we leveraged Redis sorted sets (`ZADD` and `ZREMRANGEBYSCORE`) executed in a single atomic pipeline.

## 3. Fail-Open Architecture

A core principle in critical checkout infrastructure is that a fraud engine must never take down the merchant's ability to transact. In the event of a cluster partition, the engine enters a deterministic fail-open mode while logging asynchronous recovery flags.
