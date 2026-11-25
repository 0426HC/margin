-- Explained without the Key concepts table: every named idea is explained inside the sections. Layers written with the table are
-- written again in the new shape when next opened (their old text shows until then; the read-only demo keeps its text); the table and
-- "Also mentioned" go from what is stored.
UPDATE `layers` SET `content_status` = 'stale'
WHERE `content_status` = 'ready' AND `id` IN (SELECT `layer_id` FROM `layer_content` WHERE json_extract(`explained`, '$.concepts') IS NOT NULL)
AND `part_id` IN (SELECT `parts`.`id` FROM `parts` JOIN `projects` ON `projects`.`id` = `parts`.`project_id` WHERE `projects`.`is_demo` = 0);
--> statement-breakpoint
UPDATE `layer_content` SET `explained` = json_remove(`explained`, '$.concepts', '$.alsoMentioned')
WHERE json_extract(`explained`, '$.concepts') IS NOT NULL OR json_extract(`explained`, '$.alsoMentioned') IS NOT NULL;
--> statement-breakpoint
DELETE FROM `ui_state` WHERE `key` LIKE 'layer-draft:%';
