-- Task_canvas_only_for_notes compares its columns as text, the same rule as
-- before: only a note can be a canvas (category = 'note' OR note_format =
-- 'text').
--
-- Why: compared as the enums themselves, the constraint depends on the
-- IssueCategory and NoteFormat types. Removing a value from either means
-- renaming the type to `…_old`, creating it again and moving the column over
-- (20261105120000_drop_agent_epics); with this CHECK in place that ALTER
-- COLUMN fails ("operator does not exist: IssueCategory = IssueCategory_old").
-- As text, it depends on neither type. ApiToken_readonly_prefix does the same
-- (20261114130000_api_token_readonly_prefix).
--
-- No row changes, and the rule is never missing. The new CHECK is added first,
-- under a passing name; Postgres checks every row against it, and every row
-- already passes, since the old CHECK holds the very same rule. Only then is
-- the old one dropped and the new one given its name. Stopped at any point,
-- the table still has the rule under one of the two names.
--
-- prisma/migrations.test.ts allows dropping a protected CHECK only in a
-- migration that leaves it in place again, as this one does.

-- AddCheckConstraint
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_canvas_only_for_notes_as_text"
  CHECK ("category"::text = 'note' OR "note_format"::text = 'text');

-- DropCheckConstraint
ALTER TABLE "Task" DROP CONSTRAINT "Task_canvas_only_for_notes";

-- RenameCheckConstraint
ALTER TABLE "Task" RENAME CONSTRAINT "Task_canvas_only_for_notes_as_text" TO "Task_canvas_only_for_notes";
