
import { createWsClient, defaultWsUrl } from '@ploykit/ui'

let currentWorkspaceId: string | null = null


export function setWsWorkspace(id: string | null): void {
  currentWorkspaceId = id
}

export const wsClient = createWsClient(() => defaultWsUrl(currentWorkspaceId))
