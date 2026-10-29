# Home scroll and Matrix regression
Branch: `fix/home-scroll-matrix-regression`. Scope: local rendering and evidence; no push or deployment.

## Specs
1. S1 — "El downgrade de la animacion de fondo no tuvo ningun efecto en la visualizacion de esta maquina, refina el detector de fallos graficos o algo asi, ya que incluso el scroll ahora se ve mas trabado"
2. S2 — "(El peor problema de rendimiento se ve es en la pagina principal)"
3. S3 — "Portada y detector (recomendado)" — "Investigar y corregir la pausa de Layout de Experience; verificar scroll y carga inicial, además del detector."

## Tasks
- [ ] T1 (S1; inline; commit: pending) Reproduce and refine the Matrix scroll detector with focused regression and route benchmarks.
- [ ] T2 (S2-S3; inline; commit: pending) Identify and address home Experience layout pause without breaking navigation, content, or initial loading.
- [ ] T3 (S1-S3; inline; commit: pending) Run focused/full checks and local hardware comparisons, then record bounded evidence and close.

## Log
- L1 — El downgrade de la animacion de fondo no tuvo ningun efecto en la visualizacion de esta maquina, refina el detector de fallos graficos o algo asi, ya que incluso el scroll ahora se ve mas trabado
- L2 — (El peor problema de rendimiento se ve es en la pagina principal)
- L3 — Portada y detector (recomendado) — Investigar y corregir la pausa de Layout de Experience; verificar scroll y carga inicial, además del detector.
- L4 — Baseline on local headful Chromium NVE4/Mesa: /projects/ Matrix active p95 ~33 ms versus ~17 ms disabled with p75 ~17 ms in both; homepage experienced a main-thread Layout task ~150 ms in the Experience region even with Matrix disabled. These are local observations, not physical-display FPS or production proof.
