CREATE TABLE `week_notes` (
	`project_id` text NOT NULL,
	`week` integer NOT NULL,
	`blocks` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `week_notes_week` ON `week_notes` (`project_id`,`week`);
