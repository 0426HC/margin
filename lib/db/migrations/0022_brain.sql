-- Round 3: the course brain. Every course file read in full once; notes about the things that matter, merged across files and linked.
CREATE TABLE `brain_reads` (
	`file_id` text PRIMARY KEY NOT NULL REFERENCES `files`(`id`) ON DELETE cascade,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`status` text NOT NULL,
	`notes` integer DEFAULT 0 NOT NULL,
	`read_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `brain_reads_project` ON `brain_reads` (`project_id`);
--> statement-breakpoint
CREATE TABLE `brain_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`what` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `brain_notes_project` ON `brain_notes` (`project_id`);
--> statement-breakpoint
CREATE TABLE `brain_mentions` (
	`note_id` text NOT NULL REFERENCES `brain_notes`(`id`) ON DELETE cascade,
	`file_id` text NOT NULL REFERENCES `files`(`id`) ON DELETE cascade,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`what` text NOT NULL,
	`why` text NOT NULL,
	`passage_ids` text DEFAULT '[]' NOT NULL,
	`related` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brain_mentions_pair` ON `brain_mentions` (`note_id`,`file_id`);
--> statement-breakpoint
CREATE INDEX `brain_mentions_project` ON `brain_mentions` (`project_id`);
--> statement-breakpoint
CREATE TABLE `brain_links` (
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`note_id` text NOT NULL REFERENCES `brain_notes`(`id`) ON DELETE cascade,
	`other_id` text NOT NULL REFERENCES `brain_notes`(`id`) ON DELETE cascade,
	`why` text NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `brain_links_note` ON `brain_links` (`note_id`);
--> statement-breakpoint
CREATE INDEX `brain_links_project` ON `brain_links` (`project_id`);
