import { EmbeddedFileOptions } from 'src/core/embedders/FileEmbedder';
import { TypeFeatures } from 'src/types/fontkit';

export enum ParseSpeeds {
  Fastest = Infinity,
  Fast = 1500,
  Medium = 500,
  Slow = 100,
}

export interface AttachmentOptions extends EmbeddedFileOptions {}

export interface SaveOptions {
  useObjectStreams?: boolean;
  addDefaultPage?: boolean;
  objectsPerTick?: number;
  updateFieldAppearances?: boolean;
  /** 追加式保存：保留原文件字节，只追加改动对象与新的 xref 段。 */
  incremental?: boolean;
}

export interface Base64SaveOptions extends SaveOptions {
  dataUri?: boolean;
}

export interface LoadOptions {
  ignoreEncryption?: boolean;
  parseSpeed?: ParseSpeeds | number;
  throwOnInvalidObject?: boolean;
  updateMetadata?: boolean;
  capNumbers?: boolean;
  /** 宽容加载：收集解析器警告，返回 { doc, warnings }。 */
  lenient?: boolean;
}

export interface EmbedImageOptions {
  /** JPEG 按 EXIF Orientation 自动纠正显示方向，默认 true。 */
  autoCorrectExif?: boolean;
}

export interface CreateOptions {
  updateMetadata?: boolean;
}

export interface EmbedFontOptions {
  subset?: boolean;
  customName?: string;
  features?: TypeFeatures;
}

export interface SetTitleOptions {
  showInWindowTitleBar: boolean;
}
