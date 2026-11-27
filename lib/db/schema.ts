import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ExplainedLayer, Review } from "@/lib/ai/schemas";
import type { AgentDocBlock } from "@/lib/agents/types";
import type { ExamFeedback, ExamQuestion, ExamSource, ExamSummary } from "@/lib/exam/types";
import type { Block, FileKind, FileRole, PageKind } from "@/lib/import/types";
import type { FileCategory, FileType } from "@/lib/projects/file-kinds";

const id = () => text("id").primaryKey();
const createdAt = () => integer("created_at").notNull().$defaultFn(() => Date.now());

export const projects = sqliteTable("projects", {
  id: id(),
  name: text("name").notNull(),
  courseCode: text("course_code"),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["importing", "reviewing", "building", "ready"] }).notNull().default("importing"),
  /** How many weeks the course runs: read from the syllabus or the folders at import, or set by the student. Null means "work it out". */
  weekCount: integer("week_count"),
  createdAt: createdAt(),
});

export const units = sqliteTable(
  "units",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    isOverview: integer("is_overview", { mode: "boolean" }).notNull().default(false),
    summary: text("summary"),
    throughLine: text("through_line"),
    whyItMatters: text("why_it_matters"),
    createdAt: createdAt(),
  },
  (t) => [index("units_project").on(t.projectId)],
);

export const files = sqliteTable(
  "files",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    unitId: text("unit_id").references(() => units.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    relPath: text("rel_path").notNull(),
    kind: text("kind", { enum: ["pdf", "docx", "pptx", "txt", "md"] }).$type<FileKind>(),
    storedPath: text("stored_path"),
    status: text("status", { enum: ["queued", "reading", "done", "failed"] }).notNull().default("queued"),
    error: text("error"),
    pageKind: text("page_kind", { enum: ["page", "slide", "virtual"] }).$type<PageKind>(),
    pageCount: integer("page_count"),
    /** The parsed, cleaned blocks, kept so sections can be re-cut without re-reading the file. */
    parsed: text("parsed", { mode: "json" }).$type<Block[]>(),
    runningHeaders: text("running_headers", { mode: "json" }).$type<string[]>(),
    /** PDFs only: 0 to 1, how much of the text looks like real words. */
    textQuality: real("text_quality"),
    /** Who the file's own properties say wrote it (PDF Author, Word or PowerPoint creator); null when they don't say. */
    author: text("author"),
    /** SHA-256 of the file's bytes, so "Update from folder" can tell a changed file from an unchanged one. Null on files imported before it existed. */
    contentHash: text("content_hash"),
    /** Lecture, Reading or exam material, following `type`. Null for files that are neither (the syllabus, my notes). */
    role: text("role", { enum: ["lecture", "reading", "exam"] }).$type<FileRole>(),
    /** The course week the student (or Margin) put it in. Null means "the week of its unit". */
    week: integer("week"),
    /** Where the file's text goes, following `type` (`lib/projects/file-kinds.ts`). Null: not labelled yet. */
    category: text("category", { enum: ["course", "syllabus", "exam", "optional", "notes"] }).$type<FileCategory>(),
    /** What the file is, as the AI read it at import or the student set it. Null: not labelled yet (or a duplicate). */
    type: text("type").$type<FileType>(),
    /** Why the file got its week and type, in plain words: "Listed in the syllabus under Week 2 as Gallant, Modern Greece, pp. 1-24". */
    reason: text("reason"),
    /** The AI wasn't sure ("check this"). Cleared when the student sets the week or type. */
    needsCheck: integer("needs_check", { mode: "boolean" }).notNull().default(false),
    /** The file left the folder but the student chose to keep its passages. It is not listed as removed again. */
    absent: integer("absent", { mode: "boolean" }).notNull().default(false),
    /** PDFs only: how far the printed page numbers run ahead of the PDF's own (6 when PDF page 1 is printed p. 7). Null: none found, or not a PDF. */
    pageOffset: integer("page_offset"),
    createdAt: createdAt(),
  },
  (t) => [index("files_project").on(t.projectId)],
);

/**
 * Pages of one file the syllabus assigns to a week, when it assigns different pages of the same file to different weeks (one chapter
 * saved in several week folders, pp. 7-30 in Week 2 and pp. 31-45 in Week 3). The file is stored and read once; each passage goes to the
 * week whose range holds its page (`lib/layers/passage-weeks.ts`). `printed_*` are the syllabus's page numbers, `page_*` the file's own.
 */
export const filePages = sqliteTable(
  "file_pages",
  {
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    week: integer("week").notNull(),
    printedFrom: integer("printed_from").notNull(),
    printedTo: integer("printed_to").notNull(),
    pageFrom: integer("page_from").notNull(),
    pageTo: integer("page_to").notNull(),
  },
  (t) => [index("file_pages_file").on(t.fileId), index("file_pages_project").on(t.projectId)],
);

export const sections = sqliteTable(
  "sections",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    unitId: text("unit_id").notNull().references(() => units.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    focus: text("focus"),
    pageStart: integer("page_start").notNull(),
    pageEnd: integer("page_end").notNull(),
    wordCount: integer("word_count").notNull(),
    /** The section's text, verbatim, as ordered blocks with page numbers. */
    original: text("original", { mode: "json" }).$type<Block[]>().notNull(),
    whyItMatters: text("why_it_matters"),
    explained: text("explained", { mode: "json" }),
    writtenAt: integer("written_at"),
    createdAt: createdAt(),
  },
  (t) => [index("sections_unit").on(t.unitId), index("sections_file").on(t.fileId)],
);

export const passages = sqliteTable(
  "passages",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    sectionId: text("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
    page: integer("page").notNull(),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
  },
  (t) => [index("passages_section").on(t.sectionId), index("passages_project").on(t.projectId)],
);

/**
 * The weeks of a course: one row per week that has layers (or a synthesis). The table keeps its first name, "parts", from when a course
 * was split into Parts; since the weeks round every row is one week (`week`, `key` "W3", `title` the week's topic from the syllabus or
 * its folder). Each week's layers must be approved before any content is written. Rows with a null `week` are Parts from before that
 * round, moved to weeks once when the database opens (`lib/layers/migrate-weeks.ts`).
 */
/**
 * The course's weeks as the syllabus states them, read by the AI at import: the date as written, the title in the syllabus's own words,
 * whether the week has a class, no class (a reading week, a holiday) or an exam, and what the syllabus says about it.
 */
export const courseWeeks = sqliteTable(
  "course_weeks",
  {
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    week: integer("week").notNull(),
    date: text("date"),
    title: text("title").notNull().default(""),
    kind: text("kind", { enum: ["class", "no-class", "exam"] }).notNull().default("class"),
    syllabus: text("syllabus").notNull().default(""),
  },
  (t) => [uniqueIndex("course_weeks_week").on(t.projectId, t.week)],
);

export const parts = sqliteTable(
  "parts",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    /** The course week this row is. Null only on a Part from before the weeks round, until it is migrated. */
    week: integer("week"),
    breakdownStatus: text("breakdown_status", { enum: ["proposed", "approved"] }).notNull().default("proposed"),
    approvedAt: integer("approved_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("parts_key").on(t.projectId, t.key)],
);

/** One idea of a week: a title, the one big question it answers, and a set of passages (by reference). */
export const layers = sqliteTable(
  "layers",
  {
    id: id(),
    partId: text("part_id").notNull().references(() => parts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    bigQuestion: text("big_question").notNull(),
    /** How this layer follows the one before it. Empty for the first. */
    buildsOn: text("builds_on").notNull().default(""),
    contentStatus: text("content_status", { enum: ["none", "writing", "ready", "stale"] }).notNull().default("none"),
    /** Set when files were added to (or removed from) a layer that already had its tabs written. Cleared by "Refresh this layer". */
    newMaterialAt: integer("new_material_at"),
    /** A new layer proposed after files were added. It is not part of the course until the student approves it. */
    proposed: integer("proposed", { mode: "boolean" }).notNull().default(false),
    /** Made from an optional reading the required material doesn't cover ("Add as optional layer"). */
    optional: integer("optional", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("layers_part").on(t.partId)],
);

/** Which passages make up a layer. A passage belongs to exactly one layer. */
export const layerPassages = sqliteTable(
  "layer_passages",
  {
    layerId: text("layer_id").notNull().references(() => layers.id, { onDelete: "cascade" }),
    passageId: text("passage_id").notNull().references(() => passages.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
  },
  (t) => [uniqueIndex("layer_passages_passage").on(t.passageId), index("layer_passages_layer").on(t.layerId)],
);

/** One quote on the Source tab. `text` is the passage's words; `blocks` are the same words with their original paragraph, heading and list shape. */
export type SourceQuote = { passageId: string; file: string; page: number; text: string; blocks?: { kind: "heading" | "paragraph" | "list"; text: string }[] };

/** The two tabs of a layer. `source` text is copied by code from the stored passages, never written by the AI. */
export const layerContent = sqliteTable(
  "layer_content",
  {
    id: id(),
    layerId: text("layer_id").notNull().references(() => layers.id, { onDelete: "cascade" }),
    explained: text("explained", { mode: "json" }).$type<ExplainedLayer>().notNull(),
    source: text("source", { mode: "json" }).$type<SourceQuote[]>().notNull(),
    writtenAt: integer("written_at").notNull().$defaultFn(() => Date.now()),
  },
  (t) => [uniqueIndex("layer_content_layer").on(t.layerId)],
);

/** What the student wrote for a layer or a week synthesis, and the review it got. Drafts live here; only a version the student chose to send reaches Note to Self. */
export const writebacks = sqliteTable(
  "writebacks",
  {
    id: id(),
    targetType: text("target_type", { enum: ["layer", "part"] }).notNull(),
    targetId: text("target_id").notNull(),
    text: text("text").notNull(),
    review: text("review", { mode: "json" }).$type<Review>(),
    /** The answer to "Send to Note to Self?" for this review. Null until the student answers. */
    saveChoice: text("save_choice", { enum: ["own", "refined", "no"] }),
    createdAt: createdAt(),
  },
  (t) => [index("writebacks_target").on(t.targetType, t.targetId)],
);

/** The layer chatbot's saved history. */
export const layerMessages = sqliteTable(
  "layer_messages",
  {
    id: id(),
    targetType: text("target_type", { enum: ["layer", "part"] }).notNull(),
    targetId: text("target_id").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    kind: text("kind", { enum: ["writeback", "review", "dont_get_it", "reexplain"] }).notNull(),
    writebackId: text("writeback_id").references(() => writebacks.id, { onDelete: "set null" }),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("layer_messages_target").on(t.targetType, t.targetId)],
);

/** Let's talk!: the project-wide professor chat, one saved history per project. Never mixed with the layer chatbots. */
export const talkMessages = sqliteTable(
  "talk_messages",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    /** Set when the message was sent from inside a layer: "From Layer 3: The large republic". Shown as a small subtitle above it. */
    context: text("context"),
    /** The passage the student highlighted in Note to Self and is asking about. Messages with the same topic form one thread. */
    topic: text("topic"),
    /** Which conversation: Let's talk! ("talk") or the Note to Self chat ("note"). Two separate histories in one table. */
    channel: text("channel", { enum: ["talk", "note"] }).notNull().default("talk"),
    createdAt: createdAt(),
  },
  (t) => [index("talk_messages_project").on(t.projectId), index("talk_messages_channel").on(t.projectId, t.channel)],
);

/**
 * Sources the Librarian collected from what was discussed in Let's talk!: a passage of the student's own files, copied verbatim by code,
 * grouped under a topic. A passage is collected once per project.
 */
export const talkSources = sqliteTable(
  "talk_sources",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    passageId: text("passage_id").notNull().references(() => passages.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    file: text("file").notNull(),
    page: integer("page").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("talk_sources_passage").on(t.projectId, t.passageId), index("talk_sources_project").on(t.projectId)],
);

/** One notepad per project: a never-ending page of blocks, autosaved. */
export type NoteBlock = { type: "heading" | "paragraph" | "bullet"; text: string };
export const talkNotepad = sqliteTable("talk_notepad", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  blocks: text("blocks", { mode: "json" }).$type<NoteBlock[]>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Work an agent did or is doing for a project, so the dining hall can show it busy and "While you were away" can show what finished. */
export const agentTasks = sqliteTable(
  "agent_tasks",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    agent: text("agent", { enum: ["explainer", "quizzer", "examiner", "connector", "librarian"] }).notNull(),
    kind: text("kind", { enum: ["find-sources", "make-document"] }).notNull(),
    summary: text("summary").notNull(),
    status: text("status", { enum: ["running", "done", "failed"] }).notNull().default("running"),
    /** What it finished, in a line. Set when the task ends. */
    result: text("result"),
    /** Whether the student has dismissed it from "While you were away". */
    seen: integer("seen", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    finishedAt: integer("finished_at"),
  },
  (t) => [index("agent_tasks_project").on(t.projectId)],
);

/** What is in Note to Self for a layer or week synthesis: one row each, replaced whenever the student sends a newer version. */
export const noteSaves = sqliteTable(
  "note_saves",
  {
    id: id(),
    targetType: text("target_type", { enum: ["layer", "part"] }).notNull(),
    targetId: text("target_id").notNull(),
    writebackId: text("writeback_id").notNull().references(() => writebacks.id, { onDelete: "cascade" }),
    /** Which version was sent: the student's own writing, or the cleaned-up version from the review. */
    version: text("version", { enum: ["own", "refined"] }).notNull(),
    text: text("text").notNull(),
    savedAt: integer("saved_at").notNull().$defaultFn(() => Date.now()),
  },
  (t) => [uniqueIndex("note_saves_target").on(t.targetType, t.targetId)],
);

export const uiState = sqliteTable(
  "ui_state",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value", { mode: "json" }),
  },
  (t) => [uniqueIndex("ui_state_key").on(t.projectId, t.key)],
);

/** Quick notes beside each saved write-up in Note to Self: one record per layer (or week synthesis) per project. Not the Let's talk! notepad. */
export const quickNotes = sqliteTable(
  "quick_notes",
  {
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    targetType: text("target_type", { enum: ["layer", "part"] }).notNull(),
    targetId: text("target_id").notNull(),
    text: text("text").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("quick_notes_target").on(t.projectId, t.targetType, t.targetId)],
);

/** The student's own notes for one week of the course: a notepad page of blocks, autosaved. Only the week's Lecture tab ever reads them, and only as the student's words. */
export const weekNotes = sqliteTable(
  "week_notes",
  {
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    week: integer("week").notNull(),
    blocks: text("blocks", { mode: "json" }).$type<NoteBlock[]>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("week_notes_week").on(t.projectId, t.week)],
);

/**
 * The Lecture tab of one week, shown the same in every layer of that week, in two sections: what the student's own lecture notes covered,
 * expanded from the week's material (`part` "notes"), and what the lecture material the professor posted spent its time on (`part`
 * "material"). `text` is the section as Claude streamed it (`lib/lecture/text.ts`), citations already checked. `sourceHash` says which
 * notes and passages it was written from, so it is written again, in the background, when they change.
 */
export const weekLecture = sqliteTable(
  "week_lecture",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    week: integer("week").notNull(),
    part: text("part", { enum: ["notes", "material"] }).notNull(),
    text: text("text").notNull(),
    sourceHash: text("source_hash").notNull(),
    writtenAt: integer("written_at").notNull().$defaultFn(() => Date.now()),
  },
  (t) => [uniqueIndex("week_lecture_part").on(t.projectId, t.week, t.part)],
);

/** An exam section of a project (a Midterm or a Final): the instruction sheet, read into a summary the student checks and edits before anything is generated. */
export const exams = sqliteTable(
  "exams",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    sheetFileId: text("sheet_file_id").references(() => files.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["midterm", "final", "exam"] }).notNull().default("exam"),
    title: text("title").notNull(),
    /** What the sheet says, read by Claude and then checked or edited by the student. Null until read. */
    summary: text("summary", { mode: "json" }).$type<ExamSummary>(),
    /** The student has checked the summary. Nothing is generated before this. */
    confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
    /** Which version of the exam's details is current. "Update exam details" adds a version; practice sets remember theirs. */
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index("exams_project").on(t.projectId)],
);

/** Every version of an exam's details, kept when the student updates them, so past attempts stay linked to the format they were sat in. */
export const examVersions = sqliteTable(
  "exam_versions",
  {
    id: id(),
    examId: text("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    summary: text("summary", { mode: "json" }).$type<ExamSummary>().notNull(),
    /** The sheet this version was read from (an updated sheet for a later version). */
    sheetFileId: text("sheet_file_id").references(() => files.id, { onDelete: "set null" }),
    /** What the student heard and wrote down for this update. */
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("exam_versions_number").on(t.examId, t.number)],
);

/** Past or practice exams the student uploaded for an exam. Questions may be modelled on them. */
export const examMaterials = sqliteTable(
  "exam_materials",
  {
    examId: text("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("exam_materials_file").on(t.examId, t.fileId)],
);

/** One generated practice exam: its questions (each with what it was built from) and the passages those citations point at. */
export const examSets = sqliteTable(
  "exam_sets",
  {
    id: id(),
    examId: text("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    questions: text("questions", { mode: "json" }).$type<ExamQuestion[]>().notNull(),
    sources: text("sources", { mode: "json" }).$type<ExamSource[]>().notNull(),
    /** How many questions the sheet's format asks for, so a shortened set can say so. */
    planned: integer("planned").notNull(),
    /** The real time limit for this set, in minutes (scaled when the set is shorter than the real exam). Null when the sheet gives none. */
    minutes: integer("minutes"),
    /** The version of the exam's details this set was written for. */
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index("exam_sets_exam").on(t.examId)],
);

/** One sitting of a set: the answers (autosaved), the timer, and the feedback once it is handed in. Try again is a new attempt on the same set. */
export const examAttempts = sqliteTable(
  "exam_attempts",
  {
    id: id(),
    setId: text("set_id").notNull().references(() => examSets.id, { onDelete: "cascade" }),
    timer: text("timer", { enum: ["real", "none"] }).notNull().default("none"),
    startedAt: integer("started_at").notNull(),
    deadline: integer("deadline"),
    handedInAt: integer("handed_in_at"),
    answers: text("answers", { mode: "json" }).$type<Record<string, string>>().notNull(),
    feedback: text("feedback", { mode: "json" }).$type<ExamFeedback>(),
  },
  (t) => [index("exam_attempts_set").on(t.setId)],
);

/**
 * A note the student left for the agents, and the document they made from it. Built only from the student's own course files and writing,
 * with citations. "Ready for you" is the finished ones; deleting one deletes it for good.
 */
export const agentRequests = sqliteTable(
  "agent_requests",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    agent: text("agent", { enum: ["explainer", "quizzer", "examiner", "connector", "librarian"] }).notNull(),
    text: text("text").notNull(),
    status: text("status", { enum: ["running", "done", "declined", "failed"] }).notNull().default("running"),
    title: text("title"),
    content: text("content", { mode: "json" }).$type<AgentDocBlock[]>(),
    /** Why it was declined or failed, in words for the student. */
    note: text("note"),
    createdAt: createdAt(),
    finishedAt: integer("finished_at"),
  },
  (t) => [index("agent_requests_project").on(t.projectId)],
);

/** An optional reading attached to the layer whose topic it fits: shown in Source with an "Optional" label, never part of the layer's own text. */
export const layerOptional = sqliteTable(
  "layer_optional",
  {
    layerId: text("layer_id").notNull().references(() => layers.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("layer_optional_pair").on(t.layerId, t.fileId), index("layer_optional_file").on(t.fileId)],
);

/** The student's own notes files, copied into a week's Lecture notes page. Kept so a changed file can offer only what is new. */
export const noteImports = sqliteTable(
  "note_imports",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    fileId: text("file_id").references(() => files.id, { onDelete: "set null" }),
    relPath: text("rel_path").notNull(),
    week: integer("week").notNull(),
    hash: text("hash").notNull(),
    /** The text that was copied in, line by line, so a later version can be compared with it. */
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("note_imports_project").on(t.projectId)],
);

// ---------------------------------------------------------------- the course brain (`lib/brain`)

export type BrainKind = "concept" | "person" | "event" | "case" | "place" | "reading";

/** Which course files the brain has read in full. No row: not read yet (the queue is this table). */
export const brainReads = sqliteTable(
  "brain_reads",
  {
    fileId: text("file_id").primaryKey().references(() => files.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    /** "read", or "failed" when Claude's answer couldn't be used twice (the file then falls back to word search). */
    status: text("status", { enum: ["read", "failed"] }).notNull(),
    notes: integer("notes").notNull().default(0),
    readAt: integer("read_at").notNull(),
  },
  (t) => [index("brain_reads_project").on(t.projectId)],
);

/** One thing that matters in the course (a concept, person, event, case or place), or one reading itself: merged across every file that mentions it. */
export const brainNotes = sqliteTable(
  "brain_notes",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<BrainKind>().notNull(),
    /** Other names or terms for it ("child levy" for devşirme). */
    aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** What it is, in 2-4 sentences, from the first file that named it. */
    what: text("what").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("brain_notes_project").on(t.projectId)],
);

/** Where a note appears: one row per file, with why it matters in that reading and the real passages it sits in. */
export const brainMentions = sqliteTable(
  "brain_mentions",
  {
    noteId: text("note_id").notNull().references(() => brainNotes.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    /** What this file says it is. */
    what: text("what").notNull(),
    /** Why it matters in this reading. */
    why: text("why").notNull(),
    /** Passage ids, checked by code against the file's own passages. */
    passageIds: text("passage_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** Names of other things this file says it is related to. */
    related: text("related", { mode: "json" }).$type<string[]>().notNull().default([]),
  },
  (t) => [uniqueIndex("brain_mentions_pair").on(t.noteId, t.fileId), index("brain_mentions_project").on(t.projectId)],
);

/** Two notes that belong together: they appear in the same passages, or a reading names them as related. Rebuilt after every file read. */
export const brainLinks = sqliteTable(
  "brain_links",
  {
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    noteId: text("note_id").notNull().references(() => brainNotes.id, { onDelete: "cascade" }),
    otherId: text("other_id").notNull().references(() => brainNotes.id, { onDelete: "cascade" }),
    why: text("why", { enum: ["together", "named"] }).notNull(),
    weight: integer("weight").notNull().default(1),
  },
  (t) => [index("brain_links_note").on(t.noteId), index("brain_links_project").on(t.projectId)],
);
