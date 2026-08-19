import React from 'react';
import { Button, Page, PageHeader, ResourceForm, Section, Textarea } from '@ploykit/module-sdk/ui';

export default function PublicToolPage() {
  return (
    <Page>
      <PageHeader title="Public Tool Smoke" description="Public JSON formatting fixture" />
      <Section title="Formatter">
        <ResourceForm actions={<Button>Format</Button>}>
          <Textarea name="source" placeholder='{"ok": true}' />
        </ResourceForm>
      </Section>
    </Page>
  );
}
