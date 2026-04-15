# Architecture Notes

## Applied patterns

- **BFF-style API**: Next.js Route Handlers (`app/api/*`) act as a backend-for-frontend.
- **Defensive validation pipeline**:
  - request size guard,
  - schema-like validation of payload shape and bounds,
  - conflict validation right before write.
- **Concurrency guard**:
  - write critical section via lock file,
  - conflict check inside the lock before commit.
- **Operational resilience**:
  - health endpoint,
  - rate limiting,
  - no-store API responses,
  - Kubernetes probes and HPA.

## Runtime flow (POST /api/pixels)

1. Request enters route handler.
2. Rate limit check.
3. Payload and business-rule validation (rectangle, range, duplicates).
4. Enter write lock.
5. Re-read current data and detect conflicts.
6. Write new state atomically.
7. Return success or 409 conflict.

## Security controls

- Security headers in `next.config.ts`.
- Input validation and body-size cap.
- Per-IP rate limiting.
- Conflict-safe write path.

## Scale strategy

- Horizontal scaling via `Deployment` + `HPA`.
- Rolling updates and disruption budget via `PDB`.
- Ingress-level request limits.

## Recommended next step for very high scale

Migrate state from file storage to transactional SQL (PostgreSQL) and implement:

- row-level or advisory locks,
- unique constraints for pixel ownership,
- idempotency keys for purchase flow,
- outbox/event-based processing for payments.
