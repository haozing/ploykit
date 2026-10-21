package pg

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/haozing/ploykit/platform/webx"
)

// PostgreSQL SQLSTATEs that mean "the caller sent something the database
// rejects" rather than "the server is broken". Mapping them here keeps every
// consumer from hand-rolling the same switch (and from forgetting it — the
// failure mode is a 500 with a generic "server error" where the client
// deserved a 400).
const (
	// string_data_right_truncation: a value exceeded a varchar(n)/char(n)
	// column width. The request is invalid; retrying cannot help.
	sqlStateStringTooLong = "22001"
	// invalid_text_representation: a value cannot be parsed as the target
	// type (malformed UUID, non-numeric text into a numeric column).
	sqlStateInvalidTextRepresentation = "22P02"
	// numeric_value_out_of_range: a number exceeded the column's range.
	sqlStateNumericOutOfRange = "22003"
	// foreign_key_violation: the referenced row is absent or still referenced.
	sqlStateForeignKeyViolation = "23503"
)

// IsStringTooLong reports whether err is PostgreSQL's varchar/char overflow
// (SQLSTATE 22001). Service layers validate maxLength themselves; this is the
// backstop for the columns nobody remembered to bound.
func IsStringTooLong(err error) bool { return hasSQLState(err, sqlStateStringTooLong) }

// IsInvalidTextRepresentation reports whether err is a value the database
// could not parse as the target type (SQLSTATE 22P02) — typically a malformed
// UUID reaching a ::uuid cast or a path parameter used verbatim in a query.
func IsInvalidTextRepresentation(err error) bool {
	return hasSQLState(err, sqlStateInvalidTextRepresentation)
}

// IsNumericOutOfRange reports whether err is a numeric overflow (SQLSTATE
// 22003).
func IsNumericOutOfRange(err error) bool { return hasSQLState(err, sqlStateNumericOutOfRange) }

// IsForeignKeyViolation reports whether err is a foreign-key rejection
// (SQLSTATE 23503) — the referenced row is missing on insert, or the row is
// still referenced on delete.
func IsForeignKeyViolation(err error) bool { return hasSQLState(err, sqlStateForeignKeyViolation) }

// AsValidation maps "the caller's input was rejected by the database" to a 400
// E_VALIDATION carrying msg: string overflow, unparseable values and numeric
// range errors. Every other error (transport, constraint shape the caller must
// handle itself, programming errors) is returned untouched so the caller keeps
// its own sentinel semantics.
//
//	fid, err := r.createField(ctx, ...)
//	if err != nil { return pg.AsValidation(err, "field name exceeds the column width") }
//
// Foreign-key violations are deliberately NOT folded in: 23503 means different
// things on insert (related row absent → 400/404) and delete (still referenced
// → 400/409), so callers pick with AsNotFound/IsForeignKeyViolation.
// It returns a *webx.Error (not the internal apierr carrier) so it drops
// straight into any handler that materializes errors through webx.WriteErr —
// including products with their own error-code bridge, which only recognizes
// *webx.Error and would otherwise re-bucket this as E_INTERNAL.
func AsValidation(err error, msg string) error {
	switch {
	case IsStringTooLong(err), IsInvalidTextRepresentation(err), IsNumericOutOfRange(err):
		return webx.NewValidation(msg)
	}
	return err
}

// AsConflict maps a foreign-key violation to 409 with msg (the "still
// referenced, cannot delete" reading of 23503). Any other error passes
// through; use AsNotFound when the "referenced row missing" reading is the
// intended one.
func AsConflict(err error, msg string) error {
	if IsForeignKeyViolation(err) {
		return webx.NewConflict(msg)
	}
	return err
}

func hasSQLState(err error, code string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == code
}
