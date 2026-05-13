/**
 *
 */

export interface ThemePreset {
  name: string;
  displayName: string;
  hex: string; // HEX 颜色值
  hue: number; //
  chroma: number; // and度
  lightness: number; //
  description: string;
}

/**
 */
export const THEME_PRESETS: Record<string, ThemePreset> = {
  //
  //
  //

  indigo: {
    name: 'indigo',
    displayName: '靛蓝（推荐）',
    hex: '#6366f1',
    hue: 260,
    chroma: 0.21,
    lightness: 66,
    description: '专业稳重of蓝紫色，适合企业级Productand后台ManageSystem',
  },

  violet: {
    name: 'violet',
    displayName: '紫罗兰',
    hex: '#a855f7',
    hue: 285,
    chroma: 0.22,
    lightness: 70,
    description: '优雅创new紫色，适合创意工具and设计平台',
  },

  purple: {
    name: 'purple',
    displayName: '浅紫',
    hex: '#8b5cf6',
    hue: 280,
    chroma: 0.23,
    lightness: 68,
    description: '柔andof紫色，适合Content创作and社区平台',
  },

  //
  //
  //

  blue: {
    name: 'blue',
    displayName: '蓝色',
    hex: '#3b82f6',
    hue: 240,
    chroma: 0.22,
    lightness: 67,
    description: '经典蓝色，适合企业官网and商务平台',
  },

  sky: {
    name: 'sky',
    displayName: 'day(s)空蓝',
    hex: '#0ea5e9',
    hue: 200,
    chroma: 0.2,
    lightness: 65,
    description: '清新活力of蓝色，适合工具ProductandApplication软件',
  },

  cyan: {
    name: 'cyan',
    displayName: '青色',
    hex: '#06b6d4',
    hue: 195,
    chroma: 0.19,
    lightness: 64,
    description: '现代青色，适合Data平台andAPI工具',
  },

  //
  //
  //

  emerald: {
    name: 'emerald',
    displayName: '翡翠绿',
    hex: '#10b981',
    hue: 160,
    chroma: 0.21,
    lightness: 65,
    description: '清new绿色，适合环保、健康、教育类Product',
  },

  teal: {
    name: 'teal',
    displayName: '青绿',
    hex: '#14b8a6',
    hue: 180,
    chroma: 0.18,
    lightness: 64,
    description: '专业of青绿色，适合金融、医疗类Application',
  },

  //
  //
  //

  rose: {
    name: 'rose',
    displayName: '玫瑰',
    hex: '#f43f5e',
    hue: 350,
    chroma: 0.26,
    lightness: 65,
    description: '活力of玫瑰红，适合社交、娱乐类Product',
  },

  pink: {
    name: 'pink',
    displayName: '粉色',
    hex: '#ec4899',
    hue: 330,
    chroma: 0.24,
    lightness: 72,
    description: '柔andof粉色，适合女性向Productandwhen尚平台',
  },

  orange: {
    name: 'orange',
    displayName: '橙色',
    hex: '#f97316',
    hue: 30,
    chroma: 0.25,
    lightness: 68,
    description: '热情of橙色，适合电商、活动类平台',
  },

  amber: {
    name: 'amber',
    displayName: '琥珀',
    hex: '#f59e0b',
    hue: 50,
    chroma: 0.22,
    lightness: 70,
    description: '温暖of琥珀色，适合餐饮、旅游类Application',
  },
};

/**
 */
export function getPreset(name: string): ThemePreset | null {
  return THEME_PRESETS[name] || null;
}

/**
 */
export function getAllPresetNames(): string[] {
  return Object.keys(THEME_PRESETS);
}

/**
 */
export const PRESETS_BY_CATEGORY = {
  蓝紫色系: ['indigo', 'violet', 'purple'],
  蓝色系: ['blue', 'sky', 'cyan'],
  绿色系: ['emerald', 'teal'],
  暖色系: ['rose', 'pink', 'orange', 'amber'],
} as const;
