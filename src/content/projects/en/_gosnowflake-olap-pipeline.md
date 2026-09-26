---
title: "Decoupled OLAP Marketing Pipeline"
description: "High-throughput streaming ingestion pipeline in Go integrating native Snowflake drivers to offload heavy analytical queries from transactional databases."
role: "Senior Backend Engineer"
company: "Leal"
featured: true
order: 2
locale: "en"
translationKey: "gosnowflake-olap-pipeline"
techStack:
  - "Golang"
  - "Snowflake (gosnowflake)"
  - "PostgreSQL"
  - "SQL"
  - "AWS SQS"
  - "Worker Pools"
metrics:
  - label: "Daily Event Stream"
    value: "10M+ Events"
  - label: "OLTP CPU Offload"
    value: "64%"
  - label: "Dashboard Query Speed"
    value: "10x Faster"
searchKeywords:
  - "OLAP"
  - "Data Warehouse"
  - "ETL"
  - "Streaming"
  - "Snowflake"
  - "SQL"
  - "PostgreSQL"
---

## Architectural Problem

High-concurrency merchant reporting dashboards were running analytical aggregations directly against PostgreSQL OLTP replicas, causing CPU spikes, lock contention, and degraded transactional throughput during campaign pushes.

## Engineering Solution

- **Asynchronous Worker Pools:** Streamed marketing interaction events (dispatches, opens, clicks, ROI attribution) through AWS SQS into bounded Go worker pools.
- **Native gosnowflake Driver Integration:** Batched events in memory and pushed compressed Arrow/columnar blocks directly into Snowflake data warehouse staging tables.
- **OLTP Isolation:** 100% decoupling achieved; merchant reporting queries execute strictly against Snowflake views without consuming transactional read capacity.
