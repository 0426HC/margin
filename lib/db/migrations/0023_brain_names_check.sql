-- Final round: brains read before the stricter "other names" rule are checked once for wrong merges and loose other names
INSERT OR IGNORE INTO `ui_state` (`id`, `project_id`, `key`, `value`)
SELECT `id` || ':brain-names-check', `id`, 'brain-names-check', 'true' FROM `projects`
WHERE `is_demo` = 0 AND EXISTS (SELECT 1 FROM `brain_notes` WHERE `brain_notes`.`project_id` = `projects`.`id`);
