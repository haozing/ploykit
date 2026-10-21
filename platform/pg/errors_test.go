package pg

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

func pgErr(code string) error { return &pgconn.PgError{Code: code} }

func TestPgErrorClassifiers(t *testing.T) {
	cases := []struct {
		name string
		err  error
		hit  func(error) bool
	}{
		{"22001 string too long", pgErr("22001"), IsStringTooLong},
		{"22P02 invalid text representation", pgErr("22P02"), IsInvalidTextRepresentation},
		{"22003 numeric out of range", pgErr("22003"), IsNumericOutOfRange},
		{"23503 foreign key violation", pgErr("23503"), IsForeignKeyViolation},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			require.True(t, c.hit(c.err))
			// The other classifiers must not fire on the same code.
			for _, other := range cases {
				if other.name == c.name {
					continue
				}
				require.False(t, other.hit(c.err), "%s should not match %s", other.name, c.name)
			}
		})
	}
}

func TestPgErrorClassifiersWrappedAndNonPg(t *testing.T) {
	wrapped := fmt.Errorf("insert field: %w", pgErr("22001"))
	require.True(t, IsStringTooLong(wrapped), "errors.As must see through wrapping")

	require.False(t, IsStringTooLong(nil))
	require.False(t, IsStringTooLong(errors.New("boom")))
	require.False(t, IsInvalidTextRepresentation(errors.New("boom")))
	require.False(t, IsForeignKeyViolation(errors.New("boom")))
	// A unique violation is its own class, not a FK violation.
	require.False(t, IsForeignKeyViolation(pgErr("23505")))
}

func TestAsValidationMapsClientInputErrors(t *testing.T) {
	for _, code := range []string{"22001", "22P02", "22003"} {
		got := AsValidation(pgErr(code), "invalid input")
		var we *webx.Error
		require.ErrorAs(t, got, &we, "code %s should map", code)
		require.Equal(t, 400, we.Status)
		require.Equal(t, webx.CodeValidation, we.Code)
		require.Equal(t, "invalid input", we.Message)
	}

	// Foreign key is NOT validation: the caller decides 400 vs 409 vs 404.
	raw := pgErr("23503")
	require.Same(t, raw, AsValidation(raw, "x"), "23503 must pass through untouched")
	// Unknown errors pass through untouched as well.
	boom := errors.New("boom")
	require.Same(t, boom, AsValidation(boom, "x"))
}

func TestAsConflictMapsForeignKeyOnly(t *testing.T) {
	got := AsConflict(pgErr("23503"), "still referenced, cannot delete")
	var we *webx.Error
	require.ErrorAs(t, got, &we)
	require.Equal(t, 409, we.Status)
	require.Equal(t, webx.CodeConflict, we.Code)
	require.Equal(t, "still referenced, cannot delete", we.Message)

	// Wrapped form works too.
	wrapped := fmt.Errorf("delete: %w", pgErr("23503"))
	require.ErrorAs(t, AsConflict(wrapped, "x"), &we)

	// Everything else is untouched.
	raw := pgErr("22001")
	require.Same(t, raw, AsConflict(raw, "x"))
}
