

ALTER TABLE session ADD COLUMN impersonated_by uuid REFERENCES "user"(id);
