---
phase: 15-deploy-and-live-baseline
plan: 01
status: completed
completed_at: "2026-05-28"
commits:
  - d1ebe52 fix: increase Node.js heap to 512MB in nixpacks.toml (OOM fix)
  - 5154c51 chore(15): baseline_v5.json live-prod + DELTA.md
  - 55880bb chore(15): baseline_p3 post-reanalysis — positions 4%→60.8%, brands 64%→74.6%
  - f07c265 chore(15): baseline_v6.json — post-reanalysis both projects
---

# Plan 15-01 Summary — Deploy + Live Baseline

## What was done

1. **Deploy**: `git push origin main` → Railway auto-deployed v1.1 code
2. **OOM fix**: `nixpacks.toml` 256MB→512MB heap (Dockerfile уже имел 512MB, nixpacks — нет)
3. **Smoke-check**: `/railway-health` → ok:true, `/api/auth/login` → token OK
4. **baseline_v5.json**: live-prod, n=300, seed=42 (до переанализа — старые анализы + новый audit)
5. **Переанализ**: project-3 и project-4 переанализированы с новым кодом v1.1
6. **baseline_p3_postreanalysis.json**: project-3 только, n=130 — positions 60.8%
7. **baseline_v6.json**: оба проекта, n=300, seed=42, post-reanalysis
8. **DELTA.md**: delta v1→v6 по всем 8 полям

## Key Metrics: v1 → v6 delta

| Field | v1 noise_free | v6 noise_free | Δ |
|-------|--------------|--------------|---|
| positions | 0% | 50.3% | **+50.3pp** 🏆 |
| article | 71.3% | 77.7% | **+6.4pp** ✅ |
| qty | -23% | +4% | **+27pp** ✅ |
| product_name | 71% | 71% | 0 |
| phone | 74.3% | 75.7% | +1.4pp |
| fio | 91.3% | 87.7% | -3.6pp |
| brand | 48.3% | 45.3% | -3pp |
| inn | 35.7% | 34.7% | -1pp |

## v1.3 Priority Decision

Поля с наибольшим потенциалом улучшения:
1. **INN** (34.7%) — низкий из-за checksum-валидации (старые невалидные ИНН → null); нужно лучшее извлечение
2. **brand.noise_free** (45.3%) — ghost brands всё ещё есть
3. **FIO** (87.7%) — небольшое падение, нужно исследовать причины
