
import { createWsClient, defaultWsUrl } from '@ploykit/hooks'

let currentWorkspaceId: string | null = null


export function setWsWorkspace(id: string | null): void {
  currentWorkspaceId = id
}

export const wsClient = createWsClient(() => defaultWsUrl(currentWorkspaceId))
