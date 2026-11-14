ALTER TABLE `talk_messages` ADD `channel` text DEFAULT 'talk' NOT NULL;--> statement-breakpoint
UPDATE `talk_messages` SET `channel` = 'note' WHERE `role` = 'assistant' AND rowid IN (SELECT rowid + 1 FROM `talk_messages` WHERE `topic` IS NOT NULL);--> statement-breakpoint
UPDATE `talk_messages` SET `channel` = 'note' WHERE `topic` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `talk_messages_channel` ON `talk_messages` (`project_id`,`channel`);
