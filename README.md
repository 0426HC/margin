# Margin

**A study app that makes you do the part that makes learning stick.**

Margin turns a course folder (PDFs, Word, PowerPoint, your own notes) into weeks, and each week into a few **layers**: one idea at a time, explained plainly, checked against your own files, then written back by you in your own words. It runs on your own computer, and every claim points to a page you can open.

*Every image here is the built-in demo course, a few of the Federalist Papers, which are in the public domain.*

## A visual tour

**1. Home.** What you see when you first open Margin.

![Margin's home page](docs/readme/01-home.jpg)

**2. Your projects.** Every course is a tile that shows the week you're in and how many layers you have saved.

![The project list on the home page](docs/readme/02-projects.jpg)

**3. A new project.** Choose a course folder (or just files) and Margin works out the weeks and the layers of each week.

![The new project page, before any files are chosen](docs/readme/03-new-project.jpg)

**4. The import.** Every file gets its week, its type and a one-line reason you can check. Anything Claude isn't sure about is marked *check this*.

![The import page: each file with its week, type and reason](docs/readme/04-import.jpg)

**5. A project's home screen.** The opening scene: the course's name and where you stand in it.

![A project's opening scene](docs/readme/05-course.jpg)

**6. The agents' round table, resting.** Five small agents wait at the table for a note.

![The agents' round table with the agents idle](docs/readme/06-round-table-idle.jpg)

**7. The round table at work.** Leave a note and the right agent sits down to make it from your own files.

![The agents' round table while the agents are working](docs/readme/07-round-table-at-work.jpg)

**8. The agents' panel.** Leave a note on one side; finished documents, with citations, wait in *Ready for you* on the other.

| Leave a note | Ready for you |
| --- | --- |
| ![The agents' panel, Leave a note](docs/readme/08a-agents-leave-a-note.jpg) | ![The agents' panel, Ready for you, with a finished study guide open](docs/readme/08b-agents-ready.jpg) |

**9. The layers.** Each week is a scene with its layers stacked as sheets, each with its own big question.

![A week scene with its layers stacked as sheets](docs/readme/09-layers.jpg)

<!-- VIDEO: layers-scroll -->

**10. Inside a layer.** A plain explanation with every fact cited to a page, beside the pane where you write the layer back in your own words.

![A layer's Explained tab with the write-back pane](docs/readme/10-layer-explained.jpg)

**11. Let's talk!** Ask about the whole course in your own words. Answers cite the real pages.

![Let's talk!: a question about the course and an answer citing the readings](docs/readme/11-talk.jpg)

**12. Lecture notes.** One page of your own notes for each week. Scroll over the sheets to pick a week.

![Lecture notes, with the week picker on Week 2](docs/readme/12-lecture-notes.jpg)

**13. Note to Self.** Only what you chose to save, in course order, with a chat that knows your notes.

![Note to Self with saved write-ups](docs/readme/13-note-to-self.jpg)

**14. The Exam room.** Reads your exam sheet, writes practice sets in its format and marks your answers against your own course material.

![The Exam room, with the exam's details read from its sheet](docs/readme/14-exam-room.jpg)

**15. Lock in.** One switch turns off everything decorative and moving and keeps everything needed to study, in a calm graphite palette, with a focus timer.

| | |
| --- | --- |
| ![The course page in lock in](docs/readme/lock-in-course.jpg) | ![A layer's Explained tab in lock in](docs/readme/lock-in-explained.jpg) |
| ![Let's talk! in lock in](docs/readme/lock-in-talk.jpg) | ![Note to Self in lock in](docs/readme/lock-in-note-to-self.jpg) |
| ![The Exam room in lock in](docs/readme/lock-in-exam.jpg) | ![The import page in lock in](docs/readme/lock-in-import.jpg) |

## The method

Most AI study tools do the work for you: summaries, flashcards, quizzes. Reading a good explanation feels like learning, but it isn't the same as being able to give one. Margin is built around one loop:

1. **One layer at a time.** Each week is split into 2 to 5 layers, each with a title and one big question, building on the one before. It starts from the basics underneath the course. Nothing is locked.
2. **Explained, then checked.** A plain explanation of the layer, every fact cited to a page, with the verbatim source text beside it.
3. **Write it back yourself.** You explain the layer in your own words. This is the step that makes it stick.
4. **Specific feedback.** Fixes shown as "yours → fixed" in full sentences, a cleaned-up version that keeps your wording, and one "so what" sentence tying the layer to the bigger argument.

## What's in it

**Layers and Explained.** Each layer's Explained tab teaches rather than summarises: a short summary, the big question, sections that each answer one sub-question (how and why, not just what), and the so what. Every named concept, person or case in the readings is explained inside the section where it matters (what it is, an example from the reading, why it matters), never as a word list. The explanation streams in as it is written, so you start reading within seconds. *Source* shows the exact passages it rests on, with file and page in the margin, and *Lecture* shows what the professor's own material stressed.

![Further down a layer: a section answering its sub-question, each named idea explained where it matters, its pages in the margin](docs/readme/explained-section.jpg)

**Import that reads like a student.** Drop in a folder however it's organised. Claude reads the syllabus and the folder tree, keeps the course's own week numbering, and tells your notes from the professor's material by author, style and folder.

**Let's talk! and the course brain.** Answers come from the course brain (below); the passages they relied on collect in a Sources list, and there's a Notepad beside the chat.

![Let's talk!: a question about the course and an answer citing the readings](docs/readme/11-talk.jpg)

**Note to Self** keeps your write-ups in course order, quick notes beside them, and a chat that knows your notes.

![Note to Self with a saved write-up](docs/readme/13-note-to-self.jpg)

![The Exam room, with the exam's details read from its sheet](docs/readme/14-exam-room.jpg)

## Adding files later

**Update from folder** and **Add files** (both in the course's top bar) use the same sheet, and nothing is written until you approve.

1. **Compare.** Margin fingerprints each file you choose and compares it with what the course already holds: new, changed, removed, or unchanged (same path and same content, or only moved, which is skipped). No AI is involved yet. Update from folder compares the whole folder, so files that left it are offered as removed (you choose whether their passages stay in the course); Add files is for files you pick by hand.
2. **Week, type and reason.** For new files, code measures them (pages, words, headings, opening text) and the same organizer used at import labels each one against the course's *stored* syllabus, its weeks and its existing files: a week, a type, how sure it is, and a one-line reason. With Add files you can name the week yourself; otherwise Margin decides and shows its choice. You can change any file's week or type, or skip a file, before approving.
3. **Into the existing layers.** Approved files are cut into passages like the first import. Claude then places each new passage in an existing layer of its week, or proposes a new layer when the topic isn't covered. Code checks that every passage lands exactly once (and falls back to a plain placement by week if the answer doesn't fit). A layer that gained material shows "New material since you saved". New layers are only proposals until you approve them one by one or add them to an existing layer instead. Saved write-ups, Note to Self and chats are never touched.
4. **The brain reads only what's new.** The course brain reads the new files in the background and links them into its notes; files you removed take their places with them. Nothing else is re-read.

One limit: a **new syllabus** doesn't re-read the course's weeks, and a new file's pages aren't split between weeks. For either, import the course again.

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
