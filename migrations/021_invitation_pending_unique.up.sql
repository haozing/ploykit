

UPDATE workspace_invitation i
SET status = 'revoked', updated_at = now()
WHERE i.status = 'pending'
  AND EXISTS (SELECT 1 FROM workspace_invitation j
              WHERE j.workspace_id = i.workspace_id
                AND j.email = i.email
                AND j.status = 'pending'
                AND j.id <> i.id
                AND (j.created_at, j.id) > (i.created_at, i.id));

CREATE UNIQUE INDEX uq_invitation_pending_ws_email
  ON workspace_invitation (workspace_id, email)
  WHERE status = 'pending';
