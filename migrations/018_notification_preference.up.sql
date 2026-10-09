

CREATE TABLE notification_preference (
    user_id           uuid        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    notification_type text        NOT NULL,
    email_enabled     boolean     NOT NULL DEFAULT true,
    in_app_enabled    boolean     NOT NULL DEFAULT true,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, notification_type)
);
