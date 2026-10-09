import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Avatar, AvatarImage, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarBadge } from '../avatar'

describe('avatar 冒烟', () => {
  it('无图时渲染 AvatarFallback 内容', () => {
    render(
      <Avatar>
        <AvatarImage src="" alt="张三" />
        <AvatarFallback>张</AvatarFallback>
      </Avatar>,
    )
    expect(screen.getByText('张')).toBeVisible()
  })

  it('AvatarGroup + AvatarBadge + AvatarGroupCount 组合渲染', () => {
    render(
      <AvatarGroup>
        <Avatar>
          <AvatarFallback>甲</AvatarFallback>
          <AvatarBadge />
        </Avatar>
        <AvatarGroupCount>+3</AvatarGroupCount>
      </AvatarGroup>,
    )
    expect(screen.getByText('甲')).toBeVisible()
    expect(screen.getByText('+3')).toBeVisible()
  })
})
