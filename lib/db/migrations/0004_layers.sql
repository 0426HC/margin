CREATE TABLE `finals` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`writeback_id` text NOT NULL,
	`outcome` text NOT NULL,
	`finalized_at` integer NOT NULL,
	FOREIGN KEY (`writeback_id`) REFERENCES `writebacks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finals_target` ON `finals` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `layer_content` (
	`id` text PRIMARY KEY NOT NULL,
	`layer_id` text NOT NULL,
	`explained` text NOT NULL,
	`source` text NOT NULL,
	`written_at` integer NOT NULL,
	FOREIGN KEY (`layer_id`) REFERENCES `layers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `layer_content_layer` ON `layer_content` (`layer_id`);--> statement-breakpoint
CREATE TABLE `layer_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`role` text NOT NULL,
	`kind` text NOT NULL,
	`writeback_id` text,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`writeback_id`) REFERENCES `writebacks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `layer_messages_target` ON `layer_messages` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `layer_passages` (
	`layer_id` text NOT NULL,
	`passage_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	FOREIGN KEY (`layer_id`) REFERENCES `layers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`passage_id`) REFERENCES `passages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `layer_passages_passage` ON `layer_passages` (`passage_id`);--> statement-breakpoint
CREATE INDEX `layer_passages_layer` ON `layer_passages` (`layer_id`);--> statement-breakpoint
CREATE TABLE `layers` (
	`id` text PRIMARY KEY NOT NULL,
	`part_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`big_question` text NOT NULL,
	`builds_on` text DEFAULT '' NOT NULL,
	`content_status` text DEFAULT 'none' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `layers_part` ON `layers` (`part_id`);--> statement-breakpoint
CREATE TABLE `parts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`breakdown_status` text DEFAULT 'proposed' NOT NULL,
	`approved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parts_key` ON `parts` (`project_id`,`key`);--> statement-breakpoint
CREATE TABLE `writebacks` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`text` text NOT NULL,
	`review` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `writebacks_target` ON `writebacks` (`target_type`,`target_id`);