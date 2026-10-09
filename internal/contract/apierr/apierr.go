package apierr

const (
	Unauthenticated = "E_UNAUTHENTICATED"
	Forbidden       = "E_FORBIDDEN"
	NotFound        = "E_NOT_FOUND"
	Conflict        = "E_REVISION_CONFLICT"
	Validation      = "E_VALIDATION"
	RateLimited     = "E_RATE_LIMITED"
	Internal        = "E_INTERNAL"

	DuplicatePendingTask = "E_DUPLICATE_PENDING_TASK"
	ActiveDuplicate      = "E_ACTIVE_DUPLICATE"
	SearchTimeout        = "E_SEARCH_TIMEOUT"
	AwaitingState        = "E_AWAITING_STATE"
)

type Error struct {
	Code    string
	Message string
	Details []FieldError
}

type FieldError struct {
	Field   string `json:"field"`
	Problem string `json:"problem"`
}

func (e *Error) Error() string     { return e.Code + ": " + e.Message }
func (e *Error) ErrorCode() string { return e.Code }

func New(code, msg string) *Error { return &Error{Code: code, Message: msg} }

func NewValidation(msg string, fields ...FieldError) *Error {
	return &Error{Code: Validation, Message: msg, Details: fields}
}
