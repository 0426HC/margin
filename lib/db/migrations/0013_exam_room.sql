CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`sheet_file_id` text,
	`kind` text DEFAULT 'exam' NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`confirmed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sheet_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `exams_project` ON `exams` (`project_id`);
--> statement-breakpoint
CREATE TABLE `exam_materials` (
	`exam_id` text NOT NULL,
	`file_id` text NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_materials_file` ON `exam_materials` (`exam_id`,`file_id`);
--> statement-breakpoint
CREATE TABLE `exam_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`number` integer NOT NULL,
	`questions` text NOT NULL,
	`sources` text NOT NULL,
	`planned` integer NOT NULL,
	`minutes` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exam_sets_exam` ON `exam_sets` (`exam_id`);
--> statement-breakpoint
CREATE TABLE `exam_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`set_id` text NOT NULL,
	`timer` text DEFAULT 'none' NOT NULL,
	`started_at` integer NOT NULL,
	`deadline` integer,
	`handed_in_at` integer,
	`answers` text NOT NULL,
	`feedback` text,
	FOREIGN KEY (`set_id`) REFERENCES `exam_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exam_attempts_set` ON `exam_attempts` (`set_id`);
