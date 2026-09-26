---
title: "Zero-Trust Access Governance Engine"
description: "Internal security risk evaluation platform correlating BigQuery cloud telemetry to enforce least-privilege IAM policies and automated secret detection."
role: "Senior Backend Security Engineer"
company: "Mercado Libre"
featured: true
order: 3
locale: "en"
translationKey: "zero-trust-governance-engine"
techStack:
  - "Golang"
  - "Python"
  - "Google BigQuery"
  - "GCP IAM"
  - "n8n"
  - "Docker"
metrics:
  - label: "Monitored Repositories"
    value: "10,000+"
  - label: "Triage Time Reduction"
    value: "75%"
  - label: "Policy Automation Rate"
    value: "99.4%"
searchKeywords:
  - "Meli"
  - "Mercado Pago"
  - "IAM"
  - "Zero-Trust"
  - "Shift-Left"
  - "Secret Scanning"
---

## Architectural Problem

Maintaining least-privilege access governance and preventing credential leakages across thousands of microservices and multi-cloud infrastructure accounts requires continuous automated scanning without degrading developer velocity.

## Engineering Solution

- **Telemetry Correlation:** Built a Go ingestion service that maps GCP cloud asset inventory and BigQuery audit logs into permission graph models.
- **Continuous Secret Detection:** Designed distributed scanners that inspect commit streams and bucket storage for exposed credentials and PII data patterns.
- **Automated Incident Orchestration:** Interfaced n8n workflows with custom Go microservices to automatically revoke rogue tokens and file remediation tickets.
