import React from 'react';
import { Badge, Button, Page, PageHeader, Section } from '@ploykit/module-sdk/ui';

export default function NoteDetailPage() {
  return (
    <Page>
      <PageHeader
        title="First note"
        description="Workspace note detail"
        actions={<Button tone="secondary">Edit</Button>}
      />
      <Section title="Status">
        <Badge>Draft</Badge>
      </Section>
      <Section title="Body">
        <p className="text-sm leading-6 text-slate-700">Example note body</p>
      </Section>
    </Page>
  );
}
