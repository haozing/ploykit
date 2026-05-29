export type ThemeMode = 'light' | 'dark' | 'system';

export type ThemeDensity = 'comfortable' | 'compact';

export interface HostThemeTokens {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  primary: string;
  primaryForeground: string;
  success: string;
  warning: string;
  destructive: string;
  radius: string;
}

export interface HostThemeProfile {
  id: string;
  name: string;
  modeDefault: ThemeMode;
  density: ThemeDensity;
  tokens: Partial<HostThemeTokens>;
}
