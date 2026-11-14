import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ExplainedLayer, Review } from "@/lib/ai/schemas";
import type { Block, FileKind, PageKind } from "@/lib/import/types";

const id = () => text("id").primaryKey();
const createdAt = () => integer("created_at").notNull().$defaultFn(() => Date.now());

export const projects = sqliteTable("projects", {
  id: id(),
  name: text("name").notNull(),
  courseCode: text("course_code"),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["importing", "reviewing", "building", "ready"] }).notNull().default("importing"),
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
    createdAt: createdAt(),
  },
  (t) => [index("files_project").on(t.projectId)],
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

/** Part A and Part B of a course. Each is broken into layers, and the breakdown must be approved before any content is written. */
export const parts = sqliteTable(
  "parts",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    key: text("key", { enum: ["A", "B"] }).notNull(),
    title: text("title").notNull(),
    breakdownStatus: text("breakdown_status", { enum: ["proposed", "approved"] }).notNull().default("proposed"),
    approvedAt: integer("approved_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("parts_key").on(t.projectId, t.key)],
);

/** A topic inside a Part: a title, the one big question it answers, and a set of passages (by reference). */
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

/** What the student wrote for a layer or a Part synthesis, and the review it got. Drafts live here; only a version the student chose to send reaches Note to Self. */
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
    kind: text("kind", { enum: ["find-sources"] }).notNull(),
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

/** What is in Note to Self for a layer or Part: one row each, replaced whenever the student sends a newer version. */
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

/** Quick notes beside each saved write-up in Note to Self: one record per layer (or Part synthesis) per project. Not the Let's talk! notepad. */
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
