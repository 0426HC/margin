# Margin

Margin is a local study app and reading workspace. You drop in a course folder (PDFs, Word, PowerPoint, notes) and it splits every file into **sections that follow the file's own structure**. You read the original text, as you would read an essay in a seminar, with a tutor beside it that only knows about that section.

The rule for the whole product is **cinematic outside, calm inside**: the layers before studying (projects home, project overview) carry all the expressive motion. The three-pane workspace, where the studying happens, stays simple and quiet.

It is built by one student, for the creator's own use. It is also a portfolio piece, so code quality, design quality and the README matter as much as features.

---

## Product

### The core loop (the study method)
Margin teaches a course **layer by layer**: the AI explains one layer, **I write it back in my own words**, and the AI gives specific feedback until I get it right.

**Bring material in → split it into Part A and Part B, and each Part into layers (I approve the breakdown) → read a layer's Explained tab and check it against its Source tab → write the layer back → the layer's chatbot reviews it → revise and resubmit as often as I like, and each time choose whether to send it to Note to Self (my own writing, the refined version, or neither) → after the last layer of a Part, write one synthesis of the whole Part, same loop → what I sent collects in Note to Self, my study guide for the exam.** Beside the Parts sits **Let's talk!**: one project-wide conversation with my professor, the sources the Librarian collects from it, and a notepad.

Margin is a reading, writing and feedback workspace. It is **not** a flashcard app and it is not a summary or quiz app: passive features (reading summaries, quizzes alone) are deliberately not the centre. No decks, no card flipping, no drag-to-sort, nothing locked behind anything else.

### The three layers of the app
1. **Projects home**: your projects, with a striking but clean entrance. Each shows its course code and progress.
2. **Project overview**: opening a project is a scroll-driven chapter experience. One full-screen scene each for **Part A**, **Part B**, **Let's talk!** (its own card) and **Note to Self** (see below).
3. **The workspace**: clicking a layer sheet does a shared-element zoom from the sheet into the three-pane workspace, opening on that layer. This is where you study and write.

### Objects
- **Project**: one course, book or topic. Has files and, after import, Part A, Part B and Note to Self.
- **Part**: Part A is the first half of the course (for example weeks 1–6), Part B the second half (weeks 7–12). The split point is proposed from the course's own structure (the middle unit boundary) and I can move it. Each Part has an ordered list of layers and ends with a **Part synthesis**.
- **Layer**: a sub-section of a Part, split **by topic**, not by a fixed number and not strictly by week. A week with two big topics can become two layers; two short related weeks can become one. Roughly **4–8 layers per Part**. Each layer has a **title** and the one **big question** it answers, and the layers build on each other. A layer is made of an ordered set of the course's passages (see "Layers follow topics, text follows the files"). I can open any layer in any order: nothing is locked.
- **Explained** (tab 1): a plain-language explanation of the layer, written by Claude, cached. Style (the prompt must enforce all of this):
  - Start from the basics underneath the concept, before course terms.
  - Explain every name, author, case or term the first time it appears (who or what it is and why it matters). Never drop an unexplained name.
  - Concrete examples. Analogies only if they hold up.
  - Topic-by-topic sections with bullets; tables for typologies (for example a 2x2 with an explanation in each cell). No story or narrative format.
  - End with the layer's key **so what**: how it connects to the bigger argument and to other layers.
  - Every factual claim comes from my course files and carries a `[file, p. N]` citation.
- **Source** (tab 2): the exact original text the explanation is based on, as direct quotes and paragraphs from my files, each with its **file name and page number**. **Verbatim only, never paraphrased.** It exists so I can check the explanation against the real material. The quotes are **copied by code** from the stored text; the AI only picks which passages (see below).
- **Write-back**: my own writing of a layer. I submit it and the layer's chatbot reviews it (see "The review loop").
- **Saved version**: what I chose to send to Note to Self after a review: **my own writing** (as submitted) or the **refined version** (the chatbot's cleaned-up text). One per layer; a newer "Yes" replaces the earlier one, "No" leaves it alone. Only saved versions go to Note to Self.
- **Part synthesis**: one combined piece, written by me after the layers of a Part, pulling them together in my own words. Same review loop, same save question.
- **Note to Self**: only what I saved, in course order, each entry labelled **My own writing** or **Refined version**. It is my personal study guide for the final exam, and it is a **notebook** (see "Note to Self, the notebook"). (Open question, see docs/IDEAS.md: keep it, or turn it into a Study Guide / one-page cheat sheet.)
- **Let's talk!** (a section of every project, beside Part A and Part B): **Chat** (one shared conversation per project), **Sources** (verbatim passages the Librarian collects from that conversation, grouped by topic) and **Notepad** (one never-ending page of my own notes, autosaved). See "Let's talk!".

### Layers follow topics, text follows the files
Import is unchanged and stays **deterministic code, not AI**: files are cut into verbatim sections (headings → numbered or named parts → slides → page ranges, 1,100–2,300 words, never spanning two files), each section is split into passages of about 180 words with file + page, and passages go into the FTS5 index. Original text is stored exactly as in the file, with page or slide numbers; cleaning is formatting only (paragraphs, hyphen rejoin, running headers and page numbers lifted into the margin). Sections and units are now the **import and search layer**, not something I navigate: they feed the layer breakdown, retrieval and the Source tab. The review step before opening still lets me rename, merge and move units.

The AI's jobs around structure are limited and always checked by code:
1. **Propose the Part split and the layers.** The AI sees unit names, section headings and one-line previews and proposes where Part A ends and which topics form the layers. Its output is a list of layers, each a list of passage ranges. Code validates it: every passage belongs to exactly one layer (none missing, none twice, none unknown) and layers don't cross Parts; a layer is flagged if it is very short or very long. A layer may take passages from several readings, because a topic can run through more than one, and layers are ordered so each builds on the one before, not by reading order. Invalid output is retried once with the reasons, then falls back to a plain split by unit, and the student is told when that happened.
2. **Approval gate.** **Before any layer content is generated, I see the proposed breakdown for each Part and approve or adjust it** (rename, change the big question, merge, split, reorder, move the Part split). Nothing is written until I approve.
3. **Choose the Source.** For each approved layer the AI returns passage ids (and sentence ranges) that the explanation rests on. Code copies the exact text out of storage. Any quote that is not found verbatim in the stored text is dropped, never shown.
4. **Write Explained** from those passages, cached, with every citation checked against the passages that were sent.

### The review loop (the layer chatbot)
The right pane of a layer holds my **write-back area** and the layer's chatbot, with its own saved history. When I submit a write-back, the chatbot replies with exactly three things (and then asks one question):
1. a short list of **specific fixes**: factual errors, wrong or missing terms or names, vague or unclear sentences, grammar;
2. a **cleaned-up version of MY writing** that keeps my wording wherever possible (it fixes, it does not rewrite in its own voice);
3. one **"so what"** sentence linking the layer to the bigger argument.

and a verdict, **APPROVED** or not yet, **shown for information only**: it decides nothing. The same reply ends with **"Send to Note to Self?"** and three buttons: **Yes, my own writing** / **Yes, refined version** / **No**. Rules:
- **"I don't get it"** (a button, or those words in my message) makes the chatbot explain again, more simply or from a more basic level, and then ask me to try again.
- I revise and resubmit as often as I like. There is no approval loop and no "good enough" command (typing it is just a write-back). The saved version is whatever I last said "Yes" to; the choice shows on that reply ("In Note to Self: my own writing").
- Feedback is grounded in my course files (the layer's own passages first, then project-wide search) and every factual correction cites `[file, p. N]`. The chatbot never invents facts, quotes or page numbers; a citation that was not in what it was sent is stripped.
- Drafts and chat history stay in the layer. Only the version I chose with the save question goes to Note to Self, labelled.
- The layer chatbot runs on **Claude Opus 5.5 (`claude-opus-5-5`) at medium effort**, configurable through the engine interface.

### Part synthesis
After the layers of a Part, a **Part synthesis** step (always reachable, never locked; it gently notes any layers I haven't saved) lets me write one combined piece in my own words. It uses the same review loop (fixes, cleaned-up version, so what, verdict for information, then "Send to Note to Self?"), grounded in the Part's passages and the layer writing I saved.

### Progress
Progress is shown per Part, for example **4/7 layers saved**, on the home tile, the overview and the layer list. A layer is **Saved** (a version is in Note to Self) or **Not saved**; that is all. The synthesis counts separately. **Nothing is locked**: any layer, in any order, and the synthesis at any time. Each state has a mark **and** a word, so it reads without colour: a hollow ring (not saved) or a filled plum mark (saved).

### The project overview (one scene per Part, then Let's talk!, then Note to Self)
Each Part scene is full-screen and scroll-pinned. **Let's talk!** is a full screen of its own with one card (Chat, Sources, Notepad, with live counts, and the Librarian); its headline settles in on scroll. These motion styles are the vocabulary; use the ones that fit, not all at once:
- **Headline push-in**: the Part title scales and settles in as the scene enters.
- **Teardown**: the Part "explodes" into its layers like an exploded product diagram. Each layer is a sheet that separates along an axis, with a thin leader line to a label (layer title, its big question, its progress mark).
- **Ink reveal**: the Part's short "what this Part is about" darkens into the page, word by word, as you scroll.
- **Stat chart**: a small animated tally of layers saved / not saved, readable without colour.
- **Progress rail**: a slim rail showing where you are among Part A, Part B, Let's talk! and Note to Self, with a tick to jump to each.

The Note to Self card on the overview opens the notebook (below). A "Continue" button (the next unfinished layer) is always one click away in its top bar. Smooth scrolling comes from **Lenis**; scroll-linked animation from Motion's `useScroll`. With `prefers-reduced-motion` the overview is a plain page with simple fades, no Lenis and nothing pinned.

### Note to Self, the notebook
Opening Note to Self plays a short cover animation (a navy cover swings open on its left edge, about 1 second; none under `prefers-reduced-motion`), then shows an **open book** centred on the desk: two plain pages side by side, rounded outer corners, a plum margin line on each page, a spine shadow down the middle. The Margin top bar stays; there is **no layers sidebar**.
- **The only text on the pages is mine:** my saved write-ups on the right and my quick notes on the left. Margin prints no title, intro, headings, labels, "Saved" tag, layer titles, big questions, links or placeholder, and there are **no ruled lines** and no dividers.
- **Layers I haven't saved are hidden.** Saved ones flow down the book in course order (Part A's layers, Part A synthesis, then Part B the same), told apart by a little extra space only. Each layer's notes start level with its write-up. Normal comfortable line spacing, so the book stays short.
- **Left page, quick notes:** just text on the paper (no box, border or frame, like the Notepad), freely editable, autosaved, `->` becomes `→` as I type. A small **Draft from my write-up** button appears only while the pointer (or focus) is in that layer's notes: it turns the saved write-up into short arrow-style notes for me to edit (Sonnet; only what the write-up says). Stored per layer per project in `quick_notes`, separate from the Let's talk! notepad.
- **Right page, my write-up:** the saved text, and I can click into it and edit it in place: autosaved, `->` becomes `→`. The edit changes that layer's saved write-up everywhere (the layer's write-back pane shows the same text; the version label stays).
- **Chat on the right, fixed:** it stays in place while the book scrolls, has its own scroll, and collapses. It is its **own conversation** (own history, own header "Ask about your notes", answers labelled "Notes guide"), not the Let's talk! professor chat and not read by the Librarian. It has the same abilities: it searches the whole course, answers cite `[file, p. N]` and a citation that was not in the passages sent is stripped. It also knows my saved write-ups and quick notes (as they are now, edits included).
- **Highlight to ask:** selecting text on either page shows an "Ask about this" chip. The chip (or typing a question while text is selected) pins that passage at the top of this chat as the current topic; the professor answers about it, grounded in my files with citations (for example "how can I write this more thoroughly?"), and stays on it until I highlight something else, which starts a new topic. Earlier topics stay in the history with their passage as a header. Sonnet; history saved per project. Chat replies in both chats render markdown (bold, italic, bullets, numbers, line breaks); citations stay clickable.

### The workspace (one screen, three panes)
- **Left: the layer list**, grouped under Part A and Part B (each collapsible, each with its progress and its Part synthesis), the whole pane collapses to give reading more room. Each layer has a small progress mark. **Note to Self** and Let's talk! sit at the bottom.
- **Middle: the reading pane.** Top: layer title and its big question. Then a segmented toggle **Explained | Source**.
  - *Explained* is what I read first. Citations sit in the left margin gutter and jump to the matching quote in Source.
  - *Source* is the check: the verbatim quotes, each with file and page in the margin.
  - The toggle is a smooth transition and remembers the choice **per layer**.
- **Right: the write-back and the layer chatbot**, with saved history. A large writing area ("Write this layer in your own words"), **Submit**, **I don't get it**. Replies show Fixes, Your version cleaned up, So what, the verdict (for information) and the "Send to Note to Self?" question. The pane defaults wider than before, because it holds long writing. A second tab, **Let's talk!**, continues the project's one conversation.
- Panes resize by dragging their edges (and with the arrow keys on the focused edge).
- **Cmd+K** is a small optional extra: jump to a layer, open Note to Self, or search the files. Nothing depends on it.
- **Let's talk!** is a project-level section (route `/p/[id]/talk`, same three-pane shell without the right pane) with three tabs:
  - **Chat**: one shared conversation per project (Sonnet, grounded in all the project's files, answers cite `[file, p. N]`). The Let's talk! tab inside every layer continues the SAME conversation; a message sent from inside a layer carries a small subtitle above it ("From Layer 3: The large republic"). It is separate from the layer chatbots (their write-back history stays in the layer).
  - **Sources**: the **Librarian** reads what we discussed and collects verbatim passages from my files, with file and page, grouped by topic. The AI only picks passage numbers; code copies the text from storage, and a passage is never collected twice. It runs when I leave Let's talk! (leaving the section, switching the layer's Let's talk! tab away, or closing the browser tab, only if something new was said) and with a **Find sources now** button. While it works the agents show busy; when it finishes the result waits in "While you were away".
  - **Notepad**: one never-ending page per project, autosaved, with headings and bullets (stored as blocks, never as markup) and a search box. It is the **full page**: text and toolbar (Heading, Bullets, search, with "Saved" at the far right) use the whole width with the same side margins as the page header, the writing area fills the page height so a click anywhere below the text keeps typing, and there is no box, border or frame. No narrow centred sheet and no headings outline.

### Retired from the earlier design
The section-based workspace and everything built around one section: the Original | Explained toggle, Quiz me, Teach it back (replaced by the write-back loop), Connect it (replaced by the "so what" lines), Explain differently (replaced by "I don't get it"), the New/Shaky/Solid mastery marks, the spaced-review schedule and Review today, the per-section chat, and the old "note to self" / ( ) questions in Notes. Nothing else changes: import, search, citations, Let's talk!, the agents and the design stay.

### Home, backgrounds and the agents (outside layers only)
- **Generative backgrounds** are drawn in code (canvas), seeded from the project title so a course always looks the same. Never in the workspace.
- **The agents' dining hall** is a top-down room drawn in code behind each project tile and behind the overview's opening scene. Idle and done: all five agents (Explainer, Quizzer, Examiner, Connector, Librarian, original characters) sit at one round table. Busy: the view widens to five tables, one per agent, and agents run to each other's tables to talk. Done also shows a small dismissible "While you were away" card. The room is dimmed so text keeps 4.5:1 contrast (3:1 for the large headline); reduced motion gives a static room.
- **What each agent does now:**
  - **Librarian**: finds the passages, picks the Source quotes (copied verbatim by code), retrieves what feedback is grounded in, and collects the Sources of Let's talk!.
  - **Explainer**: writes each layer's Explained tab.
  - **Examiner**: reviews my write-backs and syntheses (the fixes, the cleaned-up version, the verdict for information).
  - **Connector**: writes the "so what" links, and proposes how the layers build on each other.
  - **Quizzer**: handles "I don't get it": re-explains more simply or from a lower level, then asks me to try again.
  The dining hall's busy state is driven by real tasks (the `agent_tasks` table; the Librarian's source collection is the first real one, the rest follows in Phase 7): which agent is working on which step.

### Home and demo mode
- **Home** shows your projects with a striking but clean entrance, each with its course code and per-Part progress, plus "New project" and Note to Self.
- On first run, offer a read-only demo project built from public-domain text (a few Federalist Papers) so the app can be shown without private course files. Its layers and Explained text are pre-generated seed data; write-backs on the demo are allowed but kept local. Never ship real course files or student data in the repo.

---

## AI engine (important)

- The AI runs through the **official Claude Code CLI in headless mode** (`claude -p`) on the creator's own laptop, using the creator's Claude plan. No Anthropic API key and no extra cost.
- **Do not** use the Claude Agent SDK with subscription credentials, and never read, copy or store Claude OAuth tokens. Anthropic's terms don't allow subscription logins inside other products. The app only spawns the official `claude` binary as a subprocess.
- Put it behind one interface, `lib/ai/engine.ts`, with a `ClaudeCodeEngine` (default) and an `AnthropicApiEngine` stub, so an API key can be swapped in later through env config.
- Invocation pattern (verify flags with `claude --help` before relying on them):
  - Spawn `claude` with: `-p`, `--output-format stream-json`, `--verbose`, `--include-partial-messages`, `--model sonnet` (configurable per task, see below), `--effort <low|medium|high|xhigh|max>` (only passed when a task sets one), `--system-prompt <text>`, `--tools ""` (no built-in tools), `--strict-mcp-config`, `--no-session-persistence`, `--max-turns 1` (3 when `--json-schema` is used: structured output needs two turns, and a third if the CLI has to fix a shape error itself; checked in Phase 3).
  - Use `--json-schema <schema>` for structured outputs: the Part and layer breakdown, Source passage picks, the Explained layer, write-back reviews (fixes, cleaned-up version, so what, verdict) and the Librarian's source picks (topics with passage numbers). Validate with Zod anyway.
  - Send the prompt on **stdin**, not as an argument, because prompts can be long.
  - Run with `cwd` set to an empty app-data directory, so no repo `CLAUDE.md` or project settings leak into tutoring calls.
  - Stream partial text to the browser over SSE. Support cancel by killing the child process.
  - Queue requests: at most 2 concurrent CLI processes. Show a friendly message when the plan's usage limit is hit.
- **Model and effort are per task and configurable** (`AiRequest.model`, `AiRequest.effort`, env `MARGIN_MODEL_<TASK>` / `MARGIN_EFFORT_<TASK>` for tasks `REVIEW`, `EXPLAIN`, `STRUCTURE`, `TALK`). Defaults: the layer chatbot (write-back and synthesis reviews, "I don't get it" re-explains) **and** the layer content (the Explained tab and the choice of verbatim Source quotes) use `claude-opus-5-5` at `medium` effort, for accuracy; the Part split and layer breakdown proposal (which I approve before anything is written) and Let's talk! use `sonnet`. The `AnthropicApiEngine` stub maps the same fields to the API.
- **Retrieval is done by the app, not by tools.** Search with SQLite FTS5 (BM25), take the top passages with file + page, and put them in the prompt. Prompts tell Claude to cite as `[file, p. N]`, and the UI turns those into clickable citations.
- All prompts live in `lib/ai/prompts/*.ts` as typed functions. No prompt strings scattered through components.

---

## Tech stack

- **Next.js (App Router) + TypeScript (strict) + React**, running locally (`npm run dev` / `npm start`).
- **Tailwind CSS v4** with design tokens as CSS variables. No component library defaults left unstyled. If shadcn/ui primitives are used, restyle them fully to the Margin system.
- **Motion** (`motion/react`) for the home entrance, the overview's scroll-linked scenes (`useScroll`) and the zoom into the workspace, plus the few quiet moments in the workspace itself.
- **Lenis** for smooth scrolling on the overview only. The workspace doesn't use it.
- **SQLite** via `better-sqlite3` + **Drizzle ORM**. FTS5 virtual table for passages. The DB and uploaded files live in `~/Library/Application Support/Margin/` (or `./.data` in dev). Never commit them.
- Parsing: `pdfjs-dist` (text + page numbers, and rendering pages in the viewer), `mammoth` (docx), `jszip` (pptx slide text), plain text and Markdown.
- **Zod** for every AI output and API boundary.
- Tests: **Vitest** (unit: unit detection, section splitting, verbatim-text guarantees, layer-breakdown validation, Source-quote verbatim checks, "over" detection, progress counts, the save-to-Note-to-Self choices, the Librarian's sources (verbatim, no duplicates), the notepad, quick notes, prompt builders, schema validation) and **Playwright** (main flows, all with the fake engine). A small **eval** script checks that layer feedback and Let's talk! answers on the demo project cite real passages.

---

## Design system: "Margin" (Reading Room)

**Direction: a reading room at midnight, cinematic outside, calm inside.** A navy desk under an overhead lamp, sheets of porcelain paper to read on, blue-black ink. **No green, gold, brown or yellow anywhere in the product.** Premium, like a well-made physical object, never a SaaS dashboard. Home and the overview are expressive and motion-led; the workspace is quiet. One palette and one set of fonts across all of it, so it feels like one product. Chosen from the Phase 1 design lab (the "Reading Room" variation).

- **Surfaces:** the app sits on a midnight desk (dark by default; a light mist desk is the alternative). The desk is the "Overhead lamp" gradient: navy-indigo pooled at the top centre falling to deep navy at the edges, with one faint plum glow in a corner; never a purple-to-blue sweep. The **reading pane is a sheet of porcelain paper**: the brightest, largest thing on screen. The side panes recede into the desk. Very subtle paper grain on paper surfaces only, never on the desk.
- **Depth:** paper has a 1px top-edge highlight and layered shadows (resting, raised). Radius 8px. No identical rounded-lg + shadow-md tiles. Depth is used to show what is paper and what is desk, not as decoration.
- **Palette (tokens in `app/styles/tokens.css`, chosen in `/design-lab/palette` as "Midnight and plum"):** midnight `#111827` (lamp light `#1f2a48` at the top of the desk gradient), porcelain paper `#edf0f6`, ink `#131b2d`, muted ink `#48536d`, ink blue `#233f8f` (the one accent on paper), plum `#d38ae0` on the desk and `#7d2c92` on paper (saved layers only), coral `#f07f73` / brick `#a5312a` (errors and the "needs work" note only). Progress marks are thin and never big fills: a hollow ring (not saved) and a filled plum mark (saved); each also has its word. **Unit and project accents** (home and overview only) come from one set of cool hues: cyan blue, sky, ink blue, indigo, violet, plum and orchid. No gold, amber, brown, green or red. No purple-blue gradients, no neon, no glow.
- **Type:** display **Bricolage Grotesque**, long reading **Literata** (generous leading, ~65ch measure), labels, page markers and citations **Courier Prime**. A real type scale. Sentence case, no tracked all-caps labels.
- **The margin:** citations (Explained) and file-and-page markers (Source) live in a left margin gutter beside the text. It is the product's signature detail and the reason for the name.
- **Motion outside (home, overview, the zoom):** this is where the personality lives. Scroll-linked scenes, a headline push-in, the exploded teardown, ink reveal, the shared-element zoom. Transform and opacity only. Each scene has one orchestrated idea at a time.
- **Motion inside (the workspace):** no extra effects. Only where it helps reading, 150–300ms, strong ease-out or a quiet spring, transform and opacity only (pane width during collapse is the one allowed layout transition, because the alternative distorts text). Moments: the Explained/Source toggle (sliding thumb, content crossfade with a few px of travel), chat messages arriving, pane collapse, the panes settling once after the zoom. Nothing animates on keyboard actions (layer navigation, Cmd+K).
- **Reduced motion:** always respected. Scenes fall back to simple fades on a plain page, and the zoom becomes a direct navigation.
- **Layout:** the workspace is three panes, laptop-first (1280–1600px), left list / middle reading / right chat. Nothing should break at 1024px (the left pane collapses by default there). Drag-to-resize panes.
- **Banned AI-slop tells:** emoji as icons, gradient text, glowing pills, generic card grids with identical rounded-lg + shadow-md, centered everything, purple/blue gradients, "✨ AI" badges, stock phrases in copy, fake testimonials or social proof.
- **Copy:** plain, warm, specific. Buttons say exactly what happens ("Submit", "I don't get it", "Yes, my own writing", "Yes, refined version", "No", "Find sources now", "Explained", "Source"). Errors say what went wrong and how to fix it.

Before building any new screen, use the installed design skills (frontend-design first, then the others) to plan it against this system. Run the Impeccable audit and the taste/anti-slop checks after each phase.

---

## How to work (adapted from the Karpathy CLAUDE.md principles)

1. **Think before coding.** State assumptions, and ask when something is ambiguous rather than guessing.
2. **Simplicity first.** Write the smallest code that does the job well. No speculative abstractions.
3. **Surgical changes.** Touch only what the task needs. Don't reformat or refactor unrelated code.
4. **Goal-driven.** Define "done" as checks (tests pass, flow works in the browser, screenshot looks right) and loop until they pass.

Also:
- Work in the phases in `PROMPTS.md`. Finish, test and commit each phase before starting the next. Use small, clear commit messages.
- After UI work, open the app in a browser (Playwright screenshot) and look at it before calling it done.
- Keep `README.md` current: what it is, a screenshot or GIF, architecture diagram, how the Claude Code engine works and why, how to run, design decisions, what's next.
- Never commit secrets, `.data/`, uploaded course files, or anything under `~/Library/Application Support/Margin/`.
