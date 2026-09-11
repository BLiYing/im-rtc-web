/** 按顺序匹配：Edge / Opera 的 UA 里也带 `Chrome/`，所以必须排在 Chrome 前面。 */
const BROWSERS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'Edge', pattern: /\bEdg(?:A|iOS)?\/(\d+)/ },
  { name: 'Opera', pattern: /\bOPR\/(\d+)/ },
  { name: 'Firefox', pattern: /\b(?:Firefox|FxiOS)\/(\d+)/ },
  { name: 'Chrome', pattern: /\b(?:Chrome|CriOS)\/(\d+)/ },
  { name: 'Safari', pattern: /\bVersion\/(\d+(?:\.\d+)?).*\bSafari\// },
];

/**
 * describeBrowser 把 UA 缩成「浏览器 主版本」，给设置卡片的「关于」用。
 *
 * Web 端的 WebRTC 是浏览器内置的，**没有一个 libwebrtc 版本号可报**——报浏览器版本就是报 WebRTC 版本。
 * 认不出来时返回空串，由界面决定怎么显示。
 */
export function describeBrowser(userAgent: string): string {
  for (const { name, pattern } of BROWSERS) {
    const version = pattern.exec(userAgent)?.[1];
    if (version !== undefined) return `${name} ${version}`;
  }
  return '';
}
