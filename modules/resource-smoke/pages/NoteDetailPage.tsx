import React from 'react';
import { Badge, Page, PageHeader, Section } from '@ploykit/module-sdk/ui';

export default function NoteDetailPage() {
  return (
    <Page>
      <PageHeader title="First note" description="Workspace note detail" />
      <Section title="Status">
        <Badge>draft</Badge>
      </Section>
    </Page>
  );
}
