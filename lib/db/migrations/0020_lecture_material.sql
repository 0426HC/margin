-- Round 2: the professor's slides and the professor's lecture notes are one type, lecture material
UPDATE `files` SET `type` = 'lecture' WHERE `type` IN ('slides', 'lecture-notes');
--> statement-breakpoint
-- the author a file's own properties name, so the import can tell the student's notes from the professor's material
ALTER TABLE `files` ADD `author` text;
