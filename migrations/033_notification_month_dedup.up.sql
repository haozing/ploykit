

ALTER TABLE notification ADD COLUMN once_per_month boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX uq_notification_month
  ON notification (user_id, type, date_trunc('month', created_at AT TIME ZONE 'UTC'))
  WHERE once_per_month;
