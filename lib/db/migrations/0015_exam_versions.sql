ALTER TABLE `exams` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `exam_sets` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE TABLE `exam_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`number` integer NOT NULL,
	`summary` text NOT NULL,
	`sheet_file_id` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sheet_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_versions_number` ON `exam_versions` (`exam_id`,`number`);
