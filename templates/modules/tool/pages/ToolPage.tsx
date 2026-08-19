import React from 'react';
import { Button, Page, PageHeader, ResourceForm, Section, Textarea } from '@ploykit/module-sdk/ui';

export default function ToolPage() {
  return (
    <Page>
      <PageHeader title="__MODULE_NAME__" description="Single-page workspace tool" />
      <Section title="Input">
        <ResourceForm actions={<Button>Run</Button>}>
          <Textarea name="text" placeholder="Paste text" />
        </ResourceForm>
      </Section>
    </Page>
  );
}
