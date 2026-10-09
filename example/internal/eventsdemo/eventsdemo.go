package eventsdemo

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/google/uuid"

	"github.com/haozing/ploykit/notify/app"
	"github.com/haozing/ploykit/platform/events"
	"github.com/haozing/ploykit/platform/wsx"

	task "myproduct/internal/task"
)

type NotifyPort interface {
	Notify(ctx context.Context, input app.NotifyInput) error
}

type HubPort interface {
	BroadcastEvent(ctx context.Context, scope, event string, payload []byte, eventID string) error
}

type TaskCreatedPayload struct {
	WorkspaceID string   `json:"workspace_id"`
	ActorID     string   `json:"actor_id,omitempty"`
	Task        TaskInfo `json:"task"`
}

type TaskInfo struct {
	ID     string `json:"id"`
	Number int64  `json:"number"`
	Title  string `json:"title"`
}

func Handlers(notify NotifyPort, hub HubPort) events.Handler {
	return func(ctx context.Context, ev events.Event) error {
		var p TaskCreatedPayload
		if len(ev.Payload) > 0 {
			if err := json.Unmarshal(ev.Payload, &p); err != nil {
				slog.Warn("eventsdemo: bad task.created payload",
					"err", err, "workspace_id", ev.WorkspaceID)
				return nil
			}
		}

		ws := ev.WorkspaceID.String()
		if ev.WorkspaceID == uuid.Nil {
			ws = p.WorkspaceID
		}
		if hub != nil && ws != "" {
			if err := hub.BroadcastEvent(ctx, wsx.WorkspaceScope(ws), task.KindTaskCreated, ev.Payload, ""); err != nil {
				return fmt.Errorf("eventsdemo: broadcast: %w", err)
			}
		}

		if notify != nil && p.ActorID != "" && p.Task.ID != "" {
			if err := notify.Notify(ctx, app.NotifyInput{
				UserID:   p.ActorID,
				Type:     task.KindTaskCreated,
				Title:    "任务已创建",
				Body:     fmt.Sprintf("#%d %s", p.Task.Number, p.Task.Title),
				Link:     "/tasks",
				DedupKey: p.Task.ID,
			}); err != nil {
				return fmt.Errorf("eventsdemo: notify: %w", err)
			}
		}
		return nil
	}
}
