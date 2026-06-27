import React from 'react';
import { Badge, Page, PageHeader, Section } from '@ploykit/module-sdk/ui';

export default function PlatformSmokePage() {
  return (
    <Page>
      <PageHeader title="Platform Smoke" description="Current-contract runtime fixture" />
      <Section title="Coverage">
        <div className="flex flex-wrap gap-2">
          <Badge tone="success">Page</Badge>
          <Badge>API</Badge>
          <Badge>Action</Badge>
          <Badge>Job</Badge>
          <Badge>Webhook</Badge>
        </div>
      </Section>
    </Page>
  );
}
