import React from 'react';
import { Button, Page, PageHeader, ResourceTable, Section } from '@ploykit/module-sdk/ui';

const rows = [
  { id: 'note_1', title: 'First note', status: 'draft' },
  { id: 'note_2', title: 'Published note', status: 'published' },
];

export default function NotesListPage() {
  return (
    <Page>
      <PageHeader
        title="__MODULE_NAME__"
        description="Workspace notes"
        actions={<Button>New note</Button>}
      />
      <Section title="Notes">
        <ResourceTable
          rows={rows}
          columns={[
            { key: 'title', header: 'Title' },
            { key: 'status', header: 'Status' },
          ]}
        />
      </Section>
    </Page>
  );
}
