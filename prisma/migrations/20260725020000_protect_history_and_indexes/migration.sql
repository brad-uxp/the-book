-- Protect accounting history and align indexes with the queries that exist.
--
-- 1. Payments must survive their parent. SalaryPayment and SubscriptionPayment
--    cascaded on delete, so removing a Person or a Subscription erased the
--    payment history behind them — retroactively changing the totals of months
--    that were already closed, with no way back (the audit log stored only the
--    parent's own fields). The API now answers 409 and points at the `inactive`
--    status; these constraints are the backstop underneath it.
--
--    Deliberately unchanged: SalaryBase and SalaryIncreaseReminder stay
--    Cascade. They describe the person's current state, not booked history.

ALTER TABLE "SubscriptionPayment"
  DROP CONSTRAINT "SubscriptionPayment_subscription_id_fkey";
ALTER TABLE "SubscriptionPayment"
  ADD CONSTRAINT "SubscriptionPayment_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "Subscription"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalaryPayment"
  DROP CONSTRAINT "SalaryPayment_person_id_fkey";
ALTER TABLE "SalaryPayment"
  ADD CONSTRAINT "SalaryPayment_person_id_fkey"
  FOREIGN KEY ("person_id") REFERENCES "Person"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Invoice numbers were unique by convention only: the check was a findFirst
--    in the route, so two concurrent creates (or one double-submit) could both
--    pass it and write the same number. The index is partial because the field
--    is optional, and functional because the application compares
--    case-insensitively.
--
--    NOTE: Prisma cannot express a functional or partial unique index, so this
--    is invisible to schema.prisma and a generated migration would drop it.
--    prisma/migrations.test.ts fails the build if that ever happens.

CREATE UNIQUE INDEX "Invoice_invoice_number_lower_key"
  ON "Invoice" (lower("invoice_number"))
  WHERE "invoice_number" IS NOT NULL;

-- 3. The invoice list orders by created_at, which had no index.
CREATE INDEX "Invoice_created_at_idx" ON "Invoice" ("created_at");

-- 4. Redundant: any query filtering on status alone is already served by the
--    left prefix of Invoice_status_due_date_idx.
DROP INDEX "Invoice_status_idx";

-- 5. /api/notifications filters by type, which had no index.
CREATE INDEX "Notification_type_idx" ON "Notification" ("type");
