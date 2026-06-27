import React from 'react';
import { Button, Input, Page, PageHeader, ResourceForm, Section, Select, Textarea } from '@ploykit/module-sdk/ui';

export default function NoteCreatePage() {
  return (
    <Page>
      <PageHeader title="New note" description="Create a workspace note" />
      <Section title="Details">
        <ResourceForm actions={<Button>Create note</Button>}>
          <Input name="title" placeholder="Title" />
          <Textarea name="body" placeholder="Body" />
          <Select name="status" defaultValue="draft">
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </Select>
        </ResourceForm>
      </Section>
    </Page>
  );
}
