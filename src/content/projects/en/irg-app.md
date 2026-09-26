---
title: "iRG App: Institutional Admissions & Pre-Enrollment Platform"
description: "Cloud-hosted admissions and pre-enrollment platform engineered in Go and GraphQL with PostgreSQL persistence and stateless JWT authentication."
role: "Software Engineer"
company: "E.T.C.R Rómulo Gallegos"
featured: true
order: 1
locale: "en"
translationKey: "irg-app"
techStack:
  - "Golang"
  - "GraphQL"
  - "PostgreSQL"
  - "JWT Authentication"
  - "JavaScript (ES6+)"
  - "Heroku"
metrics:
  - label: "Data Transfer Overhead"
    value: "Zero Over-fetching"
  - label: "Authentication Model"
    value: "Stateless JWT"
  - label: "Deployment Architecture"
    value: "100% Cloud-Native"
searchKeywords:
  - "GraphQL API"
  - "Golang Backend"
  - "PostgreSQL"
  - "JWT Security"
  - "Institutional Admissions"
  - "Full-Stack Engineering"
---

## Architectural Problem

The institution relied on manual, paper-intensive admission procedures that created administrative bottlenecks, high error rates in applicant tracking, and slow response times during annual enrollment peaks. The system required a centralized, secure web application capable of processing candidate submissions concurrently while strictly eliminating payload over-fetching on constrained client connections.

## Engineering Solution

- **High-Performance GraphQL Layer:** Engineered a clean backend service in Golang exposing an optimized GraphQL schema, allowing clients to query precise applicant attributes and eliminating redundant payload over-fetching.
- **Stateless Identity & Relational Integrity:** Enforced token-based stateless authentication using JSON Web Tokens (JWT) and modeled structured relational schemas in PostgreSQL to guarantee strict referential integrity for sensitive academic and personal records.
- **Conversion-Focused Interface & Telemetry:** Built a zero-dependency responsive interface in vanilla JavaScript, semantic HTML5, and CSS3, instrumented with telemetry to identify and eliminate form abandonment drop-offs.
- **Automated Cloud Infrastructure:** Deployed the application to Heroku with dynamic environment configuration, secret isolation, and zero-downtime application process management.
