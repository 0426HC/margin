-- Round 1: the AI labels each file at import (type, week, how sure, why) and reads the course's weeks from the syllabus.
ALTER TABLE `files` ADD `type` text;
--> statement-breakpoint
ALTER TABLE `files` ADD `reason` text;
--> statement-breakpoint
ALTER TABLE `files` ADD `needs_check` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `files` SET `needs_check` = 1 WHERE `guessed` IS NOT NULL AND `guessed` != '[]';
--> statement-breakpoint
-- exam review guides and exam instructions are one type now: exam material
UPDATE `files` SET `category` = 'exam' WHERE `category` = 'review';
--> statement-breakpoint
-- files from before categories existed were course material; a missing category now means "not labelled yet"
UPDATE `files` SET `category` = 'course' WHERE `category` IS NULL AND `status` = 'done';
--> statement-breakpoint
UPDATE `files` SET `role` = CASE WHEN `kind` = 'pptx' OR `page_kind` = 'slide' THEN 'lecture' ELSE 'reading' END WHERE `role` IS NULL AND `category` IN ('course', 'optional');
--> statement-breakpoint
UPDATE `files` SET `type` = CASE
  WHEN `category` = 'syllabus' THEN 'syllabus'
  WHEN `category` = 'notes' THEN 'my-notes'
  WHEN `category` = 'exam' THEN 'exam'
  WHEN `category` = 'optional' THEN 'optional'
  WHEN `category` = 'duplicate' THEN NULL
  WHEN `role` = 'exam' THEN 'exam'
  WHEN `role` = 'lecture' THEN 'slides'
  ELSE 'reading' END
WHERE `status` = 'done';
--> statement-breakpoint
ALTER TABLE `files` DROP COLUMN `guessed`;
--> statement-breakpoint
CREATE TABLE `course_weeks` (
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `week` integer NOT NULL,
  `date` text,
  `title` text DEFAULT '' NOT NULL,
  `kind` text DEFAULT 'class' NOT NULL,
  `syllabus` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_weeks_week` ON `course_weeks` (`project_id`, `week`);
