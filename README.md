# Margin

**A study app that makes you do the part that makes learning stick.**

Margin turns a course folder (PDFs, Word, PowerPoint, your own notes) into weeks, and each week into a few **layers**: one idea at a time, explained plainly, checkable against your own files, and then written back by you in your own words. Everything runs on your own computer, and every claim it makes points to a page you can open.

![A week of the demo course on the course page: its title, what it covers, and its layers drawn as an exploded stack of sheets](docs/readme/course-normal.jpg)

*All screenshots are the built-in demo course: a few of the Federalist Papers, which are in the public domain.*

## The method

Most AI study tools do the work for you: summaries, flashcards, quizzes. Reading a good explanation feels like learning, but it isn't the same as being able to give one. Margin is built around one loop:

1. **One layer at a time.** Each week is split into 2 to 5 layers, each with a title and one big question, building on the one before. It starts from the basics underneath the course. Nothing is locked.
2. **Explained, then checked.** A plain explanation of the layer, every fact cited to a page, with the verbatim source text beside it.
3. **Write it back yourself.** You explain the layer in your own words. This is the step that makes it stick.
4. **Specific feedback.** Fixes shown as "yours → fixed" in full sentences, a cleaned-up version that keeps your wording, and one "so what" sentence tying the layer to the bigger argument.

## What's in it

**Layers and Explained.** Each layer's Explained tab teaches rather than summarises: a short summary, the big question, sections that each answer one sub-question (how and why, not just what), and the so what. Every named concept, person or case in the readings is explained inside the section where it matters (what it is, an example from the reading, why it matters), never as a word list. The explanation streams in as it is written, so you start reading within seconds. *Source* shows the exact passages it rests on, with file and page in the margin.

![A layer's Explained tab beside the write-back pane](docs/readme/explained-normal.jpg)

![Further down a layer: a section answering its sub-question, each named idea explained where it matters, its pages in the margin](docs/readme/explained-section-normal.jpg)

**Import that reads like a student.** Drop in a folder however it's organised. Claude reads the syllabus and the folder and gives every file its week, its type and a one-line reason you can check ("Listed in the syllabus under Class 2…"). Anything it isn't sure about is marked *check this*.

![The course plan after import: each file with its week, its type and Claude's one-line reason](docs/readme/import-normal.jpg)

**Let's talk!** Ask about the whole course in your own words. Answers come from the course brain (below) and cite the real pages; the passages they relied on collect in a Sources list, and there's a Notepad beside the chat.

![Let's talk!: a question about the course and an answer citing the readings](docs/readme/talk-normal.jpg)

**Note to Self.** Only what you chose to save: your write-ups in course order, quick notes beside them, and a chat that knows your notes.

![Note to Self with a saved write-up](docs/readme/note-to-self-normal.jpg)

**Exam room.** Reads your exam instruction sheet, writes practice sets in its format, and marks your answers against your own course material.

![The Exam room, with the exam's details read from its sheet](docs/readme/exam-normal.jpg)

**Lock in.** One switch turns off everything decorative and moving and keeps everything needed to study, in a calm graphite palette, with a focus timer.

| | |
| --- | --- |
| ![The course page in lock in: what's next, then every layer as a row](docs/readme/course-lock-in.jpg) | ![A layer's Explained tab in lock in](docs/readme/explained-lock-in.jpg) |
| ![Let's talk! in lock in](docs/readme/talk-lock-in.jpg) | ![Note to Self in lock in](docs/readme/note-to-self-lock-in.jpg) |
| ![The Exam room in lock in](docs/readme/exam-lock-in.jpg) | ![The import screen in lock in](docs/readme/import-lock-in.jpg) |

## How it works

**Code reads the files; Claude reads the course.** Plain code extracts each file's text, pages, headings and printed page numbers, cuts it into verbatim passages of about 180 words with file and page, and indexes them for full-text search. Then one Claude call reads the full syllabus, the folder tree and each file's measured facts, and returns the course's weeks in the course's own numbering plus every file's week, type and reason. Code checks the answer (every file labelled once, every week inside the course) and sends it back once with the problems if it doesn't fit. A final check looks over the whole result the way a teaching assistant would. When the syllabus gives different pages of one file to different weeks, each week gets its own pages.

**Weeks become layers.** For each week, Claude reads the full text of all its material and proposes the chain of ideas as 2 to 5 layers. Code checks that every passage is in exactly one layer of its own week. You edit the plan and approve it, and the layers are written in the background, this week's first.

**The course brain.** Right after import, Margin reads every course file in full and keeps notes on each concept, person, event, case and place, each pointing at the exact passages where it appears. Notes merge across files only when they are the same thing (true alternative names, like "child levy" for devşirme); related things become links. Let's talk!, the agents and the check that each layer explains every concept its readings discuss all draw on it.

**Nothing unchecked reaches you.** Claude only ever picks numbers (passages, notes) from what it was sent; code copies the real text. Every citation is checked against the passages that were sent, and one that points at nothing is removed before you see it. Source quotes are copied by code and verified word for word.

**The AI engine.** Margin runs Claude through the official Claude Code command line in headless mode (`claude -p`) on your own machine and plan: no API key, and Margin never reads your Claude credentials. Each call runs from an empty temporary folder with no tools, the prompt goes in on stdin, and structured answers are validated with Zod. Every task has its own model and effort (`lib/ai/config.ts`, overridable per task):

| Task | What it does | Model |
| --- | --- | --- |
| organize | the syllabus and folder → weeks, file labels and reasons | Opus |
| check | the final check after import; older courses' one-time checks | Opus (low effort) |
| structure | each week's layers | Opus |
| explain | Explained (streamed), its section fixes and the Source picks | Opus (low effort) |
| review | feedback on write-backs, "I don't get it" | Opus |
| lecture, exam, request | the Lecture tab, the Exam room, the agents' documents | Opus |
| brain | reading every file into the course brain | Sonnet |
| talk, notes | Let's talk!, the notebook chat, picking your lecture notes | Sonnet |

**Writing a layer.** Explained is one streamed call, shown as it arrives. Code then checks it part by part (citations, length, and every concept the readings discuss) and writes again only the part that failed: one section, or a sentence or two added where a concept belongs. On a real 10,000-word layer the first words appear in about 7 seconds and the whole layer is done in under a minute. Margin stops only if nothing new arrives for 3 minutes.

Background work runs in two lanes side by side, the course brain and layers written ahead, from a queue kept in the database, so it survives quitting; the layer you open always goes first. It pauses at your plan's usage limit and carries on after the reset.

## Built with

Next.js (App Router) · TypeScript (strict) · React · Tailwind CSS v4 · Motion (the course page's scenes run on CSS scroll timelines, so they move with the scroll) · SQLite with FTS5 through better-sqlite3 and Drizzle · Zod at every AI and API boundary · pdfjs, mammoth and jszip for PDF, Word and PowerPoint · Vitest and Playwright.

## Run it

You need Node.js 22 or newer and, for the real AI, the [Claude Code](https://claude.com/claude-code) command line installed and signed in.

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and choose **Open the demo course**. To try it with no AI at all, run `MARGIN_ENGINE=fake npm run dev` (short canned replies). Your data stays in `./.data`. To run it every day as a Mac app, see [docs/mac-app.md](docs/mac-app.md).

## Tests

About 700 unit tests and 190 browser tests. They run offline against a fake AI engine and a throwaway data folder, so they are fast, free and never touch your courses.

```bash
npm run typecheck
npm test                          # unit tests (Vitest)
E2E_PROD=1 npx playwright test    # browser tests on the production build
```

## Licence

Copyright (c) 2026 0426HC (Margin). All rights reserved. The code is shared publicly for viewing as a portfolio project. See [LICENSE](LICENSE).
