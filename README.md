# ZEROFAYYZ FINTECH

## Cloud Payments & Operations Platform

**Portfolio Prototype — Sandbox Only**

ZEROFAYYZ FINTECH is a portfolio platform under the ZEROFAYYZ STUDIOS name. It demonstrates modern full-stack engineering, payment processing, transaction tracking, cloud deployment, testing, and operational documentation.

## Primary Goal

Build and deploy a focused, recruiter-ready MVP quickly. Future technologies have reserved locations but are not required before the first job application.

## Recruiter-Ready MVP

The first working release will include:

- Next.js web application
- User authentication
- User dashboard
- Admin dashboard
- PostgreSQL database
- Transaction history
- Stripe sandbox payment flow
- Stripe webhook processing
- Payment-status updates
- Basic audit logging
- Automated tests
- Docker-based local development
- Public deployment
- Clear architecture and setup documentation

## Future Expansion

Reserved placeholders exist for:

- React Native mobile application
- MongoDB-backed activity events
- Solidity smart contracts
- Go services or blockchain integration
- Cloud infrastructure automation
- CI/CD workflows
- Gabriel or AI-assisted background workers

These features are intentionally outside the first MVP unless later promoted into scope.

## Project Structure

```text
apps/
  web/                 Next.js web app and admin dashboard
  api/                 Backend API
  mobile/              Future React Native app

packages/
  shared-types/        Shared TypeScript contracts

services/
  activity-log/        Future MongoDB activity-event service
  gabriel-worker/      Future AI/Gabriel worker

database/
  postgres/            Relational database migrations and seeds
  mongodb/             Future document-database material

integrations/
  stripe/              Stripe sandbox integration
  webhooks/            External webhook handling

infrastructure/
  docker/              Local container configuration
  cloud/               Future deployment infrastructure
  ci/                  Future automated build and test workflows

contracts/
  solidity/            Future Solidity contracts
  go/                  Future Go components

tests/
  unit/                Focused component and function tests
  integration/         API, database, and payment integration tests
  e2e/                 Browser-level user-flow tests

docs/
  architecture/        System design and diagrams
  runbooks/            Setup, deployment, and recovery instructions
  decisions/           Architecture decision records
  portfolio/           Recruiter-facing case-study material
```

## Current Status

The project skeleton and recruiter-facing Next.js dashboard are complete. A real Fastify API serves `GET /api/v1/health`, PostgreSQL 18.4 runs through Docker with the initial financial schema, and the dashboard displays both live readiness results. Stripe sandbox payments and verified webhooks remain the next implementation milestones.
