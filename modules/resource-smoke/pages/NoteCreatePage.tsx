import React from 'react';
import { Button, Input, Page, PageHeader, ResourceForm, Section, Textarea } from '@ploykit/module-sdk/ui';

export default function NoteCreatePage() {
  return (
    <Page>
      <PageHeader title="New note" description="Create a workspace-scoped note" />
      <Section title="Note">
        <ResourceForm actions={<Button>Create</Button>}>
          <Input name="title" placeholder="Title" />
          <Textarea name="body" placeholder="Body" />
        </ResourceForm>
      </Section>
    </Page>
  );
}
