import React from 'react';
import { Button, Input, Page, PageHeader, ResourceForm, Section, Select, Textarea } from '@ploykit/module-sdk/ui';

export default function NoteEditPage() {
  return (
    <Page>
      <PageHeader title="Edit note" description="Update a workspace note" />
      <Section title="Details">
        <ResourceForm actions={<Button>Save changes</Button>}>
          <Input name="title" defaultValue="First note" />
          <Textarea name="body" defaultValue="Example note body" />
          <Select name="status" defaultValue="draft">
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </Select>
        </ResourceForm>
      </Section>
    </Page>
  );
}
