# DevTools Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable AI SDK DevTools for the local CLI app so model calls, tool calls, and step data can be inspected during development.

**Architecture:** Keep the current manual agent loop unchanged and wrap the existing language model in `src/index.ts` with `devToolsMiddleware()`. Add a local helper script for launching the DevTools viewer and ignore generated `.devtools/` artifacts.

**Tech Stack:** TypeScript, AI SDK v6, `@ai-sdk/openai`, `@ai-sdk/devtools`, pnpm

---

### Task 1: Wire DevTools into the app entrypoint

**Files:**
- Modify: `src/index.ts`

**Step 1: Verify the integration surface**

Check that the installed packages export `wrapLanguageModel` and `devToolsMiddleware`.

**Step 2: Wrap the existing model**

Replace the direct `qwen.chat('qwen-plus-latest')` assignment with a wrapped model:

```ts
const model = wrapLanguageModel({
  model: qwen.chat('qwen-plus-latest'),
  middleware: devToolsMiddleware(),
});
```

**Step 3: Keep runtime behavior unchanged**

Do not modify the current prompt loop, tools, or agent loop behavior.

### Task 2: Add local developer ergonomics

**Files:**
- Modify: `package.json`
- Create or modify: `.gitignore`

**Step 1: Add a viewer script**

Expose a `pnpm devtools` script that starts the DevTools viewer through the package bin.

**Step 2: Ignore generated data**

Add `.devtools/` to `.gitignore` so local recordings do not enter version control.

### Task 3: Verify the integration

**Files:**
- Verify: `src/index.ts`
- Verify: `package.json`
- Verify: `.gitignore`

**Step 1: Run TypeScript verification**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: TypeScript exits successfully with no errors caused by the middleware integration.

**Step 2: Confirm local usage path**

Use:

```bash
pnpm devtools
pnpm start
```

Expected: DevTools viewer starts locally, and app interactions are recorded under `.devtools/`.
