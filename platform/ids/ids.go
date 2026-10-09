package ids

import (
	"github.com/google/uuid"
)

func NewV7() uuid.UUID { return uuid.Must(uuid.NewV7()) }

func NewV4() uuid.UUID { return uuid.Must(uuid.NewRandom()) }
