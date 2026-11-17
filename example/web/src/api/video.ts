/**
 * Agent 视频工作室 REST 封装（docs/plan-agent-video-studio-architecture-2026-11-14
 * §4.7 HTTP 面 / 任务下发契约）。
 *
 * - 类型就地手写：video 域已在 docs/openapi.yaml 定稿（tag `video`，
 *   components.schemas VideoProject / VideoTemplateInfo / VideoRender …），
 *   openapi 类型生成（packages/client gen:types）跟进后可直接替换本文件的
 *   接口声明；字段名与 openapi 逐字一致（snake_case）。
 * - 错误处理跟随 @ploykit/client 的 ApiError taxonomy：409 乐观锁冲突以
 *   `E_VIDEO_VERSION_CONFLICT` 抛出，调用方用 isApiError(err, 'E_VIDEO_VERSION_CONFLICT')
 *   识别后提示刷新；503 E_NOT_CONFIGURED 表示能力未接线（模板/渲染管线）。
 * - 上传走 FormData（apiFetch 原生透传，自动跳过 JSON Content-Type）。
 *   multipart 无法走 `api.post` 的 JSON 序列化，直接用 apiFetch。
 * - 浏览器原生 GET（iframe / <a download>）带不了 X-Workspace-Id header，
 *   走 workspace 中间件的 GET-only `?workspace_id=` 回退（workspace/adapters/http
 *   /routes.go WorkspaceHeaderCtx）——previewUrl / fileUrl 统一在这里拼。
 */
import { api, apiFetch, isApiError } from '@ploykit/client'

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

/** GET /api/video/projects 的响应：契约是 `{items: [...]}`（openapi
 * listVideoProjects）。后端历史上曾直接写裸数组，读取侧两者都收。 */
export interface VideoProjectListResponse {
  items: VideoProjectSummary[];
}

export interface VideoProjectDetail {
  project: VideoProject;
  ir: VideoIR;
}

// ---------------------------------------------------------------------------
// 模板 + 组合（GET /api/video/templates、POST /api/video/projects/{id}/compose）。
// 形状以 example/internal/video/app/compose.go 的 TemplateCatalogResponse 为准：
// 顶层 themes 是独立目录，模板本身不带 themes；字段全部 snake_case。
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
  font_scale: number;
}

/** 组合模板：画布规格 + 一句话描述（主题不在模板内，见 VideoTemplatesResponse.themes）。 */
export interface VideoTemplate {
  key: string;
  name: string;
  description: string;
  canvas_w: number;
  canvas_h: number;
  fps: number;
  safe_margin: number;
  /** 版式说明（后端补充的可选描述字段，展示用）。 */
  layout?: string;
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

/** POST /renders 的 201 响应与 GET /renders 的行形状一致（service.Render）。 */
export interface VideoRender {
  id: string;
  project_id: string;
  workspace_id?: string;
  status: VideoRenderStatus;
  params?: VideoRenderParams;
  frames_done: number;
  frames_total: number;
  output_key?: string;
  /** 后端拼好的 /api/video/files/<key>；浏览器直取仍需 ?workspace_id=。 */
  output_url?: string;
  /** 首帧缩略图（同上，需 ?workspace_id=）。 */
  thumb_url?: string;
  error?: string;
  created_by?: string;
  created_at: string;
  updated_at?: string;
  finished_at?: string;
}

/** 素材上传上限（后端 storagex.ParseUpload / videoapp.UploadLimitLarge = 50MiB）。 */
export const VIDEO_ASSET_MAX_BYTES = 50 * 1024 * 1024

// ---------------------------------------------------------------------------
// 浏览器原生 GET 的 URL 构造（纯函数，可单测）
// ---------------------------------------------------------------------------

/**
 * 给相对路径追加 `?workspace_id=`（已有 query 时用 `&`）。
 * 绝对 URL（http/https，例如 S3 预签名）原样返回——往预签名 URL 塞 query
 * 会破坏签名，且跨域直取不需要 workspace 中间件。
 */
export function withWorkspaceId(path: string, wsId: string): string {
  if (!wsId) return path
  if (/^https?:\/\//i.test(path)) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}workspace_id=${encodeURIComponent(wsId)}`
}

/** preview.html 直出地址（iframe src；同源，postMessage origin 校验成立）。 */
export function previewUrl(id: string, wsId: string): string {
  return withWorkspaceId(`/api/video/projects/${encodeURIComponent(id)}/preview.html`, wsId)
}

/**
 * 素材/成片直链：既能收裸 key（`video/<ws>/assets/...`），也能收后端已拼好的
 * `/api/video/files/<key>`（Render.output_url / thumb_url 即此后一种）；
 * 绝对 URL 直通。统一补 workspace_id —— 这些链接走 <a download>/<img>，
 * 带不了 X-Workspace-Id header。
 */
export function fileUrl(keyOrUrl: string, wsId: string): string {
  const path = keyOrUrl.startsWith('/') || /^https?:\/\//i.test(keyOrUrl)
    ? keyOrUrl
    : `/api/video/files/${keyOrUrl.replace(/^\/+/, '')}`
  return withWorkspaceId(path, wsId)
}

// ---------------------------------------------------------------------------
// 端点封装
// ---------------------------------------------------------------------------

export const videoApi = {
  /** 项目列表（契约 {items}；裸数组是旧后端，兼容读）。 */
  listProjects: async (): Promise<VideoProjectListResponse> => {
    const res = await api.get<VideoProjectListResponse | VideoProjectSummary[]>('/api/video/projects')
    return { items: Array.isArray(res) ? res : (res.items ?? []) }
  },

  createProject: (title: string) => api.post<{ id: string; version: number }>('/api/video/projects', { title }),

  /** 模板目录。目录无 DB 依赖，未接线时返回空目录（200）；失败按错误码提示。 */
  listTemplates: () => api.get<VideoTemplatesResponse>('/api/video/templates'),

  /**
   * 模板组合：把 script + template + theme 组合成 IR 卡片并写入项目。
   * 409 E_VIDEO_VERSION_CONFLICT 语义与 putIR 一致（expected_version 不匹配）；
   * 400 E_VIDEO_IR_INVALID 是参数问题；503 E_NOT_CONFIGURED 是管线未接线。
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
  previewUrl,

  /** 素材/成片直链（见模块级 fileUrl：统一补 ?workspace_id=）。 */
  fileUrl,

  /**
   * 提交渲染：body `{params}`；带 Idempotency-Key 时网络重试复用同一次提交
   * （后端按 key 返回首单，不重复扣配额）。201 返回 Render 行。
   */
  submitRender: (id: string, params: VideoRenderParams = {}, idempotencyKey?: string) =>
    apiFetch<VideoRender>(`/api/video/projects/${id}/renders`, {
      method: 'POST',
      body: { params },
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
    }),

  listRenders: (id: string) => api.get<{ items: VideoRender[] }>(`/api/video/projects/${id}/renders`),

  getRender: (renderId: string) => api.get<VideoRender>(`/api/video/renders/${renderId}`),

  /**
   * multipart 上传：后端强制 `project_id` 表单字段（routes.go handleUploadAsset），
   * 上限 50MiB（storagex.ParseUpload + UploadLimitLarge）。apiFetch 原样透传 FormData。
   */
  uploadAsset: (file: File, projectId: string) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('project_id', projectId)
    return apiFetch<{ key: string; url: string; size: number }>('/api/video/assets', {
      method: 'POST',
      body: fd,
    })
  },
};

export { isApiError };
/** 乐观锁冲突错误码（后端契约，逐字）。 */
export const E_VIDEO_VERSION_CONFLICT = 'E_VIDEO_VERSION_CONFLICT';
/** 能力未接线（compose / 渲染管线未配置）。 */
export const E_NOT_CONFIGURED = 'E_NOT_CONFIGURED';
/** compose 参数错误（未知模板/主题 key、分卡边界）。 */
export const E_VIDEO_IR_INVALID = 'E_VIDEO_IR_INVALID';
