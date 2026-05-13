/**
 * ════════════════════════════════════════════════════════════
 * 联系Table单Component
 * ════════════════════════════════════════════════════════════
 *
 * ClientTable单Component，用atSubmit联系Message
 *
 * 特性：
 * - Table单Validation
 * - Submitto API
 * - Toast Notifications反馈
 * - 多LanguageSupports
 */

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Toast, type ToastType } from '@/components/ui/Toast';

interface FormData {
  name: string;
  email: string;
  subject: string;
  message: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
}

export function ContactForm() {
  const t = useTranslations('contact.form');
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  // ValidationEmailFormat
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Table单Validation
  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = t('validation.nameRequired');
    }

    if (!formData.email.trim()) {
      newErrors.email = t('validation.emailRequired');
    } else if (!validateEmail(formData.email)) {
      newErrors.email = t('validation.emailInvalid');
    }

    if (!formData.subject) {
      newErrors.subject = t('validation.subjectRequired');
    }

    if (!formData.message.trim()) {
      newErrors.message = t('validation.messageRequired');
    } else if (formData.message.trim().length < 10) {
      newErrors.message = t('validation.messageMin');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Table单Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        setToast({ message: t('success'), type: 'success' });
        // Table单
        setFormData({
          name: '',
          email: '',
          subject: '',
          message: '',
        });
        setErrors({});
      } else {
        setToast({ message: data.error || t('error'), type: 'error' });
      }
    } catch (error) {
      console.error('Contact form error:', error);
      setToast({ message: t('error'), type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  //
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // FieldofError
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const inputClassName = `w-full px-4 py-3 rounded-lg border transition-colors ${'border-border focus:border-primary focus:outline-none focus:ring-2 focus:ring-blue-200'}`;

  const errorClassName = 'text-sm text-destructive mt-1';

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Name */}
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--color-text)' }}
          >
            {t('name')}
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder={t('namePlaceholder')}
            className={inputClassName}
            style={{
              color: 'var(--color-text)',
              backgroundColor: 'var(--color-background)',
            }}
          />
          {errors.name && <p className={errorClassName}>{errors.name}</p>}
        </div>

        {/* Email */}
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--color-text)' }}
          >
            {t('email')}
          </label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            placeholder={t('emailPlaceholder')}
            className={inputClassName}
            style={{
              color: 'var(--color-text)',
              backgroundColor: 'var(--color-background)',
            }}
          />
          {errors.email && <p className={errorClassName}>{errors.email}</p>}
        </div>

        {/* Subject */}
        <div>
          <label
            htmlFor="subject"
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--color-text)' }}
          >
            {t('subject')}
          </label>
          <select
            id="subject"
            name="subject"
            value={formData.subject}
            onChange={handleChange}
            className={inputClassName}
            style={{
              color: 'var(--color-text)',
              backgroundColor: 'var(--color-background)',
            }}
          >
            <option value="">{t('subjectPlaceholder')}</option>
            <option value="support">{t('subjects.support')}</option>
            <option value="business">{t('subjects.business')}</option>
            <option value="bug">{t('subjects.bug')}</option>
            <option value="feature">{t('subjects.feature')}</option>
            <option value="other">{t('subjects.other')}</option>
          </select>
          {errors.subject && <p className={errorClassName}>{errors.subject}</p>}
        </div>

        {/* Message */}
        <div>
          <label
            htmlFor="message"
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--color-text)' }}
          >
            {t('message')}
          </label>
          <textarea
            id="message"
            name="message"
            value={formData.message}
            onChange={handleChange}
            placeholder={t('messagePlaceholder')}
            rows={6}
            className={inputClassName}
            style={{
              color: 'var(--color-text)',
              backgroundColor: 'var(--color-background)',
            }}
          />
          {errors.message && <p className={errorClassName}>{errors.message}</p>}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            backgroundColor: 'var(--color-primary)',
            color: 'var(--color-primary-text)',
          }}
        >
          {isSubmitting ? t('sending') : t('send')}
        </button>
      </form>

      {/* Toast Notification */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
