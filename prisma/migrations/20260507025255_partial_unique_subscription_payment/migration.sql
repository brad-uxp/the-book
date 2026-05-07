-- Enforce uniqueness of (subscription_id, due_date) among active (non-deleted)
-- SubscriptionPayment rows. Prisma cannot model partial unique indexes
-- natively, so this is a manual migration.
CREATE UNIQUE INDEX "SubscriptionPayment_subscription_id_due_date_active_key"
ON "SubscriptionPayment"(subscription_id, due_date)
WHERE deleted_at IS NULL;
