CREATE OR REPLACE FUNCTION prevent_row_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_append_only
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

CREATE TRIGGER price_snapshot_append_only
BEFORE UPDATE OR DELETE ON "PriceSnapshot"
FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

CREATE TRIGGER loan_transaction_append_only
BEFORE UPDATE OR DELETE ON "LoanTransaction"
FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

CREATE TRIGGER savings_transaction_append_only
BEFORE UPDATE OR DELETE ON "SavingsTransaction"
FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

CREATE OR REPLACE FUNCTION protect_posted_journal()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'Posted journals cannot be deleted; create a reversal journal';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'Posted journals cannot be changed; create a reversal journal';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_posting_immutable
BEFORE UPDATE OR DELETE ON "Journal"
FOR EACH ROW EXECUTE FUNCTION protect_posted_journal();

CREATE OR REPLACE FUNCTION validate_journal_balance()
RETURNS trigger AS $$
DECLARE
  line_count integer;
  unbalanced_count integer;
BEGIN
  IF NEW.status = 'POSTED' AND OLD.status = 'PENDING' THEN
    SELECT count(*) INTO line_count FROM "JournalLine" WHERE "journalId" = NEW.id;
    IF line_count < 2 THEN
      RAISE EXCEPTION 'A posted journal requires at least two lines';
    END IF;

    SELECT count(*) INTO unbalanced_count
    FROM (
      SELECT a."currencyCode"
      FROM "JournalLine" l
      JOIN "LedgerAccount" a ON a.id = l."accountId"
      WHERE l."journalId" = NEW.id
      GROUP BY a."currencyCode"
      HAVING sum(CASE WHEN l.direction = 'DEBIT' THEN l."amountMinor" ELSE 0 END)
          <> sum(CASE WHEN l.direction = 'CREDIT' THEN l."amountMinor" ELSE 0 END)
    ) balances;

    IF unbalanced_count > 0 THEN
      RAISE EXCEPTION 'Journal must balance debits and credits independently per currency';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_balance_before_post
BEFORE UPDATE OF status ON "Journal"
FOR EACH ROW EXECUTE FUNCTION validate_journal_balance();

CREATE OR REPLACE FUNCTION protect_posted_journal_line()
RETURNS trigger AS $$
DECLARE
  current_status "JournalStatus";
  target_journal_id uuid;
BEGIN
  target_journal_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."journalId" ELSE NEW."journalId" END;
  SELECT status INTO current_status FROM "Journal" WHERE id = target_journal_id;
  IF current_status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'Lines of a posted journal cannot be changed';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posted_journal_lines_immutable
BEFORE INSERT OR UPDATE OR DELETE ON "JournalLine"
FOR EACH ROW EXECUTE FUNCTION protect_posted_journal_line();
