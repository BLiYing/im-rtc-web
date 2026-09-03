import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';

const container = document.getElementById('root');
if (container === null) throw new Error('找不到 #root');

// StrictMode 在开发下会把 effect 跑两遍——**这是有意开着的**：
// 订阅没配对清理、发布做了两次这类问题会立刻暴露，而不是等到线上。
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
