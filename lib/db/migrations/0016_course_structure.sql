ALTER TABLE `files` ADD `category` text;--> statement-breakpoint
ALTER TABLE `files` ADD `guessed` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `week_count` integer;--> statement-breakpoint
ALTER TABLE `parts` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `parts` ADD `in_progress` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `parts` SET `position` = CASE `key` WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END;--> statement-breakpoint
ALTER TABLE `layers` ADD `optional` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE `layer_optional` (
	`layer_id` text NOT NULL,
	`file_id` text NOT NULL,
	FOREIGN KEY (`layer_id`) REFERENCES `layers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `layer_optional_pair` ON `layer_optional` (`layer_id`,`file_id`);--> statement-breakpoint
CREATE INDEX `layer_optional_file` ON `layer_optional` (`file_id`);--> statement-breakpoint
CREATE TABLE `note_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`file_id` text,
	`rel_path` text NOT NULL,
	`week` integer NOT NULL,
	`hash` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `note_imports_project` ON `note_imports` (`project_id`);
