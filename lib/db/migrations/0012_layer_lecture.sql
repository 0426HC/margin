CREATE TABLE `layer_lecture` (
	`id` text PRIMARY KEY NOT NULL,
	`layer_id` text NOT NULL,
	`facts` text NOT NULL,
	`writing` text NOT NULL,
	`notes` text NOT NULL,
	`notes_hash` text NOT NULL,
	`written_at` integer NOT NULL,
	FOREIGN KEY (`layer_id`) REFERENCES `layers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `layer_lecture_layer` ON `layer_lecture` (`layer_id`);
