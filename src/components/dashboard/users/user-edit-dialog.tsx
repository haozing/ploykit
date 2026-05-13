'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type UserWithDetails, useUpdateUser } from '@/hooks/use-users';

interface UserEditDialogProps {
  user: UserWithDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function UserEditDialog({ user, open, onOpenChange, onSuccess }: UserEditDialogProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [image, setImage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const updateUserMutation = useUpdateUser();

  useEffect(() => {
    if (!open || !user) {
      return;
    }

    setName(user.name || '');
    setEmail(user.email || '');
    setImage(user.image || '');
    setError(null);
  }, [open, user]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!user) {
      return;
    }

    const updates = {
      name: name.trim(),
      email: email.trim(),
      image: image.trim() || undefined,
    };

    try {
      setError(null);
      const result = await updateUserMutation.trigger({
        userId: user.id,
        updates,
      });

      if (!result.success) {
        throw new Error('Failed to update user');
      }

      toast.success('User updated');
      onSuccess?.();
      onOpenChange(false);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to update user';
      setError(message);
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>
            Update the user&apos;s profile fields stored by the platform.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="admin-user-edit-name">Name</Label>
            <Input
              id="admin-user-edit-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={updateUserMutation.isMutating}
              required
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="admin-user-edit-email">Email</Label>
            <Input
              id="admin-user-edit-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={updateUserMutation.isMutating}
              required
              maxLength={255}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="admin-user-edit-image">Avatar URL</Label>
            <Input
              id="admin-user-edit-image"
              type="url"
              value={image}
              onChange={(event) => setImage(event.target.value)}
              disabled={updateUserMutation.isMutating}
              maxLength={2048}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateUserMutation.isMutating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateUserMutation.isMutating || !user}>
              {updateUserMutation.isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
