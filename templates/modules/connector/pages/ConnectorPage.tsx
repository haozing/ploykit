import React from 'react';
import { Badge, Page, PageHeader, Section } from '@ploykit/module-sdk/ui';

export default function ConnectorPage() {
  return (
    <Page>
      <PageHeader title="__MODULE_NAME__" description="Controlled service connector" />
      <Section title="Connection">
        <div className="flex flex-wrap gap-2">
          <Badge tone="success">Ready</Badge>
          <Badge>Sync job declared</Badge>
        </div>
      </Section>
    </Page>
  );
}
