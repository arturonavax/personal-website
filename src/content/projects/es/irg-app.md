---
title: "iRG App: Plataforma Institucional de Admisiones y Preinscripción"
description: "Plataforma de admisiones y preinscripciones escolares desarrollada en Go y GraphQL, con persistencia relacional en PostgreSQL y autenticación stateless mediante JWT."
role: "Software Engineer"
company: "E.T.C.R Rómulo Gallegos"
featured: true
order: 1
locale: "es"
translationKey: "irg-app"
techStack:
  - "Golang"
  - "GraphQL"
  - "PostgreSQL"
  - "Autenticación JWT"
  - "JavaScript (ES6+)"
  - "Heroku"
metrics:
  - label: "Sobrecarga de Datos"
    value: "Cero Over-fetching"
  - label: "Modelo de Autenticación"
    value: "JWT Stateless"
  - label: "Arquitectura de Despliegue"
    value: "100% Cloud-Native"
searchKeywords:
  - "GraphQL API"
  - "Backend Golang"
  - "PostgreSQL"
  - "Seguridad JWT"
  - "Admisiones Escolares"
  - "Ingeniería Full-Stack"
---

## Problema Arquitectónico

La institución dependía de procesos de admisión manuales basados en papel que saturaban la capacidad administrativa, incrementaban el margen de error en el registro de postulantes y generaban demoras críticas durante los picos de inscripción. Se requería una plataforma web centralizada y segura capaz de gestionar registros masivos de forma concurrente, optimizando el consumo de red en conexiones móviles o inestables.

## Solución de Ingeniería

- **Capa GraphQL de Alto Rendimiento:** Implementación de un microservicio en Golang con esquemas GraphQL optimizados para que el cliente solicite únicamente los campos requeridos, suprimiendo la sobrecarga de datos (over-fetching).
- **Identidad Stateless e Integridad Relacional:** Autenticación sin estado basada en JSON Web Tokens (JWT) y modelado relacional en PostgreSQL, asegurando transacciones atómicas e integridad referencial en los expedientes académicos.
- **Interfaz Responsiva e Instrumentación:** Desarrollo de una interfaz ligera en JavaScript nativo (HTML5/CSS3) instrumentada con analítica para monitorear tasas de conversión y erradicar puntos de abandono en los formularios.
- **Infraestructura Cloud:** Despliegue contenerizado en Heroku administrando variables de entorno seguras, aislamiento de credenciales y ejecución tolerante a fallos.
