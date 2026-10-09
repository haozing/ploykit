package app

import (
	"context"
	"errors"
	"time"
)

var ErrNotFound = errors.New("not found")

type Notification struct {
	ID        string     `json:"id"`
	Type      string     `json:"type"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	Link      string     `json:"link,omitempty"`
	Count     int        `json:"count"`
	ReadAt    *time.Time `json:"read_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

type NotifyInput struct {
	UserID string
	Type   string
	Title  string
	Body   string
	Link   string

	DedupKey string

	OncePerMonth bool
}

type Clock func() time.Time

type Repo interface {
	Insert(ctx context.Context, n NotifyInput, now time.Time) (isNew bool, err error)

	ListInbox(ctx context.Context, userID string, limit int) ([]Notification, error)

	UnreadCount(ctx context.Context, userID string) (int, error)

	MarkRead(ctx context.Context, userID, notificationID string) error
	MarkAllRead(ctx context.Context, userID string) error

	Archive(ctx context.Context, userID, notificationID string) error
}

type EmailSender interface {
	SendLoginCode(ctx context.Context, to, code string) error
	SendInvite(ctx context.Context, to, workspaceName, invitationID string) error
	Send(ctx context.Context, to, subject, body string) error
}

type NotifyService struct {
	repo  Repo
	mail  EmailSender
	now   Clock
	prefs PrefGate
}

func NewNotifyService(repo Repo, mail EmailSender, now Clock) *NotifyService {
	return &NotifyService{repo: repo, mail: mail, now: now}
}

func (s *NotifyService) Notify(ctx context.Context, input NotifyInput) error {
	if !s.inAppAllowed(ctx, input.UserID, input.Type) {
		return nil
	}
	now := s.now()

	if input.DedupKey != "" {
		input.DedupKey = input.Type + ":" + input.DedupKey
		input.OncePerMonth = false
		isNew, err := s.repo.Insert(ctx, input, now)
		if err != nil {
			return err
		}
		if !isNew {
			return nil
		}
		return nil
	}

	_, err := s.repo.Insert(ctx, input, now)
	return err
}

func (s *NotifyService) NotifyOncePerMonth(ctx context.Context, input NotifyInput) error {
	if !s.inAppAllowed(ctx, input.UserID, input.Type) {
		return nil
	}
	input.DedupKey = ""
	input.OncePerMonth = true
	_, err := s.repo.Insert(ctx, input, s.now())
	return err
}

func (s *NotifyService) Inbox(ctx context.Context, userID string, limit int) ([]Notification, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	return s.repo.ListInbox(ctx, userID, limit)
}

func (s *NotifyService) Badge(ctx context.Context, userID string) (int, error) {
	return s.repo.UnreadCount(ctx, userID)
}

func (s *NotifyService) MarkRead(ctx context.Context, userID, id string) error {
	return s.repo.MarkRead(ctx, userID, id)
}
func (s *NotifyService) MarkAllRead(ctx context.Context, userID string) error {
	return s.repo.MarkAllRead(ctx, userID)
}
func (s *NotifyService) Archive(ctx context.Context, userID, id string) error {
	return s.repo.Archive(ctx, userID, id)
}

func (s *NotifyService) SendEmail(ctx context.Context, to, subject, body string) error {
	if s.mail == nil {
		return nil
	}
	return s.mail.Send(ctx, to, subject, body)
}

func (s *NotifyService) SendTypeEmail(ctx context.Context, userID, typ, to, subject, body string) error {
	if s.mail == nil {
		return nil
	}
	if !s.emailAllowed(ctx, userID, typ) {
		return nil
	}
	return s.mail.Send(ctx, to, subject, body)
}
