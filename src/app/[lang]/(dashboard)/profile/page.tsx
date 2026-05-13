'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import useSWR, { mutate } from 'swr';
import useSWRMutation from 'swr/mutation';
import { Edit, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useSession } from '@/lib/auth/client';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { API_KEYS, fetcher, postFetcher, putFetcher } from '@/lib/swr';
import { apiFetch } from '@/lib/shared/auth-client';

const profileFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must not exceed 100 characters')
    .regex(/^[\p{L}\p{M}\p{N}\s'’._-]+$/u, 'Name contains invalid characters'),
  image: z
    .string()
    .trim()
    .url('Invalid image URL')
    .max(2048, 'Image URL must not exceed 2048 characters')
    .optional()
    .or(z.literal('')),
});

const passwordFormSchema = z
  .object({
    currentPassword: z.string().optional(),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string().min(1, 'Confirm password is required'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  });

type ProfileFormData = z.infer<typeof profileFormSchema>;
type PasswordFormData = z.infer<typeof passwordFormSchema>;

interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  createdAt: string;
  role: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

interface ProfileResponse {
  profile: UserProfile;
}

export default function ProfilePage() {
  const t = useTranslations('dashboard.profile');
  const { data: session, isPending: isSessionLoading } = useSession();

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSavedNameRef = useRef('');

  const {
    data: profileData,
    error: profileError,
    isLoading: isProfileLoading,
    mutate: mutateProfile,
  } = useSWR<ProfileResponse>(session?.user?.id ? API_KEYS.USER.PROFILE : null, fetcher);
  const { data: passwordCapability, isLoading: isPasswordCapabilityLoading } = useSWR<{
    hasPassword: boolean;
    mode: 'change' | 'set';
  }>(session?.user?.id ? API_KEYS.USER.PASSWORD : null, fetcher);

  const { trigger: updateProfile, isMutating: isSavingProfile } = useSWRMutation(
    API_KEYS.USER.PROFILE,
    putFetcher<ProfileResponse, ProfileFormData>
  );

  const { trigger: changePassword, isMutating: isSavingPassword } = useSWRMutation(
    API_KEYS.USER.PASSWORD,
    postFetcher<{ success: boolean }, PasswordFormData>
  );

  const profile = profileData?.profile || null;

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileFormSchema),
    mode: 'onBlur',
    defaultValues: {
      name: '',
      image: '',
    },
  });

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  useEffect(() => {
    if (profile) {
      profileForm.reset({
        name: profile.name || '',
        image: profile.image || '',
      });
      lastSavedNameRef.current = profile.name || '';
      setAvatarPreview(null);
    }
  }, [profile, profileForm]);

  useEffect(() => {
    if (profileError) {
      toast.error(t('toast.loadError'));
    }
  }, [profileError, t]);

  const updateProfileData = async (data: Partial<ProfileFormData>) => {
    try {
      // Only send non-empty fields to the API
      const payload: ProfileFormData = {
        name: data.name || '',
        image: data.image || '',
      };
      await updateProfile(payload);
      await mutateProfile();
      toast.success(t('toast.profileUpdateSuccess'));
    } catch (error) {
      console.error('Failed to update profile:', error);
      toast.error(error instanceof Error ? error.message : t('toast.profileUpdateError'));
      throw error;
    }
  };

  const handleNameBlur = profileForm.handleSubmit(async (data) => {
    const trimmedName = data.name.trim();
    if (!trimmedName || trimmedName === lastSavedNameRef.current) return;
    await updateProfileData({ name: trimmedName });
    lastSavedNameRef.current = trimmedName;
    profileForm.setValue('name', trimmedName, { shouldDirty: false });
  });

  const handleAvatarClick = () => {
    if (isUploadingAvatar) return;
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingAvatar(true);
    const previewUrl = URL.createObjectURL(file);
    setAvatarPreview(previewUrl);

    try {
      const formData = new FormData();
      formData.set('file', file);
      const response = await apiFetch(API_KEYS.USER.AVATAR, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to upload avatar');
      }

      await mutateProfile();
      setAvatarPreview(null);
      toast.success(t('toast.profileUpdateSuccess'));
    } catch (error) {
      console.error('Failed to upload avatar:', error);
      setAvatarPreview(null);
      toast.error(error instanceof Error ? error.message : t('toast.profileUpdateError'));
    } finally {
      URL.revokeObjectURL(previewUrl);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setIsUploadingAvatar(false);
    }
  };

  const handlePasswordSubmit = async (data: PasswordFormData) => {
    try {
      await changePassword(data);
      await mutateProfile();
      await mutate(API_KEYS.USER.PASSWORD);
      passwordForm.reset();
      setShowPasswordForm(false);
      toast.success(t('toast.passwordChangeSuccess'));
    } catch (error) {
      console.error('Failed to change password:', error);
      toast.error(error instanceof Error ? error.message : t('toast.passwordChangeError'));
    }
  };

  const user = profile
    ? {
        id: profile.id,
        name: profile.name || t('unknownUser'),
        email: profile.email,
        avatar: profile.image,
      }
    : {
        id: session?.user?.id || '',
        name: session?.user?.name || t('loading'),
        email: session?.user?.email || '',
        avatar: session?.user?.image,
      };

  const showLoading = isSessionLoading || isProfileLoading;
  const isSaving = isSavingProfile || isUploadingAvatar;
  const avatarSrc = avatarPreview || user.avatar || undefined;
  const hasPassword = passwordCapability?.hasPassword === true;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8 px-10 pb-8">
          <div className="flex items-center gap-6">
            <Label className="w-24">{t('basicInfo.avatar')}</Label>
            <div className="relative w-fit">
              <button
                type="button"
                className="group relative"
                onClick={handleAvatarClick}
                disabled={showLoading || isSaving}
                aria-label={t('basicInfo.avatar')}
              >
                <Avatar className="h-24 w-24">
                  <AvatarImage src={avatarSrc} alt={user.name} />
                  <AvatarFallback className="text-2xl">
                    {user.name
                      .split(' ')
                      .map((n: string) => n[0])
                      .join('')}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute inset-0 rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100" />
                <span className="absolute inset-0 flex items-center justify-center text-white opacity-0 transition-opacity group-hover:opacity-100">
                  {isUploadingAvatar ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Edit className="h-5 w-5" />
                  )}
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
                disabled={showLoading || isSaving}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-6">
              <Label htmlFor="name" className="w-24">
                {t('basicInfo.name')}
              </Label>
              <Input
                id="name"
                className="max-w-sm w-full"
                {...profileForm.register('name')}
                onBlur={handleNameBlur}
                disabled={showLoading || isSaving}
              />
            </div>
            {profileForm.formState.errors.name && (
              <p className="text-sm text-destructive mt-1 ml-24">
                {profileForm.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="flex items-center gap-6">
            <Label htmlFor="email" className="w-24">
              {t('basicInfo.email')}
            </Label>
            <Input
              id="email"
              type="email"
              className="max-w-sm w-full"
              value={user.email}
              disabled
            />
          </div>

          {!showPasswordForm ? (
            <Button
              variant="outline"
              onClick={() => setShowPasswordForm(true)}
              disabled={isPasswordCapabilityLoading}
            >
              {hasPassword ? t('security.changePassword') : t('security.setPassword')}
            </Button>
          ) : (
            <form onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)} className="space-y-8">
              {hasPassword ? (
                <div>
                  <div className="flex items-center gap-6">
                    <Label htmlFor="current-password" className="w-24">
                      {t('security.currentPassword')}
                    </Label>
                    <Input
                      id="current-password"
                      type="password"
                      placeholder={t('security.currentPasswordPlaceholder')}
                      className="max-w-sm w-full"
                      {...passwordForm.register('currentPassword')}
                      disabled={isSavingPassword}
                    />
                  </div>
                  {passwordForm.formState.errors.currentPassword && (
                    <p className="text-sm text-destructive mt-1 ml-24">
                      {passwordForm.formState.errors.currentPassword.message}
                    </p>
                  )}
                </div>
              ) : null}

              <div>
                <div className="flex items-center gap-6">
                  <Label htmlFor="new-password" className="w-24">
                    {t('security.newPassword')}
                  </Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder={t('security.newPasswordPlaceholder')}
                    className="max-w-sm w-full"
                    {...passwordForm.register('newPassword')}
                    disabled={isSavingPassword}
                  />
                </div>
                {passwordForm.formState.errors.newPassword && (
                  <p className="text-sm text-destructive mt-1 ml-24">
                    {passwordForm.formState.errors.newPassword.message}
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center gap-6">
                  <Label htmlFor="confirm-password" className="w-24">
                    {t('security.confirmPassword')}
                  </Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder={t('security.confirmPasswordPlaceholder')}
                    className="max-w-sm w-full"
                    {...passwordForm.register('confirmPassword')}
                    disabled={isSavingPassword}
                  />
                </div>
                {passwordForm.formState.errors.confirmPassword && (
                  <p className="text-sm text-destructive mt-1 ml-24">
                    {passwordForm.formState.errors.confirmPassword.message}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={isSavingPassword}>
                  {isSavingPassword ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('buttons.updating')}
                    </>
                  ) : hasPassword ? (
                    t('security.updatePassword')
                  ) : (
                    t('security.createPassword')
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowPasswordForm(false)}
                  disabled={isSavingPassword}
                >
                  {t('buttons.cancel')}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
