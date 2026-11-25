ALTER TABLE `files` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `files` ADD `role` text;--> statement-breakpoint
ALTER TABLE `files` ADD `week` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `absent` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `layers` ADD `new_material_at` integer;--> statement-breakpoint
ALTER TABLE `layers` ADD `proposed` integer DEFAULT false NOT NULL;
