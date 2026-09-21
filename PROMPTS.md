# AI Prompt History

AI assistant: **Claude Code** (Claude Opus 5), desktop app. Development date: **2026-09-21**.

Entries are marked **[exact]** when the prompt is copied verbatim, or **[summary]** when condensed.
Only prompts actually sent during development are listed.

---

## Prompt 1 — Ideation, architecture and full implementation brief

- **Date:** 2026-09-21
- **Purpose:** Project ideation, architecture, setup, backend, frontend, LLM integration, memory, workflow, testing and deployment prep.
- **Type:** [summary] (the original is long; key content kept)

> Act as a senior full-stack AI engineer, Cloudflare developer, UI/UX designer, and technical mentor. I have been given a project assignment as part of a recruitment process… an AI-powered application containing: (1) an LLM, preferably Llama 3.3 on Workers AI; (2) workflow/coordination using Workflows, Workers or Durable Objects; (3) user input via chat or voice; (4) memory or state.
> Study the official Cloudflare Agents docs first… Evaluate 3 original, feasible AI application ideas… prefer actual agentic behavior, not simply a chatbot… Use a modern TypeScript stack… The application must include real LLM calls, a well-designed system prompt, multi-step workflow with progress and retries, a polished responsive UI with streaming, and persistent memory restored after refresh… Create PROMPTS.md and keep it updated… Do not deploy without my confirmation… Provide README, architecture diagram, requirement mapping, test results, file list and a submission checklist.

**Result:**
- Read the Agents SDK API reference and the Llama 3.3 model page; checked current package versions (`agents` 0.24, `wrangler` 4.135, Vite 8, `@cloudflare/vite-plugin` 1.56).
- Proposed 3 ideas (interview-prep agent, incident postmortem drafter, meal planner) and picked **Mockingbird**, the interview-prep agent.
- Built the whole app:
  - `PrepAgent`: a Durable Object on the Agents SDK with SQLite chat history and synced state.
  - `PrepWorkflow`: a 4-step Cloudflare Workflow with per-step retries.
  - Workers AI wrapper with JSON mode and streaming.
  - Validators for model output.
  - React UI with a live progress view, streamed chat and per-answer grading.
  - Vitest unit tests, README and this file.
- Debugging along the way:
  - A shell heredoc failed on quoting, so files were written directly.
  - Vitest picked up the Cloudflare Vite plugin, so it got its own `vitest.config.ts`.
  - Local dev needs `wrangler login`, because Workers AI always runs remotely.

---

## Prompt 2 — Cloudflare login for local development

- **Date:** 2026-09-21
- **Purpose:** Setup / unblock local testing.
- **Type:** [exact] reply to the assistant's question "Have you run `npx wrangler login`?"

> how to do it

**Result:** The assistant ran `npx wrangler login`, which opened Cloudflare's OAuth page in the browser, and I clicked Allow. Login was confirmed with `wrangler whoami`. No credentials were shared in chat.

---

## Work done after Prompt 2 (no new prompts; continuation of Prompt 1)

These steps follow from the original brief ("run the application locally, test the main user journeys and fix errors"):

- **Testing:** curl tests of validation (400/404/409), a live streamed chat, and 5 Workflow runs; browser tests of the plan flow, a refresh mid-workflow, grading, hints, persistence after refresh, an injected network failure with Retry, Start over, and the mobile layout.
- **Bug found and fixed:** in JSON-schema mode, Llama returned `{"gaps":[],"strengths":[]}` repeatedly for one input, so the Workflow failed after all retries. Fix: `minItems` constraints in the schemas, plus a free-form fallback call (schema in the prompt, `extractJson`) before the step retries. The same input then passed 2/2 times.
- **UX fixes:** grading verdicts were cut off mid-word, so they're now limited to one short sentence with a word-boundary ellipsis. Raw "Failed to fetch" errors are now a friendly message.
- **Verified:** a dev hot reload that cut an in-flight Workers AI call showed that the server rolls back the user message on failure.
- **Deployment prep:** `wrangler deploy --dry-run` passed. README with architecture diagram, requirement mapping, test results and troubleshooting.

---

## Prompt 3 — Status check

- **Date:** 2026-09-21
- **Purpose:** Confirm completion status.
- **Type:** [exact]

> is it done?

**Result:** Status summary only; no code changes. Built and tested locally; deployment pending approval.

---

## Prompt 4 — Deploy time estimate

- **Date:** 2026-09-21
- **Type:** [exact]

> how much time does it take to deploy

**Result:** Explanation only; no changes.

---

## Prompt 5 — Requirements audit

- **Date:** 2026-09-21
- **Type:** [summary] (pasted the official assignment text)

> check if all the requirements are been completed? also have you used all the things? [followed by the assignment text: LLM, Workflow/coordination, user input via chat or voice, memory or state, prompt history]

**Result:** Audit of each requirement against the code; no code changes.

---

## Prompt 6 — Deploy, rename to PROMPTS.md, set up a cf_ai_ repository

- **Date:** 2026-09-21
- **Type:** [exact] reply to "Should I deploy it, and do the `cf_ai_` repository and `PROMPTS.md` changes too?"

> yes

**Result:**
- Deployed with `npm run deploy` to https://mockingbird.palakmathur2811.workers.dev and checked the live site (health, validation, chat, workflow, browser flow).
- **Bug found in production and fixed:** the opening interview question didn't appear after the plan finished. Overlapping `/history` fetches resolved out of order, so a stale empty response overwrote the fresh one. Added a newest-request-wins guard in `App.tsx`, `cache: "no-store"` on the client and `cache-control: no-store` on the server's JSON responses. Redeployed and re-verified: question 1 appears and an answer was graded 5/5.
- Renamed `PROMPT_HISTORY.md` to `PROMPTS.md` and added the live URL to the README.
- Initialised a git repository with a first commit, ready to push to a GitHub repo named `cf_ai_mockingbird`.

<!-- Add further prompts below as development continues. -->
