/**
 * Agent 视频工作室 REST 封装（docs/plan-agent-video-studio-architecture-2026-11-14.md
 * §4.7 HTTP 面 / 任务下发契约）。
 *
 * - 类型就地手写：openapi 类型生成（packages/client gen:types）另行推进，
 *   video 域尚未入 docs/openapi.yaml，不抢 `components['schemas']` 的道。
 * - 错误处理跟随 @ploykit/client 的 ApiError taxonomy：409 乐观锁冲突以
 *   `E_VIDEO_VERSION_CONFLICT` 抛出，调用方用 isApiError(err, 'E_VIDEO_VERSION_CONFLICT')
 *   识别后提示刷新。
 * - 上传走 FormData（apiFetch 原生透传，自动跳过 JSON Content-Type）。
 *   multipart 无法走 `api.post` 的 JSON 序列化，直接用 apiFetch。
 */
import { api, apiFetch, isApiError } from '@ploykit/client';

// ---------------------------------------------------------------------------
// IR 契约（§4.2.1/§4.2.2）—— 前端只消费的字段；读时容错（写时校验在后端）。
// ---------------------------------------------------------------------------

export interface VideoWord {
  index: number;
  text: string;
  /** 秒；start < end，相邻不重叠、单调递增（后端写时保证）。 */
  start: number;
  end: number;
  source: 'tts' | 'aligner' | 'manual' | 'estimated';
}

export interface VideoEffect {
  id: string;
  /** {text, occurrence}；后端解析后回填 resolvedFrom。 */
  anchor: { text: string; occurrence: number };
  type: string;
  params: Record<string, unknown>;
  resolvedFrom?: { wordIndex: number; reason: 'exact' | 'same_text' | 'nearest' | 'missing' };
}

export interface VideoElement {
  id: string;
  type: 'image' | 'text' | 'shape';
  src?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
  animations?: Array<{
    id: string;
    type: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
    startAnchor: { text: string; occurrence: number };
    durationFrames: number;
    easing: string;
    resolvedFrom?: { wordIndex: number; reason: string };
  }>;
}

export interface VideoIR {
  /** IR 自身版本（保存时跟随 project.version 递增）。 */
  version?: number;
  meta: {
    fps: number;
    width: number;
    height: number;
    durationSec: number;
  };
  script: string;
  words: VideoWord[];
  effects: VideoEffect[];
  elements: VideoElement[];
  audio?: {
    voice?: { key: string; durationSec: number };
    bgm?: { key: string; volume: number };
  };
}

export interface VideoProject {
  id: string;
  title: string;
  script: string;
  version: number;
  updated_at: string;
}

export interface VideoProjectSummary {
  id: string;
  title: string;
  version: number;
  updated_at: string;
}

export interface VideoProjectDetail {
  project: VideoProject;
  ir: VideoIR;
}

// ---------------------------------------------------------------------------
// 模板 + 组合（批B 端点：GET /api/video/templates、
// POST /api/video/projects/{id}/compose）。字段名以任务说明为准，批B 落地
// 后与 docs/openapi.yaml 对齐（主会话对接时核对，见页面文件顶部假设清单）。
// ---------------------------------------------------------------------------

/** 组合主题（色板 + 字号缩放）。 */
export interface VideoTheme {
  key: string;
  name: string;
  /** CSS 可直接消费的颜色（#hex / hsl 均可，前端只透传到 style）。 */
  bg: string;
  fg: string;
  accent: string;
  muted: string;
  /** 字号缩放系数（1 = 基准）。 */
  fontScale: number;
}

/** 组合模板：画布规格 + 可选主题列表 + 一句话描述。 */
export interface VideoTemplate {
  key: string;
  name: string;
  description: string;
  canvasW: number;
  canvasH: number;
  fps: number;
  themes: VideoTheme[];
}

export interface VideoTemplatesResponse {
  templates: VideoTemplate[];
  themes: VideoTheme[];
}

/** compose 响应：新版本号 + 组合出的卡片 + 词条来源。 */
export interface VideoComposeResponse {
  version: number;
  cards: unknown[];
  words_source: string;
}

export interface VideoComposeParams {
  script: string;
  template: string;
  theme: string;
  /** 乐观锁：编辑器内重组必带；创建流首次组合可不带（刚建的项目无并发方）。 */
  expected_version?: number;
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

export type VideoRenderStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted';

export interface VideoRenderParams {
  fps?: number;
  width?: number;
  height?: number;
  burn_subtitles?: boolean;
  /** burn | soft | none */
  subtitle_mode?: 'burn' | 'soft' | 'none';
  /** 覆盖 IR 的 bgm volume（0–1）。 */
  bgm_volume?: number;
}

export interface VideoRender {
  id: string;
  project_id: string;
  status: VideoRenderStatus;
  params: VideoRenderParams;
  frames_done: number;
  frames_total: number;
  output_url?: string;
  error?: string;
  created_at: string;
  updated_at: string;
  finished_at?: string;
}

// ---------------------------------------------------------------------------
// 端点封装
// ---------------------------------------------------------------------------

export const videoApi = {
  listProjects: () => api.get<{ projects: VideoProjectSummary[] }>('/api/video/projects'),

  createProject: (title: string) => api.post<{ id: string; version: number }>('/api/video/projects', { title }),

  /** 模板目录（批B）。404/501 视为「模板服务未部署」，调用方降级到空白项目。 */
  listTemplates: () => api.get<VideoTemplatesResponse>('/api/video/templates'),

  /**
   * 模板组合（批B）：把 script + template + theme 组合成 IR 卡片并写入项目。
   * 409 E_VIDEO_VERSION_CONFLICT 语义与 putIR 一致（expected_version 不匹配）。
   */
  compose: (id: string, params: VideoComposeParams) =>
    api.post<VideoComposeResponse>(`/api/video/projects/${id}/compose`, params),

  getProject: (id: string) => api.get<VideoProjectDetail>(`/api/video/projects/${id}`),

  /**
   * 全量 IR 替换（乐观锁）。冲突时后端返回 409 E_VIDEO_VERSION_CONFLICT
   * （details.current_version）——调用方 catch 后用 isApiError 识别并提示刷新。
   */
  putIR: (id: string, body: { ir: VideoIR; expected_version: number }) =>
    api.put<{ version: number }>(`/api/video/projects/${id}/ir`, body),

  deleteProject: (id: string) => api.delete<void>(`/api/video/projects/${id}`),

  /** preview.html 直出 HTML（塞 iframe src；同源，postMessage origin 校验成立）。 */
  previewUrl: (id: string) => `/api/video/projects/${id}/preview.html`,

  submitRender: (id: string, params: VideoRenderParams = {}) =>
    // 契约是 {params:{...}} 嵌套（openapi createVideoRender；L3 冒烟 F1 修了
    // 契约但漏了这里——界面点渲染报 json unknown field 的根因）。
    api.post<{ render_id: string; status: VideoRenderStatus }>(`/api/video/projects/${id}/renders`, { params }),

  listRenders: (id: string) => api.get<{ items: VideoRender[] }>(`/api/video/projects/${id}/renders`),

  getRender: (renderId: string) =>
    api.get<{ status: VideoRenderStatus; frames_done: number; frames_total: number; output_url?: string; error?: string }>(
      `/api/video/renders/${renderId}`,
    ),

  /** multipart 上传（storagex.ParseUpload，maxBytes=1MiB）。apiFetch 原样透传 FormData。 */
  uploadAsset: (file: File) =>
    apiFetch<{ key: string; url: string; size: number }>('/api/video/assets', {
      method: 'POST',
      body: (() => {
        const fd = new FormData();
        fd.append('file', file);
        return fd;
      })(),
    }),
};

export { isApiError };
/** 乐观锁冲突错误码（后端契约，逐字）。 */
export const E_VIDEO_VERSION_CONFLICT = 'E_VIDEO_VERSION_CONFLICT';
