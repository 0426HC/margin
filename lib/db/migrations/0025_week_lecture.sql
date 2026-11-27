-- The Lecture tab is written once per week instead of once per layer: the student's lecture notes expanded from the week's material, and
-- what the lecture material spent its time on. The per-layer tabs (and their copied note lines) go; every week's tab is written again from
-- its notes and files when it is opened, or in the background.
DROP TABLE IF EXISTS `layer_lecture`;
--> statement-breakpoint
CREATE TABLE `week_lecture` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`week` integer NOT NULL,
	`part` text NOT NULL,
	`text` text NOT NULL,
	`source_hash` text NOT NULL,
	`written_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `week_lecture_part` ON `week_lecture` (`project_id`,`week`,`part`);
