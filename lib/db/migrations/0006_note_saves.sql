CREATE TABLE `note_saves` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`writeback_id` text NOT NULL,
	`version` text NOT NULL,
	`text` text NOT NULL,
	`saved_at` integer NOT NULL,
	FOREIGN KEY (`writeback_id`) REFERENCES `writebacks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_saves_target` ON `note_saves` (`target_type`,`target_id`);--> statement-breakpoint
INSERT INTO `note_saves` (`id`, `target_type`, `target_id`, `writeback_id`, `version`, `text`, `saved_at`)
SELECT f.`id`, f.`target_type`, f.`target_id`, f.`writeback_id`, 'own', w.`text`, f.`finalized_at` FROM `finals` f JOIN `writebacks` w ON w.`id` = f.`writeback_id`;--> statement-breakpoint
DELETE FROM `layer_messages` WHERE `kind` = 'good_enough';--> statement-breakpoint
DROP TABLE `finals`;--> statement-breakpoint
ALTER TABLE `writebacks` ADD `save_choice` text;