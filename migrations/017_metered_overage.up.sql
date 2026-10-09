

CREATE UNIQUE INDEX uq_order_overage_period ON "order" (workspace_id, (metadata->>'overage_period'))
  WHERE metadata->>'overage_period' IS NOT NULL;
