# Margin: build prompts for Claude Code

Paste these **one at a time** into Claude Code, from inside the `margin` folder. Wait for each phase to finish, check it in the browser, then paste the next one. If something looks off, tell Claude Code exactly what in plain words before moving on.

---

## Phase 0: Setup, skills and plan

```
Read CLAUDE.md carefully. It is the spec for this project.

Step 1: Install these design and workflow skills/plugins into this project, following each repo's own README install instructions (clone or plugin install as the README says). Then confirm each one is detected by running /skills (or listing .claude/skills):
- anthropics/skills: install the "frontend-design" and "canvas-design" skills
- pbakaus/impeccable: design audit and refinement commands
- emilkowalski/skills: motion and animation principles
- Leonxlnx/taste-skill: anti-generic-UI skills
- obra/superpowers: planning, spec-first and test-first workflow plugin
Read each skill's SKILL.md so you know when to use it. If any repo has moved or fails to install, tell me and continue with the rest.

Step 2: Check my machine: node -v (need 20+), git, and that the claude CLI works headless with this exact test, and show me the output:
echo "Reply with the single word: ready" | claude -p --output-format json --tools "" --no-session-persistence --max-turns 1
Also run claude --help and confirm these flags exist: --output-format stream-json, --include-partial-messages, --json-schema, --system-prompt, --tools, --strict-mcp-config, --no-session-persistence, --max-turns. Report any that differ.

Step 3: Use the superpowers brainstorming/planning workflow to write docs/PLAN.md: the architecture (folders, data model, API routes, the AI engine), the phase list from PROMPTS.md, and the tests for each phase. Don't write app code yet. Show me the plan and wait for my OK.
```

---

## Phase 1: Design system first

```
Using the frontend-design skill (and taste-skill), design Margin's visual system from the "Design system" section of CLAUDE.md BEFORE building features.

1. Propose 3 concrete variations of the visual direction. Each has its palette (light + dark), the font pairing (display / text / label), surface and shadow treatment, and one signature motion. Show them on a page I can open: /design-lab. Wait for me to pick one.
2. After I pick, set up the project: Next.js App Router + TypeScript strict + Tailwind v4 + Motion. Turn the chosen system into tokens (CSS variables) in app/styles/tokens.css, plus a /style-guide page showing type scale, colours, paper and desk surfaces, mastery marks, buttons, inputs, the Original/Explained toggle, chat messages and citations.
3. Build the core components with Motion, following Emil Kowalski's motion skill: <Workspace> (three panes, drag-to-resize, collapsible left pane), <ViewToggle> (Original | Explained with a sliding thumb and a content crossfade), <MarginGutter> (page markers and citations), <Message> (arrives with a short fade and rise). Respect prefers-reduced-motion.
4. Run the Impeccable audit on /style-guide and fix what it finds. Take a Playwright screenshot of /style-guide and /design-lab and look at them yourself before telling me it's done.
Commit.
```

*Direction update (final):* I picked **Reading Room**, with the rule **cinematic outside, calm inside**. The three-pane workspace at /design-lab is where I study and stays quiet. A scroll-driven overview at /design-lab/overview carries the expressive motion and zooms into the workspace. Margin has no decks, no card flipping, no course map and no margin agents. The tokens, /style-guide and audit above still apply, to this direction.

---

## Phase 2: Projects, import and the section map

```
Build data and import.

1. SQLite (better-sqlite3 + Drizzle), stored in an app-data folder (dev: ./.data, gitignored). Tables: projects, files, units, sections (with the verbatim original as ordered blocks with page numbers), passages (+ FTS5 virtual table), chats (per section), notes, questions, reviews (mastery + schedule), ui_state. Migrations included.
2. Import: a "New project" flow. Pick a folder (webkitdirectory) or drag one in. Parse PDF (pdfjs-dist, keep page numbers), DOCX (mammoth), PPTX (jszip, keep slide numbers), TXT/MD. Show each file reading live as a row with a per-file status.
3. Unit detection from folder/file names (week|module|unit|lecture|chapter|topic|session + number). Syllabus files go to a "Course overview" unit. Unit tests for the detector with tricky names ("Wk03", "Lecture_12 slides", "POL101 Syllabus F26").
4. Split each file into sections by its own structure, in reading order: headings, then numbered or named parts, then slides (grouped, never split), then page ranges for PDFs with no headings. About 5-10 minutes of reading each (roughly 1,100-2,300 words). Do this with code, not AI. Never rewrite, summarize, reorder or drop text: store the original verbatim with page numbers (cleaning is formatting only: rebuild paragraphs, rejoin line-break hyphens, lift running headers and page numbers into page markers). A test must prove that a file's sections joined together equal its text after whitespace and hyphen normalisation.
5. A review step before opening: units shown as lists with their sections. I can rename a unit, move a file to another unit, merge two units and remove files.
6. Index each section's passages (~180 words, with file + page/slide) in FTS5. Unit test that page numbers stay right.
Commit.
```

---

## Phase 3: The AI engine (Claude Code headless)

**Superseded for the study-method redesign:** the prompts for Phases 3, 4 and 5 below describe the old section-based design. The authoritative versions are Phases 3, 3b, 4 and 5 in `docs/PLAN.md`; I'll rewrite these prompts from there once the plan is approved.

```
Build lib/ai exactly as the "AI engine" section of CLAUDE.md says.

1. engine.ts interface: complete(), stream(), json(schema). ClaudeCodeEngine spawns the official claude binary as a subprocess with the flags in CLAUDE.md, sends the prompt on stdin, parses stream-json events into text deltas, supports AbortController (kills the process), has a concurrency queue (max 2), and clear errors for "claude not installed", "not logged in" and "usage limit reached". AnthropicApiEngine is a stub selected by env var. Never touch OAuth tokens.
2. An SSE route /api/ai/stream for chat streaming, and server actions for JSON tasks.
3. Retrieval: search(projectId, query, k, {unitId?, sectionId?}) using FTS5 BM25, returning passages with file + page. Citations: prompts require [file, p. N]. A parser turns them into citation tokens the UI can render.
4. Prompts in lib/ai/prompts/, each a typed function with a Zod output schema:
   - whyItMatters: 3-4 sentences linking the section to what came before and after.
   - explainSection: a plain-English walkthrough of the same section as short paragraphs. Every paragraph cites [file, p. N], and every citation must point at a page that exists in that section's original text. It never alters or replaces the original.
   - courseOverview: through-line, assessments if the syllabus lists them, a why-it-matters for each unit, and a one-line focus for each section (the overview shows these).
   - tutor, explainDifferently(mode), quizNext (adaptive, one question), gradeQuizAnswer, gradeTeachBack (right / missing / misconceptions with citations, plus a 0-3 score), connectSection, answerQuestions (for notes).
   All prompts: plain English, use only the files, keep names/dates/numbers exact, never invent quotes, label general knowledge "Beyond your files:".
5. Titles: a sectionTitle prompt gives every section a short, meaningful title from its content (and names the "part N of M" pieces of long readings). Display only; the Original is never touched. Keep the file's own real heading as the source line.
6. After import, run courseOverview in the background (the app is usable before it finishes). Why-it-matters and Explained are written lazily the first time a section is opened, then cached, with a calm "Writing this section" state in the reading pane. The Original is never generated.
7. Unit tests with a fake engine. One real smoke test (skipped in CI) that runs claude -p once.
Commit.
```

---

## Phase 4: Home, the overview and the workspace shell

```
Build the main experience with the Phase 1 components. Cinematic outside, calm inside.

1. Projects home: my projects shown with a striking but clean entrance, each with its course code and progress, plus "New project", and Review today and Notes entries. A demo project (public-domain Federalist Papers excerpts, read-only) is offered on first run.
2. Project overview at /p/[projectId]: promote the /design-lab/overview mockup to real data. Each unit is a full-screen scene I scroll through, in course order, using these where they fit (not all at once):
   - Headline push-in: the unit title scales and settles in as the scene enters.
   - Teardown: the unit explodes into its sections, each separating out with a thin leader line and a label (title, one-line focus, mastery mark), like an exploded product diagram.
   - Ink reveal: the unit's "why this matters" fades in like ink.
   - Stat chart: a small animated tally of sections solid / shaky / new for that unit.
   - A slim progress rail showing where I am among the units.
   Smooth scrolling with Lenis, scroll-linked animation with Motion's useScroll. Keep the Reading Room palette and fonts. With prefers-reduced-motion it falls back to a plain page with simple fades.
3. Transition: clicking a section card does a shared-element zoom from the card into the workspace, opening on that section. Coming back returns me to the same scene.
4. The workspace at /p/[projectId]/s/[sectionId]: three panes, simple and quiet, with no extra effects.
   - Left: the section list grouped by unit, each group collapsible, the whole pane collapsible, a small mastery mark per section, Review today and Notes at the bottom.
   - Middle: section title, source (file + pages), the "Why this section matters" box, then the Original | Explained toggle. Original is the exact stored text, cleanly formatted, with page markers in the margin gutter. Explained is the written walkthrough with [file, p. N] citations in the same gutter; clicking one switches to Original and highlights that page marker. The toggle is a smooth transition and remembers my choice per section (and my scroll position per view).
   - Right: the chat panel placeholder (wired up in Phase 5).
   - Cmd+K as a small optional extra: actions, jump to a section, open Notes. "note to self" and ( ) questions work there too.
5. Panes resize by dragging; the edges also work with arrow keys. The left pane starts collapsed at 1024px wide.
6. Keyboard: J/K or [ and ] move between sections, no animation on keyboard moves. Esc closes the source viewer.
7. Check it in the browser (screenshots at 1440 and 1024 wide, including mid-scroll), run the Impeccable audit, fix, commit.
```

---

## Phase 5: The chat panel and all interactions

```
Build the right pane, the heart of Margin's interaction.

Layout: chat for THIS section only, with its own saved history. Above the input: the action buttons. Citations in chat open the source viewer.

1. Source viewer: a slide-over panel rendering the original PDF page (pdfjs) or slide text, with the cited passage highlighted.
2. Action bar: Explain differently (simpler / with an example / as an analogy), Quiz me (one question at a time, adaptive, about this section only, with feedback), Teach it back (a writing area, then a graded result showing what was right / what's missing / misconceptions, with citations), Connect it. Free typing in the input is Ask anything (section-scoped, streaming, searches the whole project when needed and names the file, labels general knowledge "Beyond your files:").
3. Messages stream in; there is a Stop button; history persists per section and reloads with the section.
4. Notes: any message starting with "note to self" is saved; text inside ( ) becomes a question answered automatically with citations, shown underneath. A Notes view lists notes and questions with answers, "open section" links, delete and copy all.
5. Mastery: update New / Shaky / Solid from quiz and teach-back results; schedule reviews (1, 3, 7 days for shaky). Review today lists what is due and opens the section.
6. Let's talk! (text only): a second tab at the top of the chat pane, next to "This section", also reachable from the project overview. One conversation per project with a professor-like agent that searches ALL of the project's files (project-wide retrieval, not section-scoped). It explains, pushes back, may ask a question back, says which file an answer comes from, cites [file, p. N] (validated against what it was sent), labels general knowledge "Beyond your files:", and quizzes only when asked. New table talk_messages, prompt lib/ai/prompts/professor.ts, route POST /api/projects/[id]/talk (SSE, cancellable). Its history is per project and separate from section chats. Tests: project-wide retrieval, citations resolve, history persists, never mixes with section chats, Stop cancels.
7. Playwright test of the full flow on the demo project with the fake engine, including Let's talk! (ask something that lives in another unit, the reply cites that file, the citation opens the source viewer). Screenshot and look. Impeccable audit. Commit.
```

---

## Phase 6: Polish pass

```
Polish Margin like a product designer would.
1. Run Impeccable's full audit and its AI-design-tell detector on every screen. Fix everything that's real.
2. Apply Emil Kowalski's motion principles: check every animation's easing, duration and purpose, remove anything that doesn't earn its place, and make sure the overview's scenes and the zoom feel cinematic, and that the workspace stays calm (toggle, pane collapse and message arrival only).
3. Empty states, loading states ("Writing this section"), error states (claude not logged in, usage limit, unreadable PDF), all with plain, warm copy.
4. Accessibility: focus states, keyboard paths, contrast, aria for the card interactions.
5. Dark mode (walnut desk, the default) and the light tan desk checked on every screen. Stress-test long titles and very long sections.
Screenshots before and after. Commit.
```

---

## Phase 7: Background agents
Make the mocked agents real. Read "Phase 7" in `docs/PLAN.md`: a task queue on the Claude Code engine, bigger requests become background tasks, the agents show what is running, and "While you were away" lists what finished. No unsolicited notifications. Test with the fake engine, then commit.

## Phase 8: Portfolio finish

```
Make Margin portfolio-ready.
1. README.md: a one-line pitch, a GIF of scrolling the course overview, zooming into a section, switching Original to Explained and asking the tutor a question, why I built it (learning by interacting in sections), features, an architecture diagram (Mermaid: Next.js UI, SQLite + FTS5 retrieval, the Claude Code headless engine with streaming, Zod-validated structured outputs), the design system ("cinematic outside, calm inside") and its decisions, how to run it locally, and what I'd build next.
2. docs/DECISIONS.md: short notes on key decisions (Claude Code headless vs API, FTS5 vs embeddings, lazy section writing, the mastery schedule).
3. An eval script: run 10 tutor questions on the demo project and check every answer cites a real passage. Report the score in the README.
4. Clean up: lint, typecheck, tests all green. No secrets, no .data, no personal course files in git.
5. Help me create the GitHub repo and push it (I'll log in when asked).
```
