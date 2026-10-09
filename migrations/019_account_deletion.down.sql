
ALTER TABLE "user" DROP CONSTRAINT user_status_check;
ALTER TABLE "user" ADD CONSTRAINT user_status_check
    CHECK (status IN ('active', 'disabled'));
