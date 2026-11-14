# Margin: implementation plan

Status: **final direction: cinematic outside, calm inside** (see `CLAUDE.md`). Projects home and a scroll-driven project overview carry the motion; the three-pane Reading Room workspace is where you study and stays quiet. Phase 1 is in progress: the mockups exist at `/design-lab` and `/design-lab/overview`; tokens, `/style-guide` and the audit are not done.
**Redesign (study method):** Margin is now built around the layer loop: Part A and Part B, each split into topic layers with an **Explained** tab and a verbatim **Source** tab, a write-back area with a reviewing chatbot, a Part synthesis, and **Note to Self** holding only final writing. Phases 3 to 5 below are rewritten for it; Phases 1 and 2 (design system, import) are unchanged and kept. See section 11 for the decisions and what was retired.
Spec: `CLAUDE.md` (product, AI engine, stack, design system). Phases: `PROMPTS.md`.

**Study loop v2 (branch `study-loop-v2`; supersedes the "Approved / Good enough" rules in the sections below):**
1. **Saving, not approving.** A review still shows Fixes, Your version cleaned up, So what and the verdict, but the verdict is information only. The same reply ends with "Send to Note to Self?": *Yes, my own writing* / *Yes, refined version* / *No*. The choice is stored on the write-back (`writebacks.save_choice`) and the text lands in `note_saves` (one row per layer or Part, replaced by a newer "Yes", labelled `own` or `refined`; "No" leaves the earlier save). There is no "good enough" command or button and no `finals` table (migration 0006 carries old finals over as `own`). Progress is **saved / not saved** ("4/7 layers saved"); marks are a hollow ring and a filled plum mark. Layer and synthesis share the loop (`lib/layers/writeback.ts`: `saveWriteback`, `saveSynthesis`; routes `POST /api/layers/[id]/save`, `POST /api/parts/[id]/synthesis/save`).
2. **Let's talk! is a project-level section** (`/p/[id]/talk`, tabs Chat, Sources, Notepad), a scene of its own on the overview between Part B and Note to Self (and a tick on the rail). *Chat* is the one conversation per project (`talk_messages`); the tab inside each layer and synthesis continues it, and a message sent from there stores `context` ("From Layer 3: The large republic"), shown as a subtitle. *Sources*: the Librarian (`lib/talk/sources.ts`, prompt `lib/ai/prompts/sources.ts`, task `pickTalkSources` on the `talk` model) reads the conversation since it last looked (a rowid cursor in `ui_state`), gets candidate passages from the pages the professor cited and from BM25 on each message (never an already-collected passage), and returns topics with passage numbers only. Code validates the numbers and copies the stored text into `talk_sources` (unique per project and passage, so nothing is ever collected twice). It runs from `POST /api/projects/[id]/sources/find`: the "Find sources now" button, and automatically when the student leaves Let's talk! (section unmount, the layer's Let's talk! tab switched away, or `pagehide`; `fetch` with `keepalive`), only when something new was said. *Notepad*: `talk_notepad`, one row per project holding blocks (`heading`/`paragraph`/`bullet`) saved by autosave (`PUT /api/projects/[id]/notepad`); text is escaped, never stored or rendered as markup; the search box highlights matches and lists the lines.
3. **Real agent tasks, first instance.** `agent_tasks` (`lib/agents/tasks.ts`) records the Librarian's run. `GET /api/projects/[id]/agent-tasks` feeds `useAgentTasks`: while a task runs the dining hall is busy, and a finished one waits in "While you were away" (latest run per kind, dismissible, opens Sources). A task left running by a stopped server is shown failed after 15 minutes.
4. **Note to Self keeps its content** (only what was saved, in course order, with the version label). The open question is in `docs/IDEAS.md`. The screen itself is redone in step 5.
5. **Note to Self as an open book (study loop v3, same branch).** Clicking Note to Self opens a navy cover that swings open on its left edge (about 1s; none under reduced motion), then an open book spread centred on the desk: two plain pages side by side, rounded outer corners, a plum margin line on each page, a spine shadow down the middle, the Margin top bar above (solid over the book), no layers sidebar. **Nothing Margin writes is printed on the pages**: no title, intro, headings, labels, "Saved" tag, layer titles, big questions, links or placeholder (an `sr-only` h1, a per-Part `aria-label` and a hidden line naming each write-up remain for screen readers). **The only text is my saved write-ups (right page) and my quick notes (left page).** **Layers I haven't saved are hidden** (also an unsaved Part synthesis); saved ones flow down the book in course order, one row each (Part A's layers, Part A synthesis, Part B's layers, Part B synthesis), told apart by extra space only (64px), with no lines or labels, and each layer's notes start level with its write-up. No ruled lines: ordinary line spacing (17px text, line-height 1.7), so the book is short. **Left page**: a textarea per saved layer, autosaved (700ms and on leaving), `->` becomes `→` as typed and on save, no placeholder; the **Draft from my write-up** button shows only while the pointer or keyboard focus is in that layer's notes (set in the gap above the notes so it never covers text; always shown on touch devices) and drafts 4 to 9 `→` lines from that layer's saved text only (Sonnet, `draftQuickNotes`, returned not saved). Stored in `quick_notes` (migration 0008), separate from the Let's talk! notepad; an emptied note deletes its row. **Chat** is fixed on the right (own scroll, collapsible; on phone width the book is one page at a time and the chat starts closed as a bottom sheet) and is the same one conversation per project (`talk_messages`). **Highlight to ask**: selecting text on either page offers an "Ask about this" chip; the chip, or typing a question while text is still selected, pins that passage as the chat's current topic (shown at the top, with Clear). Every message sent carries it (`talk_messages.topic`), the professor prompt gets it as "The passage the student highlighted" and it is searched together with the question (Sonnet, grounded in the files, citations as before). It continues until something else is highlighted; earlier topics stay in the history with their passage as a header where the topic changes. Tests: unit (`tests/unit/notebook.test.ts`) and Playwright (`tests/e2e/notebook.spec.ts`: cover, only saved layers and no stray text, two pages and spine, no rules, spacing and level starts, autosave, draft on hover, fixed chat, highlight-to-ask, phone width, photographs at 1440, 1280 and 1024 in `docs/screens/v3-*`).
Tests: unit tests for the save choices, Note to Self content, progress, the Librarian (verbatim copy, no duplicates, reads only what is new, busy and away states, failure), the notepad and the layer subtitle; Playwright for the write-back save loop, synthesis, the section's three tabs, leave-to-collect and "While you were away"; `npm run shots` writes the changed screens at 1440 and 1024 to `docs/screens/v2-*`.

This plan decides what the spec leaves open. Anything marked **(my call)** is a decision I made that you didn't, so you can overrule it. Open questions are in section 9.

---

## 0. What I found on your machine

| Check | Result |
|---|---|
| `git` | 2.50.1 ✔ |
| `claude` CLI | 2.1.319 ✔, logged in, headless test returns `ready` ✔ |
| `node` / `npm` | 22 LTS via nvm ✔ (installed after this check; needs `~/.nvm/versions/node/v22.23.4/bin` on PATH) |
| All 8 required CLI flags | All present and accepted (details in section 4) |

---

## 1. Architecture

```
Browser (React, Motion)
   │  fetch / SSE
   ▼
Next.js route handlers + server actions          ← all server code runs locally
   ├─ lib/import   parse files → passages → units
   ├─ lib/db       better-sqlite3 + Drizzle, FTS5 passages
   ├─ lib/retrieval  BM25 search → cited passages
   ├─ lib/layers   Part split, layer breakdown validation, Source copy-by-code, write-back state machine, progress  (pure functions)
   └─ lib/ai       engine.ts ── ClaudeCodeEngine ──spawn──▶ `claude -p` (stdin prompt, stream-json out)
                              └ AnthropicApiEngine (stub, env-selected)
```

Principles that shape the layout:
- **Pure logic is isolated** (unit detection, chunking, mastery, citation parsing, prompt builders) so Vitest covers it without a browser, a DB or Claude.
- **One door to the AI**: components never see a prompt string or a process. Routes call `lib/ai`, which calls the engine.
- **Retrieval is the app's job.** Claude gets passages in the prompt and has no tools.
- **Everything the AI returns is Zod-validated**, even when `--json-schema` was used.

## 2. Folder structure

```
margin/
├─ app/
│  ├─ page.tsx                          projects home: cinematic entrance, Review today, Notes
│  ├─ p/[projectId]/page.tsx            project overview: one scroll scene per unit
│  ├─ p/[projectId]/setup/page.tsx      Part split and layer breakdown: review and approve
│  ├─ p/[projectId]/l/[layerId]/page.tsx     the workspace: layer list | Explained / Source | write-back and chatbot
│  ├─ p/[projectId]/part/[A|B]/synthesis/page.tsx   Part synthesis (same loop)
│  ├─ p/[projectId]/notes/page.tsx      Note to Self: the notebook (quick notes beside saved write-ups, fixed chat)
│  ├─ p/[projectId]/import/page.tsx     new project / review-before-build
│  ├─ design-lab/  style-guide/         Phase 1 only
│  ├─ api/…                             see section 5
│  └─ styles/tokens.css  globals.css
├─ components/
│  ├─ home/       ProjectCard, entrance
│  ├─ setup/      PartSplit, LayerBreakdown, LayerRow (rename, merge, split, reorder)
│  ├─ overview/   Scene (per Part), ExplodedStack (layers), InkReveal, PartTally, ProgressRail, ZoomToWorkspace
│  ├─ workspace/  Workspace (3 panes + resizers), LayerList, ReadingPane, CommandBar,
│  │              ViewToggle (Explained | Source), ExplainedView, SourceView, MarginGutter
│  ├─ writeback/  WritingArea, ReviewMessage (fixes, cleaned-up version, so what, verdict), LoopActions
│  ├─ chat/       ChatPanel, Message, Composer (Let's talk! and layer chat)
│  ├─ notes/      NoteToSelf (finals by Part and layer, labelled)
│  ├─ source/     SourceViewer (slide-over: PDF page / slide text)
│  └─ ui/         Button, Input, Segmented, Slideover, MasteryMark (fully restyled)
├─ lib/
│  ├─ ai/  engine.ts  claude-code-engine.ts  anthropic-api-engine.ts  fake-engine.ts
│  │       queue.ts  stream-parse.ts  errors.ts  citations.ts
│  │       prompts/  part-split.ts layer-breakdown.ts pick-source.ts explain-layer.ts
│  │                 review-writeback.ts review-synthesis.ts reexplain.ts professor.ts
│  │       schemas/  (Zod, one per prompt output)
│  ├─ db/  schema.ts client.ts fts.ts migrations/ paths.ts
│  ├─ import/  parse-pdf.ts parse-docx.ts parse-pptx.ts parse-text.ts
│  │           detect-units.ts split-sections.ts clean-text.ts pipeline.ts
│  ├─ retrieval/  search.ts
│  └─ layers/  split-parts.ts validate-breakdown.ts copy-source.ts loop.ts good-enough.ts progress.ts
├─ demo/        public-domain Federalist Papers excerpts + seed (no private data)
├─ scripts/     eval-feedback.ts  build-demo.ts
├─ tests/       unit/ (Vitest)  e2e/ (Playwright)  fixtures/
├─ docs/        PLAN.md  DECISIONS.md (Phase 8)
└─ .data/       gitignored (dev DB + uploads)
```

Production data lives in `~/Library/Application Support/Margin/` (db, `files/`, `engine-cwd/`). `lib/db/paths.ts` is the only place that decides where.

## 3. Data model (Drizzle, SQLite)

All ids are text (nanoid). Timestamps are integer epoch ms.

| Table | Columns (beyond `id`, `createdAt`) |
|---|---|
| `projects` | name, courseCode?, isDemo (read-only when true), status (`importing`/`reviewing`/`building`/`ready`) |
| `files` | projectId, unitId?, name, relPath, kind (`pdf`/`docx`/`pptx`/`txt`/`md`), storedPath, status (`queued`/`reading`/`done`/`failed`), error?, pageCount |
| `units` | projectId, title, position, isOverview, summary?, throughLine?, whyItMatters? (for the overview scene) |
| `sections` | unitId, fileId, position, title, focus? (one line for the overview), pageStart, pageEnd, wordCount, **original** (json: ordered blocks `{kind: heading/paragraph/list, text, page}`, **verbatim**), whyItMatters? (null until written), explained? (json: paragraphs with citations; null until written), writtenAt? |
| `passages` | projectId, fileId, sectionId, page (page or slide number), ordinal, text. Built **from the section's original blocks**, so a search hit always maps to a section and a page marker |
| `passages_fts` | FTS5 virtual table over `passages.text`, content-linked; ranked by `bm25()` |
| `parts` | projectId, key (`A`/`B`), title, splitUnitId? (first unit of Part B), breakdownStatus (`proposed`/`approved`), approvedAt? |
| `layers` | partId, position, title, bigQuestion, buildsOn? (one line: how it follows the previous layer), contentStatus (`none`/`writing`/`ready`/`stale`) |
| `layer_passages` | layerId, passageId, ordinal. The layer's text, by reference. Every passage of the project sits in exactly one layer (a validated invariant) |
| `layer_content` | layerId (unique), explained (json: blocks of heading, bullets, table, paragraph, each with citations), source (json: ordered quotes `{file, page, passageId, text}`, **text copied by code from `passages`**), soWhat, writtenAt |
| `writebacks` | id, targetType (`layer`/`part`), targetId, text (the user's submission, verbatim), review (json: fixes, cleanedUp, soWhat, verdict `approved`/`needs_work`, for information only), saveChoice? (`own`/`refined`/`no`), createdAt. Drafts live here; only a chosen version reaches Note to Self |
| `layer_messages` | targetType, targetId, role (`user`/`assistant`), kind (`writeback`/`review`/`dont_get_it`/`reexplain`), writebackId?, content, createdAt. The layer chatbot's saved history |
| `note_saves` | targetType, targetId (unique together), writebackId, version (`own`/`refined`), text, savedAt. What is in Note to Self; it reads **only** this table |
| `talk_messages` | projectId, channel (`talk` = Let's talk!, `note` = the Note to Self chat; two separate histories, migration 0009), role, content, context? ("From Layer 3: …"), topic? (the passage highlighted in Note to Self), createdAt |
| `quick_notes` | projectId, targetType (`layer`/`part`), targetId (unique together), text, updatedAt. The notebook's left column; never the Let's talk! notepad |
| `talk_sources` | projectId, passageId (unique together), topic, file, page, text (copied by code), createdAt. The Librarian's collected sources |
| `talk_notepad` | projectId (key), blocks (json), updatedAt. One notepad per project |
| `agent_tasks` | projectId, agent, kind, summary, status (`running`/`done`/`failed`), result?, seen, createdAt, finishedAt? |
| `ui_state` | projectId, lastLayerId?, per-layer `viewMode` (`explained`/`source`), collapsed Part ids, pane widths. Small key/value rows; also mirrored in `localStorage` so the toggle is instant |

**Kept from Phase 2:** `projects`, `units`, `files`, `sections`, `passages`, `passages_fts`. They are the import and search layer. **Retired (migration in Phase 3b, tables are empty):** `chats`, `notes`, `questions`, `reviews`. `units.summary / throughLine / whyItMatters` and `sections.whyItMatters / explained / focus` are no longer written; they are dropped in the same migration if nothing reads them.

(my call) Layers point at passages (about 180 words) and not at whole sections, because a topic can start or end in the middle of a section. Passages are the finest verbatim unit the app already stores, with file and page.

(my call) What Note to Self shows is `note_saves.text`: the user's own writing exactly as submitted, or the cleaned-up version if they chose it, labelled either way. There is no mastery score and no schedule any more; progress is a count of saved layers per Part.

---

## 4. The AI engine

### Verified flag behaviour (tested on your machine, claude 2.1.319)

| Flag | Status |
|---|---|
| `--output-format stream-json` (+ `--verbose`) | ✔ Emits `stream_event` lines; text arrives as `content_block_delta` / `text_delta`; ends with one `result` line. A `rate_limit_event` line appears before it. |
| `--include-partial-messages` | ✔ |
| `--json-schema` | ✔ Works even with `--max-turns 1` (reports `num_turns: 2`). The validated object is in `structured_output` on the `result` line. |
| `--system-prompt`, `--tools ""`, `--strict-mcp-config`, `--no-session-persistence` | ✔ |
| `--max-turns` | ✔ **accepted, but missing from `claude --help`**. Plain text uses 1. **Structured calls need 3**: the real smoke test showed `error_max_turns` with 1 on a larger schema, because the CLI answers through a hidden tool and may fix a shape error itself. Covered by a unit test and the smoke test. |
| `--model sonnet` | ✔ |

### Model and effort per task (verified on your machine)
`claude --help` lists `--effort <level>` with `low, medium, high, xhigh, max`, so **medium effort can be set** in headless mode. A real call `claude -p --model claude-opus-5-5 --effort medium` (empty cwd) was accepted and returned normally, so the model id is valid on your plan. The CLI does not report the effort it used in its result, so the Phase 3 test asserts the **argv** we spawn, plus one real smoke call.
| Task | Model | Effort | Why |
|---|---|---|---|
| Layer chatbot: write-back review, synthesis review, "I don't get it" | `claude-opus-5-5` | `medium` | you asked for this |
| Layer content: Explained and the Source picks (task `explain`) | `claude-opus-5-5` | `medium` | you asked for this, for accuracy. Runs once per layer and is cached |
| Part split and layer breakdown proposal (task `structure`) | `sonnet` | not set | you approve it before anything is written |
| Let's talk! | `sonnet` | not set | (my call) high volume |
Env: `MARGIN_MODEL_<TASK>` and `MARGIN_EFFORT_<TASK>` for `REVIEW`, `EXPLAIN`, `STRUCTURE` and `TALK`. An effort of `default` or `none` drops `--effort`. `ClaudeCodeEngine` adds `--effort` only when a task sets one. The `AnthropicApiEngine` stub maps `model` and `effort` to the API fields later. Cost note: Opus runs on your plan's usage. Reviews (one per submit) are the main driver, and writing a whole Part's layers once adds a few Opus calls per layer; both are cached or one-off. The queue cap of 2 stays.

### Isolation: what I found
- Run in the repo, a call picks up `CLAUDE.md` and memory (a plain "say hi" came back as a personal greeting that named the project). **The empty `cwd` is required**, and a Phase 3 test will assert it.
- `--bare` would isolate more, but it **skips your login** ("Not logged in"), so it can't be used.
- The CLI injects your account email into every call itself, and no flag removes it. It's harmless, but it means the isolation test must check for *repo/project* leakage, not email.
- I'll also pass `--setting-sources project` and `--disable-slash-commands`. Both are accepted. With an empty cwd, no project settings or skills load.

### Interface (`lib/ai/engine.ts`)
```ts
interface Engine {
  complete(req: AiRequest): Promise<string>
  stream(req: AiRequest, signal?: AbortSignal): AsyncIterable<StreamChunk>   // { type:'text', delta } | { type:'done', usage }
  json<T>(req: AiRequest, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T>
}
type AiRequest = { system: string; prompt: string; model?: string; effort?: 'low'|'medium'|'high'|'xhigh'|'max' }
```
- `ClaudeCodeEngine` spawns `claude` with the flags from CLAUDE.md, writes the prompt to **stdin**, parses stdout lines in `stream-parse.ts`, and kills the child on abort. It never reads credentials.
- `queue.ts`: a global semaphore of 2, held on `globalThis` so Next dev hot-reload doesn't create a second pool.
- `errors.ts` maps failures to typed errors with plain-English messages: `ClaudeNotInstalled` (ENOENT), `ClaudeNotLoggedIn` (the "Not logged in · Please run /login" result), `UsageLimitReached`, `EngineTimeout`, `BadStructuredOutput` (Zod failure, retried once).
  **Risk:** I haven't seen the exact usage-limit text. The matcher is built from a fixture and refined during the Phase 3 smoke test. Until then, unrecognised errors surface raw instead of being mislabelled.
- `fake-engine.ts` is selected with `MARGIN_ENGINE=fake`. It returns canned, schema-valid output with realistic delays, so every test and Playwright flow runs offline.
- `AnthropicApiEngine` throws "not configured" unless `MARGIN_ENGINE=anthropic-api` and a key are set. It's a stub, with no logic.

### Retrieval and citations
- `search(projectId, query, k, {unitId?, sectionId?})` runs FTS5 `bm25()`. The query is sanitised to FTS tokens. Results are `{passageId, file, page, text, score}`.
- Prompts include passages as `[file, p. N]` blocks and require citations in exactly that form. `citations.ts` parses `[file, p. N]` into tokens and **validates each against the passages that were actually sent**. A citation that points at nothing is stripped and flagged, so the UI never shows a link to a made-up source. The eval depends on this.
- Tutor scope: section passages first. If the top BM25 score is weak, widen to the project and name the file. If nothing matches, the prompt allows only a labelled `Beyond your files:` answer.

## 5. API routes

| Route | Purpose |
|---|---|
| `POST /api/projects` | create a project |
| `POST /api/projects/[id]/files` | upload one file (multipart). The client sends them one at a time, so each gets its own status row |
| `POST /api/projects/[id]/analyze` | detect units, **split files into sections and passages**, index them (JSON). No AI involved |
| `PATCH /api/projects/[id]/units/[unitId]`, `POST …/units/merge`, `PATCH /api/files/[id]` | rename, merge, move or remove during the import review |
| `POST /api/projects/[id]/structure/propose` | AI proposes the Part split and the layers of each Part (validated by code; one retry, then split by unit) |
| `PATCH /api/projects/[id]/structure` | edit the proposal: move the split, rename, edit the big question, merge, split, reorder, move a layer across Parts |
| `POST /api/projects/[id]/structure/approve` | approve a Part's breakdown. **Content generation returns 409 until then** |
| `POST /api/layers/[id]/write` | lazy write of the layer's **Source** (picked, copied by code) and **Explained**, then cached |
| `POST /api/layers/[id]/submit` and `POST /api/parts/[id]/synthesis/submit` | submit a write-back; returns the structured review. Non-streamed JSON |
| `POST /api/layers/[id]/save`, `POST /api/layers/[id]/dont-get-it` | answer "Send to Note to Self?" (no engine call); re-explain (SSE) |
| `GET/POST /api/layers/[id]/messages` | the layer chatbot's saved history |
| `PUT /api/layers/[id]/view` | remember Explained / Source for this layer |
| `GET /api/projects/[id]/note-to-self` | saved versions only, by Part and layer, labelled |
| `GET /api/projects/[id]/progress` | per-Part counts: saved, not saved; synthesis separately |
| `POST /api/ai/stream` | SSE for "I don't get it" and Let's talk!. Aborting the request kills the child |
| `GET /api/files/[id]/page/[n]` | raw file or page for the source viewer |
| `POST /api/projects/[id]/talk` | Let's talk!: project-wide professor chat, SSE; body `{question, layerId?, partId?, topic?, channel?}` (the layer or Part it was sent from; the passage highlighted in Note to Self; `channel: "note"` for the notebook chat, also `GET ...?channel=note`); typed or spoken (Phase 7c) |
| `GET /api/projects/[id]/sources`, `POST /api/projects/[id]/sources/find` | the Librarian's collected sources by topic (and whether there is unread conversation); collect them now |
| `GET/PUT /api/projects/[id]/notepad` | the project's notepad blocks; autosave |
| `PUT /api/projects/[id]/write-up` | edit a saved write-up from Note to Self: changes `note_saves.text` and the text the layer's pane shows (submitted text for `own`, cleaned-up version for `refined`) |
| `GET/PUT /api/projects/[id]/quick-notes`, `POST /api/projects/[id]/quick-notes/draft` | the notebook's quick notes by layer; autosave one; draft arrow notes from a layer's saved write-up (returned, not saved) |
| `GET/POST /api/projects/[id]/agent-tasks` | who is busy, what finished; dismiss "While you were away" |
| `GET /api/health/engine` | is `claude` installed and logged in, for friendly first-run errors |

Every request body and every response is Zod-validated at the boundary.

---

## 6. Phases and their tests

"Done" for every phase means **tests green, flow works in the browser, screenshot looked at, commit**. Each phase ends with its Impeccable audit where UI changed.

### Phase 0: Setup and plan *(this one)*
- Skills installed and read. Machine checked. This plan written.
- **Done when:** you approve this plan.

### Phase 1: Design system first
**Done.** `/design-lab` stays as the frozen approved reference (landing, overview, dining hall, workspace). The real system is:
- **Tokens** in `app/styles/tokens.css`, in three layers: raw palette, semantic roles (desk, panel, paper, accent, solid, shaky) swapped by theme, and scales (type, space, radius, depth, motion). `globals.css` maps them to Tailwind utilities (`bg-paper`, `text-ink`, ...). Fonts load once in the root layout (`app/fonts.ts`). **No green anywhere**: accent is ink blue, solid is warm gold, unit accents come from gold, amber, terracotta, blues, violet and plum.
- **Components** in `components/`: `ui/` (Button, Input, Textarea, MasteryMark, Surface, Segmented, CitedText), `workspace/` (Workspace, Resizer, SectionList, ViewToggle, MarginGutter, ReadingPane), `chat/` (Message, ChatPanel), `agents/` (AgentCharacter). Pure layout and citation logic is in `lib/layout/panes.ts` and `lib/ai/citations.ts`.
- **`/style-guide`**: colour with live contrast ratios, type scale, surfaces, mastery states, buttons, inputs, the Original | Explained toggle, the margin, chat, the agents, and a live three-pane workspace.
- **Not promoted yet:** the generative backdrops, the dining hall, the overview scenes and the landing page stay in `app/design-lab/` (shared there) until Phase 4 builds them on real data. `ReadingPane` is controlled; per-section view memory and scroll memory arrive with the real data in Phase 4.
- **Styling split:** Tailwind for layout and page composition; token-based component classes (`m-*`, in `app/styles/*.css`) for parts that need pseudo-elements, layered shadows and state selectors.
- **Impeccable audit on `/style-guide`** (detector on the rendered page and on the source). Fixed: the Why-it-matters side stripe and nested box (now a hairline note), body-copy stragglers (`text-wrap: pretty`), a 123-character chat line (demo at real pane width), mastery label contrast (the word is plain text, only the glyph is coloured), a contrast swatch that tripped the text check. Kept, with reasons: **repeating stripes** is the shaky hatch, which exists so mastery reads without colour; **nested cards** is a tutor slip on the chat panel, the paper-on-desk depth model; **19 em dashes** is the detector counting the `--` in CSS token names, there are no em dashes in the page.
Direction chosen: **Reading Room**, cinematic outside, calm inside.
Skills: frontend-design, taste-skill (checks only), emil motion skills, Impeccable audit.
Tests:
- Vitest + Testing Library: `ViewToggle` switches on click and with arrow keys, exposes `role="tablist"` semantics, and with `prefers-reduced-motion` swaps the content with a plain crossfade (no travel). Pane resizer: arrow keys change width within its min and max.
- Playwright: `/style-guide`, `/design-lab` and `/design-lab/overview` load with no console errors, both on direct load and on client navigation. Screenshots at 1440 and 1024, including mid-scroll.
- Impeccable `detect` on `app/` and `components/` exits clean, or each remaining finding is justified.
- Motion rule check: a grep-style test that components animate only transform and opacity (the one exception, pane-width collapse, is annotated in code).

### Phase 2: Projects, import and the section map
**Done** (merged to `main`). After first use on a real course: junk lines are never used as titles (a line must look like a real heading, else the nearest real heading plus its pages), long readings split at their own headings (marked-up or title-like lines) before falling back to part numbers, and PDFs with poor text quality are flagged on the review screen. Differences from the plan: `analyze` is a plain JSON call (it takes milliseconds, so no SSE); sections, passages and units are cut in one step and edited in place during review; PDF outlines are not read yet (typographic headings and numbered parts are); Word, text and Markdown get virtual pages of about 400 words because those formats have no pages. Sample course: `demo/sample-course` (public-domain Federalist Papers, built by `scripts/make-sample-course.ts`).
Build: DB + migrations, import pipeline, unit detector, **section splitter**, text cleaner, review step.
Tests:
- **`detect-units`** with the tricky names from PROMPTS.md (`Wk03`, `Lecture_12 slides`, `POL101 Syllabus F26`). I'd add `Week 3 - Readings/ch2.pdf` (folder wins over file), `Module02`, `session 4b`, `Week 10 vs Week 1` (no false merge on "1"), and a file with no number (lands in a "Misc" unit, not dropped).
- **`split-sections`**, table-driven on small fixtures: a Markdown file with headings, a text file with "Federalist No. N" parts, a Word file with heading styles, a PPTX of 12 slides, a PDF with no headings (page ranges). Each asserts: sections are in file order, 1,100–2,300 words (or smaller only when the file is small or a part is naturally short), a slide is never split, tiny neighbours are merged, titles come from the file (or "Pages 4–7").
- **Verbatim guarantee (the key test):** for every fixture, the section texts joined in order equal the file's extracted text after normalising whitespace and rejoining line-break hyphens. Nothing is dropped, added, reordered or reworded. Page numbers on every block are correct.
- **`clean-text`**: rebuilds paragraphs from hard-wrapped lines, rejoins `hyphen-\nated` words, lifts repeated running headers and bare page numbers into page markers, keeps lists. Never changes a word.
- Parsers on tiny fixtures: a 3-page PDF, a docx, a 4-slide pptx, a txt and an md. Each asserts page or slide numbers are correct.
- **FTS5**: a query returns the right passage first. Special characters (`"`, `-`, `*`, `:`) don't throw.
- Migrations apply to an empty DB and are idempotent.
- Playwright: drop the fixture folder, watch each file read with a status row, see units in the review step with their sections, rename a unit, move a file to another unit, merge two units.
- Unreadable PDF → that file's row shows `failed` with a reason, and the rest still import.

### Phase 3: The AI engine
**Done.** Differences from the plan above: (1) the model task split is `review`, `explain` (Explained and Source picks) and `structure` (Part split and breakdown) plus `talk`, per your later change. (2) Structured calls use `--max-turns 3` and a draft-07 schema without `$schema`; both were found by the real smoke test (Opus 5.5, medium), which passes for Explained and for a write-back review. (3) `pickSource` chooses **whole passages** (about 180 words each, verbatim by construction), not sentence ranges; sentence ranges can come later if a passage proves too coarse. (4) The `/api/ai/stream` route is not built yet: nothing calls it until the layer chatbot (Phase 5). (5) `lib/ai/tasks.ts` binds each prompt to its schema and model, and strips any citation that wasn't sent (Explained is asked once more first).
Build: everything in section 4 (engine, queue, errors, stream parsing, **per-task model and effort**, retrieval, citations), plus the prompt builders and Zod schemas for the layer flow. No UI yet.
Prompts (`lib/ai/prompts/`, all typed, all Zod-validated):
- `partSplit` and `layerBreakdown`: propose where Part A ends and the layers of each Part (title, big question, passage ranges, how it builds on the one before).
- `pickSource`: which passage ids (and sentence ranges) a layer's explanation rests on. Returns ids only; code copies the text.
- `explainLayer`: the Explained tab in the style rules from `CLAUDE.md` (basics first, every name explained at first use, examples, topic-by-topic bullets, tables for typologies, no story, ends with the so what, every factual claim cited).
- `reviewWriteback` (layer) and `reviewSynthesis` (Part): fixes, cleaned-up version of the user's writing, one so what, verdict.
- `reexplain` ("I don't get it"): simpler or more basic, then ask for another try.
- `professor` (Let's talk!, Phase 5).
Retired from the old plan: `whyMatters`, `explainSection`, `sectionTitle`, `tutor`, `explainDifferently`, `quizNext`, `gradeQuizAnswer`, `gradeTeachBack`, `connectSection`, `answerQuestions`, `courseOverview`.
Tests:
- **Prompt builders**: each prompt contains its rules and the passages provided. `explainLayer` carries every style rule (basics first, explain each name, tables for typologies, no story, so-what ending, citations). `reviewWriteback` carries "keep the user's wording", "never invent facts, quotes or page numbers" and the three output parts.
- **Schemas**: valid and invalid samples for each. `reviewWriteback` needs fixes (array, may be empty only when the verdict is APPROVED), a cleaned version, exactly one so-what sentence and a verdict.
- **Model and effort**: with a fake `claude` on PATH that records argv, a layer review spawns with `--model claude-opus-5-5 --effort medium`, the Explained and Source calls also spawn with Opus 5.5 at medium, the Part split and breakdown spawn with `--model sonnet` and no `--effort`, and env overrides change each. A smoke test (skipped unless `RUN_CLAUDE_SMOKE=1`) runs one real `claude -p` with Opus 5.5 at medium and checks that it returns.
- **stream-parse**, **queue** (never more than 2 at once, abort frees the slot), **abort** (child is dead), **errors** (ENOENT, not logged in, usage limit), **isolation** (cwd is the empty engine dir), **citations parser** (including filenames with commas and brackets, and stripping a citation that was not sent), **retrieval** (scoped to passage set, unit and project). These carry over unchanged.
- **Explained citations resolve**: every `[file, p. N]` in an Explained block points at a passage that was sent for that layer, so a jump to Source always lands.

### Phase 3b: Parts, layers and the approval step
**Done.** Differences from the plan below: (1) The Part boundary is not stored: it is simply which layers sit in Part A and Part B. "Move the Part split" is the **Move to Part A / Part B** button on the layers at the edge, which crosses a layer over (a Part always keeps one layer). (2) Splitting a layer cuts it near the middle by word count and names the second half "(continued)" for you to rename. (3) Editing an approved Part keeps it approved; changed layers are marked stale and rewritten on next open, untouched layers keep their text. Renaming only the title keeps the content. (4) Only the retired tables were dropped; the unused `sections.explained / whyItMatters / focus` and `units.summary / throughLine / whyItMatters` columns are left in place (empty, nothing reads them) to keep the migration small. (5) `finishReview` now sets the project to `building`; it becomes `ready` when both Parts are approved. (6) The layer page at `/p/[id]/l/[layerId]` and the project page are **interim** and plain (Explained and Source tabs, a list of layers); Phase 4 replaces them with the overview and the workspace. (7) The fake engine (`MARGIN_ENGINE=fake`) gives canned, schema-valid answers for the layer flow, and the e2e server runs on it. (8) **Known limitation for Phase 4:** a passage's stored text is flat (paragraph, heading and list breaks are not kept), so the Source tab shows each quote as one block. Words, pages and files are exact. Phase 4 can render Source with the section's original blocks to keep the formatting.
Build: the data model in section 3 (`parts`, `layers`, `layer_passages`, `layer_content`, `writebacks`, `layer_messages`, `finals`), the pipeline "sections → Part split → layers → approval → content", and the screens for the approval step.
Flow: after the existing review step (units and sections) the project asks for the **Part split** (a proposed split point I can move) and shows the **proposed layers for Part A and Part B** with title, big question and what each covers. I can rename, edit the big question, merge two layers, split one, reorder, move a layer across the Part boundary, and then **Approve**. **No layer content (Source or Explained) is generated before I approve.** After approval, content is written lazily on first open and cached (and can be prefetched in the background in Phase 7). The approval screen lives in the Reading Room style (calm, paper on desk); it is not a motion layer.
Tests:
- **Breakdown validator** (table-driven): every passage in exactly one layer (none missing, none twice, none unknown), and **a layer may take ranges from several readings and layers need not follow reading order** (changed after the real engine proposed exactly that for Federalist 47 and 51, and the stricter rule rejected it and fell back to a split by unit); no layer crosses the Part boundary; layer count 1–12 accepted but flagged outside 4–8 on the screen; a layer under about 300 words or over about 6,000 is flagged; overlap, gap and unknown passage ids are rejected. Invalid AI output is retried once, then falls back to a split by unit.
- **Part split**: lands on a unit boundary nearest the middle by word count; a course with one unit still splits (by passage count) and says so.
- **Source verbatim (the key test)**: every Source quote equals a substring of the stored original text after whitespace and hyphen normalisation, with the right file and page. A fake engine returning an invented or altered quote has it dropped, and the layer shows no fabricated text. The union of picked passages is never empty (fallback: the layer's first passages).
- **Gate**: with the fake engine, calling content generation before the Part's breakdown is approved returns a 409 and makes no engine call. Editing an approved breakdown marks the affected layers' content stale (regenerated on next open); untouched layers keep their content.
- **Edits**: rename, merge, split, reorder and moving the boundary produce valid layers and keep passage coverage complete.
- **Migrations**: apply to an empty DB and to a Phase 2 DB (adds the new tables and drops the retired empty ones: `chats`, `questions`, `reviews`, the old `notes`).
- Playwright (fake engine): import the sample course → review step → proposed Part split → see Part A and B layers → rename one, merge two → approve → open a layer and see Explained and Source written.

### Phase 4: Home, the overview and the workspace shell
**Done.** Differences from the plan below: (1) **Source keeps the original's shape.** Passages are stored flat, so each quote is rebuilt from the section's original blocks: a section's passages are its words cut in order with none dropped, so passage k covers a known word range, and `lib/layers/source-blocks.ts` slices exactly those words out of the original blocks, keeping heading, paragraph and list kinds and the original line breaks. No schema change, and it works on layers written before. A test proves every piece is a verbatim slice of one original block and that the pieces have exactly the passage's words. (2) **The "what this Part covers" text on the overview is built from the layers' big questions, without AI.** (3) **The Part synthesis entry and Let's talk! are not in the left list yet**; they arrive in Phase 5 with the write-back loop. The right pane says what will live there and doesn't pretend to work. (4) **The home page lost "Review today" and "Notes"** (retired); Note to Self is per project, reached from the overview and the workspace. (5) **The demo** is `demo/seed.json`, built once by `npm run demo:build` with the real Claude Code engine (Sonnet for the plan, Opus 5.5 at medium for every layer) from the public-domain sample course, and loaded by `POST /api/demo` with fresh ids. Its structure is read-only (403 on every route that changes it, and the plan and unit-review pages redirect away). (6) The agents keep their five characters and the dining hall; their jobs are renamed to the new flow, and the idle, busy and done states are still driven by a dev toggle (hidden in a production build) until Phase 7. "While you were away" shows a mock built from this course's real layers. (7) The tab for each layer is remembered in `ui_state` (the database), not also in `localStorage`; a layer opens on Explained until you choose Source. (8) The command bar searches layer titles and the files (BM25) and opens the layer that holds a hit. (9) Marks: hollow ring = not started or in progress, filled gold = Approved, half gold = Good enough, each with its word. (10) Overview labels show a one-line title and one or two lines of the big question, chosen by how far apart the rows are, so 12 layers never touch.
Build: the projects home (striking but clean entrance, course code and **per-Part progress** on each tile, "New project", Note to Self), **generative backgrounds** (canvas, seeded from the title, home and overview only; static under reduced motion), **the agents' dining hall** with the new job names (idle, busy and done, mocked with a dev toggle until Phase 7), the demo project offered on first run, the **project overview** with **one pinned scene per Part** and a calm Note to Self scene (headline push-in, teardown of the Part into its layers with title, big question and progress mark, ink reveal, stat chart of approved / good enough / not yet, progress rail among A, B and Note to Self), the shared-element zoom from a layer sheet, and the **workspace shell**: layer list grouped under Part A and Part B (collapsible, each with its progress and synthesis entry), the reading pane with the **Explained | Source** toggle (remembered per layer, scroll kept per view), the margin gutter (citations in Explained, file and page in Source), resizable panes (the right pane defaults wider), Cmd+K (jump to a layer, Note to Self, search files), keyboard navigation. The right pane is a placeholder until Phase 5.
Tests:
- Vitest: `viewMode` persistence per layer (defaults to Explained, survives reload). Layer-list grouping and next/previous order across Parts. **Progress counts** per Part and the "4/7 layers done (3 approved, 1 good enough)" wording. The teardown geometry fits every layer count from 1 to 12 at 1024 and 1440 with labels on screen and not overlapping.
- Playwright, overview: first run offers the demo. Scroll: each Part's title, ink text, tally and every layer label appear, the rail tracks the scene. Click a layer sheet: the zoom lands on the reading pane and opens that layer. Back returns to the same scene. Next keeps routes alive in `<Activity>`, so a returning overview must not replay a stale zoom, and a second zoom opens the new layer.
- Reduced motion: no Lenis, nothing pinned, all content reachable, clicking a sheet navigates directly.
- Playwright, workspace: Explained renders; switch to Source and back (state and scroll remembered); clicking an Explained citation switches to Source and highlights the matching quote; collapse the left pane; resize with mouse and keyboard; `[` and `]` (or J/K) move between layers across Parts; **nothing is locked** (open layer 5 first, open Part B before finishing Part A). Screenshots at 1440 and 1024.
- Source text rendered in the DOM equals the stored passage text (checked on the demo).
- The demo's structure is read-only (no breakdown edit controls, API rejects with 403); write-backs on the demo are allowed.
- Repo hygiene check: `git ls-files` has no `.data/` or non-demo course files.

### Phase 5: The write-back loop, synthesis, Note to Self and Let's talk!
Build: the right pane for a layer: a large writing area, **Submit**, **I don't get it**, **Good enough**, the layer chatbot with saved history (replies show Fixes, Your version cleaned up, So what, and the verdict), the **Part synthesis** screen (same loop), **Note to Self** (final writing only, by Part and layer, labelled Approved or Good enough, copy all), progress marks everywhere, the source viewer (a slide-over showing the PDF page or slide text for any citation), and the text-only **Let's talk!** tab (project-wide retrieval, `talk_messages`, `POST /api/projects/[id]/talk`, as in the earlier plan).
How the loop is decided:
- **"Good enough"** is detected by code from the message text (trimmed, case-insensitive, trailing punctuation ignored, the whole message), or the button. It finalises the **last submitted write-back** with outcome `good_enough`; it makes no engine call.
- **APPROVED** is the structured verdict from the reviewer, accepted only if its schema is valid. It finalises that write-back with outcome `approved`.
- **"I don't get it"** (button, or a message that is only those words) runs `reexplain`, then asks the user to try again; it never changes status.
- Review calls are non-streamed structured JSON (`--json-schema`, Zod-validated); the pane shows a calm "Reading your write-back" state. Streaming applies to Let's talk! and "I don't get it".
- The **final** that goes to Note to Self is the user's own last submitted text, unchanged. A cleaned-up version only becomes a final if the user pastes it into the writing area and submits it as their own. Resubmitting after a final reopens the layer (status in progress) and the old final stays in Note to Self until a new one replaces it.
- The cleaned-up version is checked against the draft: if too little of the user's wording survives (word overlap under a threshold set in one pure file), the review is retried once with a stricter prompt.
Tests:
- **Good enough detector** (table): "good enough", " Good enough. ", "GOOD ENOUGH!" end it; "it's good enough for now, but I think..." and "not good enough" do not.
- **Loop state machine** (pure, table-driven): not started → in progress on first submit; APPROVED → final approved; good enough → final good_enough on the last submission; "I don't get it" leaves state unchanged; resubmitting after a final reopens; both Parts' synthesis follow the same machine; **nothing is locked** (any layer or synthesis accepts a submission at any time).
- **Review contract** (fake engine): reply always has fixes, a cleaned-up version, one so-what sentence and a verdict; the cleaned-up version keeps most of the draft's wording on the fixtures; every `[file, p. N]` in the reply was in the passages sent (others are stripped); a fix with an invented page number is stripped, never shown as a link.
- **Grounding**: the review prompt contains the layer's passages first and project passages only when the top BM25 score is weak.
- **Note to Self content**: contains only finals (layer and synthesis), grouped by Part and layer, each labelled; contains no drafts, chat messages or cleaned-up versions (assert against fixtures where all three exist); a layer with no final is absent or shown as "Not written yet".
- **Progress**: counts per Part from the finals table (approved, good enough, in progress, not started) and the synthesis counted separately.
- **Chat history** is per layer; a second layer's history is empty; persists across reload. **Let's talk!** keeps its earlier tests (project-wide retrieval, citations resolve, per-project history, never mixes with layer chats, Stop cancels).
- Playwright, full flow on the demo with the fake engine: open a layer → read Explained → check a citation against Source → write it back → see fixes, cleaned-up version and so what → revise and resubmit → APPROVED → progress becomes 1/N → open another layer, type "I don't get it" and get a simpler explanation, then type "good enough" → open Note to Self and see both finals with the right labels and no drafts → write a Part synthesis, "good enough" → Let's talk! asks about another layer and cites that file. Screenshot and look. Impeccable audit.

**Progress (5a, layer write-back loop): done.** `lib/layers/loop.ts` holds the pure rules (good-enough and "I don't get it" detectors, loop state, how much of the student's wording the cleaned-up version must keep, when to look beyond the layer's passages); `lib/layers/writeback.ts` runs submit, good enough and "I don't get it" and saves the history. Routes: `POST /api/layers/[id]/submit` (a message that is only "good enough" or "I don't get it" is routed by code), `/good-enough`, `/dont-get-it` (SSE, Stop aborts), `GET /messages`. The right pane is `components/layers/WriteBack.tsx`. Differences from the plan: (1) a final holds only until something newer is submitted (resubmitting reopens the layer, the old final stays in Note to Self); (2) the unsent draft is remembered per layer in `localStorage`; (3) clicking a citation in the pane jumps to the Source tab for now, the slide-over viewer is still to do.
**Progress (5b, Part synthesis): done.** The synthesis runs the same loop as a layer, in `lib/layers/writeback.ts` (`submitSynthesis`, `markSynthesisGoodEnough`, `dontGetItSynthesis`, `getSynthesisThread`), stored in the same tables with `targetType "part"`. Routes: `POST /api/parts/[id]/synthesis/submit` (good enough and "I don't get it" routed by code), `/good-enough`, `/dont-get-it` (SSE), `GET /messages`. Screen: `/p/[id]/part/[A|B]/synthesis` (`components/layers/SynthesisWorkspace.tsx`), three panes like a layer: the layer list, the Part's layers in my own words (finals, or "Not finished yet" with a link), and `WriteBack` in its synthesis wording. Each Part in the layer list ends with its synthesis and its mark; `StructurePart.synthesis` holds its state; Note to Self's synthesis sheet opens it. Differences from the plan: (1) the review is grounded in the two passages of each layer that share the most words with the writing, plus my own layer finals, and project search only if the writing leaves the Part (not every passage of the Part, which would be too long); (2) "I don't get it" on a synthesis re-explains how the layers connect, using the layer re-explain prompt with the synthesis question; (3) a citation in synthesis feedback opens the layer that holds that file on its Source tab, until the slide-over viewer (5c) exists.
**Progress (5c, source viewer): done.** Every citation (Explained margin, review feedback, synthesis feedback, "I don't get it", Let's talk!) opens `components/layers/SourceViewer.tsx`, a paper slide-over with the file name, page (or slide), the page's text verbatim with its headings, paragraphs and lists, and the cited passage marked (ink-blue tint plus a rule on its left edge, so it reads without colour). Previous and next page buttons, Escape and Close, focus kept inside and returned to the citation. `GET /api/projects/[id]/source?file&page&near` is built by `lib/layers/source-view.ts`. Differences from the plan: (1) a citation carries only file and page, so `near` (the sentence that held it) picks which passage on that page to mark, by shared words, falling back to the first. (2) The page is rebuilt from the stored **sections**, not `files.parsed`, because the demo ships no parsed copy; a test opens every Source quote of the demo. (3) The Explained margin citations no longer jump to the Source tab; the Source tab is only its own toggle now.
**Progress (5d, Let's talk!): done.** `talk_messages` (migration 0005), `lib/ai/prompts/professor.ts`, `talkToProfessor` (task `talk`, Sonnet), `lib/talk/service.ts` and `GET`/`POST /api/projects/[id]/talk` (SSE, Stop keeps what had arrived). Retrieval is FTS5 over the whole project (top 8), a short follow-up is searched together with the question before it, and a citation that was not in the passages sent is stripped. The right pane is now two tabs on the desk, **Write it back | Let's talk!** (`RightPane.tsx`, both stay mounted, the open tab is kept while you move between layers); the left footer's Let's talk! opens it. It works in a layer and in a synthesis, and its history is per project and never mixes with a layer chat.
**Phase 5 audit and flow test: done.** `tests/e2e/phase5-flow.spec.ts` runs the whole loop on the demo with the fake engine. Impeccable audit: the detector found nothing; fixed `aria-busy` on the chat logs while an answer streams, so screen readers don't read every chunk. Known and left alone: a passage is about 180 words, so on a short file or slide the marked passage is most of the page. The 17 lint errors are all in the old `app/design-lab` files.
**Phase 5 is complete.**

### Phase 6: Polish
Tests: Impeccable full audit and the AI-design-tell detector clean on every screen. Long-text stress: a 5,000-word section, a 60-section unit and a 120-character title all render without breaking the layout. Playwright with `axe` (a11y) on each screen, and a keyboard-only walk through the main flow. Screenshots in light and dark, before and after. Error states are triggered by the fake engine: claude missing, not logged in, usage limit, unreadable PDF.

### Phase 7: Background agents
Build: the real version of the agents mocked at `/design-lab/home` and `/design-lab/overview`, mapped onto the layer flow. Long jobs become **background tasks** (a `tasks` table: id, project, kind, agents involved, status `queued | running | done | failed | cancelled`, input, result, timestamps) on a small queue through the same `ClaudeCodeEngine`, so the limit of 2 concurrent CLI processes still holds and **foreground work always goes first** (a review I just submitted, "I don't get it", Let's talk!). The write-back review itself stays in the foreground: I am waiting for it.
| Task | Agents (who runs to whose table) |
|---|---|
| Propose the Part split and layers | Librarian (what the files contain) hands to Connector (how layers build on each other) |
| Write a layer (Source, then Explained, then the so what), optionally prefetching the whole approved Part | Librarian picks the Source quotes and hands the passages to Explainer, who hands the draft to Connector for the so what |
| Review a write-back or synthesis (foreground, but the agents still show it) | Librarian retrieves, Examiner reviews, Connector adds the so what |
| "I don't get it" | Quizzer re-explains, with Explainer for the lower-level version |
The dining hall's busy state is driven by the running task rows, not a toggle, and the movements come from the real handoffs above. Results are saved where the workspace already reads them (`layer_content`, `layer_messages`). **While you were away** lists results finished since the project was last opened (for example "Part B layers 3 to 6 are written") and marks them seen when dismissed. Nothing is shown unprompted anywhere else: no badges, no notifications. Tasks can be cancelled (kill the child process), and a failed task says what went wrong and how to fix it.
Tests: Vitest: queue order (foreground before tasks), the 2-process cap, cancel kills the child, a usage-limit error pauses the queue rather than failing every task, the task-to-agents mapping, and "seen" bookkeeping. Playwright (fake engine): approve a Part and prefetch it, see the agents go busy, reload mid-task and still see them busy, finish, reopen the project and see the card, open a result on the right layer, dismiss it and not see it again.

### Phase 8: Portfolio finish
Tests: lint, typecheck, Vitest and Playwright all green. **Eval script** (`scripts/eval-feedback.ts`): on the demo, 5 sample write-backs (good, wrong fact, vague, wrong name, off-topic) run through the layer review plus 5 Let's talk! questions; every citation must resolve to a real passage, no fix may cite a page that was not sent, and each cleaned-up version must keep most of the draft's wording. The score goes in the README. The score goes in the README. A secret and path scan of `git ls-files`. README and `docs/DECISIONS.md`.

---

## 7. Skills: what each is for

| Skill | I'll use it for |
|---|---|
| superpowers (`brainstorming`, `writing-plans`, `test-driven-development`, `verification-before-completion`) | process: plan first, tests before code, verify before saying done |
| frontend-design, canvas-design | Phase 1 design lab and the visual system. canvas-design is a possible fit for the README hero image |
| Impeccable (`/impeccable audit`, `detect`, `polish`, …) | the audit after each UI phase and the AI-tell detector |
| Emil Kowalski (`animate`, `review-animations`, `animation-performance`, `choreograph`, `emil-design-eng`, `break-ui`) | the overview's scenes and zoom, the home entrance, and the workspace's quiet moments (toggle, pane collapse, message arrival), plus worst-case-data checks (very long titles, 40-section units, a 5,000-word section) |
| taste-skill | **Limited fit. See the caveat in section 8** |

## 8. Install report (Step 1)

| Source | How it installed | Status |
|---|---|---|
| anthropics/skills | `claude plugin marketplace add` + `install example-skills` (project scope) | ✔ includes `frontend-design` and `canvas-design`. It also pulled in the rest of that bundle (pdf, docx, pptx, …). That's harmless, but those are extra skills |
| pbakaus/impeccable | plugin, project scope, v4.8.0 | ✔ |
| obra/superpowers | `superpowers@claude-plugins-official`, v7.0.0 | ✔ |
| Leonxlnx/taste-skill | plugin, project scope, v2.5.0 | ✔ installed, **but see caveat** |
| emilkowalski/skills | Its only install route is `npx skills add`, which needs Node, and the repo has no plugin manifest. **I copied 10 web-relevant skill folders into `.claude/skills/`** instead | ✔ (left out: write-swift, animate-expo, mobile-native, apple-design, ask-sonner, pick-ui-library, prototype) |

- **Detection:** the four plugins are installed and enabled, but **Claude Code only loads plugin skills when a session starts, so they won't show in `/skills` until you restart.** Please run `/skills` after restarting to confirm. I checked the files on disk and read the SKILL.md for each.
- **taste-skill caveat:** v2.5 is built for marketing-site pages (hero, one section per screen, stock photos, shader effects). Margin is an app UI, and several of its house rules conflict with CLAUDE.md. I'll use it only as an anti-slop reviewer, not to generate layouts.
- **Nothing failed to install.** I changed `.claude/settings.json` (new) and added `.claude/skills/` (new, untracked).

## 9. Open questions

**Resolved (plan approved):** 1) Node 22 LTS installed via nvm. 2) Pre-generated demo seed, committed. 3) `.claude/skills/` gitignored, only `.claude/settings.json` committed, and skills are listed with links in the README. 4) Mastery weights approved as a starting point. 5) Native execution, no subagents.

Original questions, kept for the record:

1. **Install Node 22 LTS?** I'd need to install it (the official `.pkg` from nodejs.org, or Homebrew, which you also don't have). I won't do this without your OK. Phase 1 can't start without it.
2. **Demo content, my call:** ship a **pre-generated demo map and written sections** as committed seed data, built once by `npm run demo:build`, so the demo opens instantly and works even if Claude is unavailable. The tutor, quiz and teach-back would still call Claude live. The alternative is generating the demo on first run, which is slower and needs Claude. OK to go with the pre-generated seed?
3. **Commit the `.claude/` folder?** Committing `.claude/settings.json` and `.claude/skills/` makes the repo self-describing for a portfolio, but the copied Emil skills carry his licence. I'd commit settings only and gitignore `.claude/skills/`. OK?
4. **Mastery rule (section 3):** are the weights and the "Solid ≥ 75 and teach-back ≥ 2" threshold fine as a starting point? They're easy to change later, since they live in one pure file.
5. **Execution style once you approve:** superpowers offers *subagent-driven* (a fresh agent and reviewer per task, thorough but costs more usage) or *native* (I do it here, with one review at the end). Because every phase here is committed and checked by you before the next one starts, I'd recommend **native**.

## 10. Risks I'll watch

- **Layer quality is the product now.** A bad breakdown, or an Explained tab that drops a name, undermines the loop. The approval gate, the validators and the eval exist for this. Expect to tune the prompts on a real course early.
- **Opus usage.** Every write-back review is an Opus call. Long drafts plus the layer's passages can be a few thousand tokens each. If the plan's limit bites, the first levers are `MARGIN_MODEL_EXPLAIN=sonnet` and `MARGIN_MODEL_REVIEW=sonnet`, which need no code change.
- **The reviewer approving too easily or too harshly.** "APPROVED" is a model judgement. The prompt defines it (no factual errors, all key terms and names present, clear) and the eval checks a wrong-fact draft is never approved.
- **Cleaned-up version drifting into the AI's voice.** Guarded by the wording-overlap check and a stricter retry.
- A layer built from passages in the middle of a section must still show page markers correctly. The Source verbatim test covers it.
- `better-sqlite3` is a native module, so it needs Xcode command-line tools to build. `git` works, so they're probably there, but I'll confirm at Phase 2 (done).
- `pdfjs-dist` in Node needs the legacy build with the worker disabled. The browser viewer uses the normal build.
- A Playwright run launches a browser, so Chrome or Chromium has to be available (`npx playwright install chromium`).
- Spawning `claude` on every action adds startup latency (~1.5 s time-to-first-token in my tests). Opus at medium effort will take longer for a review, so the review shows a calm "Reading your write-back" state.
- Scroll-pinned scenes with many motion values could drop frames on a real course. Watch this in Phase 4 and move word-level ink to a simpler reveal if needed.

## 11. Redesign: decisions and what changed

**You decided:** (1) layers replace sections in the UI; sections stay as the hidden import and search layer. (2) Retire the section-era features (Quiz me, Teach it back, Connect it, Explain differently, mastery marks, spaced review, per-section chat) but keep Let's talk!, and keep all five agents with new jobs. (3) Note to Self is replaced entirely and holds only final writing.

**Kept unchanged:** import and sectioning (Phase 2), the design system and every aesthetic decision, the home, overview scenes, zoom, generative backgrounds, the dining hall, search and citations, the engine and its isolation.

**My calls (overrule any):**
1. Layers reference **passages**, not whole sections, so a topic can start mid-section.
2. Demo structure is read-only, but **write-backs on the demo are allowed** (they are the point of the demo). Its layers and Explained text are pre-generated seed data.
3. **Part split** is proposed at the unit boundary nearest the middle by word count, and I can move it on the approval screen.
4. **Progress counts saved layers** ("4/7 layers saved"). *(Study loop v2; was approved or good enough.)*
5. **Note to Self holds the version you chose** after each review, your own or the refined one, labelled. *(Study loop v2; was the last final.)*
6. **Models:** Opus 5.5 at medium for reviews, re-explains, Explained and the Source picks (your later change); Sonnet for the Part split, the layer breakdown proposal and Let's talk!. All env-configurable.
7. Reviews are **non-streamed structured output** so the three parts and the verdict are always complete and validated. The "I don't get it" command is **detected by code**, never by the AI. *(The "good enough" command is gone in v2.)*
8. **Marks:** hollow ring = not saved, filled plum = saved; oxblood is no longer a mastery colour (errors only). *(Study loop v2.)*
9. The **Part synthesis** is never locked; it notes unfinished layers but doesn't block.
10. Phase numbers 6 to 8 are unchanged; the new work is Phases 3, 3b, 4 and 5.

**Resolved:** demo write-backs were my call above; nothing else is waiting on you except approving this plan.


**Study loop v3, change 3 (Note to Self, same branch).** (1) The right page is editable: click into a saved write-up, edit, autosave (700ms), `->` becomes `→`; `editSaved` updates `note_saves.text` and the same text in the layer's write-back pane (the submitted text for "own", the cleaned-up version for "refined"); an empty edit is refused. (2) The quick-notes and write-up boxes are plain text on the paper (no border, outline, shadow or background even when focused), like the Notepad. The gold dot some browsers show at the corner of a text box is not from Margin (it is a writing-assistant extension such as Grammarly); the boxes carry its opt-out attributes (`data-gramm="false"` and friends). (3) The Note to Self chat is its own conversation: `talk_messages.channel = 'note'` (migration 0009 moves earlier highlighted-passage messages and their replies over from Let's talk!), its own header and labels, no link to the Let's talk! section, ignored by the Librarian. Same engine path as Let's talk! (search the whole course, citations checked and stripped if not sent, `talk` model = Sonnet), with a study-partner prompt that also gets the student's notebook (`notebookText`: saved write-ups and quick notes per layer, capped at 6,000 characters). (4) Chat replies render markdown through `components/ui/Markdown.tsx` (bold, italic, code, bullets, numbers, headings as bold, line breaks; elements only, never HTML; citations still buttons; an unclosed mark stays plain while streaming), in both chats. Tests: unit (`tests/unit/notebook.test.ts`, `tests/unit/markdown.test.tsx`) and Playwright (`tests/e2e/notebook.spec.ts`).

**Notepad, full page (on `main`).** The Let's talk! Notepad is the full page, not a narrow centred sheet, and it has no headings outline (that earlier idea is dropped). The toolbar (Heading, Bullets, search) and the text span the whole width with side margins equal to the page header's (`clamp(24px, 3.4vw, 48px)`); "Saved" sits at the far right end of the toolbar; the writing area (`.m-np-page`) fills the page height (`.m-np-body` / `.m-np-wrap` are flex columns), so a click anywhere below the text puts the caret at the end. Still no box, border or frame; autosave, headings, bullets and search are unchanged. Test: `tests/e2e/talk-section.spec.ts` ("Notepad") checks the edges against the header, the toolbar and status position, the height, and typing after a click below the text.
