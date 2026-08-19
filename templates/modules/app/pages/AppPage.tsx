import React from 'react';
import { Badge, Button, Page, PageHeader, Section } from '@ploykit/module-sdk/ui';

export default function AppPage() {
  return (
    <Page>
      <PageHeader
        title="__MODULE_NAME__"
        description="Workspace app module"
        actions={<Button>New item</Button>}
      />
      <Section title="Overview" description="The module is ready for workspace workflows.">
        <div className="flex flex-wrap gap-2">
          <Badge tone="success">Ready</Badge>
          <Badge>Workspace</Badge>
        </div>
      </Section>
    </Page>
  );
}
