-- CreateIndex
CREATE INDEX "Client_default_referrer_id_idx" ON "Client"("default_referrer_id");

-- CreateIndex
CREATE INDEX "FeePayment_referrer_id_idx" ON "FeePayment"("referrer_id");

-- CreateIndex
CREATE INDEX "Invoice_client_id_idx" ON "Invoice"("client_id");

-- CreateIndex
CREATE INDEX "Invoice_referrer_id_idx" ON "Invoice"("referrer_id");

-- CreateIndex
CREATE INDEX "Person_role_id_idx" ON "Person"("role_id");
