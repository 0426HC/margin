CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`role` text NOT NULL,
	`mode` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`unit_id` text,
	`name` text NOT NULL,
	`rel_path` text NOT NULL,
	`kind` text,
	`stored_path` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`page_kind` text,
	`page_count` integer,
	`parsed` text,
	`running_headers` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `files_project` ON `files` (`project_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`section_id` text,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `passages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`file_id` text NOT NULL,
	`section_id` text NOT NULL,
	`page` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passages_section` ON `passages` (`section_id`);--> statement-breakpoint
CREATE INDEX `passages_project` ON `passages` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`course_code` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'importing' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`text` text NOT NULL,
	`answer` text,
	`status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`mastery` text DEFAULT 'new' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`step` integer DEFAULT 0 NOT NULL,
	`due_at` integer,
	`last_reviewed_at` integer,
	`signals` text NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_section` ON `reviews` (`section_id`);--> statement-breakpoint
CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`file_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`focus` text,
	`page_start` integer NOT NULL,
	`page_end` integer NOT NULL,
	`word_count` integer NOT NULL,
	`original` text NOT NULL,
	`why_it_matters` text,
	`explained` text,
	`written_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sections_unit` ON `sections` (`unit_id`);--> statement-breakpoint
CREATE INDEX `sections_file` ON `sections` (`file_id`);--> statement-breakpoint
CREATE TABLE `ui_state` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ui_state_key` ON `ui_state` (`project_id`,`key`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`is_overview` integer DEFAULT false NOT NULL,
	`summary` text,
	`through_line` text,
	`why_it_matters` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `units_project` ON `units` (`project_id`);