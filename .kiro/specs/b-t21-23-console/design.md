# Design

React 19 + TypeScript + Vite, plain CSS, no UI library, no router (role decides the screen).

- `src/auth.ts`: PKCE, token exchange at `https://<CognitoDomain>/oauth2/token`, in-memory session. Only the one-time verifier and state use `sessionStorage`.
- `src/api.ts`: typed client over `contracts/api`, presigned POST upload (fields first, file last).
- `src/Customer.tsx`, `src/Adjuster.tsx`: the two screens.
- `vite.config.ts`: `loadEnv(mode)` reads `.env.<stage>` and injects `ApiUrl`, `AppClientId`, `CognitoDomain` as build-time constants. The build fails if one is missing.
- Deploy: `npm run outputs -- <stage>`, `STAGE=<stage> npm run build -w frontend`, `cdk deploy Web`. The Web stack uploads `frontend/dist`.
- CORS: the CloudFront origin is listed in `consoleOrigins` of the stage config (API CORS and evidence bucket CORS).
- Verified by `tests/e2e/console-ui.mjs` (puppeteer, headless Chrome).
