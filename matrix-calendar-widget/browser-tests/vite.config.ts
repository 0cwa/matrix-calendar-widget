/*
 * Copyright 2026 Matrix Calendar Widget contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { defineConfig, type PluginOption } from 'vite';

export default defineConfig({
  plugins: [react() as PluginOption],
  resolve: {
    dedupe: ['react', 'react-dom', 'i18next', 'react-i18next', '@mui/material'],
  },
  build: {
    commonjsOptions: { strictRequires: true },
    outDir: 'browser-test-dist',
    rollupOptions: { input: path.resolve(__dirname, 'index.html') },
  },
});
