ALTER TABLE `talk_messages` ADD `topic` text;--> statement-breakpoint
CREATE TABLE `quick_notes` (
	`project_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`text` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quick_notes_target` ON `quick_notes` (`project_id`,`target_type`,`target_id`);
