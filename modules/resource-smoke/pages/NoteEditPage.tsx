import React from 'react';
import { Button, Input, Page, PageHeader, ResourceForm, Section, Textarea } from '@ploykit/module-sdk/ui';

export default function NoteEditPage() {
  return (
    <Page>
      <PageHeader title="Edit note" description="Update a workspace-scoped note" />
      <Section title="Note">
        <ResourceForm actions={<Button>Save</Button>}>
          <Input name="title" placeholder="Title" defaultValue="First note" />
          <Textarea name="body" placeholder="Body" defaultValue="Draft body" />
        </ResourceForm>
      </Section>
    </Page>
  );
}
