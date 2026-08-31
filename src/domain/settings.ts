import { z } from 'zod';

export const settingsSchema = z.object({
  general: z.object({
    defaultSaveDirectory: z.string(),
    autosaveEnabled: z.boolean(),
    recentFilesLimit: z.number().int().min(1).max(50),
    versionHistoryLimit: z.number().int().min(0).max(500).default(50)
  }),
  editor: z.object({
    defaultFont: z.string(),
    defaultFontSize: z.number().min(8).max(96),
    defaultLineHeight: z.number().min(1).max(3)
  }),
  ai: z.object({
    fastModel: z.string(),
    deepModel: z.string(),
    idleAnalysisMinutes: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(5), z.literal(10), z.literal(15)]),
    maxContextCharacters: z.number().int().min(1000).max(100000),
    authorRules: z.string()
  }),
  appearance: z.object({ theme: z.enum(['light', 'dark', 'system']) })
});

export type AppSettings = z.infer<typeof settingsSchema>;

export const defaultSettings: AppSettings = {
  general: { defaultSaveDirectory: '', autosaveEnabled: true, recentFilesLimit: 12, versionHistoryLimit: 50 },
  editor: { defaultFont: '思源宋体', defaultFontSize: 16, defaultLineHeight: 1.75 },
  ai: {
    fastModel: 'deepseek-v4-flash',
    deepModel: 'deepseek-v4-pro',
    idleAnalysisMinutes: 0,
    maxContextCharacters: 12000,
    authorRules: '不要改变我的叙事语气。\n优先指出问题，不要无理由重写。'
  },
  appearance: { theme: 'light' }
};
