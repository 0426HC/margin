CREATE TABLE `agent_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`title` text,
	`content` text,
	`note` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_requests_project` ON `agent_requests` (`project_id`);
