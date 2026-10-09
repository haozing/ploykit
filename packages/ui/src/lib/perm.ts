

export type Perm = 'admin' | 'owner'

export function roleSatisfies(role: string | undefined, perm?: Perm): boolean {
  if (perm === undefined) return true
  if (perm === 'owner') return role === 'owner'
  
  return role === 'owner' || role === 'admin'
}
