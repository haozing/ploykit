

ALTER TABLE member ADD COLUMN removed_by uuid REFERENCES "user"(id);
