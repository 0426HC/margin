CREATE TABLE `agent_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`result` text,
	`seen` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_tasks_project` ON `agent_tasks` (`project_id`);--> statement-breakpoint
CREATE TABLE `talk_notepad` (
	`project_id` text PRIMARY KEY NOT NULL,
	`blocks` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `talk_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`passage_id` text NOT NULL,
	`topic` text NOT NULL,
	`file` text NOT NULL,
	`page` integer NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`passage_id`) REFERENCES `passages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `talk_sources_passage` ON `talk_sources` (`project_id`,`passage_id`);--> statement-breakpoint
CREATE INDEX `talk_sources_project` ON `talk_sources` (`project_id`);--> statement-breakpoint
ALTER TABLE `talk_messages` ADD `context` text;