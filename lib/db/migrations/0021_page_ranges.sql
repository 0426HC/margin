-- Round 3: printed page numbers, and the pages of one file the syllabus assigns to different weeks
ALTER TABLE `files` ADD `page_offset` integer;
--> statement-breakpoint
CREATE TABLE `file_pages` (
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`file_id` text NOT NULL REFERENCES `files`(`id`) ON DELETE cascade,
	`week` integer NOT NULL,
	`printed_from` integer NOT NULL,
	`printed_to` integer NOT NULL,
	`page_from` integer NOT NULL,
	`page_to` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `file_pages_file` ON `file_pages` (`file_id`);
--> statement-breakpoint
CREATE INDEX `file_pages_project` ON `file_pages` (`project_id`);
