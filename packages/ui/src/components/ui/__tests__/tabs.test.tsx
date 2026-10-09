import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../tabs'

describe('tabs 冒烟', () => {
  it('点击 Tab 切换面板', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Tab A</TabsTrigger>
          <TabsTrigger value="b">Tab B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Content A</TabsContent>
        <TabsContent value="b">Content B</TabsContent>
      </Tabs>,
    )
    expect(screen.getByText('Content A')).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Tab B' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Tab B' }))
    expect(screen.getByText('Content B')).toBeVisible()
  })
})
